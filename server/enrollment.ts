import { and, eq } from 'drizzle-orm'
import { createError } from 'h3'
import { db } from '../../../server/database'
import { writeAudit } from '../../../server/sdk'
import { sisEnrollments, sisStudents } from './database/schema'
import { canUseSis, requireSisOrganization, type SisActor } from './context'
import { assertAcademicYearInContext, assertTermInContext, classInContext } from './academics'

function requireManage(actor: SisActor, resource: string): number {
  const organizationId = requireSisOrganization(actor)
  if (!canUseSis(actor, 'create', resource)) {
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
export async function assertStudentInContext(actor: SisActor, studentId: number): Promise<void> {
  const organizationId = requireSisOrganization(actor)
  const [row] = await db.select({ organizationId: sisStudents.organizationId })
    .from(sisStudents).where(eq(sisStudents.id, studentId)).limit(1)
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
export async function enrollStudent(actor: SisActor, input: EnrollStudentInput) {
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
    const [active] = await tx.select({ id: sisEnrollments.id })
      .from(sisEnrollments)
      .where(and(
        eq(sisEnrollments.studentId, studentId),
        eq(sisEnrollments.academicYearId, academicYearId),
        eq(sisEnrollments.status, 'active')
      ))
      .limit(1)
    if (active) {
      throw createError({ statusCode: 409, statusMessage: 'Conflict', message: 'Student already has an active enrollment for this academic year' })
    }

    const [row] = await tx.insert(sisEnrollments).values({
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
    await tx.update(sisStudents)
      .set({ classId })
      .where(and(eq(sisStudents.id, studentId), eq(sisStudents.organizationId, organizationId)))

    await writeAudit(tx, {
      actorUserId: actor.userId,
      tenantId: actor.tenantId ?? undefined,
      organizationId,
      moduleId: 'sis',
      action: 'enrollment.create',
      resource: 'enrollments',
      recordId: row.id,
      after: row,
      source: 'sis-service'
    })
    return row
  })
}

/** Withdraw an active enrollment without deleting its history. */
export async function withdrawEnrollment(actor: SisActor, enrollmentId: number) {
  const organizationId = requireManage(actor, 'enrollments')
  return await db.transaction(async (tx) => {
    const [current] = await tx.select().from(sisEnrollments).where(and(
      eq(sisEnrollments.id, enrollmentId),
      eq(sisEnrollments.organizationId, organizationId)
    )).limit(1)
    if (!current) {
      throw createError({ statusCode: 404, message: 'Enrollment not found' })
    }
    if (current.status !== 'active') {
      throw createError({ statusCode: 409, statusMessage: 'Conflict', message: 'Only active enrollments can be withdrawn' })
    }
    const [row] = await tx.update(sisEnrollments)
      .set({ status: 'withdrawn', endedAt: new Date() })
      .where(eq(sisEnrollments.id, enrollmentId))
      .returning()
    await writeAudit(tx, {
      actorUserId: actor.userId,
      tenantId: actor.tenantId ?? undefined,
      organizationId,
      moduleId: 'sis',
      action: 'enrollment.withdraw',
      resource: 'enrollments',
      recordId: enrollmentId,
      before: current,
      after: row,
      source: 'sis-service'
    })
    return row
  })
}
