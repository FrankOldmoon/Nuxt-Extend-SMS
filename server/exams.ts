/**
 * Exams, scores and report cards (Slice B).
 *
 * Data scope follows the class ownership rules used by attendance/leave:
 * - `sms.scores.all` (or admin) sees the whole organization;
 * - teachers see their classes;
 * - students/guardians only see *published* exams of their own class.
 *
 * Score edits are only allowed on `draft` exams and every correction writes an
 * immutable `sms_score_revisions` row. Publishing is a high-risk, second-person
 * capability and freezes the exam.
 */
import { and, asc, desc, eq, ilike, inArray, isNull, or, sql } from 'drizzle-orm'
import { createError } from 'h3'
import { db, writeAudit } from '../../../server/sdk'
import {
  smsClasses,
  smsExamScores,
  smsExams,
  smsReportCards,
  smsScoreRevisions,
  smsStudents,
  smsSubjects,
  smsTeacherAssignments,
  smsTerms
} from './database/schema'
import { canUseSms, isSmsAdmin, requireSmsOrganization, type SmsActor } from './context'
import { getStudent } from './students'
import { guardianStudentIds } from './guardians'
import { assertSubjectInContext, assertTermInContext } from './academics'

export const EXAM_STATUSES = ['draft', 'published', 'closed'] as const
export type ExamStatus = typeof EXAM_STATUSES[number]

export const EXAM_TYPES = ['regular', 'midterm', 'final', 'quiz', 'other'] as const
export type ExamType = typeof EXAM_TYPES[number]

const MAX_SCORE_ENTRIES = 100
const DEFAULT_FULL_SCORE = 100
const MAX_FULL_SCORE = 1000

// ---------------------------------------------------------------------------
// Normalisation (pure, unit-tested)
// ---------------------------------------------------------------------------

export function normalizeExamStatus(value: unknown): ExamStatus {
  if (typeof value === 'string' && (EXAM_STATUSES as readonly string[]).includes(value)) {
    return value as ExamStatus
  }
  throw createError({ statusCode: 400, message: `status must be one of ${EXAM_STATUSES.join(', ')}` })
}

export function normalizeExamType(value: unknown): ExamType {
  if (value === undefined || value === null || value === '') return 'regular'
  if (typeof value === 'string' && (EXAM_TYPES as readonly string[]).includes(value)) {
    return value as ExamType
  }
  throw createError({ statusCode: 400, message: `examType must be one of ${EXAM_TYPES.join(', ')}` })
}

export function normalizeExamDate(value: unknown): string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw createError({ statusCode: 400, message: 'examDate must be YYYY-MM-DD' })
  }
  const parsed = new Date(`${value}T00:00:00Z`)
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) {
    throw createError({ statusCode: 400, message: 'examDate is not a valid calendar day' })
  }
  return value
}

export function normalizeFullScore(value: unknown): number {
  if (value === undefined || value === null || value === '') return DEFAULT_FULL_SCORE
  const score = Number(value)
  if (!Number.isFinite(score) || score <= 0 || score > MAX_FULL_SCORE) {
    throw createError({ statusCode: 400, message: `fullScore must be between 0 and ${MAX_FULL_SCORE}` })
  }
  return Math.round(score * 100) / 100
}

/** `null` means "not recorded" (or absent); values are bounded by fullScore. */
export function normalizeScoreValue(value: unknown, fullScore: number, absent = false): number | null {
  if (absent) return null
  if (value === undefined || value === null || value === '') return null
  const score = Number(value)
  if (!Number.isFinite(score) || score < 0 || score > fullScore) {
    throw createError({ statusCode: 400, message: `score must be between 0 and ${fullScore}` })
  }
  return Math.round(score * 100) / 100
}

export interface ScoreEntry {
  studentId: number
  score: number | null
  absent: boolean
  remark: string | null
}

