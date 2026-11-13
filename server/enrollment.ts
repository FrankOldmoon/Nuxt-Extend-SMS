import { and, asc, desc, eq, inArray } from 'drizzle-orm'
import { createError } from 'h3'
import { db } from '../../../server/database'
import { writeAudit } from '../../../server/sdk'
import {
  smsClasses,
  smsEnrollments,
  smsGuardians,
  smsStudentGuardians,
  smsStudents,
  smsTeacherAssignments
} from './database/schema'
import { canUseSms, isSmsAdmin, requireSmsOrganization, type SmsActor } from './context'
import { assertAcademicYearInContext, assertTermInContext, classInContext } from './academics'

function requireManage(actor: SmsActor, resource: string): number {
  const organizationId = requireSmsOrganization(actor)
  if (!canUseSms(actor, 'create', resource)) {
    throw createError({ statusCode: 403, statusMessage: 'Forbidden', message: `No permission to manage ${resource}` })
  }
  return organizationId
}

function positiveId(value: unknown, field: string): number {
  const id = Number(value)
  if (!Number.isSafeInteger(id) || id <= 0) {
    throw createError({ statusCode: 400, statusMessage: 'Bad Request', message: `${field} must be a positive integer` })
  }
  return id
}

/** Ensure a student belongs to the actor's organization. */
export async function assertStudentInContext(actor: SmsActor, studentId: number): Promise<void> {
  const organizationId = requireSmsOrganization(actor)
  const [row] = await db.select({ organizationId: smsStudents.organizationId })
    .from(smsStudents).where(eq(smsStudents.id, studentId)).limit(1)
  if (!row || row.organizationId !== organizationId) {
    throw createError({ statusCode: 400, statusMessage: 'Bad Request', message: 'studentId does not belong to the current organization' })
  }
}

export interface EnrollStudentInput {
  studentId?: unknown
  classId?: unknown
  academicYearId?: unknown
  termId?: unknown
}

/**
 * Enroll a student into a class. Enrollment history is kept: one *active*
 * enrollment per student per academic year, older rows become `withdrawn` or
 * `completed` and are never deleted by this flow.
 */
export async function enrollStudent(actor: SmsActor, input: EnrollStudentInput) {
  const organizationId = requireManage(actor, 'enrollments')
  const studentId = positiveId(input.studentId, 'studentId')
  const classId = positiveId(input.classId, 'classId')
  await assertStudentInContext(actor, studentId)
  const classRow = await classInContext(actor, classId)

  let academicYearId = classRow.academicYearId
  if (input.academicYearId !== undefined && input.academicYearId !== null && input.academicYearId !== '') {
    academicYearId = positiveId(input.academicYearId, 'academicYearId')
    await assertAcademicYearInContext(actor, academicYearId)
  }
  if (!academicYearId) {
    throw createError({ statusCode: 400, statusMessage: 'Bad Request', message: 'The class has no academic year; provide academicYearId' })
  }

  let termId: number | null = null
  if (input.termId !== undefined && input.termId !== null && input.termId !== '') {
    termId = positiveId(input.termId, 'termId')
    await assertTermInContext(actor, termId, academicYearId)
  }

  return await db.transaction(async (tx) => {
    const [active] = await tx.select({ id: smsEnrollments.id })
      .from(smsEnrollments)
      .where(and(
        eq(smsEnrollments.studentId, studentId),
        eq(smsEnrollments.academicYearId, academicYearId),
        eq(smsEnrollments.status, 'active')
      ))
      .limit(1)
    if (active) {
      throw createError({ statusCode: 409, statusMessage: 'Conflict', message: 'Student already has an active enrollment for this academic year' })
    }

    const [row] = await tx.insert(smsEnrollments).values({
      organizationId,
      tenantId: actor.tenantId ?? null,
      studentId,
      classId,
      academicYearId,
      termId,
      status: 'active'
    }).returning()
    if (!row) throw createError({ statusCode: 500, message: 'Failed to create enrollment' })

    // Keep the denormalised current class on the student in sync.
    await tx.update(smsStudents)
      .set({ classId })
      .where(and(eq(smsStudents.id, studentId), eq(smsStudents.organizationId, organizationId)))

    await writeAudit(tx, {
      actorUserId: actor.userId,
      tenantId: actor.tenantId ?? undefined,
      organizationId,
      moduleId: 'sms',
      action: 'enrollment.create',
      resource: 'enrollments',
      recordId: row.id,
      after: row,
      source: 'sms-service'
    })
    return row
  })
}

