import { and, asc, eq, ilike, inArray, isNull, lt, or } from 'drizzle-orm'
import { createError } from 'h3'
import { db, writeAudit } from '../../../server/sdk'
import { smsClasses, smsStudents, smsTeacherAssignments } from './database/schema'
import { canUseSms, isSmsAdmin, requireSmsOrganization, type SmsActor } from './context'
import { guardianStudentIds } from './guardians'

export interface StudentSearchOptions {
  query?: string
  limit?: number
  /** 游标分页：上一页最后一行的 id，返回更早的记录。 */
  cursor?: number
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
  const limit = Math.min(Math.max(Math.floor(Number(options.limit ?? 50) || 50), 1), 200)
  const conditions = await studentScopeConditions(actor)

  const cursor = Number(options.cursor)
  if (Number.isSafeInteger(cursor) && cursor > 0) {
    conditions.push(lt(smsStudents.id, cursor))
  }

  const query = options.query?.trim()
  if (query) {
    conditions.push(or(
      ilike(smsStudents.name, `%${query}%`),
      ilike(smsStudents.studentNo, `%${query}%`)
    )!)
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

/** Row-level visibility for students (org + role scope). */
async function studentScopeConditions(actor: SmsActor) {
  const organizationId = requireSmsOrganization(actor)
  const conditions = [eq(smsStudents.organizationId, organizationId), isNull(smsStudents.deletedAt)]
  if (!isSmsAdmin(actor)) {
    if (actor.roleName === 'student') {
      conditions.push(eq(smsStudents.userId, actor.userId))
    } else if (actor.roleName === 'guardian') {
      const studentIds = await guardianStudentIds(actor)
      conditions.push(studentIds.length ? inArray(smsStudents.id, studentIds) : eq(smsStudents.id, -1))
    } else {
      const classIds = await assignedClassIds(actor)
      conditions.push(classIds.length ? inArray(smsStudents.classId, classIds) : eq(smsStudents.classId, -1))
    }
  }
  return conditions
}

/** One student visible to the actor; 404 otherwise (no existence leak). */
export async function getStudent(actor: SmsActor, studentId: number) {
  const conditions = await studentScopeConditions(actor)
  conditions.push(eq(smsStudents.id, studentId))
  const [row] = await db.select({
    id: smsStudents.id,
    name: smsStudents.name,
    studentNo: smsStudents.studentNo,
    classId: smsStudents.classId,
    userId: smsStudents.userId,
    organizationId: smsStudents.organizationId
  })
    .from(smsStudents)
    .where(and(...conditions))
    .limit(1)
  if (!row) {
    throw createError({ statusCode: 404, message: 'Student not found' })
  }
  return row
}

export interface UpdateStudentInput {
  studentId?: unknown
  name?: unknown
  studentNo?: unknown
  classId?: unknown
}

/**
 * Update a student. Class ownership is validated like creation; teachers may
 * only move students between their assigned classes.
 */
export async function updateStudent(actor: SmsActor, input: UpdateStudentInput) {
  const organizationId = requireSmsOrganization(actor)
  if (!canUseSms(actor, 'update') && !canUseSms(actor, 'create')) {
    throw createError({ statusCode: 403, statusMessage: 'Forbidden', message: 'No permission to update students' })
  }
  const studentId = Number(input.studentId)
  if (!Number.isSafeInteger(studentId) || studentId <= 0) {
    throw createError({ statusCode: 400, statusMessage: 'Bad Request', message: 'studentId must be a positive integer' })
  }
  const current = await getStudent(actor, studentId)

  const patch: { name?: string, studentNo?: string, classId?: number | null } = {}
  if (input.name !== undefined) {
    const name = typeof input.name === 'string' ? input.name.trim() : ''
    if (!name) throw createError({ statusCode: 400, statusMessage: 'Bad Request', message: 'name must not be empty' })
    patch.name = name
  }
  if (input.studentNo !== undefined) {
    const studentNo = typeof input.studentNo === 'string' ? input.studentNo.trim() : ''
    if (!studentNo) throw createError({ statusCode: 400, statusMessage: 'Bad Request', message: 'studentNo must not be empty' })
    patch.studentNo = studentNo
  }
  if (input.classId !== undefined) {
    if (input.classId === null || input.classId === '') {
      patch.classId = null
    } else {
      const classId = Number(input.classId)
      if (!Number.isSafeInteger(classId) || classId <= 0) {
        throw createError({ statusCode: 400, statusMessage: 'Bad Request', message: 'classId must be a positive integer' })
      }
      await assertClassInContext(actor, classId)
      if (!isSmsAdmin(actor)) {
        const assigned = await assignedClassIds(actor)
        if (!assigned.includes(classId)) {
          throw createError({ statusCode: 403, statusMessage: 'Forbidden', message: 'No access to the requested class' })
        }
      }
      patch.classId = classId
    }
  }
  if (Object.keys(patch).length === 0) {
    throw createError({ statusCode: 400, statusMessage: 'Bad Request', message: 'No fields to update' })
  }

  return await db.transaction(async (tx) => {
    const [row] = await tx.update(smsStudents)
      .set(patch)
      .where(and(eq(smsStudents.id, studentId), eq(smsStudents.organizationId, organizationId)))
      .returning()
    if (!row) throw createError({ statusCode: 404, message: 'Student not found' })
    await writeAudit(tx, {
      actorUserId: actor.userId,
      tenantId: actor.tenantId ?? undefined,
      organizationId,
      moduleId: 'sms',
      action: 'student.update',
      resource: 'students',
      recordId: row.id,
      before: current,
      after: row,
      source: 'sms-service'
    })
    return row
  })
}

/** Soft delete a student (high risk; chat requires explicit approval). */
export async function softDeleteStudent(actor: SmsActor, studentId: number) {
  const organizationId = requireSmsOrganization(actor)
  if (!canUseSms(actor, 'delete')) {
    throw createError({ statusCode: 403, statusMessage: 'Forbidden', message: 'No permission to delete students' })
  }
  const current = await getStudent(actor, studentId)
  return await db.transaction(async (tx) => {
    const [row] = await tx.update(smsStudents)
      .set({ deletedAt: new Date() })
      .where(and(
        eq(smsStudents.id, studentId),
        eq(smsStudents.organizationId, organizationId),
        isNull(smsStudents.deletedAt)
      ))
      .returning()
    if (!row) throw createError({ statusCode: 404, message: 'Student not found' })
    await writeAudit(tx, {
      actorUserId: actor.userId,
      tenantId: actor.tenantId ?? undefined,
      organizationId,
      moduleId: 'sms',
      action: 'student.delete',
      resource: 'students',
      recordId: row.id,
      before: current,
      after: row,
      source: 'sms-service'
    })
    return row
  })
}