export function normalizeScoreEntries(value: unknown, fullScore: number): ScoreEntry[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw createError({ statusCode: 400, message: 'entries must be a non-empty array' })
  }
  if (value.length > MAX_SCORE_ENTRIES) {
    throw createError({ statusCode: 400, message: `entries must not exceed ${MAX_SCORE_ENTRIES}` })
  }
  const seen = new Set<number>()
  return value.map((entry, index) => {
    if (typeof entry !== 'object' || entry === null) {
      throw createError({ statusCode: 400, message: `entries[${index}] must be an object` })
    }
    const row = entry as Record<string, unknown>
    const studentId = Number(row.studentId)
    if (!Number.isSafeInteger(studentId) || studentId <= 0) {
      throw createError({ statusCode: 400, message: `entries[${index}].studentId must be a positive integer` })
    }
    if (seen.has(studentId)) {
      throw createError({ statusCode: 400, message: `entries[${index}] duplicates student ${studentId}` })
    }
    seen.add(studentId)
    const absent = row.absent === true || row.absent === 'true'
    const remark = typeof row.remark === 'string' && row.remark.trim()
      ? row.remark.trim().slice(0, 255)
      : null
    return { studentId, score: normalizeScoreValue(row.score, fullScore, absent), absent, remark }
  })
}

/** Arithmetic mean of recorded (non-absent) scores, rounded to 2 decimals. */
export function computeAverage(items: ReadonlyArray<{ score: number | null, absent?: boolean }>): number {
  const values = items
    .filter(item => !item.absent && typeof item.score === 'number')
    .map(item => item.score as number)
  if (values.length === 0) return 0
  return Math.round((values.reduce((sum, value) => sum + value, 0) / values.length) * 100) / 100
}

// ---------------------------------------------------------------------------
// Permissions & scope
// ---------------------------------------------------------------------------

function positiveId(value: unknown, field: string): number {
  const id = Number(value)
  if (!Number.isSafeInteger(id) || id <= 0) {
    throw createError({ statusCode: 400, message: `${field} must be a positive integer` })
  }
  return id
}

function optionalId(value: unknown): number | null {
  if (value === undefined || value === null || value === '') return null
  const id = Number(value)
  return Number.isSafeInteger(id) && id > 0 ? id : null
}

function hasPermission(actor: SmsActor, permission: string): boolean {
  if (isSmsAdmin(actor)) return true
  return (actor.permissions ?? []).includes(permission)
}

function requireScoreRead(actor: SmsActor): number {
  const organizationId = requireSmsOrganization(actor)
  if (!canUseSms(actor, 'read', 'scores')) {
    throw createError({ statusCode: 403, statusMessage: 'Forbidden', message: 'No permission to read scores' })
  }
  return organizationId
}

function requireScoreUpdate(actor: SmsActor): number {
  const organizationId = requireSmsOrganization(actor)
  if (!canUseSms(actor, 'update', 'scores')) {
    throw createError({ statusCode: 403, statusMessage: 'Forbidden', message: 'No permission to edit scores' })
  }
  return organizationId
}

function requireExamCreate(actor: SmsActor): number {
  const organizationId = requireSmsOrganization(actor)
  if (!canUseSms(actor, 'create', 'exams')) {
    throw createError({ statusCode: 403, statusMessage: 'Forbidden', message: 'No permission to create exams' })
  }
  return organizationId
}

export function canPublishScores(actor: SmsActor): boolean {
  // `.all` is a data-scope flag only; publishing always needs the explicit grant.
  return hasPermission(actor, 'sms.scores.publish')
}

export function canGenerateReportCard(actor: SmsActor): boolean {
  return hasPermission(actor, 'sms.report-cards.generate')
}

function isStudentFacing(actor: SmsActor): boolean {
  return actor.roleName === 'student' || actor.roleName === 'guardian'
}

/** `null` means whole organization; otherwise the classes the actor can see. */
export async function scopedExamClassIds(actor: SmsActor): Promise<number[] | null> {
  if (isSmsAdmin(actor) || hasPermission(actor, 'sms.scores.all')) return null
  const organizationId = requireSmsOrganization(actor)

  if (actor.roleName === 'student') {
    const [row] = await db.select({ classId: smsStudents.classId }).from(smsStudents)
      .where(and(
        eq(smsStudents.organizationId, organizationId),
        eq(smsStudents.userId, actor.userId),
        isNull(smsStudents.deletedAt)
      ))
      .limit(1)
    return row?.classId ? [row.classId] : []
  }

  if (actor.roleName === 'guardian') {
    const studentIds = await guardianStudentIds(actor)
    if (studentIds.length === 0) return []
    const rows = await db.select({ classId: smsStudents.classId }).from(smsStudents)
      .where(and(eq(smsStudents.organizationId, organizationId), inArray(smsStudents.id, studentIds)))
    return [...new Set(rows.map(row => row.classId).filter((id): id is number => id !== null))]
  }

  const rows = await db.selectDistinct({ classId: smsClasses.id })
    .from(smsClasses)
    .leftJoin(smsTeacherAssignments, and(
      eq(smsTeacherAssignments.classId, smsClasses.id),
      eq(smsTeacherAssignments.organizationId, organizationId),
      eq(smsTeacherAssignments.teacherUserId, actor.userId)
    ))
    .where(and(
      eq(smsClasses.organizationId, organizationId),
      isNull(smsClasses.deletedAt),
      or(
        eq(smsClasses.homeroomUserId, actor.userId),
        eq(smsTeacherAssignments.teacherUserId, actor.userId)
      )
    ))
  return rows.map(row => row.classId)
}

