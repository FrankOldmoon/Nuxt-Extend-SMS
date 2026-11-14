/**
 * Timetable (Slice C): weekly class slots with conflict detection and a
 * second-person publish step.
 *
 * Conflicts are evaluated for the same term across three dimensions:
 * class slot (one subject per class/period), teacher slot (a teacher cannot be
 * in two classes at once) and room slot.
 */
import { and, asc, eq, inArray, isNull, or } from 'drizzle-orm'
import { createError } from 'h3'
import { db, writeAudit } from '../../../server/sdk'
import {
  smsClasses,
  smsStudents,
  smsSubjects,
  smsTeachers,
  smsTeacherAssignments,
  smsTerms,
  smsTimetableEntries
} from './database/schema'
import { canUseSms, isSmsAdmin, requireSmsOrganization, type SmsActor } from './context'
import { assertSubjectInContext, assertTermInContext } from './academics'
import { guardianStudentIds } from './guardians'

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
