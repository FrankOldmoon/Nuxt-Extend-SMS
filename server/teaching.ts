/**
 * Teaching domain (P2): assignments, submissions and course elections.
 *
 * Students act on their own records (resolved from the authenticated user), while
 * staff are limited to their assigned / homeroom classes unless they hold a
 * school-wide scope flag.
 */
import { and, desc, eq, inArray, isNull } from 'drizzle-orm'
import { createError } from 'h3'
import { db, writeAudit } from '../../../server/sdk'
import {
  smsAssignments,
  smsAssignmentSubmissions,
  smsClasses,
  smsCourseElections,
  smsStudents
} from './database/schema'
import { assertSubjectInContext, assertTermInContext } from './academics'
import { assertClassInContext, assignedClassIds } from './students'
import { guardianStudentIds } from './guardians'
import { canUseSms, isSmsAdmin, requireSmsOrganization, type SmsActor } from './context'

export const ASSIGNMENT_STATUSES = ['draft', 'published', 'closed'] as const
export type AssignmentStatus = typeof ASSIGNMENT_STATUSES[number]

export function normalizeAssignmentStatus(value: unknown): AssignmentStatus {
  if (value === undefined || value === null || value === '') return 'draft'
  if (typeof value === 'string' && (ASSIGNMENT_STATUSES as readonly string[]).includes(value)) {
    return value as AssignmentStatus
  }
  throw createError({ statusCode: 400, message: `status must be one of ${ASSIGNMENT_STATUSES.join(', ')}` })
}

function positiveId(value: unknown, field: string): number {
  const id = Number(value)
  if (!Number.isSafeInteger(id) || id <= 0) {
    throw createError({ statusCode: 400, message: `${field} 必须是正整数` })
  }
  return id
}

function requireAssignmentRead(actor: SmsActor): number {
  const organizationId = requireSmsOrganization(actor)
  if (!canUseSms(actor, 'read', 'assignments')) {
    throw createError({ statusCode: 403, statusMessage: 'Forbidden', message: 'No permission to read assignments' })
  }
  return organizationId
}

function requireAssignmentWrite(actor: SmsActor): number {
  const organizationId = requireSmsOrganization(actor)
  if (!canUseSms(actor, 'update', 'assignments')) {
    throw createError({ statusCode: 403, statusMessage: 'Forbidden', message: 'No permission to edit assignments' })
  }
  return organizationId
}

function hasSchoolWide(actor: SmsActor): boolean {
  return isSmsAdmin(actor) || (actor.permissions ?? []).includes('sms.scores.all')
}

/** Student profile linked to the signed-in user. */
async function resolveStudent(actor: SmsActor) {
  const organizationId = requireSmsOrganization(actor)
  const [student] = await db.select({
    id: smsStudents.id,
    classId: smsStudents.classId,
    name: smsStudents.name
  }).from(smsStudents)
    .where(and(
      eq(smsStudents.organizationId, organizationId),
      eq(smsStudents.userId, actor.userId),
      isNull(smsStudents.deletedAt)
    ))
    .limit(1)
  if (!student) {
    throw createError({ statusCode: 403, statusMessage: 'Forbidden', message: 'No student profile is linked to this user' })
  }
  return student
}

async function teachingClassIds(actor: SmsActor): Promise<number[]> {
  const organizationId = requireSmsOrganization(actor)
  const [assigned, homeroom] = await Promise.all([
    assignedClassIds(actor),
    db.select({ id: smsClasses.id }).from(smsClasses).where(and(
      eq(smsClasses.organizationId, organizationId),
      eq(smsClasses.homeroomUserId, actor.userId),
      isNull(smsClasses.deletedAt)
    ))
  ])
  return [...new Set([...assigned, ...homeroom.map(row => row.id)])]
}

async function guardianClassIds(actor: SmsActor): Promise<number[]> {
  const organizationId = requireSmsOrganization(actor)
  const studentIds = await guardianStudentIds(actor)
  if (studentIds.length === 0) return []
  const rows = await db.select({ classId: smsStudents.classId }).from(smsStudents)
    .where(and(
      eq(smsStudents.organizationId, organizationId),
      inArray(smsStudents.id, studentIds),
      isNull(smsStudents.deletedAt)
    ))
  return [...new Set(rows.map(row => row.classId).filter((id): id is number => Number.isSafeInteger(id)))]
}