/** Loads an exam with display names and enforces class scope + visibility. */
export async function getExam(actor: SmsActor, examId: number) {
  const organizationId = requireScoreRead(actor)
  const classIds = await scopedExamClassIds(actor)
  if (classIds) {
    const [probe] = await db.select({ classId: smsExams.classId }).from(smsExams)
      .where(and(eq(smsExams.id, examId), eq(smsExams.organizationId, organizationId)))
      .limit(1)
    if (!probe) throw createError({ statusCode: 404, message: 'Exam not found' })
    if (!classIds.includes(probe.classId)) {
      throw createError({ statusCode: 404, message: 'Exam not found' })
    }
  }
  const [row] = await db.select({
    id: smsExams.id,
    name: smsExams.name,
    examType: smsExams.examType,
    examDate: smsExams.examDate,
    fullScore: smsExams.fullScore,
    status: smsExams.status,
    classId: smsExams.classId,
    className: smsClasses.name,
    subjectId: smsExams.subjectId,
    subjectName: smsSubjects.name,
    termId: smsExams.termId,
    termName: smsTerms.name,
    publishedBy: smsExams.publishedBy,
    publishedAt: smsExams.publishedAt,
    createdAt: smsExams.createdAt
  }).from(smsExams)
    .leftJoin(smsClasses, eq(smsClasses.id, smsExams.classId))
    .leftJoin(smsSubjects, eq(smsSubjects.id, smsExams.subjectId))
    .leftJoin(smsTerms, eq(smsTerms.id, smsExams.termId))
    .where(and(eq(smsExams.id, examId), eq(smsExams.organizationId, organizationId)))
    .limit(1)
  if (!row) throw createError({ statusCode: 404, message: 'Exam not found' })
  if (isStudentFacing(actor) && row.status !== 'published') {
    throw createError({ statusCode: 404, message: 'Exam not found' })
  }
  return { ...row, fullScore: Number(row.fullScore) }
}

async function assertClassInExamScope(actor: SmsActor, organizationId: number, classId: number) {
  const [row] = await db.select({ id: smsClasses.id }).from(smsClasses)
    .where(and(
      eq(smsClasses.id, classId),
      eq(smsClasses.organizationId, organizationId),
      isNull(smsClasses.deletedAt)
    ))
    .limit(1)
  if (!row) throw createError({ statusCode: 404, message: 'Class not found' })
  const classIds = await scopedExamClassIds(actor)
  if (classIds && !classIds.includes(classId)) {
    throw createError({ statusCode: 404, message: 'Class not found' })
  }
}

// ---------------------------------------------------------------------------
// Exams
// ---------------------------------------------------------------------------

export interface ExamListQuery {
  termId?: unknown
  classId?: unknown
  subjectId?: unknown
  status?: unknown
  limit?: unknown
}

