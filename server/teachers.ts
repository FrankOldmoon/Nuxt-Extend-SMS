import { and, asc, eq, ilike, isNull, or } from 'drizzle-orm'
import { createError } from 'h3'
import { db } from '../../../server/database'
import { writeAudit } from '../../../server/sdk'
import { smsTeacherAssignments, smsTeachers } from './database/schema'
import { canUseSms, isSmsAdmin, requireSmsOrganization, type SmsActor } from './context'
import {
  assertAcademicYearInContext,
  assertSubjectInContext,
  assertTermInContext,
  classInContext
} from './academics'

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

export interface CreateTeacherInput {
  userId?: unknown
  name?: unknown
  employeeNo?: unknown
}

export async function createTeacher(actor: SmsActor, input: CreateTeacherInput) {
  const organizationId = requireManage(actor, 'teachers')
  const userId = positiveId(input.userId, 'userId')
  const name = typeof input.name === 'string' && input.name.trim() ? input.name.trim() : null
  const employeeNo = typeof input.employeeNo === 'string' && input.employeeNo.trim() ? input.employeeNo.trim() : null

  return await db.transaction(async (tx) => {
    const [row] = await tx.insert(smsTeachers).values({
      organizationId,
      tenantId: actor.tenantId ?? null,
      userId,
      name,
      employeeNo
    }).returning()
    if (!row) throw createError({ statusCode: 500, message: 'Failed to create teacher' })
    await writeAudit(tx, {
      actorUserId: actor.userId,
      tenantId: actor.tenantId ?? undefined,
      organizationId,
      moduleId: 'sms',
      action: 'teacher.create',
      resource: 'teachers',
      recordId: row.id,
      after: row,
      source: 'sms-service'
    })
    return row
  })
}

export async function findTeacherInContext(actor: SmsActor, teacherId: number) {
  const organizationId = requireSmsOrganization(actor)
  const [row] = await db.select({
    id: smsTeachers.id,
    userId: smsTeachers.userId,
    organizationId: smsTeachers.organizationId
  }).from(smsTeachers).where(and(
    eq(smsTeachers.id, teacherId),
    eq(smsTeachers.organizationId, organizationId)
  )).limit(1)
  if (!row) {
    throw createError({ statusCode: 400, statusMessage: 'Bad Request', message: 'teacherId does not belong to the current organization' })
  }
  return row
}

export interface AssignTeacherInput {
  teacherId?: unknown
  teacherUserId?: unknown
  classId?: unknown
  subjectId?: unknown
  termId?: unknown
  academicYearId?: unknown
}

/**
 * Teacher-class(-subject/term) assignment. Every referenced entity must belong
 * to the actor's organization; the academic year defaults to the class year.
 */
export async function assignTeacher(actor: SmsActor, input: AssignTeacherInput) {
  const organizationId = requireManage(actor, 'teacher-assignments')
  const classId = positiveId(input.classId, 'classId')
  const classRow = await classInContext(actor, classId)

  let teacherId: number | null = null
  let teacherUserId: number
  if (input.teacherId !== undefined && input.teacherId !== null && input.teacherId !== '') {
    teacherId = positiveId(input.teacherId, 'teacherId')
    const teacher = await findTeacherInContext(actor, teacherId)
    teacherUserId = teacher.userId
  } else {
    teacherUserId = positiveId(input.teacherUserId, 'teacherUserId')
  }

  let subjectId: number | null = null
  if (input.subjectId !== undefined && input.subjectId !== null && input.subjectId !== '') {
    subjectId = positiveId(input.subjectId, 'subjectId')
    await assertSubjectInContext(actor, subjectId)
  }

  let academicYearId = classRow.academicYearId
  if (input.academicYearId !== undefined && input.academicYearId !== null && input.academicYearId !== '') {
    academicYearId = positiveId(input.academicYearId, 'academicYearId')
    await assertAcademicYearInContext(actor, academicYearId)
  }

  let termId: number | null = null
  if (input.termId !== undefined && input.termId !== null && input.termId !== '') {
    termId = positiveId(input.termId, 'termId')
    await assertTermInContext(actor, termId, academicYearId ?? undefined)
  }

  return await db.transaction(async (tx) => {
    const [row] = await tx.insert(smsTeacherAssignments).values({
      organizationId,
      tenantId: actor.tenantId ?? null,
      teacherId,
      teacherUserId,
      classId,
      subjectId,
      termId,
      academicYearId
    }).returning()
    if (!row) throw createError({ statusCode: 500, message: 'Failed to create teacher assignment' })
    await writeAudit(tx, {
      actorUserId: actor.userId,
      tenantId: actor.tenantId ?? undefined,
      organizationId,
      moduleId: 'sms',
      action: 'teacher-assignment.create',
      resource: 'teacher-assignments',
      recordId: row.id,
      after: row,
      source: 'sms-service'
    })
    return row
  })
}

/** Teachers visible to the actor: admins see all, teachers see themselves. */
export async function listTeachers(actor: SmsActor, options: { query?: string, limit?: number } = {}) {
  const organizationId = requireSmsOrganization(actor)
  const conditions = [
    eq(smsTeachers.organizationId, organizationId),
    isNull(smsTeachers.deletedAt)
  ]
  if (!isSmsAdmin(actor)) conditions.push(eq(smsTeachers.userId, actor.userId))

  const clean = options.query?.trim()
  if (clean) {
    conditions.push(or(
      ilike(smsTeachers.name, `%${clean}%`),
      ilike(smsTeachers.employeeNo, `%${clean}%`)
    )!)
  }

  const limit = Math.min(Math.max(Math.floor(options.limit ?? 100), 1), 200)
  return await db.select({
    id: smsTeachers.id,
    userId: smsTeachers.userId,
    name: smsTeachers.name,
    employeeNo: smsTeachers.employeeNo
  }).from(smsTeachers)
    .where(and(...conditions))
    .orderBy(asc(smsTeachers.name))
    .limit(limit)
}