export interface CreateAssignmentInput {
  classId?: unknown
  subjectId?: unknown
  title?: unknown
  description?: unknown
  dueAt?: unknown
  status?: unknown
}

export async function createAssignment(actor: SmsActor, input: CreateAssignmentInput) {
  const organizationId = requireAssignmentWrite(actor)
  const classId = positiveId(input.classId, 'classId')
  const subjectId = positiveId(input.subjectId, 'subjectId')
  const title = typeof input.title === 'string' ? input.title.trim().slice(0, 200) : ''
  if (!title) throw createError({ statusCode: 400, message: 'title 不能为空' })
  await assertClassInContext(actor, classId)
  await assertSubjectInContext(actor, subjectId)

  const description = typeof input.description === 'string' ? input.description.trim().slice(0, 20_000) : null
  const status = normalizeAssignmentStatus(input.status)
  let dueAt: Date | null = null
  if (typeof input.dueAt === 'string' && input.dueAt.trim()) {
    const parsed = new Date(input.dueAt)
    if (Number.isNaN(parsed.getTime())) throw createError({ statusCode: 400, message: 'dueAt 不是合法时间' })
    dueAt = parsed
  }

  return await db.transaction(async (tx) => {
    const [row] = await tx.insert(smsAssignments).values({
      organizationId,
      tenantId: actor.tenantId ?? null,
      classId,
      subjectId,
      title,
      description,
      dueAt,
      status,
      createdBy: actor.userId
    }).returning()
    if (!row) throw createError({ statusCode: 500, message: 'Failed to create assignment' })
    await writeAudit(tx, {
      actorUserId: actor.userId,
      tenantId: actor.tenantId ?? undefined,
      organizationId,
      moduleId: 'sms',
      action: 'assignment.create',
      resource: 'assignments',
      recordId: row.id,
      after: { title, classId, subjectId, status },
      source: 'sms-service'
    })
    return row
  })
}

export interface ListAssignmentQuery {
  classId?: unknown
  status?: unknown
  limit?: unknown
}

export async function listAssignments(actor: SmsActor, options: ListAssignmentQuery = {}) {
  const organizationId = requireAssignmentRead(actor)
  const conditions = [eq(smsAssignments.organizationId, organizationId)]

  if (actor.roleName === 'student') {
    const student = await resolveStudent(actor)
    conditions.push(eq(smsAssignments.classId, student.classId ?? -1))
    conditions.push(eq(smsAssignments.status, 'published'))
  } else if (actor.roleName === 'guardian') {
    const classIds = await guardianClassIds(actor)
    if (classIds.length === 0) return []
    conditions.push(inArray(smsAssignments.classId, classIds))
    conditions.push(eq(smsAssignments.status, 'published'))
  } else if (!hasSchoolWide(actor)) {
    const classIds = await teachingClassIds(actor)
    if (classIds.length === 0) return []
    conditions.push(inArray(smsAssignments.classId, classIds))
  }

  if (options.classId !== undefined && options.classId !== null && options.classId !== '') {
    conditions.push(eq(smsAssignments.classId, positiveId(options.classId, 'classId')))
  }
  if (options.status !== undefined && options.status !== null && options.status !== '') {
    conditions.push(eq(smsAssignments.status, normalizeAssignmentStatus(options.status)))
  }
  const limit = Math.min(Math.max(Math.floor(Number(options.limit ?? 50) || 50), 1), 200)
  return await db.select({
    id: smsAssignments.id,
    classId: smsAssignments.classId,
    subjectId: smsAssignments.subjectId,
    title: smsAssignments.title,
    description: smsAssignments.description,
    dueAt: smsAssignments.dueAt,
    status: smsAssignments.status,
    createdAt: smsAssignments.createdAt
  }).from(smsAssignments)
    .where(and(...conditions))
    .orderBy(desc(smsAssignments.createdAt))
    .limit(limit)
}

export interface SubmitAssignmentInput {
  assignmentId?: unknown
  content?: unknown
}