export async function listExams(actor: SmsActor, options: ExamListQuery = {}) {
  const organizationId = requireScoreRead(actor)
  const classIds = await scopedExamClassIds(actor)
  const conditions = [eq(smsExams.organizationId, organizationId)]
  if (classIds) {
    conditions.push(classIds.length ? inArray(smsExams.classId, classIds) : eq(smsExams.id, -1))
  }
  if (isStudentFacing(actor)) {
    conditions.push(eq(smsExams.status, 'published'))
  } else if (options.status !== undefined && options.status !== null && options.status !== '') {
    conditions.push(eq(smsExams.status, normalizeExamStatus(options.status)))
  }
  const termId = optionalId(options.termId)
  if (termId) conditions.push(eq(smsExams.termId, termId))
  const classId = optionalId(options.classId)
  if (classId) conditions.push(eq(smsExams.classId, classId))
  const subjectId = optionalId(options.subjectId)
  if (subjectId) conditions.push(eq(smsExams.subjectId, subjectId))

  const limit = Math.min(Math.max(Math.floor(Number(options.limit ?? 50) || 50), 1), 200)
  const rows = await db.select({
    id: smsExams.id,
    name: smsExams.name,
    examType: smsExams.examType,
    examDate: smsExams.examDate,
    fullScore: smsExams.fullScore,
    status: smsExams.status,
    classId: smsExams.classId,
    className: smsClasses.name,
    subjectId: smsExams.subjectId,
    subjectName: smsSubjects.name,
    termId: smsExams.termId,
    termName: smsTerms.name,
    createdAt: smsExams.createdAt
  }).from(smsExams)
    .leftJoin(smsClasses, eq(smsClasses.id, smsExams.classId))
    .leftJoin(smsSubjects, eq(smsSubjects.id, smsExams.subjectId))
    .leftJoin(smsTerms, eq(smsTerms.id, smsExams.termId))
    .where(and(...conditions))
    .orderBy(desc(smsExams.examDate), asc(smsExams.id))
    .limit(limit)

  return rows.map(row => ({ ...row, fullScore: Number(row.fullScore) }))
}

export interface CreateExamInput {
  name?: unknown
  classId?: unknown
  subjectId?: unknown
  termId?: unknown
  examType?: unknown
  examDate?: unknown
  fullScore?: unknown
}

export async function createExam(actor: SmsActor, input: CreateExamInput) {
  const organizationId = requireExamCreate(actor)
  const name = typeof input.name === 'string' ? input.name.trim() : ''
  if (!name || name.length > 120) {
    throw createError({ statusCode: 400, message: 'name must be 1-120 characters' })
  }
  const classId = positiveId(input.classId, 'classId')
  await assertClassInExamScope(actor, organizationId, classId)
  const examDate = normalizeExamDate(input.examDate)
  const examType = normalizeExamType(input.examType)
  const fullScore = normalizeFullScore(input.fullScore)
  const subjectId = optionalId(input.subjectId)
  if (subjectId) await assertSubjectInContext(actor, subjectId)
  const termId = optionalId(input.termId)
  if (termId) await assertTermInContext(actor, termId)

  const [existing] = await db.select({ id: smsExams.id }).from(smsExams)
    .where(and(
      eq(smsExams.organizationId, organizationId),
      eq(smsExams.classId, classId),
      eq(smsExams.name, name)
    ))
    .limit(1)
  if (existing) {
    throw createError({ statusCode: 409, message: 'An exam with this name already exists for the class' })
  }

  return await db.transaction(async (tx) => {
    const [row] = await tx.insert(smsExams).values({
      organizationId,
      tenantId: actor.tenantId ?? null,
      termId,
      subjectId,
      classId,
      name,
      examType,
      examDate,
      fullScore: fullScore.toFixed(2),
      createdBy: actor.userId
    }).returning()
    if (!row) throw createError({ statusCode: 500, message: 'Failed to create exam' })
    await writeAudit(tx, {
      actorUserId: actor.userId,
      tenantId: actor.tenantId ?? undefined,
      organizationId,
      moduleId: 'sms',
      action: 'exam.create',
      resource: 'exams',
      recordId: row.id,
      after: row,
      source: 'sms-service'
    })
    return { ...row, fullScore: Number(row.fullScore) }
  })
}

// ---------------------------------------------------------------------------
// Scores
// ---------------------------------------------------------------------------

export interface ScoreSheetQuery {
  examId?: unknown
}

export async function getScoreSheet(actor: SmsActor, options: ScoreSheetQuery) {
  const examId = positiveId(options.examId, 'examId')
  const exam = await getExam(actor, examId)
  const organizationId = requireSmsOrganization(actor)

  const rows = await db.select({
    studentId: smsStudents.id,
    studentName: smsStudents.name,
    studentNo: smsStudents.studentNo,
    scoreId: smsExamScores.id,
    score: smsExamScores.score,
    absent: smsExamScores.absent,
    remark: smsExamScores.remark,
    updatedAt: smsExamScores.updatedAt
  }).from(smsStudents)
    .leftJoin(smsExamScores, and(
      eq(smsExamScores.studentId, smsStudents.id),
      eq(smsExamScores.examId, examId),
      eq(smsExamScores.organizationId, organizationId)
    ))
    .where(and(
      eq(smsStudents.organizationId, organizationId),
      eq(smsStudents.classId, exam.classId),
      isNull(smsStudents.deletedAt)
    ))
    .orderBy(asc(smsStudents.studentNo), asc(smsStudents.id))

  return {
    exam,
    rows: rows.map(row => ({
      ...row,
      score: row.score === null ? null : Number(row.score)
    }))
  }
}

