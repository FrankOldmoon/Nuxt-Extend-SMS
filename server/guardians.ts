import { and, asc, eq, ilike, inArray, isNull, or } from 'drizzle-orm'
import { createError } from 'h3'
import { db, writeAudit } from '../../../server/sdk'
import {
  smsClasses,
  smsGuardians,
  smsStudentGuardians,
  smsStudents,
  smsTeacherAssignments
} from './database/schema'
import { canUseSms, isSmsAdmin, requireSmsOrganization, type SmsActor } from './context'
import { assertStudentInContext } from './enrollment'

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

export async function assertGuardianInContext(actor: SmsActor, guardianId: number): Promise<void> {
  const organizationId = requireSmsOrganization(actor)
  const [row] = await db.select({ organizationId: smsGuardians.organizationId })
    .from(smsGuardians).where(eq(smsGuardians.id, guardianId)).limit(1)
  if (!row || row.organizationId !== organizationId) {
    throw createError({ statusCode: 400, statusMessage: 'Bad Request', message: 'guardianId does not belong to the current organization' })
  }
}

export interface CreateGuardianInput {
  userId?: unknown
  name?: unknown
  phone?: unknown
}

export async function createGuardian(actor: SmsActor, input: CreateGuardianInput) {
  const organizationId = requireManage(actor, 'guardians')
  const userId = positiveId(input.userId, 'userId')
  const name = typeof input.name === 'string' && input.name.trim() ? input.name.trim() : null
  const phone = typeof input.phone === 'string' && input.phone.trim() ? input.phone.trim() : null

  return await db.transaction(async (tx) => {
    const [row] = await tx.insert(smsGuardians).values({
      organizationId,
      tenantId: actor.tenantId ?? null,
      userId,
      name,
      phone
    }).returning()
    if (!row) throw createError({ statusCode: 500, message: 'Failed to create guardian' })
    await writeAudit(tx, {
      actorUserId: actor.userId,
      tenantId: actor.tenantId ?? undefined,
      organizationId,
      moduleId: 'sms',
      action: 'guardian.create',
      resource: 'guardians',
      recordId: row.id,
      after: row,
      source: 'sms-service'
    })
    return row
  })
}

export interface LinkGuardianInput {
  studentId?: unknown
  guardianId?: unknown
  relation?: unknown
  isPrimary?: unknown
}

/** Link a guardian to a student; both must belong to the same organization. */
export async function linkGuardian(actor: SmsActor, input: LinkGuardianInput) {
  const organizationId = requireManage(actor, 'student-guardians')
  const studentId = positiveId(input.studentId, 'studentId')
  const guardianId = positiveId(input.guardianId, 'guardianId')
  await assertStudentInContext(actor, studentId)
  await assertGuardianInContext(actor, guardianId)
  const relation = typeof input.relation === 'string' && input.relation.trim() ? input.relation.trim() : null
  const isPrimary = input.isPrimary === true || input.isPrimary === 'true'

  return await db.transaction(async (tx) => {
    const [row] = await tx.insert(smsStudentGuardians).values({
      organizationId,
      tenantId: actor.tenantId ?? null,
      studentId,
      guardianId,
      relation,
      isPrimary
    }).returning()
    if (!row) throw createError({ statusCode: 500, message: 'Failed to link guardian' })
    await writeAudit(tx, {
      actorUserId: actor.userId,
      tenantId: actor.tenantId ?? undefined,
      organizationId,
      moduleId: 'sms',
      action: 'student-guardian.create',
      resource: 'student-guardians',
      recordId: row.id,
      after: row,
      source: 'sms-service'
    })
    return row
  })
}

/** Students explicitly linked to a guardian user in the current organization. */
export async function guardianStudentIds(actor: SmsActor): Promise<number[]> {
  const organizationId = requireSmsOrganization(actor)
  const rows = await db.select({ studentId: smsStudentGuardians.studentId })
    .from(smsStudentGuardians)
    .innerJoin(smsGuardians, eq(smsStudentGuardians.guardianId, smsGuardians.id))
    .where(and(
      eq(smsStudentGuardians.organizationId, organizationId),
      eq(smsGuardians.userId, actor.userId)
    ))
  return rows.map(row => row.studentId)
}

export interface GuardianChild {
  id: number
  name: string
  studentNo: string
  classId: number | null
  className: string | null
  status: string
}

