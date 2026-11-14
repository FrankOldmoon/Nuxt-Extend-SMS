/**
 * CSV bulk import (P1).
 *
 * The parser is intentionally small and deterministic so the same code runs in
 * Chat, the API and tests. Imports are validated row-by-row, written in one
 * batch (idempotent through the natural unique indexes) and return a report the
 * operator can fix and re-upload; `dryRun` validates without writing.
 */
import { and, eq, inArray, isNull } from 'drizzle-orm'
import { createError } from 'h3'
import { db, writeAudit } from '../../../server/sdk'
import { smsClasses, smsStudents } from './database/schema'
import { assignedClassIds } from './students'
import { isSmsAdmin, canUseSms, requireSmsOrganization, type SmsActor } from './context'
import { saveScores } from './exams'
import { enqueueBackgroundJob, snapshotActor } from './jobQueue'

export const IMPORT_MAX_ROWS = 500
export const IMPORT_MAX_BYTES = 200_000

export type ImportRowStatus = 'valid' | 'invalid' | 'imported' | 'skipped'

export interface ImportRowReport {
  line: number
  status: ImportRowStatus
  message?: string
  studentNo?: string
  name?: string
}

export interface StudentImportResult {
  batchId: string
  total: number
  valid: number
  invalid: number
  imported: number
  skipped: number
  dryRun: boolean
  rows: ImportRowReport[]
  /** 可直接保存为 .csv 的错误文件内容（仅含无效行）。 */
  errorsCsv: string
}

export interface ScoreImportResult {
  batchId: string
  total: number
  valid: number
  invalid: number
  imported: number
  skipped: number
  dryRun: boolean
  rows: ImportRowReport[]
  errorsCsv: string
}

/** RFC4180-ish CSV parser: quotes, escaped quotes and CRLF. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let inQuotes = false

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index]
    if (inQuotes) {
      if (char === '"') {
        if (text[index + 1] === '"') {
          field += '"'
          index += 1
        } else {
          inQuotes = false
        }
      } else {
        field += char
      }
      continue
    }
    if (char === '"') {
      inQuotes = true
    } else if (char === ',') {
      row.push(field)
      field = ''
    } else if (char === '\n') {
      row.push(field)
      rows.push(row)
      row = []
      field = ''
    } else if (char !== '\r') {
      field += char
    }
  }
  if (field !== '' || row.length > 0) {
    row.push(field)
    rows.push(row)
  }
  return rows.filter(cells => cells.some(cell => cell.trim() !== ''))
}

const HEADER_ALIASES: Record<string, string[]> = {
  name: ['name', '姓名', '学生姓名'],
  studentNo: ['studentno', 'student_no', '学号'],
  classId: ['classid', 'class_id', '班级id', '班级'],
  score: ['score', '成绩', '分数']
}

function normalizeHeader(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, '')
}

function headerIndex(headers: string[], field: keyof typeof HEADER_ALIASES): number {
  const aliases = HEADER_ALIASES[field] ?? []
  return headers.findIndex(header => aliases.includes(header))
}

function cell(row: string[], index: number): string {
  return index >= 0 ? (row[index] ?? '').trim() : ''
}

function newBatchId(value: unknown): string {
  if (typeof value === 'string' && value.trim()) return value.trim().slice(0, 80)
  return globalThis.crypto?.randomUUID?.() ?? `batch-${Date.now()}-${Math.random().toString(16).slice(2)}`
}

/**
 * CSV 单元格转义。
 * 除引号/逗号/换行外，还要防公式注入：以 `= + - @`、制表符或回车开头的
 * 内容在 Excel 中会被当作公式执行，前置单引号把它固定为文本。
 */