/** Withdraw an active enrollment without deleting its history. */
export async function withdrawEnrollment(actor: SmsActor, enrollmentId: number) {
  const organizationId = requireManage(actor, 'enrollments')
  return await db.transaction(async (tx) => {
    const [current] = await tx.select().from(smsEnrollments).where(and(
      eq(smsEnrollments.id, enrollmentId),
      eq(smsEnrollments.organizationId, organizationId)
    )).limit(1)
    if (!current) {
      throw createError({ statusCode: 404, message: 'Enrollment not found' })
    }
    if (current.status !== 'active') {
      throw createError({ statusCode: 409, statusMessage: 'Conflict', message: 'Only active enrollments can be withdrawn' })
    }
    const [row] = await tx.update(smsEnrollments)
      .set({ status: 'withdrawn', endedAt: new Date() })
      .where(eq(smsEnrollments.id, enrollmentId))
      .returning()
    await writeAudit(tx, {
      actorUserId: actor.userId,
      tenantId: actor.tenantId ?? undefined,
      organizationId,
      moduleId: 'sms',
      action: 'enrollment.withdraw',
      resource: 'enrollments',
      recordId: enrollmentId,
      before: current,
      after: row,
      source: 'sms-service'
    })
    return row
  })
}

// ---------------------------------------------------------------------------
// Read helpers for pages and capabilities
// ---------------------------------------------------------------------------

async function enrollmentScopeConditions(actor: SmsActor) {
  const organizationId = requireSmsOrganization(actor)
  const conditions = [eq(smsEnrollments.organizationId, organizationId)]
  if (isSmsAdmin(actor)) return conditions

  if (actor.roleName === 'student') {
    const [row] = await db.select({ id: smsStudents.id })
      .from(smsStudents)
      .where(and(
        eq(smsStudents.organizationId, organizationId),
        eq(smsStudents.userId, actor.userId)
      ))
      .limit(1)
    conditions.push(row ? eq(smsEnrollments.studentId, row.id) : eq(smsEnrollments.id, -1))
    return conditions
  }

  if (actor.roleName === 'guardian') {
    const rows = await db.select({ studentId: smsStudentGuardians.studentId })
      .from(smsStudentGuardians)
      .innerJoin(smsGuardians, eq(smsGuardians.id, smsStudentGuardians.guardianId))
      .where(and(
        eq(smsStudentGuardians.organizationId, organizationId),
        eq(smsGuardians.userId, actor.userId)
      ))
    const ids = rows.map(row => row.studentId)
    conditions.push(ids.length ? inArray(smsEnrollments.studentId, ids) : eq(smsEnrollments.id, -1))
    return conditions
  }

  const classes = await db.select({ classId: smsTeacherAssignments.classId })
    .from(smsTeacherAssignments)
    .where(and(
      eq(smsTeacherAssignments.organizationId, organizationId),
      eq(smsTeacherAssignments.teacherUserId, actor.userId)
    ))
  const classIds = classes.map(row => row.classId)
  conditions.push(classIds.length ? inArray(smsEnrollments.classId, classIds) : eq(smsEnrollments.id, -1))
  return conditions
}

export interface EnrollmentListOptions {
  studentId?: number | null
  classId?: number | null
  status?: 'active' | 'completed' | 'withdrawn' | null
  limit?: number
}

export async function listEnrollments(actor: SmsActor, options: EnrollmentListOptions = {}) {
  const conditions = await enrollmentScopeConditions(actor)
  if (options.studentId) conditions.push(eq(smsEnrollments.studentId, options.studentId))
  if (options.classId) conditions.push(eq(smsEnrollments.classId, options.classId))
  if (options.status) conditions.push(eq(smsEnrollments.status, options.status))

  const limit = Math.min(Math.max(Math.floor(options.limit ?? 100), 1), 200)
  return await db.select({
    id: smsEnrollments.id,
    studentId: smsEnrollments.studentId,
    studentName: smsStudents.name,
    classId: smsEnrollments.classId,
    className: smsClasses.name,
    academicYearId: smsEnrollments.academicYearId,
    termId: smsEnrollments.termId,
    status: smsEnrollments.status,
    enrolledAt: smsEnrollments.enrolledAt,
    endedAt: smsEnrollments.endedAt
  }).from(smsEnrollments)
    .leftJoin(smsStudents, eq(smsStudents.id, smsEnrollments.studentId))
    .leftJoin(smsClasses, eq(smsClasses.id, smsEnrollments.classId))
    .where(and(...conditions))
    .orderBy(desc(smsEnrollments.enrolledAt), asc(smsEnrollments.id))
    .limit(limit)
}

/** One enrollment visible to the actor; 404 otherwise. */
export async function findEnrollment(actor: SmsActor, enrollmentId: number) {
  const conditions = await enrollmentScopeConditions(actor)
  conditions.push(eq(smsEnrollments.id, enrollmentId))
  const [row] = await db.select({
    id: smsEnrollments.id,
    studentId: smsEnrollments.studentId,
    studentName: smsStudents.name,
    classId: smsEnrollments.classId,
    className: smsClasses.name,
    academicYearId: smsEnrollments.academicYearId,
    termId: smsEnrollments.termId,
    status: smsEnrollments.status,
    enrolledAt: smsEnrollments.enrolledAt,
    endedAt: smsEnrollments.endedAt
  }).from(smsEnrollments)
    .leftJoin(smsStudents, eq(smsStudents.id, smsEnrollments.studentId))
    .leftJoin(smsClasses, eq(smsClasses.id, smsEnrollments.classId))
    .where(and(...conditions))
    .limit(1)
  if (!row) throw createError({ statusCode: 404, message: 'Enrollment not found' })
  return row
}
