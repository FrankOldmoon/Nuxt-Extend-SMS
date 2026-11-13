import { and, asc, eq, ilike, inArray, isNull, or } from 'drizzle-orm'
import { createError } from 'h3'
import { db } from '../../../server/database'
import { writeAudit } from '../../../server/sdk'
import { smsClasses, smsStudents, smsTeacherAssignments } from './database/schema'
import { canUseSms, isSmsAdmin, requireSmsOrganization, type SmsActor } from './context'
import { guardianStudentIds } from './guardians'

export interface StudentSearchOptions {
  query?: string
  limit?: number
}

/** Classes assigned to the teacher in the current organization. */
export async function assignedClassIds(actor: SmsActor): Promise<number[]> {
  const organizationId = requireSmsOrganization(actor)
  const rows = await db.select({ classId: smsTeacherAssignments.classId })
    .from(smsTeacherAssignments)
    .where(and(
      eq(smsTeacherAssignments.organizationId, organizationId),
      eq(smsTeacherAssignments.teacherUserId, actor.userId)
    ))
  return rows.map(row => row.classId)
}

export interface CreateStudentInput {
  name?: unknown
  studentNo?: unknown
  classId?: unknown
  userId?: unknown
}

/**
 * Dedicated creation path: ownership comes from the authenticated context and
 * the class must belong to the same tenant + organization.
 */
export async function createStudent(actor: SmsActor, input: CreateStudentInput) {
  const organizationId = requireSmsOrganization(actor)
  if (!canUseSms(actor, 'create')) {
    throw createError({ statusCode: 403, statusMessage: 'Forbidden', message: 'No permission to create students' })
  }
  const name = typeof input.name === 'string' ? input.name.trim() : ''
  const studentNo = typeof input.studentNo === 'string' ? input.studentNo.trim() : ''
  if (!name || !studentNo) {
    throw createError({ statusCode: 400, statusMessage: 'Bad Request', message: 'name and studentNo are required' })
  }
  const classId = input.classId === undefined || input.classId === null ? null : Number(input.classId)
  if (classId !== null && (!Number.isSafeInteger(classId) || classId <= 0)) {
    throw createError({ statusCode: 400, statusMessage: 'Bad Request', message: 'classId must be a positive integer' })
  }
  const userId = input.userId === undefined || input.userId === null || input.userId === ''
    ? null
    : Number(input.userId)
  if (userId !== null && (!Number.isSafeInteger(userId) || userId <= 0)) {
    throw createError({ statusCode: 400, statusMessage: 'Bad Request', message: 'userId must be a positive integer' })
  }

  if (classId !== null) {
    await assertClassInContext(actor, classId)
    if (!isSmsAdmin(actor)) {
      const assigned = await assignedClassIds(actor)
      if (!assigned.includes(classId)) {
        throw createError({ statusCode: 403, statusMessage: 'Forbidden', message: 'No access to the requested class' })
      }
    }
  }

  return await db.transaction(async (tx) => {
    const [row] = await tx.insert(smsStudents).values({
      organizationId,
      tenantId: actor.tenantId ?? null,
      classId,
      userId,
      name,
      studentNo
    }).returning()
    if (!row) throw createError({ statusCode: 500, message: 'Failed to create student' })
    await writeAudit(tx, {
      actorUserId: actor.userId,
      tenantId: actor.tenantId ?? undefined,
      organizationId,
      moduleId: 'sms',
      action: 'student.create',
      resource: 'students',
      recordId: row.id,
      after: row,
      source: 'sms-api'
    })
    return row
  })
}

/** Validate a class belongs to the actor's tenant + organization. */
export async function assertClassInContext(actor: SmsActor, classId: number) {
  const organizationId = requireSmsOrganization(actor)
  const [row] = await db.select({
    organizationId: smsClasses.organizationId,
    tenantId: smsClasses.tenantId
  }).from(smsClasses).where(eq(smsClasses.id, classId)).limit(1)
  if (!row || row.organizationId !== organizationId) {
    throw createError({ statusCode: 400, statusMessage: 'Bad Request', message: 'classId does not belong to the current organization' })
  }
  if (actor.tenantId && row.tenantId && row.tenantId !== actor.tenantId) {
    throw createError({ statusCode: 400, statusMessage: 'Bad Request', message: 'classId belongs to another tenant' })
  }
}

/**
 * Shared SMS student search used by the module API, the Tool Registry and the
 * page. Row scope comes from TeacherAssignment, never from request input.
 */
export async function searchStudents(actor: SmsActor, options: StudentSearchOptions = {}) {
  const organizationId = requireSmsOrganization(actor)
  const limit = Math.min(Math.max(options.limit ?? 50, 1), 200)
  const conditions = [eq(smsStudents.organizationId, organizationId), isNull(smsStudents.deletedAt)]

  const query = options.query?.trim()
  if (query) {
    conditions.push(or(
      ilike(smsStudents.name, `%${query}%`),
      ilike(smsStudents.studentNo, `%${query}%`)
    )!)
  }
  if (!isSmsAdmin(actor)) {
    if (actor.roleName === 'student') {
      conditions.push(eq(smsStudents.userId, actor.userId))
    } else if (actor.roleName === 'guardian') {
      conditions.push(inArray(smsStudents.id, await guardianStudentIds(actor)))
    } else {
      conditions.push(inArray(smsStudents.classId, await assignedClassIds(actor)))
    }
  }

  return await db.select({
    id: smsStudents.id,
    name: smsStudents.name,
    studentNo: smsStudents.studentNo,
    classId: smsStudents.classId,
    organizationId: smsStudents.organizationId
  })
    .from(smsStudents)
    .where(and(...conditions))
    .orderBy(asc(smsStudents.name))
    .limit(limit)
}