export async function submitAssignment(actor: SmsActor, input: SubmitAssignmentInput) {
  const organizationId = requireSmsOrganization(actor)
  if (!canUseSms(actor, 'create', 'assignments')) {
    throw createError({ statusCode: 403, statusMessage: 'Forbidden', message: 'No permission to submit assignments' })
  }
  const assignmentId = positiveId(input.assignmentId, 'assignmentId')
  const student = await resolveStudent(actor)
  const [assignment] = await db.select({
    id: smsAssignments.id,
    classId: smsAssignments.classId,
    status: smsAssignments.status,
    title: smsAssignments.title
  }).from(smsAssignments)
    .where(and(
      eq(smsAssignments.id, assignmentId),
      eq(smsAssignments.organizationId, organizationId)
    ))
    .limit(1)
  if (!assignment) throw createError({ statusCode: 404, message: 'Assignment not found' })
  if (assignment.status !== 'published') {
    throw createError({ statusCode: 409, message: 'Assignment is not open for submission' })
  }
  if (assignment.classId !== student.classId) {
    throw createError({ statusCode: 403, statusMessage: 'Forbidden', message: 'Assignment is not for your class' })
  }
  const content = typeof input.content === 'string' ? input.content.trim().slice(0, 50_000) : null

  return await db.transaction(async (tx) => {
    const [row] = await tx.insert(smsAssignmentSubmissions).values({
      organizationId,
      tenantId: actor.tenantId ?? null,
      assignmentId,
      studentId: student.id,
      content,
      status: 'submitted',
      submittedAt: new Date()
    }).onConflictDoUpdate({
      target: [
        smsAssignmentSubmissions.organizationId,
        smsAssignmentSubmissions.assignmentId,
        smsAssignmentSubmissions.studentId
      ],
      set: { content, status: 'submitted', submittedAt: new Date() }
    }).returning()
    await writeAudit(tx, {
      actorUserId: actor.userId,
      tenantId: actor.tenantId ?? undefined,
      organizationId,
      moduleId: 'sms',
      action: 'assignment.submit',
      resource: 'assignments',
      recordId: assignmentId,
      after: { studentId: student.id, submissionId: row?.id },
      source: 'sms-service'
    })
    return row ?? null
  })
}

export interface GradeSubmissionInput {
  submissionId?: unknown
  score?: unknown
  feedback?: unknown
}

export async function gradeSubmission(actor: SmsActor, input: GradeSubmissionInput) {
  const organizationId = requireAssignmentWrite(actor)
  const submissionId = positiveId(input.submissionId, 'submissionId')
  const score = Number(input.score)
  if (!Number.isFinite(score) || score < 0 || score > 1000) {
    throw createError({ statusCode: 400, message: 'score 必须在 0 到 1000 之间' })
  }
  const [row] = await db.select({
    submissionId: smsAssignmentSubmissions.id,
    assignmentId: smsAssignmentSubmissions.assignmentId,
    classId: smsAssignments.classId
  }).from(smsAssignmentSubmissions)
    .innerJoin(smsAssignments, eq(smsAssignments.id, smsAssignmentSubmissions.assignmentId))
    .where(and(
      eq(smsAssignmentSubmissions.id, submissionId),
      eq(smsAssignmentSubmissions.organizationId, organizationId)
    ))
    .limit(1)
  if (!row) throw createError({ statusCode: 404, message: 'Submission not found' })
  if (!hasSchoolWide(actor)) {
    const classIds = await teachingClassIds(actor)
    if (!classIds.includes(row.classId)) {
      throw createError({ statusCode: 403, statusMessage: 'Forbidden', message: 'Submission is outside your classes' })
    }
  }
  const feedback = typeof input.feedback === 'string' ? input.feedback.trim().slice(0, 500) : null

  return await db.transaction(async (tx) => {
    const [updated] = await tx.update(smsAssignmentSubmissions)
      .set({
        status: 'graded',
        score: score.toFixed(2),
        feedback,
        gradedBy: actor.userId,
        gradedAt: new Date()
      })
      .where(eq(smsAssignmentSubmissions.id, submissionId))
      .returning()
    await writeAudit(tx, {
      actorUserId: actor.userId,
      tenantId: actor.tenantId ?? undefined,
      organizationId,
      moduleId: 'sms',
      action: 'assignment.grade',
      resource: 'assignments',
      recordId: submissionId,
      after: { score: score.toFixed(2), feedback },
      source: 'sms-service'
    })
    return updated ?? null
  })
}