export interface SaveScoresInput {
  examId?: unknown
  entries?: unknown
  reason?: unknown
}

export async function saveScores(actor: SmsActor, input: SaveScoresInput) {
  const organizationId = requireScoreUpdate(actor)
  const examId = positiveId(input.examId, 'examId')
  const exam = await getExam(actor, examId)
  if (exam.status !== 'draft') {
    throw createError({ statusCode: 409, message: 'Published exams cannot be edited; create a correction flow instead' })
  }
  const entries = normalizeScoreEntries(input.entries, exam.fullScore)
  const reason = typeof input.reason === 'string' && input.reason.trim()
    ? input.reason.trim().slice(0, 255)
    : null

  const students = await db.select({ id: smsStudents.id }).from(smsStudents)
    .where(and(
      eq(smsStudents.organizationId, organizationId),
      eq(smsStudents.classId, exam.classId),
      inArray(smsStudents.id, entries.map(entry => entry.studentId))
    ))
  const validIds = new Set(students.map(row => row.id))
  for (const entry of entries) {
    if (!validIds.has(entry.studentId)) {
      throw createError({ statusCode: 400, message: `studentId ${entry.studentId} does not belong to the exam class` })
    }
  }

  return await db.transaction(async (tx) => {
    let created = 0
    let corrected = 0
    let unchanged = 0
    for (const entry of entries) {
      const [existing] = await tx.select({
        id: smsExamScores.id,
        score: smsExamScores.score,
        absent: smsExamScores.absent,
        remark: smsExamScores.remark
      }).from(smsExamScores)
        .where(and(
          eq(smsExamScores.organizationId, organizationId),
          eq(smsExamScores.examId, examId),
          eq(smsExamScores.studentId, entry.studentId)
        ))
        .limit(1)

      const scoreText = entry.score === null ? null : entry.score.toFixed(2)
      if (!existing) {
        const [row] = await tx.insert(smsExamScores).values({
          organizationId,
          tenantId: actor.tenantId ?? null,
          examId,
          studentId: entry.studentId,
          score: scoreText,
          absent: entry.absent,
          remark: entry.remark,
          recordedBy: actor.userId
        }).returning()
        if (row) {
          await tx.insert(smsScoreRevisions).values({
            organizationId,
            tenantId: actor.tenantId ?? null,
            examId,
            scoreId: row.id,
            studentId: entry.studentId,
            beforeScore: null,
            afterScore: scoreText,
            beforeAbsent: null,
            afterAbsent: entry.absent,
            reason: reason ?? 'initial',
            revisedBy: actor.userId
          })
        }
        created += 1
        continue
      }

      const beforeScore = existing.score === null ? null : Number(existing.score)
      const changed = beforeScore !== entry.score || existing.absent !== entry.absent || existing.remark !== entry.remark
      if (!changed) {
        unchanged += 1
        continue
      }
      await tx.update(smsExamScores)
        .set({
          score: scoreText,
          absent: entry.absent,
          remark: entry.remark,
          recordedBy: actor.userId,
          updatedAt: new Date()
        })
        .where(eq(smsExamScores.id, existing.id))
      await tx.insert(smsScoreRevisions).values({
        organizationId,
        tenantId: actor.tenantId ?? null,
        examId,
        scoreId: existing.id,
        studentId: entry.studentId,
        beforeScore: existing.score,
        afterScore: scoreText,
        beforeAbsent: existing.absent,
        afterAbsent: entry.absent,
        reason,
        revisedBy: actor.userId
      })
      corrected += 1
    }

    await writeAudit(tx, {
      actorUserId: actor.userId,
      tenantId: actor.tenantId ?? undefined,
      organizationId,
      moduleId: 'sms',
      action: 'scores.save',
      resource: 'scores',
      recordId: examId,
      after: { examId, created, corrected, unchanged, total: entries.length },
      source: 'sms-service'
    })

    return { examId, className: exam.className, saved: created + corrected, created, corrected, unchanged }
  })
}

