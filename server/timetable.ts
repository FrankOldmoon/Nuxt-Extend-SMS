/**
 * Timetable (Slice C): weekly class slots with conflict detection and a
 * second-person publish step.
 *
 * Conflicts are evaluated for the same term across three dimensions:
 * class slot (one subject per class/period), teacher slot (a teacher cannot be
 * in two classes at once) and room slot.
 */
import { and, asc, eq, gte, inArray, isNull, lte, or } from 'drizzle-orm'
import { createError } from 'h3'
import { db, writeAudit } from '../../../server/sdk'
import {
  smsClasses,
  smsStudents,
  smsSubjects,
  smsTeachers,
  smsTeacherAssignments,
  smsTerms,
  smsTimetableEntries,
  smsTimetableSubstitutions
} from './database/schema'
import { canUseSms, isSmsAdmin, requireSmsOrganization, type SmsActor } from './context'
import { assertSubjectInContext, assertTermInContext } from './academics'
import { guardianStudentIds, resolveGuardianStudentId } from './guardians'

export const TIMETABLE_STATUSES = ['draft', 'published'] as const
export type TimetableStatus = typeof TIMETABLE_STATUSES[number]

export const MIN_WEEKDAY = 1
export const MAX_WEEKDAY = 7
export const MAX_PERIOD = 12

export function normalizeWeekday(value: unknown): number {
  const weekday = Number(value)
  if (!Number.isSafeInteger(weekday) || weekday < MIN_WEEKDAY || weekday > MAX_WEEKDAY) {
    throw createError({ statusCode: 400, message: `weekday must be an integer between ${MIN_WEEKDAY} and ${MAX_WEEKDAY}` })
  }
  return weekday
}

export function normalizePeriodNo(value: unknown): number {
  const period = Number(value)
  if (!Number.isSafeInteger(period) || period < 1 || period > MAX_PERIOD) {
    throw createError({ statusCode: 400, message: `periodNo must be an integer between 1 and ${MAX_PERIOD}` })
  }
  return period
}

export function normalizeTimetableStatus(value: unknown): TimetableStatus {
  if (typeof value === 'string' && (TIMETABLE_STATUSES as readonly string[]).includes(value)) {
    return value as TimetableStatus
  }
  throw createError({ statusCode: 400, message: `status must be one of ${TIMETABLE_STATUSES.join(', ')}` })
}

export const SUBSTITUTION_TYPES = ['substitute', 'reschedule'] as const
export type SubstitutionType = typeof SUBSTITUTION_TYPES[number]

export function normalizeSubstitutionType(value: unknown): SubstitutionType {
  if (value === undefined || value === null || value === '') return 'substitute'
  if (typeof value === 'string' && (SUBSTITUTION_TYPES as readonly string[]).includes(value)) {
    return value as SubstitutionType
  }
  throw createError({ statusCode: 400, message: `type must be one of ${SUBSTITUTION_TYPES.join(', ')}` })
}

/** 代课/调课按自然日生效，日期必须是合法的 YYYY-MM-DD。 */
export function normalizeSubstitutionDate(value: unknown): string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw createError({ statusCode: 400, message: 'date must be YYYY-MM-DD' })
  }
  const parsed = new Date(`${value}T00:00:00Z`)
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) {
    throw createError({ statusCode: 400, message: 'date is not a valid calendar day' })
  }
  return value
}

/** 1 = 周一 … 7 = 周日，与课表 weekday 保持一致。 */
export function weekdayOfDate(value: string): number {
  const day = new Date(`${value}T00:00:00Z`).getUTCDay()
  return day === 0 ? 7 : day
}

export interface SubstitutionCandidate {
  entryId: number
  classId: number
  termId: number | null
  weekday: number
  periodNo: number
  date: string
  substituteUserId: number | null
}

export interface SubstitutionRecord {
  entryId: number
  classId: number
  termId: number | null
  weekday: number
  periodNo: number
  date: string
  substituteUserId: number | null
}

export interface SubstitutionConflict {
  type: 'duplicate' | 'teacher'
  entryId: number
  classId: number
}

/**
 * 调课/代课冲突（纯函数）：
 * - duplicate：同一节课同一天已登记调整；
 * - teacher：代课教师在同一时段已有其他班级的课或代课。
 */
