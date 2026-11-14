/**
 * 学籍异动：转入、转出、休学、复学、毕业。
 *
 * 每次操作都会追加一条 sms_student_movements 流水，并同步 sms_students.status；
 * 转出/毕业会结束在读学籍，转入会为班级所在学年补一条 active 学籍。
 */
import { and, desc, eq, inArray } from 'drizzle-orm'
import { createError } from 'h3'
import { db } from '../../../server/sdk'
import {
  smsClasses,
  smsEnrollments,
  smsStudentMovements,
  smsStudents
} from './database/schema'
import { classInContext } from './academics'
import { canUseSms, requireSmsOrganization, type SmsActor } from './context'
import { getStudent, studentScopeConditions } from './students'

export const STUDENT_STATUSES = ['active', 'suspended', 'transferred', 'graduated'] as const
export type StudentStatus = typeof STUDENT_STATUSES[number]

export const MOVEMENT_TYPES = ['transfer_in', 'transfer_out', 'suspend', 'resume', 'graduate'] as const
export type MovementType = typeof MOVEMENT_TYPES[number]

export interface CreateMovementInput {
  studentId?: unknown
  type?: unknown
  toClassId?: unknown
  effectiveDate?: unknown
  reason?: unknown
}

export interface MovementRow {
  id: number
  studentId: number
  studentName: string | null
  studentNo: string | null
  type: MovementType
  fromClassId: number | null
  fromClassName: string | null
  toClassId: number | null
  toClassName: string | null
  effectiveDate: string
  reason: string | null
  createdBy: number
  createdAt: string
}

function normalizeType(value: unknown): MovementType {
  if (typeof value === 'string' && (MOVEMENT_TYPES as readonly string[]).includes(value)) {
    return value as MovementType
  }
  throw createError({ statusCode: 400, message: '异动类型不合法' })
}

function normalizeDate(value: unknown): string {
  if (value === undefined || value === null || value === '') {
    return new Date(Date.now() + 8 * 3_600_000).toISOString().slice(0, 10)
  }
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw createError({ statusCode: 400, message: '生效日期格式应为 YYYY-MM-DD' })
  }
  return value
}

/** 目标状态是纯函数，便于单测覆盖所有流转组合。 */
export function nextStudentStatus(type: MovementType): StudentStatus {
  switch (type) {
    case 'suspend':
      return 'suspended'
    case 'resume':
    case 'transfer_in':
      return 'active'
    case 'transfer_out':
      return 'transferred'
    case 'graduate':
      return 'graduated'
  }
}

/** 校验当前状态是否允许该异动。 */
export function assertMovementTransition(current: string, type: MovementType): StudentStatus {
  const status = (STUDENT_STATUSES as readonly string[]).includes(current) ? current as StudentStatus : 'active'
  if (type === 'suspend' && status !== 'active') {
    throw createError({ statusCode: 400, message: '只有在校生可以休学' })
  }
  if (type === 'resume' && status !== 'suspended') {
    throw createError({ statusCode: 400, message: '只有休学学生可以复学' })
  }
  if (type === 'transfer_out' && status !== 'active' && status !== 'suspended') {
    throw createError({ statusCode: 400, message: '只有在校或休学学生可以转出' })
  }
  if (type === 'graduate' && status !== 'active') {
    throw createError({ statusCode: 400, message: '只有在校生可以毕业' })
  }
  if (type === 'transfer_in' && status !== 'transferred') {
    throw createError({ statusCode: 400, message: '只有已转出学生可以重新转入；新生请直接建档' })
  }
  return nextStudentStatus(type)
}