export interface SaveScoreInput {
  examId?: unknown
  studentId?: unknown
  score?: unknown
  absent?: unknown
  remark?: unknown
  reason?: unknown
}

/** Single-student wrapper used by the chat capability. */
export async function saveScore(actor: SmsActor, input: SaveScoreInput) {
  return saveScores(actor, {
    examId: input.examId,
    reason: input.reason,
    entries: [{
      studentId: input.studentId,
      score: input.score,
      absent: input.absent === true || input.absent === 'true',
      remark: input.remark
    }]
  })
}

export async function publishExam(actor: SmsActor, examId: number) {
  const organizationId = requireSmsOrganization(actor)
  if (!canPublishScores(actor)) {
    throw createError({ statusCode: 403, statusMessage: 'Forbidden', message: 'No permission to publish scores' })
  }
  const exam = await getExam(actor, examId)
  if (exam.status !== 'draft') {
    throw createError({ statusCode: 409, message: `Exam is already ${exam.status}` })
  }
  const [scored] = await db.select({ count: sql<number>`count(*)::int` }).from(smsExamScores)
    .where(and(
      eq(smsExamScores.organizationId, organizationId),
      eq(smsExamScores.examId, examId)
    ))
  if (!scored || Number(scored.count) === 0) {
    throw createError({ statusCode: 409, message: 'No scores recorded yet' })
  }

  return await db.transaction(async (tx) => {
    const now = new Date()
    const [row] = await tx.update(smsExams)
      .set({ status: 'published', publishedBy: actor.userId, publishedAt: now, updatedAt: now })
      .where(eq(smsExams.id, examId))
      .returning()
    await writeAudit(tx, {
      actorUserId: actor.userId,
      tenantId: actor.tenantId ?? undefined,
      organizationId,
      moduleId: 'sms',
      action: 'scores.publish',
      resource: 'scores',
      recordId: examId,
      before: { status: exam.status },
      after: { status: 'published' },
      source: 'sms-service'
    })
    return { examId, name: exam.name, status: row?.status ?? 'published' }
  })
}

export interface ScoreQuery {
  examId?: unknown
  studentId?: unknown
  classId?: unknown
  /** 学生姓名或学号片段。 */
  query?: unknown
  limit?: unknown
}

export async function listScores(actor: SmsActor, options: ScoreQuery = {}) {
  const organizationId = requireScoreRead(actor)
  const classIds = await scopedExamClassIds(actor)
  const conditions = [eq(smsExamScores.organizationId, organizationId), eq(smsExams.organizationId, organizationId)]

  if (classIds) {
    conditions.push(classIds.length ? inArray(smsExams.classId, classIds) : eq(smsExams.id, -1))
  }
  if (isStudentFacing(actor)) {
    conditions.push(eq(smsExams.status, 'published'))
    if (actor.roleName === 'student') {
      const [row] = await db.select({ id: smsStudents.id }).from(smsStudents)
        .where(and(
          eq(smsStudents.organizationId, organizationId),
          eq(smsStudents.userId, actor.userId)
        ))
        .limit(1)
      conditions.push(eq(smsExamScores.studentId, row?.id ?? -1))
    }
  } else {
    const studentId = optionalId(options.studentId)
    if (studentId) conditions.push(eq(smsExamScores.studentId, studentId))
  }
  const examId = optionalId(options.examId)
  if (examId) conditions.push(eq(smsExamScores.examId, examId))
  const classId = optionalId(options.classId)
  if (classId) conditions.push(eq(smsExams.classId, classId))
  const query = typeof options.query === 'string' ? options.query.trim().slice(0, 80) : ''
  if (query) {
    const pattern = `%${query}%`
    conditions.push(or(
      ilike(smsStudents.name, pattern),
      ilike(smsStudents.studentNo, pattern)
    )!)
  }

  const limit = Math.min(Math.max(Math.floor(Number(options.limit ?? 100) || 100), 1), 200)
  const rows = await db.select({
    id: smsExamScores.id,
    examId: smsExamScores.examId,
    examName: smsExams.name,
    examDate: smsExams.examDate,
    fullScore: smsExams.fullScore,
    examStatus: smsExams.status,
    className: smsClasses.name,
    subjectName: smsSubjects.name,
    studentId: smsExamScores.studentId,
    studentName: smsStudents.name,
    studentNo: smsStudents.studentNo,
    score: smsExamScores.score,
    absent: smsExamScores.absent,
    remark: smsExamScores.remark,
    updatedAt: smsExamScores.updatedAt
  }).from(smsExamScores)
    .innerJoin(smsExams, eq(smsExams.id, smsExamScores.examId))
    .leftJoin(smsStudents, eq(smsStudents.id, smsExamScores.studentId))
    .leftJoin(smsClasses, eq(smsClasses.id, smsExams.classId))
    .leftJoin(smsSubjects, eq(smsSubjects.id, smsExams.subjectId))
    .where(and(...conditions))
    .orderBy(desc(smsExams.examDate), asc(smsStudents.studentNo))
    .limit(limit)

  return rows.map(row => ({
    ...row,
    fullScore: Number(row.fullScore),
    score: row.score === null ? null : Number(row.score)
  }))
}