function escapeCsv(value: string): string {
  const guarded = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value
  return /[",\n]/.test(guarded) ? `"${guarded.replace(/"/g, '""')}"` : guarded
}

/** 错误文件：只包含无效行，便于操作员直接修改后重传。 */
export function buildErrorsCsv(rows: readonly ImportRowReport[]): string {
  const header = 'line,studentNo,name,message'
  const body = rows
    .filter(row => row.status === 'invalid')
    .map(row => [String(row.line), row.studentNo ?? '', row.name ?? '', row.message ?? '']
      .map(escapeCsv)
      .join(','))
  return [header, ...body].join('\n')
}

/** 学生可导入班级：组织内未删除班级；非管理员再收窄到教师所授班级。 */
async function importableClassIds(actor: SmsActor): Promise<Set<number>> {
  const organizationId = requireSmsOrganization(actor)
  const rows = await db.select({ id: smsClasses.id }).from(smsClasses)
    .where(and(
      eq(smsClasses.organizationId, organizationId),
      isNull(smsClasses.deletedAt)
    ))
  const all = new Set(rows.map(row => row.id))
  if (isSmsAdmin(actor)) return all
  const assigned = await assignedClassIds(actor)
  return new Set(assigned.filter(id => all.has(id)))
}

export async function importStudentsCsv(
  actor: SmsActor,
  input: { csv?: unknown, dryRun?: unknown, batchId?: unknown, defer?: unknown }
): Promise<StudentImportResult | { queued: true, jobId: number }> {
  const organizationId = requireSmsOrganization(actor)
  if (!canUseSms(actor, 'create', 'students')) {
    throw createError({ statusCode: 403, statusMessage: 'Forbidden', message: 'No permission to import students' })
  }
  // defer=true 时只入队，由 sms:job-worker 执行；dryRun 仍同步返回校验结果。
  if (input.defer === true && input.dryRun !== true) {
    const job = await enqueueBackgroundJob(
      'student-import',
      { actor: snapshotActor(actor), input: { ...input, defer: false } },
      organizationId
    )
    return { queued: true, jobId: job.id }
  }
  const csv = typeof input.csv === 'string' ? input.csv : ''
  if (!csv.trim()) throw createError({ statusCode: 400, message: 'csv 不能为空' })
  if (csv.length > IMPORT_MAX_BYTES) {
    throw createError({ statusCode: 413, message: `CSV 不能超过 ${IMPORT_MAX_BYTES} 字符` })
  }

  const parsed = parseCsv(csv)
  if (parsed.length < 2) throw createError({ statusCode: 400, message: 'CSV 至少需要表头和一行数据' })
  if (parsed.length - 1 > IMPORT_MAX_ROWS) {
    throw createError({ statusCode: 400, message: `单次最多导入 ${IMPORT_MAX_ROWS} 行` })
  }

  const headers = parsed[0]!.map(normalizeHeader)
  const nameIndex = headerIndex(headers, 'name')
  const noIndex = headerIndex(headers, 'studentNo')
  const classIndex = headerIndex(headers, 'classId')
  const missing: string[] = []
  if (nameIndex < 0) missing.push('name')
  if (noIndex < 0) missing.push('studentNo')
  if (classIndex < 0) missing.push('classId')
  if (missing.length > 0) {
    throw createError({ statusCode: 400, message: `缺少列：${missing.join(', ')}` })
  }

  const dryRun = input.dryRun === true
  const batchId = newBatchId(input.batchId)
  const allowedClasses = await importableClassIds(actor)
  const seen = new Set<string>()
  const rows: ImportRowReport[] = []
  const validRows: Array<{ line: number, name: string, studentNo: string, classId: number }> = []

  for (let index = 1; index < parsed.length; index += 1) {
    const raw = parsed[index]!
    const name = cell(raw, nameIndex)
    const studentNo = cell(raw, noIndex)
    const classId = Number(cell(raw, classIndex))
    const line = index + 1

    if (!name) {
      rows.push({ line, status: 'invalid', message: '姓名不能为空', studentNo, name })
      continue
    }
    if (!studentNo) {
      rows.push({ line, status: 'invalid', message: '学号不能为空', studentNo, name })
      continue
    }
    if (seen.has(studentNo)) {
      rows.push({ line, status: 'invalid', message: '文件内学号重复', studentNo, name })
      continue
    }
    seen.add(studentNo)
    if (!Number.isSafeInteger(classId) || classId <= 0) {
      rows.push({ line, status: 'invalid', message: '班级 ID 必须是正整数', studentNo, name })
      continue
    }
    if (!allowedClasses.has(classId)) {
      rows.push({ line, status: 'invalid', message: '班级不存在或超出数据范围', studentNo, name })
      continue
    }

    validRows.push({ line, name, studentNo, classId })
    rows.push({ line, status: 'valid', studentNo, name })
  }

  let imported = 0
  if (!dryRun && validRows.length > 0) {
    const CHUNK = 500
    const insertedNos = new Set<string>()
    await db.transaction(async (tx) => {
      for (let index = 0; index < validRows.length; index += CHUNK) {
        const chunk = validRows.slice(index, index + CHUNK)
        const inserted = await tx.insert(smsStudents)
          .values(chunk.map(row => ({
            organizationId,
            tenantId: actor.tenantId ?? null,
            classId: row.classId,
            name: row.name,
            studentNo: row.studentNo
          })))
          .onConflictDoNothing({
            target: [smsStudents.organizationId, smsStudents.studentNo]
          })
          .returning({ studentNo: smsStudents.studentNo })
        for (const row of inserted) insertedNos.add(row.studentNo)
      }
      imported = insertedNos.size

      // 回填导入状态：已存在（冲突跳过）的行标记为 skipped。
      for (const row of rows) {
        if (row.status !== 'valid' || !row.studentNo) continue
        row.status = insertedNos.has(row.studentNo) ? 'imported' : 'skipped'
        if (row.status === 'skipped') row.message = '学号已存在，已跳过'
      }

      await writeAudit(tx, {
        actorUserId: actor.userId,
        tenantId: actor.tenantId ?? undefined,
        organizationId,
        moduleId: 'sms',
        action: 'student.import',
        resource: 'students',
        recordId: 0,
        after: { batchId, imported, skipped: validRows.length - imported, total: rows.length },
        source: 'sms-service'
      })
    })
  } else if (dryRun) {
    imported = 0
  }

  const invalid = rows.filter(row => row.status === 'invalid').length
  const valid = rows.length - invalid
  return {
    batchId,
    total: rows.length,
    valid,
    invalid,
    imported,
    skipped: dryRun ? 0 : valid - imported,
    dryRun,
    rows: rows.slice(0, IMPORT_MAX_ROWS),
    errorsCsv: buildErrorsCsv(rows)
  }
}

/**
 * 成绩导入：CSV 表头 `studentNo,score`，先校验考试为草稿且学生属于该考试班级，
 * 再复用 `saveScores` 一次写入（保留成绩修订与审计逻辑）。
 */
export async function importScoresCsv(
  actor: SmsActor,
  input: { csv?: unknown, examId?: unknown, dryRun?: unknown, batchId?: unknown, reason?: unknown, defer?: unknown }
): Promise<ScoreImportResult | { queued: true, jobId: number }> {
  const organizationId = requireSmsOrganization(actor)
  if (!canUseSms(actor, 'update', 'scores')) {
    throw createError({ statusCode: 403, statusMessage: 'Forbidden', message: 'No permission to import scores' })
  }
  if (input.defer === true && input.dryRun !== true) {
    const job = await enqueueBackgroundJob(
      'score-import',
      { actor: snapshotActor(actor), input: { ...input, defer: false } },
      organizationId
    )
    return { queued: true, jobId: job.id }
  }
  const examId = Number(input.examId)
  if (!Number.isSafeInteger(examId) || examId <= 0) {
    throw createError({ statusCode: 400, message: 'examId 必须是正整数' })
  }
  const csv = typeof input.csv === 'string' ? input.csv : ''
  if (!csv.trim()) throw createError({ statusCode: 400, message: 'csv 不能为空' })
  if (csv.length > IMPORT_MAX_BYTES) {
    throw createError({ statusCode: 413, message: `CSV 不能超过 ${IMPORT_MAX_BYTES} 字符` })
  }

  const parsed = parseCsv(csv)
  if (parsed.length < 2) throw createError({ statusCode: 400, message: 'CSV 至少需要表头和一行数据' })
  if (parsed.length - 1 > IMPORT_MAX_ROWS) {
    throw createError({ statusCode: 400, message: `单次最多导入 ${IMPORT_MAX_ROWS} 行` })
  }
  const headers = parsed[0]!.map(normalizeHeader)
  const noIndex = headerIndex(headers, 'studentNo')
  const scoreIndex = headerIndex(headers, 'score')
  if (noIndex < 0 || scoreIndex < 0) {
    throw createError({ statusCode: 400, message: '缺少列：studentNo, score' })
  }

  const dryRun = input.dryRun === true
  const batchId = newBatchId(input.batchId)
  const rows: ImportRowReport[] = []
  const studentNos: string[] = []
  const scoreByNo = new Map<string, number>()
  const seen = new Set<string>()

  for (let index = 1; index < parsed.length; index += 1) {
    const raw = parsed[index]!
    const studentNo = cell(raw, noIndex)
    const line = index + 1
    const scoreText = cell(raw, scoreIndex)
    if (!studentNo) {
      rows.push({ line, status: 'invalid', message: '学号不能为空', studentNo })
      continue
    }
    if (seen.has(studentNo)) {
      rows.push({ line, status: 'invalid', message: '文件内学号重复', studentNo })
      continue
    }
    seen.add(studentNo)
    const score = Number(scoreText)
    if (!scoreText || !Number.isFinite(score) || score < 0) {
      rows.push({ line, status: 'invalid', message: '成绩必须是非负数字', studentNo })
      continue
    }
    studentNos.push(studentNo)
    scoreByNo.set(studentNo, score)
    rows.push({ line, status: 'valid', studentNo })
  }

  // 把学号解析为该考试班级内的学生 ID。
  const students = studentNos.length > 0
    ? await db.select({
        id: smsStudents.id,
        studentNo: smsStudents.studentNo
      }).from(smsStudents)
        .where(and(
          eq(smsStudents.organizationId, organizationId),
          inArray(smsStudents.studentNo, studentNos),
          isNull(smsStudents.deletedAt)
        ))
    : []
  const byNo = new Map(students.map(student => [student.studentNo, student.id]))

  for (const row of rows) {
    if (row.status !== 'valid' || !row.studentNo) continue
    if (!byNo.has(row.studentNo)) {
      row.status = 'invalid'
      row.message = '学生不存在或不在本组织'
    }
  }

  const validRows = rows.filter(row => row.status === 'valid' && row.studentNo)
  const resolvedEntries = validRows.map(row => ({
    studentId: byNo.get(row.studentNo!)!,
    score: scoreByNo.get(row.studentNo!)!
  }))

  if (!dryRun && resolvedEntries.length > 0) {
    await saveScores(actor, {
      examId,
      entries: resolvedEntries,
      reason: typeof input.reason === 'string' ? input.reason : `CSV 导入 ${batchId}`
    })
    for (const row of validRows) row.status = 'imported'
  }

  const invalid = rows.filter(row => row.status === 'invalid').length
  const valid = rows.length - invalid
  const imported = dryRun ? 0 : valid
  return {
    batchId,
    total: rows.length,
    valid,
    invalid,
    imported,
    skipped: 0,
    dryRun,
    rows: rows.slice(0, IMPORT_MAX_ROWS),
    errorsCsv: buildErrorsCsv(rows)
  }
}
