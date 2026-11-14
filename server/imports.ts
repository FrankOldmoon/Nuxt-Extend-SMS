/**
 * CSV bulk import (P1).
 *
 * The parser is intentionally small and deterministic so the same code runs in
 * Chat, the API and tests. Imports are validated row-by-row and the response is
 * a report the operator can fix and re-upload; `dryRun` validates without
 * writing.
 */
import { createError } from 'h3'
import { assertClassInContext, createStudent } from './students'
import { canUseSms, requireSmsOrganization, type SmsActor } from './context'

export const IMPORT_MAX_ROWS = 500
export const IMPORT_MAX_BYTES = 200_000

export type ImportRowStatus = 'valid' | 'invalid' | 'imported'

export interface ImportRowReport {
  line: number
  status: ImportRowStatus
  message?: string
  studentNo?: string
  name?: string
}

export interface StudentImportResult {
  total: number
  valid: number
  invalid: number
  imported: number
  dryRun: boolean
  rows: ImportRowReport[]
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
  classId: ['classid', 'class_id', '班级id', '班级']
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

export async function importStudentsCsv(
  actor: SmsActor,
  input: { csv?: unknown, dryRun?: unknown }
): Promise<StudentImportResult> {
  requireSmsOrganization(actor)
  if (!canUseSms(actor, 'create', 'students')) {
    throw createError({ statusCode: 403, statusMessage: 'Forbidden', message: 'No permission to import students' })
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
  const seen = new Set<string>()
  const rows: ImportRowReport[] = []
  let imported = 0

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

    try {
      await assertClassInContext(actor, classId)
    } catch {
      rows.push({ line, status: 'invalid', message: '班级不存在或超出数据范围', studentNo, name })
      continue
    }

    if (dryRun) {
      rows.push({ line, status: 'valid', studentNo, name })
      continue
    }

    try {
      await createStudent(actor, { name, studentNo, classId })
      imported += 1
      rows.push({ line, status: 'imported', studentNo, name })
    } catch (error) {
      const message = error instanceof Error ? error.message : '导入失败'
      rows.push({ line, status: 'invalid', message, studentNo, name })
    }
  }

  const valid = rows.filter(row => row.status !== 'invalid').length
  return {
    total: rows.length,
    valid,
    invalid: rows.length - valid,
    imported,
    dryRun,
    rows: rows.slice(0, IMPORT_MAX_ROWS)
  }
}