export interface ElectionQuery {
  studentId?: unknown
  termId?: unknown
  status?: unknown
  limit?: unknown
}

export async function listElections(actor: SmsActor, options: ElectionQuery = {}) {
  const organizationId = requireSmsOrganization(actor)
  if (!canUseSms(actor, 'read', 'elections')) {
    throw createError({ statusCode: 403, statusMessage: 'Forbidden', message: 'No permission to read course elections' })
  }
  const conditions = [eq(smsCourseElections.organizationId, organizationId)]

  if (actor.roleName === 'student') {
    const student = await resolveStudent(actor)
    conditions.push(eq(smsCourseElections.studentId, student.id))
  } else if (actor.roleName === 'guardian') {
    const studentIds = await guardianStudentIds(actor)
    if (studentIds.length === 0) return []
    conditions.push(inArray(smsCourseElections.studentId, studentIds))
  } else {
    if (options.studentId !== undefined && options.studentId !== null && options.studentId !== '') {
      conditions.push(eq(smsCourseElections.studentId, positiveId(options.studentId, 'studentId')))
    } else if (!hasSchoolWide(actor)) {
      const classIds = await teachingClassIds(actor)
      if (classIds.length === 0) return []
      const students = await db.select({ id: smsStudents.id }).from(smsStudents).where(and(
        eq(smsStudents.organizationId, organizationId),
        inArray(smsStudents.classId, classIds),
        isNull(smsStudents.deletedAt)
      ))
      if (students.length === 0) return []
      conditions.push(inArray(smsCourseElections.studentId, students.map(student => student.id)))
    }
  }
  if (options.termId !== undefined && options.termId !== null && options.termId !== '') {
    conditions.push(eq(smsCourseElections.termId, positiveId(options.termId, 'termId')))
  }
  if (options.status === 'selected' || options.status === 'dropped') {
    conditions.push(eq(smsCourseElections.status, options.status))
  }
  const limit = Math.min(Math.max(Math.floor(Number(options.limit ?? 100) || 100), 1), 300)
  return await db.select({
    id: smsCourseElections.id,
    studentId: smsCourseElections.studentId,
    subjectId: smsCourseElections.subjectId,
    termId: smsCourseElections.termId,
    status: smsCourseElections.status,
    electedAt: smsCourseElections.electedAt
  }).from(smsCourseElections)
    .where(and(...conditions))
    .orderBy(desc(smsCourseElections.electedAt))
    .limit(limit)
}

export interface SetElectionInput {
  subjectId?: unknown
  termId?: unknown
  action?: unknown
}

export async function setCourseElection(actor: SmsActor, input: SetElectionInput) {
  const organizationId = requireSmsOrganization(actor)
  if (!canUseSms(actor, 'create', 'elections')) {
    throw createError({ statusCode: 403, statusMessage: 'Forbidden', message: 'No permission to change course elections' })
  }
  const subjectId = positiveId(input.subjectId, 'subjectId')
  const termId = positiveId(input.termId, 'termId')
  const action = input.action === 'drop' ? 'drop' : 'elect'
  await assertSubjectInContext(actor, subjectId)
  await assertTermInContext(actor, termId)
  const student = await resolveStudent(actor)

  return await db.transaction(async (tx) => {
    const [row] = await tx.insert(smsCourseElections).values({
      organizationId,
      tenantId: actor.tenantId ?? null,
      studentId: student.id,
      subjectId,
      termId,
      status: action === 'drop' ? 'dropped' : 'selected'
    }).onConflictDoUpdate({
      target: [
        smsCourseElections.organizationId,
        smsCourseElections.studentId,
        smsCourseElections.subjectId,
        smsCourseElections.termId
      ],
      set: { status: action === 'drop' ? 'dropped' : 'selected', updatedAt: new Date() }
    }).returning()
    await writeAudit(tx, {
      actorUserId: actor.userId,
      tenantId: actor.tenantId ?? undefined,
      organizationId,
      moduleId: 'sms',
      action: action === 'drop' ? 'election.drop' : 'election.elect',
      resource: 'elections',
      recordId: row?.id ?? 0,
      after: { studentId: student.id, subjectId, termId, status: row?.status },
      source: 'sms-service'
    })
    return row ?? null
  })
}