/** 家长可切换的子女；非家长或未关联学生时返回空数组。 */
export async function listGuardianChildren(actor: SmsActor): Promise<GuardianChild[]> {
  if (actor.roleName !== 'guardian') return []
  const organizationId = requireSmsOrganization(actor)
  const studentIds = await guardianStudentIds(actor)
  if (studentIds.length === 0) return []
  return await db.select({
    id: smsStudents.id,
    name: smsStudents.name,
    studentNo: smsStudents.studentNo,
    classId: smsStudents.classId,
    className: smsClasses.name,
    status: smsStudents.status
  }).from(smsStudents)
    .leftJoin(smsClasses, eq(smsClasses.id, smsStudents.classId))
    .where(and(
      eq(smsStudents.organizationId, organizationId),
      inArray(smsStudents.id, studentIds),
      isNull(smsStudents.deletedAt)
    ))
    .orderBy(asc(smsStudents.name))
}

/**
 * 家长「当前子女」解析：请求里的 studentId 必须落在 guardianStudentIds 内。
 * 未指定返回 null（沿用全部子女范围）；跨子女请求返回 404，避免枚举。
 */
export async function resolveGuardianStudentId(actor: SmsActor, value: unknown): Promise<number | null> {
  if (value === undefined || value === null || value === '') return null
  const studentId = Number(value)
  if (!Number.isSafeInteger(studentId) || studentId <= 0) {
    throw createError({ statusCode: 400, message: 'studentId must be a positive integer' })
  }
  const studentIds = await guardianStudentIds(actor)
  if (!studentIds.includes(studentId)) {
    throw createError({ statusCode: 404, message: 'Student not found' })
  }
  return studentId
}

/** Guardians visible to the actor (admin: all; guardian: self; others: linked). */
export async function listGuardians(actor: SmsActor, options: { query?: string, limit?: number } = {}) {
  const organizationId = requireSmsOrganization(actor)
  const conditions = [
    eq(smsGuardians.organizationId, organizationId),
    isNull(smsGuardians.deletedAt)
  ]

  if (!isSmsAdmin(actor)) {
    if (actor.roleName === 'guardian') {
      conditions.push(eq(smsGuardians.userId, actor.userId))
    } else {
      let studentIds: number[] = []
      if (actor.roleName === 'student') {
        const [row] = await db.select({ id: smsStudents.id })
          .from(smsStudents)
          .where(and(
            eq(smsStudents.organizationId, organizationId),
            eq(smsStudents.userId, actor.userId)
          ))
          .limit(1)
        if (row) studentIds = [row.id]
      } else if (actor.roleName === 'teacher') {
        const classes = await db.select({ classId: smsTeacherAssignments.classId })
          .from(smsTeacherAssignments)
          .where(and(
            eq(smsTeacherAssignments.organizationId, organizationId),
            eq(smsTeacherAssignments.teacherUserId, actor.userId)
          ))
        const classIds = classes.map(row => row.classId)
        if (classIds.length) {
          const rows = await db.select({ studentId: smsStudentGuardians.studentId })
            .from(smsStudentGuardians)
            .innerJoin(smsStudents, eq(smsStudents.id, smsStudentGuardians.studentId))
            .where(and(
              eq(smsStudentGuardians.organizationId, organizationId),
              inArray(smsStudents.classId, classIds)
            ))
          studentIds = rows.map(row => row.studentId)
        }
      }
      if (!studentIds.length) {
        conditions.push(eq(smsGuardians.id, -1))
      } else {
        const guardianRows = await db.select({ guardianId: smsStudentGuardians.guardianId })
          .from(smsStudentGuardians)
          .where(and(
            eq(smsStudentGuardians.organizationId, organizationId),
            inArray(smsStudentGuardians.studentId, studentIds)
          ))
        const guardianIds = [...new Set(guardianRows.map(row => row.guardianId))]
        conditions.push(guardianIds.length ? inArray(smsGuardians.id, guardianIds) : eq(smsGuardians.id, -1))
      }
    }
  }

  const clean = options.query?.trim()
  if (clean) {
    conditions.push(or(
      ilike(smsGuardians.name, `%${clean}%`),
      ilike(smsGuardians.phone, `%${clean}%`)
    )!)
  }

  const limit = Math.min(Math.max(Math.floor(options.limit ?? 100), 1), 200)
  return await db.select({
    id: smsGuardians.id,
    userId: smsGuardians.userId,
    name: smsGuardians.name,
    phone: smsGuardians.phone
  }).from(smsGuardians)
    .where(and(...conditions))
    .orderBy(asc(smsGuardians.name))
    .limit(limit)
}