export async function createStudentMovement(actor: SmsActor, input: CreateMovementInput): Promise<{
  studentId: number
  status: StudentStatus
  movementId: number
}> {
  const organizationId = requireSmsOrganization(actor)
  if (!canUseSms(actor, 'update', 'students')) {
    throw createError({ statusCode: 403, message: '没有学籍异动权限' })
  }
  const studentId = Number(input.studentId)
  if (!Number.isSafeInteger(studentId) || studentId <= 0) {
    throw createError({ statusCode: 400, message: 'studentId 不合法' })
  }
  const type = normalizeType(input.type)
  const effectiveDate = normalizeDate(input.effectiveDate)
  const reason = typeof input.reason === 'string' && input.reason.trim()
    ? input.reason.trim().slice(0, 500)
    : null
  const student = await getStudent(actor, studentId)
  const targetStatus = assertMovementTransition(student.status ?? 'active', type)

  let toClassId: number | null = null
  let targetClass: Awaited<ReturnType<typeof classInContext>> | null = null
  if (type === 'transfer_in') {
    const id = Number(input.toClassId)
    if (!Number.isSafeInteger(id) || id <= 0) {
      throw createError({ statusCode: 400, message: '转入必须指定目标班级' })
    }
    targetClass = await classInContext(actor, id)
    toClassId = targetClass.id
  }

  const movementId = await db.transaction(async (tx) => {
    const nextClassId = type === 'transfer_in'
      ? toClassId
      : type === 'transfer_out' || type === 'graduate'
        ? null
        : student.classId
    await tx.update(smsStudents)
      .set({ classId: nextClassId, status: targetStatus })
      .where(and(
        eq(smsStudents.id, studentId),
        eq(smsStudents.organizationId, organizationId)
      ))

    const [movement] = await tx.insert(smsStudentMovements).values({
      organizationId,
      tenantId: actor.tenantId ?? null,
      studentId,
      type,
      fromClassId: student.classId ?? null,
      toClassId,
      effectiveDate,
      reason,
      createdBy: actor.userId
    }).returning({ id: smsStudentMovements.id })

    if (type === 'transfer_out' || type === 'graduate') {
      await tx.update(smsEnrollments)
        .set({ status: 'withdrawn', endedAt: new Date() })
        .where(and(
          eq(smsEnrollments.organizationId, organizationId),
          eq(smsEnrollments.studentId, studentId),
          eq(smsEnrollments.status, 'active')
        ))
    }

    if (type === 'transfer_in' && targetClass?.academicYearId) {
      const [existing] = await tx.select({ id: smsEnrollments.id })
        .from(smsEnrollments)
        .where(and(
          eq(smsEnrollments.organizationId, organizationId),
          eq(smsEnrollments.studentId, studentId),
          eq(smsEnrollments.academicYearId, targetClass.academicYearId),
          eq(smsEnrollments.status, 'active')
        ))
        .limit(1)
      if (!existing) {
        await tx.insert(smsEnrollments).values({
          organizationId,
          tenantId: actor.tenantId ?? null,
          studentId,
          classId: targetClass.id,
          academicYearId: targetClass.academicYearId,
          status: 'active'
        })
      }
    }

    return movement!.id
  })

  return { studentId, status: targetStatus, movementId }
}

export interface MovementListQuery {
  studentId?: unknown
  type?: unknown
  limit?: unknown
}

export async function listStudentMovements(actor: SmsActor, options: MovementListQuery = {}): Promise<MovementRow[]> {
  const organizationId = requireSmsOrganization(actor)
  if (!canUseSms(actor, 'read', 'students')) {
    throw createError({ statusCode: 403, message: '没有学籍查看权限' })
  }
  const conditions = [eq(smsStudentMovements.organizationId, organizationId)]
  if (options.type !== undefined) {
    const type = normalizeType(options.type)
    conditions.push(eq(smsStudentMovements.type, type))
  }
  const studentId = Number(options.studentId)
  if (Number.isSafeInteger(studentId) && studentId > 0) {
    await getStudent(actor, studentId)
    conditions.push(eq(smsStudentMovements.studentId, studentId))
  } else {
    // 非管理员按学生可见范围过滤，避免看到其他班级/学校的流水。
    conditions.push(...await studentScopeConditions(actor))
  }
  const limit = Math.min(Math.max(Math.floor(Number(options.limit ?? 100) || 100), 1), 200)

  const rows = await db.select({
    id: smsStudentMovements.id,
    studentId: smsStudentMovements.studentId,
    studentName: smsStudents.name,
    studentNo: smsStudents.studentNo,
    type: smsStudentMovements.type,
    fromClassId: smsStudentMovements.fromClassId,
    fromClassName: smsClasses.name,
    toClassId: smsStudentMovements.toClassId,
    effectiveDate: smsStudentMovements.effectiveDate,
    reason: smsStudentMovements.reason,
    createdBy: smsStudentMovements.createdBy,
    createdAt: smsStudentMovements.createdAt
  })
    .from(smsStudentMovements)
    .innerJoin(smsStudents, eq(smsStudents.id, smsStudentMovements.studentId))
    .leftJoin(smsClasses, eq(smsClasses.id, smsStudentMovements.fromClassId))
    .where(and(...conditions))
    .orderBy(desc(smsStudentMovements.effectiveDate), desc(smsStudentMovements.id))
    .limit(limit)

  // 目标班级需要第二次 join，Drizzle 同一表别名通过子查询最清晰；这里用 id 批量补全。
  const toClassIds = [...new Set(rows.map(row => row.toClassId).filter((id): id is number => Boolean(id)))]
  const toClassMap = new Map<number, string>()
  if (toClassIds.length > 0) {
    const classRows = await db.select({ id: smsClasses.id, name: smsClasses.name })
      .from(smsClasses)
      .where(inArray(smsClasses.id, toClassIds))
    for (const row of classRows) toClassMap.set(row.id, row.name)
  }

  return rows.map(row => ({
    id: row.id,
    studentId: row.studentId,
    studentName: row.studentName,
    studentNo: row.studentNo,
    type: row.type as MovementType,
    fromClassId: row.fromClassId,
    fromClassName: row.fromClassName,
    toClassId: row.toClassId,
    toClassName: row.toClassId ? toClassMap.get(row.toClassId) ?? null : null,
    effectiveDate: row.effectiveDate,
    reason: row.reason,
    createdBy: row.createdBy,
    createdAt: row.createdAt.toISOString()
  }))
}