export function detectSubstitutionConflicts(
  entries: readonly TimetableSlot[],
  existing: readonly SubstitutionRecord[],
  candidate: SubstitutionCandidate
): SubstitutionConflict[] {
  const conflicts: SubstitutionConflict[] = []
  for (const record of existing) {
    if (record.date !== candidate.date) continue
    if (record.entryId === candidate.entryId) {
      conflicts.push({ type: 'duplicate', entryId: record.entryId, classId: record.classId })
      continue
    }
    if (
      candidate.substituteUserId !== null
      && record.substituteUserId === candidate.substituteUserId
      && (record.termId ?? null) === (candidate.termId ?? null)
      && record.weekday === candidate.weekday
      && record.periodNo === candidate.periodNo
    ) {
      conflicts.push({ type: 'teacher', entryId: record.entryId, classId: record.classId })
    }
  }
  if (candidate.substituteUserId === null) return conflicts
  for (const entry of entries) {
    if (entry.classId === candidate.classId) continue
    if ((entry.termId ?? null) !== (candidate.termId ?? null)) continue
    if (entry.weekday !== candidate.weekday || entry.periodNo !== candidate.periodNo) continue
    if (entry.teacherUserId === candidate.substituteUserId) {
      conflicts.push({ type: 'teacher', entryId: entry.id ?? 0, classId: entry.classId })
    }
  }
  return conflicts
}

export interface TimetableSlot {
  id?: number
  termId: number | null
  classId: number
  teacherUserId: number | null
  weekday: number
  periodNo: number
  room: string | null
}

export interface TimetableConflict {
  type: 'class' | 'teacher' | 'room'
  entryId: number
  classId: number
}

/**
 * Pure conflict detection. Only entries in the same term (including both
 * `null`) and the same weekday/period are compared; `id` skips self-updates.
 */
export function detectTimetableConflicts(
  existing: readonly TimetableSlot[],
  candidate: TimetableSlot
): TimetableConflict[] {
  const conflicts: TimetableConflict[] = []
  const sameTerm = (slot: TimetableSlot) => (slot.termId ?? null) === (candidate.termId ?? null)
  for (const entry of existing) {
    if (entry.id !== undefined && candidate.id !== undefined && entry.id === candidate.id) continue
    if (!sameTerm(entry)) continue
    if (entry.weekday !== candidate.weekday || entry.periodNo !== candidate.periodNo) continue
    if (entry.classId === candidate.classId) {
      conflicts.push({ type: 'class', entryId: entry.id ?? 0, classId: entry.classId })
      continue
    }
    if (candidate.teacherUserId !== null && entry.teacherUserId === candidate.teacherUserId) {
      conflicts.push({ type: 'teacher', entryId: entry.id ?? 0, classId: entry.classId })
    }
    if (candidate.room && entry.room && entry.room === candidate.room) {
      conflicts.push({ type: 'room', entryId: entry.id ?? 0, classId: entry.classId })
    }
  }
  return conflicts
}

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

function instant(value: unknown): number | null {
  const id = Number(value)
  return Number.isSafeInteger(id) && id > 0 ? id : null
}

function hasPermission(actor: SmsActor, permission: string): boolean {
  if (isSmsAdmin(actor)) return true
  return (actor.permissions ?? []).includes(permission)
}

function requireTimetableRead(actor: SmsActor): number {
  const organizationId = requireSmsOrganization(actor)
  if (!canUseSms(actor, 'read', 'timetable')) {
    throw createError({ statusCode: 403, statusMessage: 'Forbidden', message: 'No permission to read timetable' })
  }
  return organizationId
}

function requireTimetableUpdate(actor: SmsActor): number {
  const organizationId = requireSmsOrganization(actor)
  if (!canUseSms(actor, 'update', 'timetable')) {
    throw createError({ statusCode: 403, statusMessage: 'Forbidden', message: 'No permission to edit timetable' })
  }
  return organizationId
}

export function canPublishTimetable(actor: SmsActor): boolean {
  // `.all` is a data-scope flag only; publishing always needs the explicit grant.
  return hasPermission(actor, 'sms.timetable.publish')
}

function isStudentFacing(actor: SmsActor): boolean {
  return actor.roleName === 'student' || actor.roleName === 'guardian'
}

