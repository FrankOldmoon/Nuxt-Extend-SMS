import { and, asc, eq, ilike, inArray, isNull, or } from 'drizzle-orm'
import { createError } from 'h3'
import { db } from '../../../server/database'
import { writeAudit } from '../../../server/sdk'
import { sisClasses, sisStudents, sisTeacherAssignments } from './database/schema'
import { canUseSis, isSisAdmin, requireSisOrganization, type SisActor } from './context'
import { guardianStudentIds } from './guardians'

export interface StudentSearchOptions {
  query?: string
  limit?: number
}

/** Classes assigned to the teacher in the current organization. */
export async function assignedClassIds(actor: SisActor): Promise<number[]> {
  const organizationId = requireSisOrganization(actor)
  const rows = await db.select({ classId: sisTeacherAssignments.classId })
    .from(sisTeacherAssignments)
    .where(and(
      eq(sisTeacherAssignments.organizationId, organizationId),
      eq(sisTeacherAssignments.teacherUserId, actor.userId)
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
export async function createStudent(actor: SisActor, input: CreateStudentInput) {
  const organizationId = requireSisOrganization(actor)
  if (!canUseSis(actor, 'create')) {
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
    if (!isSisAdmin(actor)) {
      const assigned = await assignedClassIds(actor)
      if (!assigned.includes(classId)) {
        throw createError({ statusCode: 403, statusMessage: 'Forbidden', message: 'No access to the requested class' })
      }
    }
  }

  return await db.transaction(async (tx) => {
    const [row] = await tx.insert(sisStudents).values({
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
      moduleId: 'sis',
      action: 'student.create',
      resource: 'students',
      recordId: row.id,
      after: row,
      source: 'sis-api'
    })
    return row
  })
}

/** Validate a class belongs to the actor's tenant + organization. */
export async function assertClassInContext(actor: SisActor, classId: number) {
  const organizationId = requireSisOrganization(actor)
  const [row] = await db.select({
    organizationId: sisClasses.organizationId,
    tenantId: sisClasses.tenantId
  }).from(sisClasses).where(eq(sisClasses.id, classId)).limit(1)
  if (!row || row.organizationId !== organizationId) {
    throw createError({ statusCode: 400, statusMessage: 'Bad Request', message: 'classId does not belong to the current organization' })
  }
  if (actor.tenantId && row.tenantId && row.tenantId !== actor.tenantId) {
    throw createError({ statusCode: 400, statusMessage: 'Bad Request', message: 'classId belongs to another tenant' })
  }
}

/**
 * Shared SIS student search used by the module API, the Tool Registry and the
 * page. Row scope comes from TeacherAssignment, never from request input.
 */
export async function searchStudents(actor: SisActor, options: StudentSearchOptions = {}) {
  const organizationId = requireSisOrganization(actor)
  const limit = Math.min(Math.max(options.limit ?? 50, 1), 200)
  const conditions = [eq(sisStudents.organizationId, organizationId), isNull(sisStudents.deletedAt)]

  const query = options.query?.trim()
  if (query) {
    conditions.push(or(
      ilike(sisStudents.name, `%${query}%`),
      ilike(sisStudents.studentNo, `%${query}%`)
    )!)
  }
  if (!isSisAdmin(actor)) {
    if (actor.roleName === 'student') {
      conditions.push(eq(sisStudents.userId, actor.userId))
    } else if (actor.roleName === 'guardian') {
      conditions.push(inArray(sisStudents.id, await guardianStudentIds(actor)))
    } else {
      conditions.push(inArray(sisStudents.classId, await assignedClassIds(actor)))
    }
  }

  return await db.select({
    id: sisStudents.id,
    name: sisStudents.name,
    studentNo: sisStudents.studentNo,
    classId: sisStudents.classId,
    organizationId: sisStudents.organizationId
  })
    .from(sisStudents)
    .where(and(...conditions))
    .orderBy(asc(sisStudents.name))
    .limit(limit)
}