// ---------------------------------------------------------------------------
// Report cards
// ---------------------------------------------------------------------------

export interface GenerateReportCardInput {
  studentId?: unknown
  termId?: unknown
}

export async function generateReportCard(actor: SmsActor, input: GenerateReportCardInput) {
  const organizationId = requireSmsOrganization(actor)
  if (!canGenerateReportCard(actor)) {
    throw createError({ statusCode: 403, statusMessage: 'Forbidden', message: 'No permission to generate report cards' })
  }
  const studentId = positiveId(input.studentId, 'studentId')
  const student = await getStudent(actor, studentId)
  const termId = optionalId(input.termId)
  if (termId) await assertTermInContext(actor, termId)
  if (!student.classId) {
    throw createError({ statusCode: 409, message: 'Student is not assigned to a class' })
  }

  const conditions = [
    eq(smsExams.organizationId, organizationId),
    eq(smsExams.classId, student.classId),
    eq(smsExams.status, 'published')
  ]
  if (termId) conditions.push(eq(smsExams.termId, termId))

  const rows = await db.select({
    examId: smsExams.id,
    examName: smsExams.name,
    examType: smsExams.examType,
    examDate: smsExams.examDate,
    fullScore: smsExams.fullScore,
    subjectName: smsSubjects.name,
    score: smsExamScores.score,
    absent: smsExamScores.absent,
    remark: smsExamScores.remark
  }).from(smsExams)
    .innerJoin(smsExamScores, and(
      eq(smsExamScores.examId, smsExams.id),
      eq(smsExamScores.studentId, studentId),
      eq(smsExamScores.organizationId, organizationId)
    ))
    .leftJoin(smsSubjects, eq(smsSubjects.id, smsExams.subjectId))
    .where(and(...conditions))
    .orderBy(asc(smsExams.examDate))

  const items = rows.map(row => ({
    examId: row.examId,
    examName: row.examName,
    examType: row.examType,
    examDate: row.examDate,
    subjectName: row.subjectName,
    fullScore: Number(row.fullScore),
    score: row.score === null ? null : Number(row.score),
    absent: row.absent,
    remark: row.remark
  }))
  const average = computeAverage(items)
  const averageRate = items.length === 0
    ? 0
    : Math.round((average / (items[0]?.fullScore ?? DEFAULT_FULL_SCORE)) * 10000) / 100

  const payload = {
    student: {
      id: student.id,
      name: student.name,
      studentNo: student.studentNo,
      classId: student.classId
    },
    termId,
    items,
    average,
    averageRate,
    generatedAt: new Date().toISOString()
  }

  return await db.transaction(async (tx) => {
    const [row] = await tx.insert(smsReportCards).values({
      organizationId,
      tenantId: actor.tenantId ?? null,
      studentId,
      termId,
      payload,
      generatedBy: actor.userId
    }).returning()
    if (!row) throw createError({ statusCode: 500, message: 'Failed to generate report card' })
    await writeAudit(tx, {
      actorUserId: actor.userId,
      tenantId: actor.tenantId ?? undefined,
      organizationId,
      moduleId: 'sms',
      action: 'report-card.generate',
      resource: 'report-cards',
      recordId: row.id,
      after: { studentId, termId, average, exams: items.length },
      source: 'sms-service'
    })
    return { id: row.id, studentId, termId, items, average, averageRate }
  })
}