/** `null` means whole organization; otherwise the classes the actor can see. */
export async function scopedTimetableClassIds(actor: SmsActor): Promise<number[] | null> {
  if (isSmsAdmin(actor) || hasPermission(actor, 'sms.timetable.all')) return null
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

export interface TimetableListQuery {
  termId?: unknown
  classId?: unknown
  teacherUserId?: unknown
  /** 家长当前子女；必须属于 guardianStudentIds。 */
  studentId?: unknown
  status?: unknown
  limit?: unknown
}

export async function listTimetable(actor: SmsActor, options: TimetableListQuery = {}) {
  const organizationId = requireTimetableRead(actor)
  const conditions = [eq(smsTimetableEntries.organizationId, organizationId)]
  const classIds = await scopedTimetableClassIds(actor)
  if (classIds) {
    conditions.push(classIds.length ? inArray(smsTimetableEntries.classId, classIds) : eq(smsTimetableEntries.id, -1))
  }
  if (isStudentFacing(actor)) {
    conditions.push(eq(smsTimetableEntries.status, 'published'))
    if (actor.roleName === 'guardian' && options.studentId !== undefined && options.studentId !== null && options.studentId !== '') {
      // 家长切换子女后只看该子女班级的课表。
      const studentId = await resolveGuardianStudentId(actor, options.studentId)
      if (studentId !== null) {
        const [child] = await db.select({ classId: smsStudents.classId }).from(smsStudents)
          .where(and(
            eq(smsStudents.organizationId, organizationId),
            eq(smsStudents.id, studentId),
            isNull(smsStudents.deletedAt)
          ))
          .limit(1)
        conditions.push(child?.classId
          ? eq(smsTimetableEntries.classId, child.classId)
          : eq(smsTimetableEntries.id, -1))
      }
    }
  } else if (options.status !== undefined && options.status !== null && options.status !== '') {
    conditions.push(eq(smsTimetableEntries.status, normalizeTimetableStatus(options.status)))
  }
  const termId = optionalId(options.termId)
  if (termId) conditions.push(eq(smsTimetableEntries.termId, termId))
  const classId = optionalId(options.classId)
  if (classId) conditions.push(eq(smsTimetableEntries.classId, classId))
  const teacherUserId = instant(options.teacherUserId)
  if (teacherUserId) conditions.push(eq(smsTimetableEntries.teacherUserId, teacherUserId))

  const limit = Math.min(Math.max(Math.floor(Number(options.limit ?? 200) || 200), 1), 400)
  return await db.select({
    id: smsTimetableEntries.id,
    termId: smsTimetableEntries.termId,
    termName: smsTerms.name,
    classId: smsTimetableEntries.classId,
    className: smsClasses.name,
    subjectId: smsTimetableEntries.subjectId,
    subjectName: smsSubjects.name,
    teacherUserId: smsTimetableEntries.teacherUserId,
    teacherName: smsTeachers.name,
    weekday: smsTimetableEntries.weekday,
    periodNo: smsTimetableEntries.periodNo,
    room: smsTimetableEntries.room,
    status: smsTimetableEntries.status
  }).from(smsTimetableEntries)
    .leftJoin(smsClasses, eq(smsClasses.id, smsTimetableEntries.classId))
    .leftJoin(smsSubjects, eq(smsSubjects.id, smsTimetableEntries.subjectId))
    .leftJoin(smsTerms, eq(smsTerms.id, smsTimetableEntries.termId))
    .leftJoin(smsTeachers, eq(smsTeachers.userId, smsTimetableEntries.teacherUserId))
    .where(and(...conditions))
    .orderBy(asc(smsTimetableEntries.weekday), asc(smsTimetableEntries.periodNo))
    .limit(limit)
}

export interface CreateTimetableEntryInput {
  termId?: unknown
  classId?: unknown
  subjectId?: unknown
  teacherUserId?: unknown
  weekday?: unknown
  periodNo?: unknown
  room?: unknown
}

export async function createTimetableEntry(actor: SmsActor, input: CreateTimetableEntryInput) {
  const organizationId = requireTimetableUpdate(actor)
  const classId = positiveId(input.classId, 'classId')
  const classIds = await scopedTimetableClassIds(actor)
  const [cls] = await db.select({ id: smsClasses.id, name: smsClasses.name }).from(smsClasses)
    .where(and(
      eq(smsClasses.id, classId),
      eq(smsClasses.organizationId, organizationId),
      isNull(smsClasses.deletedAt)
    ))
    .limit(1)
  if (!cls || (classIds && !classIds.includes(classId))) {
    throw createError({ statusCode: 404, message: 'Class not found' })
  }

  const weekday = normalizeWeekday(input.weekday)
  const periodNo = normalizePeriodNo(input.periodNo)
  const termId = optionalId(input.termId)
  if (termId) await assertTermInContext(actor, termId)
  const subjectId = optionalId(input.subjectId)
  if (subjectId) await assertSubjectInContext(actor, subjectId)
  const teacherUserId = instant(input.teacherUserId)
  const room = typeof input.room === 'string' && input.room.trim() ? input.room.trim().slice(0, 40) : null

  const existing = await db.select({
    id: smsTimetableEntries.id,
    termId: smsTimetableEntries.termId,
    classId: smsTimetableEntries.classId,
    teacherUserId: smsTimetableEntries.teacherUserId,
    weekday: smsTimetableEntries.weekday,
    periodNo: smsTimetableEntries.periodNo,
    room: smsTimetableEntries.room
  }).from(smsTimetableEntries)
    .where(and(
      eq(smsTimetableEntries.organizationId, organizationId),
      eq(smsTimetableEntries.weekday, weekday),
      eq(smsTimetableEntries.periodNo, periodNo)
    ))

  const conflicts = detectTimetableConflicts(existing, {
    termId,
    classId,
    teacherUserId,
    weekday,
    periodNo,
    room
  })
  if (conflicts.length > 0) {
    throw createError({
      statusCode: 409,
      message: `Timetable conflict: ${conflicts.map(item => item.type).join(', ')}`,
      data: { conflicts }
    })
  }

  return await db.transaction(async (tx) => {
    const [row] = await tx.insert(smsTimetableEntries).values({
      organizationId,
      tenantId: actor.tenantId ?? null,
      termId,
      classId,
      subjectId,
      teacherUserId,
      weekday,
      periodNo,
      room,
      status: 'draft',
      createdBy: actor.userId
    }).returning()
    if (!row) throw createError({ statusCode: 500, message: 'Failed to create timetable entry' })
    await writeAudit(tx, {
      actorUserId: actor.userId,
      tenantId: actor.tenantId ?? undefined,
      organizationId,
      moduleId: 'sms',
      action: 'timetable.create',
      resource: 'timetable',
      recordId: row.id,
      after: row,
      source: 'sms-service'
    })
    return row
  })
}

export interface PublishTimetableInput {
  termId?: unknown
  classId?: unknown
}

export async function publishTimetable(actor: SmsActor, input: PublishTimetableInput = {}) {
  const organizationId = requireSmsOrganization(actor)
  if (!canPublishTimetable(actor)) {
    throw createError({ statusCode: 403, statusMessage: 'Forbidden', message: 'No permission to publish timetable' })
  }
  const termId = optionalId(input.termId)
  const classId = optionalId(input.classId)
  if (classId) {
    const classIds = await scopedTimetableClassIds(actor)
    if (classIds && !classIds.includes(classId)) {
      throw createError({ statusCode: 404, message: 'Class not found' })
    }
  }
  const conditions = [
    eq(smsTimetableEntries.organizationId, organizationId),
    eq(smsTimetableEntries.status, 'draft')
  ]
  if (termId) conditions.push(eq(smsTimetableEntries.termId, termId))
  if (classId) conditions.push(eq(smsTimetableEntries.classId, classId))

  return await db.transaction(async (tx) => {
    const rows = await tx.update(smsTimetableEntries)
      .set({ status: 'published', updatedAt: new Date() })
      .where(and(...conditions))
      .returning({ id: smsTimetableEntries.id })
    await writeAudit(tx, {
      actorUserId: actor.userId,
      tenantId: actor.tenantId ?? undefined,
      organizationId,
      moduleId: 'sms',
      action: 'timetable.publish',
      resource: 'timetable',
      recordId: classId ?? 0,
      after: { termId, classId, published: rows.length },
      source: 'sms-service'
    })
    return { termId, classId, published: rows.length }
  })
}

export interface SubstitutionListQuery {
  entryId?: unknown
  classId?: unknown
  from?: unknown
  to?: unknown
  limit?: unknown
}

export async function listTimetableSubstitutions(actor: SmsActor, options: SubstitutionListQuery = {}) {
  const organizationId = requireTimetableRead(actor)
  const classIds = await scopedTimetableClassIds(actor)
  const conditions = [eq(smsTimetableSubstitutions.organizationId, organizationId)]

  const entryId = optionalId(options.entryId)
  if (entryId) conditions.push(eq(smsTimetableSubstitutions.entryId, entryId))
  const classId = optionalId(options.classId)
  if (classId) conditions.push(eq(smsTimetableEntries.classId, classId))
  if (classIds) {
    conditions.push(classIds.length
      ? inArray(smsTimetableEntries.classId, classIds)
      : eq(smsTimetableEntries.id, -1))
  }
  if (typeof options.from === 'string' && options.from.trim()) {
    conditions.push(gte(smsTimetableSubstitutions.date, normalizeSubstitutionDate(options.from)))
  }
  if (typeof options.to === 'string' && options.to.trim()) {
    conditions.push(lte(smsTimetableSubstitutions.date, normalizeSubstitutionDate(options.to)))
  }

  const limit = Math.min(Math.max(Math.floor(Number(options.limit ?? 100) || 100), 1), 300)
  const rows = await db.select({
    id: smsTimetableSubstitutions.id,
    entryId: smsTimetableSubstitutions.entryId,
    date: smsTimetableSubstitutions.date,
    type: smsTimetableSubstitutions.type,
    originalTeacherUserId: smsTimetableSubstitutions.originalTeacherUserId,
    substituteUserId: smsTimetableSubstitutions.substituteUserId,
    room: smsTimetableSubstitutions.room,
    reason: smsTimetableSubstitutions.reason,
    createdAt: smsTimetableSubstitutions.createdAt,
    classId: smsTimetableEntries.classId,
    className: smsClasses.name,
    subjectName: smsSubjects.name,
    weekday: smsTimetableEntries.weekday,
    periodNo: smsTimetableEntries.periodNo,
    teacherName: smsTeachers.name
  }).from(smsTimetableSubstitutions)
    .innerJoin(smsTimetableEntries, and(
      eq(smsTimetableEntries.id, smsTimetableSubstitutions.entryId),
      eq(smsTimetableEntries.organizationId, organizationId)
    ))
    .leftJoin(smsClasses, eq(smsClasses.id, smsTimetableEntries.classId))
    .leftJoin(smsSubjects, eq(smsSubjects.id, smsTimetableEntries.subjectId))
    .leftJoin(smsTeachers, eq(smsTeachers.userId, smsTimetableEntries.teacherUserId))
    .where(and(...conditions))
    .orderBy(asc(smsTimetableSubstitutions.date), asc(smsTimetableEntries.periodNo))
    .limit(limit)

  const substituteIds = [...new Set(rows
    .map(row => row.substituteUserId)
    .filter((id): id is number => Number.isSafeInteger(id)))]
  const names = substituteIds.length === 0
    ? []
    : await db.select({ userId: smsTeachers.userId, name: smsTeachers.name }).from(smsTeachers)
        .where(and(
          eq(smsTeachers.organizationId, organizationId),
          inArray(smsTeachers.userId, substituteIds)
        ))
  const nameMap = new Map(names.map(row => [row.userId, row.name]))

  return rows.map(row => ({
    ...row,
    substituteName: row.substituteUserId === null ? null : nameMap.get(row.substituteUserId) ?? null
  }))
}

export interface CreateSubstitutionInput {
  entryId?: unknown
  date?: unknown
  type?: unknown
  substituteUserId?: unknown
  room?: unknown
  reason?: unknown
}

export async function createTimetableSubstitution(actor: SmsActor, input: CreateSubstitutionInput) {
  const organizationId = requireTimetableUpdate(actor)
  const entryId = positiveId(input.entryId, 'entryId')
  const date = normalizeSubstitutionDate(input.date)
  const type = normalizeSubstitutionType(input.type)
  const substituteUserId = instant(input.substituteUserId)
  if (type === 'substitute' && substituteUserId === null) {
    throw createError({ statusCode: 400, message: '代课必须选择代课教师' })
  }
  const room = typeof input.room === 'string' && input.room.trim() ? input.room.trim().slice(0, 40) : null
  const reason = typeof input.reason === 'string' && input.reason.trim() ? input.reason.trim().slice(0, 200) : null

  const classIds = await scopedTimetableClassIds(actor)
  const entryConditions = [
    eq(smsTimetableEntries.id, entryId),
    eq(smsTimetableEntries.organizationId, organizationId)
  ]
  if (classIds) {
    if (classIds.length === 0) throw createError({ statusCode: 404, message: 'Timetable entry not found' })
    entryConditions.push(inArray(smsTimetableEntries.classId, classIds))
  }
  const [entry] = await db.select({
    id: smsTimetableEntries.id,
    termId: smsTimetableEntries.termId,
    classId: smsTimetableEntries.classId,
    teacherUserId: smsTimetableEntries.teacherUserId,
    weekday: smsTimetableEntries.weekday,
    periodNo: smsTimetableEntries.periodNo
  }).from(smsTimetableEntries)
    .where(and(...entryConditions))
    .limit(1)
  if (!entry) throw createError({ statusCode: 404, message: 'Timetable entry not found' })

  if (weekdayOfDate(date) !== entry.weekday) {
    throw createError({ statusCode: 400, message: 'date 与课表星期不一致' })
  }

  if (substituteUserId !== null) {
    const [teacher] = await db.select({ userId: smsTeachers.userId }).from(smsTeachers)
      .where(and(
        eq(smsTeachers.organizationId, organizationId),
        eq(smsTeachers.userId, substituteUserId),
        isNull(smsTeachers.deletedAt)
      ))
      .limit(1)
    if (!teacher) throw createError({ statusCode: 400, message: '代课教师不存在' })
  }

  const slotEntries = await db.select({
    id: smsTimetableEntries.id,
    termId: smsTimetableEntries.termId,
    classId: smsTimetableEntries.classId,
    teacherUserId: smsTimetableEntries.teacherUserId,
    weekday: smsTimetableEntries.weekday,
    periodNo: smsTimetableEntries.periodNo,
    room: smsTimetableEntries.room
  }).from(smsTimetableEntries)
    .where(and(
      eq(smsTimetableEntries.organizationId, organizationId),
      eq(smsTimetableEntries.weekday, entry.weekday),
      eq(smsTimetableEntries.periodNo, entry.periodNo)
    ))

  const existing = await db.select({
    entryId: smsTimetableSubstitutions.entryId,
    date: smsTimetableSubstitutions.date,
    substituteUserId: smsTimetableSubstitutions.substituteUserId,
    classId: smsTimetableEntries.classId,
    termId: smsTimetableEntries.termId,
    weekday: smsTimetableEntries.weekday,
    periodNo: smsTimetableEntries.periodNo
  }).from(smsTimetableSubstitutions)
    .innerJoin(smsTimetableEntries, and(
      eq(smsTimetableEntries.id, smsTimetableSubstitutions.entryId),
      eq(smsTimetableEntries.organizationId, organizationId)
    ))
    .where(and(
      eq(smsTimetableSubstitutions.organizationId, organizationId),
      eq(smsTimetableSubstitutions.date, date)
    ))

  const conflicts = detectSubstitutionConflicts(slotEntries, existing, {
    entryId,
    classId: entry.classId,
    termId: entry.termId,
    weekday: entry.weekday,
    periodNo: entry.periodNo,
    date,
    substituteUserId
  })
  if (conflicts.length > 0) {
    throw createError({
      statusCode: 409,
      message: `Substitution conflict: ${conflicts.map(item => item.type).join(', ')}`,
      data: { conflicts }
    })
  }

  return await db.transaction(async (tx) => {
    const [row] = await tx.insert(smsTimetableSubstitutions).values({
      organizationId,
      tenantId: actor.tenantId ?? null,
      entryId,
      date,
      type,
      originalTeacherUserId: entry.teacherUserId,
      substituteUserId,
      room,
      reason,
      createdBy: actor.userId
    }).returning()
    if (!row) throw createError({ statusCode: 500, message: 'Failed to create substitution' })
    await writeAudit(tx, {
      actorUserId: actor.userId,
      tenantId: actor.tenantId ?? undefined,
      organizationId,
      moduleId: 'sms',
      action: 'timetable.substitution.create',
      resource: 'timetable',
      recordId: row.id,
      after: { entryId, date, type, substituteUserId, room },
      source: 'sms-service'
    })
    return row
  })
}
