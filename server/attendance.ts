/**
 * Attendance service — the first vertical slice of the school-management plan.
 *
 * Everything here is organization-scoped and data-scope aware:
 * - `sms.attendance.all` (or admin) sees the whole school;
 * - homeroom / subject teachers see only their own classes.
 *
 * Records are never deleted: a correction updates the same row (unique key is
 * organization × student × date × session × period).
 */
import { and, asc, desc, eq, gte, inArray, isNull, or, sql } from 'drizzle-orm'
import { createError } from 'h3'
import { db, writeAudit } from '../../../server/sdk'
import {
  smsAttendanceAlerts,
  smsAttendanceRecords,
  smsClasses,
  smsStudents,
  smsTeacherAssignments
} from './database/schema'
import { canUseSms, isSmsAdmin, requireSmsOrganization, type SmsActor } from './context'
import { notifyAttendanceAlerts } from './notifications'
import { smsDateDaysAgo, smsDateString } from './time'

export const ATTENDANCE_STATUSES = ['present', 'late', 'absent', 'excused', 'leave'] as const
export type AttendanceStatus = typeof ATTENDANCE_STATUSES[number]

export const ATTENDANCE_SESSIONS = ['full_day', 'morning', 'afternoon', 'period'] as const
export type AttendanceSession = typeof ATTENDANCE_SESSIONS[number]

/**
 * Alert thresholds. Kept as constants for the first slice; a per-organization
 * rules table is planned once the rules UI lands.
 */
export const ATTENDANCE_RULES = {
  consecutiveAbsentDays: 3,
  monthlyAbsenceRate: 20
} as const

const MAX_BATCH_ENTRIES = 100

// ---------------------------------------------------------------------------
// Normalisation (pure, unit-tested)
// ---------------------------------------------------------------------------

export function normalizeAttendanceDate(value: unknown): string {
  if (value === undefined || value === null || value === '') {
    return smsDateString()
  }
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw createError({ statusCode: 400, message: 'date must be YYYY-MM-DD' })
  }
  const parsed = new Date(`${value}T00:00:00Z`)
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) {
    throw createError({ statusCode: 400, message: 'date is not a valid calendar day' })
  }
  return value
}

export function normalizeAttendanceStatus(value: unknown): AttendanceStatus {
  if (typeof value === 'string' && (ATTENDANCE_STATUSES as readonly string[]).includes(value)) {
    return value as AttendanceStatus
  }
  throw createError({
    statusCode: 400,
    message: `status must be one of ${ATTENDANCE_STATUSES.join(', ')}`
  })
}

export function normalizeAttendanceSession(value: unknown): AttendanceSession {
  if (value === undefined || value === null || value === '') return 'full_day'
  if (typeof value === 'string' && (ATTENDANCE_SESSIONS as readonly string[]).includes(value)) {
    return value as AttendanceSession
  }
  throw createError({
    statusCode: 400,
    message: `session must be one of ${ATTENDANCE_SESSIONS.join(', ')}`
  })
}

/** `period` sessions need a positive period number; other sessions must not. */
export function normalizePeriodNo(session: AttendanceSession, value: unknown): number | null {
  if (session !== 'period') return null
  const period = Number(value)
  if (!Number.isSafeInteger(period) || period < 1 || period > 12) {
    throw createError({ statusCode: 400, message: 'periodNo must be an integer between 1 and 12' })
  }
  return period
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

function requireAttendancePermission(actor: SmsActor, action: 'read' | 'update'): number {
  const organizationId = requireSmsOrganization(actor)
  if (!canUseSms(actor, action, 'attendance')) {
    throw createError({
      statusCode: 403,
      statusMessage: 'Forbidden',
      message: `No permission to ${action} attendance`
    })
  }
  return organizationId
}

/** Whole-school attendance scope (admin or the explicit `sms.attendance.all` grant). */
export function hasSchoolWideAttendance(actor: SmsActor): boolean {
  if (isSmsAdmin(actor)) return true
  return (actor.permissions ?? []).includes('sms.attendance.all')
}

// ---------------------------------------------------------------------------
// Data scope
// ---------------------------------------------------------------------------

/** `null` means whole organization; otherwise the classes the actor owns. */
export async function scopedClassIds(actor: SmsActor): Promise<number[] | null> {
  if (hasSchoolWideAttendance(actor)) return null
  const organizationId = requireSmsOrganization(actor)
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

async function classRow(actor: SmsActor, classId: number) {
  const organizationId = requireSmsOrganization(actor)
  const [row] = await db.select({
    id: smsClasses.id,
    name: smsClasses.name,
    homeroomUserId: smsClasses.homeroomUserId
  }).from(smsClasses)
    .where(and(
      eq(smsClasses.id, classId),
      eq(smsClasses.organizationId, organizationId),
      isNull(smsClasses.deletedAt)
    ))
    .limit(1)
  return row ?? null
}

/** Ensures the class exists in the organization *and* is inside the actor's scope. */
export async function assertClassInScope(actor: SmsActor, classId: number) {
  const row = await classRow(actor, classId)
  const allowed = await scopedClassIds(actor)
  if (!row || (allowed && !allowed.includes(classId))) {
    // 404 rather than 403 so cross-scope ids cannot be enumerated.
    throw createError({ statusCode: 404, message: 'Class not found' })
  }
  return row
}

async function firstScopedClassId(actor: SmsActor): Promise<number> {
  const allowed = await scopedClassIds(actor)
  if (allowed === null) {
    const organizationId = requireSmsOrganization(actor)
    const [row] = await db.select({ id: smsClasses.id }).from(smsClasses)
      .where(and(eq(smsClasses.organizationId, organizationId), isNull(smsClasses.deletedAt)))
      .orderBy(asc(smsClasses.id))
      .limit(1)
    if (!row) throw createError({ statusCode: 404, message: 'No class available' })
    return row.id
  }
  const [first] = allowed
  if (!first) {
    throw createError({
      statusCode: 403,
      statusMessage: 'Forbidden',
      message: 'You are not assigned to any class'
    })
  }
  return first
}

async function assertStudentInClass(organizationId: number, studentId: number, classId: number) {
  const [row] = await db.select({
    id: smsStudents.id,
    name: smsStudents.name,
    studentNo: smsStudents.studentNo,
    classId: smsStudents.classId
  }).from(smsStudents)
    .where(and(
      eq(smsStudents.id, studentId),
      eq(smsStudents.organizationId, organizationId),
      isNull(smsStudents.deletedAt)
    ))
    .limit(1)
  if (!row || row.classId !== classId) {
    throw createError({ statusCode: 400, message: 'studentId does not belong to the class' })
  }
  return row
}

// ---------------------------------------------------------------------------
// Alert evaluation (pure, unit-tested)
// ---------------------------------------------------------------------------

export interface AttendanceDay {
  date: string
  status: AttendanceStatus
}

export interface AttendanceAlertCandidate {
  rule: 'consecutive_absent' | 'monthly_rate'
  windowStart: string
  windowEnd: string
  metric: number
  threshold: number
}

function round2(value: number): number {
  return Math.round(value * 100) / 100
}

/**
 * Derive alert candidates from full-day attendance history (ascending date).
 * Pure so the rules can be tested without a database.
 */
export function evaluateAttendanceAlerts(
  days: readonly AttendanceDay[],
  rules: { consecutiveAbsentDays: number, monthlyAbsenceRate: number } = ATTENDANCE_RULES
): AttendanceAlertCandidate[] {
  const alerts: AttendanceAlertCandidate[] = []

  let runStart: string | null = null
  let runEnd: string | null = null
  let runLength = 0
  for (const day of days) {
    if (day.status === 'absent') {
      runStart ??= day.date
      runEnd = day.date
      runLength += 1
      continue
    }
    if (runLength >= rules.consecutiveAbsentDays && runStart && runEnd) {
      alerts.push({
        rule: 'consecutive_absent',
        windowStart: runStart,
        windowEnd: runEnd,
        metric: runLength,
        threshold: rules.consecutiveAbsentDays
      })
    }
    runStart = null
    runEnd = null
    runLength = 0
  }
  if (runLength >= rules.consecutiveAbsentDays && runStart && runEnd) {
    alerts.push({
      rule: 'consecutive_absent',
      windowStart: runStart,
      windowEnd: runEnd,
      metric: runLength,
      threshold: rules.consecutiveAbsentDays
    })
  }

  const months = new Map<string, { total: number, absent: number, end: string }>()
  for (const day of days) {
    const month = day.date.slice(0, 7)
    const bucket = months.get(month) ?? { total: 0, absent: 0, end: day.date }
    bucket.total += 1
    if (day.status === 'absent') bucket.absent += 1
    if (day.date > bucket.end) bucket.end = day.date
    months.set(month, bucket)
  }
  for (const [month, bucket] of months) {
    const rate = round2((bucket.absent / bucket.total) * 100)
    if (rate >= rules.monthlyAbsenceRate) {
      alerts.push({
        rule: 'monthly_rate',
        windowStart: `${month}-01`,
        windowEnd: bucket.end,
        metric: rate,
        threshold: rules.monthlyAbsenceRate
      })
    }
  }

  return alerts
}

async function refreshAlerts(
  tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
  organizationId: number,
  tenantId: number | null,
  studentId: number
): Promise<number> {
  const since = smsDateDaysAgo(90)
  const rows = await tx.select({
    date: smsAttendanceRecords.attendanceDate,
    status: smsAttendanceRecords.status
  }).from(smsAttendanceRecords)
    .where(and(
      eq(smsAttendanceRecords.organizationId, organizationId),
      eq(smsAttendanceRecords.studentId, studentId),
      eq(smsAttendanceRecords.session, 'full_day'),
      gte(smsAttendanceRecords.attendanceDate, since)
    ))
    .orderBy(asc(smsAttendanceRecords.attendanceDate))

  const days: AttendanceDay[] = rows.map(row => ({
    date: row.date,
    status: normalizeAttendanceStatus(row.status)
  }))
  let created = 0
  for (const alert of evaluateAttendanceAlerts(days)) {
    const inserted = await tx.insert(smsAttendanceAlerts).values({
      organizationId,
      tenantId,
      studentId,
      rule: alert.rule,
      windowStart: alert.windowStart,
      windowEnd: alert.windowEnd,
      metric: alert.metric.toFixed(2),
      threshold: alert.threshold.toFixed(2)
    }).onConflictDoNothing().returning({ id: smsAttendanceAlerts.id })
    created += inserted.length
  }
  return created
}

// ---------------------------------------------------------------------------
// Roster
// ---------------------------------------------------------------------------

export interface RosterOptions {
  classId?: unknown
  date?: unknown
  session?: unknown
}

export async function listAttendanceRoster(actor: SmsActor, options: RosterOptions = {}) {
  requireAttendancePermission(actor, 'read')
  const organizationId = requireSmsOrganization(actor)
  const requestedClassId = optionalId(options.classId)
  const classId = requestedClassId ?? await firstScopedClassId(actor)
  const target = await assertClassInScope(actor, classId)
  const date = normalizeAttendanceDate(options.date)
  const session = normalizeAttendanceSession(options.session)

  const rows = await db.select({
    studentId: smsStudents.id,
    studentName: smsStudents.name,
    studentNo: smsStudents.studentNo,
    recordId: smsAttendanceRecords.id,
    status: smsAttendanceRecords.status,
    remark: smsAttendanceRecords.remark,
    updatedAt: smsAttendanceRecords.updatedAt
  }).from(smsStudents)
    .leftJoin(smsAttendanceRecords, and(
      eq(smsAttendanceRecords.studentId, smsStudents.id),
      eq(smsAttendanceRecords.organizationId, organizationId),
      eq(smsAttendanceRecords.attendanceDate, date),
      eq(smsAttendanceRecords.session, session)
    ))
    .where(and(
      eq(smsStudents.organizationId, organizationId),
      eq(smsStudents.classId, classId),
      isNull(smsStudents.deletedAt)
    ))
    .orderBy(asc(smsStudents.studentNo), asc(smsStudents.id))

  return {
    classId,
    className: target.name,
    date,
    session,
    rows: rows.map(row => ({
      studentId: row.studentId,
      studentName: row.studentName,
      studentNo: row.studentNo,
      recordId: row.recordId,
      status: row.status,
      remark: row.remark,
      updatedAt: row.updatedAt
    }))
  }
}

// ---------------------------------------------------------------------------
// Writes
// ---------------------------------------------------------------------------

export interface MarkAttendanceInput {
  classId?: unknown
  studentId?: unknown
  date?: unknown
  session?: unknown
  periodNo?: unknown
  status?: unknown
  remark?: unknown
}

interface MatchedRecord {
  id: number
  status: string
  remark: string | null
}

async function upsertRecord(
  tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
  values: {
    organizationId: number
    tenantId: number | null
    classId: number
    studentId: number
    date: string
    session: AttendanceSession
    periodNo: number | null
    status: AttendanceStatus
    remark: string | null
    actorUserId: number
  }
): Promise<{ row: { id: number, status: string, remark: string | null }, before: MatchedRecord | null }> {
  const match = and(
    eq(smsAttendanceRecords.organizationId, values.organizationId),
    eq(smsAttendanceRecords.studentId, values.studentId),
    eq(smsAttendanceRecords.attendanceDate, values.date),
    eq(smsAttendanceRecords.session, values.session),
    values.periodNo === null
      ? isNull(smsAttendanceRecords.periodNo)
      : eq(smsAttendanceRecords.periodNo, values.periodNo)
  )
  const [existing] = await tx.select({
    id: smsAttendanceRecords.id,
    status: smsAttendanceRecords.status,
    remark: smsAttendanceRecords.remark
  }).from(smsAttendanceRecords).where(match).limit(1)

  if (existing) {
    const [updated] = await tx.update(smsAttendanceRecords)
      .set({
        status: values.status,
        remark: values.remark,
        recordedBy: values.actorUserId,
        updatedAt: new Date()
      })
      .where(eq(smsAttendanceRecords.id, existing.id))
      .returning({ id: smsAttendanceRecords.id, status: smsAttendanceRecords.status, remark: smsAttendanceRecords.remark })
    if (!updated) throw createError({ statusCode: 500, message: 'Failed to update attendance' })
    return { row: updated, before: existing }
  }

  const [created] = await tx.insert(smsAttendanceRecords).values({
    organizationId: values.organizationId,
    tenantId: values.tenantId,
    classId: values.classId,
    studentId: values.studentId,
    attendanceDate: values.date,
    session: values.session,
    periodNo: values.periodNo,
    status: values.status,
    remark: values.remark,
    recordedBy: values.actorUserId
  }).returning({ id: smsAttendanceRecords.id, status: smsAttendanceRecords.status, remark: smsAttendanceRecords.remark })
  if (!created) throw createError({ statusCode: 500, message: 'Failed to record attendance' })
  return { row: created, before: null }
}

export async function markAttendance(actor: SmsActor, input: MarkAttendanceInput) {
  const organizationId = requireAttendancePermission(actor, 'update')
  const studentId = positiveId(input.studentId, 'studentId')
  const classIdInput = optionalId(input.classId)
  const date = normalizeAttendanceDate(input.date)
  const session = normalizeAttendanceSession(input.session)
  const periodNo = normalizePeriodNo(session, input.periodNo)
  const status = normalizeAttendanceStatus(input.status)

  const [student] = await db.select({ classId: smsStudents.classId, name: smsStudents.name })
    .from(smsStudents)
    .where(and(
      eq(smsStudents.id, studentId),
      eq(smsStudents.organizationId, organizationId),
      isNull(smsStudents.deletedAt)
    ))
    .limit(1)
  if (!student) throw createError({ statusCode: 404, message: 'Student not found' })
  const classId = classIdInput ?? student.classId
  if (!classId) throw createError({ statusCode: 400, message: 'Student has no class; provide classId' })
  const target = await assertClassInScope(actor, classId)
  await assertStudentInClass(organizationId, studentId, classId)

  const remark = typeof input.remark === 'string' && input.remark.trim()
    ? input.remark.trim().slice(0, 255)
    : null

  return await db.transaction(async (tx) => {
    const { row, before } = await upsertRecord(tx, {
      organizationId,
      tenantId: actor.tenantId ?? null,
      classId,
      studentId,
      date,
      session,
      periodNo,
      status,
      remark,
      actorUserId: actor.userId
    })
    const createdAlerts = await refreshAlerts(tx, organizationId, actor.tenantId ?? null, studentId)
    if (createdAlerts > 0) {
      await notifyAttendanceAlerts(tx, {
        organizationId,
        tenantId: actor.tenantId ?? null,
        studentId,
        classId,
        studentName: student.name,
        alertCount: createdAlerts
      })
    }
    await writeAudit(tx, {
      actorUserId: actor.userId,
      tenantId: actor.tenantId ?? undefined,
      organizationId,
      moduleId: 'sms',
      action: before ? 'attendance.correct' : 'attendance.mark',
      resource: 'attendance',
      recordId: row.id,
      before,
      after: { ...row, classId, studentId, date, session, periodNo },
      source: 'sms-service'
    })
    return {
      recordId: row.id,
      classId,
      className: target.name,
      studentId,
      studentName: student.name,
      date,
      session,
      periodNo,
      status: row.status,
      remark: row.remark,
      corrected: Boolean(before)
    }
  })
}

export interface BatchMarkInput {
  classId?: unknown
  date?: unknown
  session?: unknown
  entries?: unknown
}

interface BatchEntry {
  studentId: number
  status: AttendanceStatus
  remark?: string | null
}

export function normalizeBatchEntries(value: unknown): BatchEntry[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw createError({ statusCode: 400, message: 'entries must be a non-empty array' })
  }
  if (value.length > MAX_BATCH_ENTRIES) {
    throw createError({ statusCode: 400, message: `entries must not exceed ${MAX_BATCH_ENTRIES}` })
  }
  const seen = new Set<number>()
  return value.map((entry, index) => {
    if (typeof entry !== 'object' || entry === null) {
      throw createError({ statusCode: 400, message: `entries[${index}] must be an object` })
    }
    const row = entry as Record<string, unknown>
    const studentId = positiveId(row.studentId, `entries[${index}].studentId`)
    if (seen.has(studentId)) {
      throw createError({ statusCode: 400, message: `entries[${index}] duplicates student ${studentId}` })
    }
    seen.add(studentId)
    const remark = typeof row.remark === 'string' && row.remark.trim()
      ? row.remark.trim().slice(0, 255)
      : null
    return { studentId, status: normalizeAttendanceStatus(row.status), remark }
  })
}

export async function batchMarkAttendance(actor: SmsActor, input: BatchMarkInput) {
  const organizationId = requireAttendancePermission(actor, 'update')
  const requestedClassId = optionalId(input.classId)
  const classId = requestedClassId ?? await firstScopedClassId(actor)
  const target = await assertClassInScope(actor, classId)
  const date = normalizeAttendanceDate(input.date)
  const session = normalizeAttendanceSession(input.session)
  const entries = normalizeBatchEntries(input.entries)

  for (const entry of entries) {
    await assertStudentInClass(organizationId, entry.studentId, classId)
  }
  const studentIds = [...new Set(entries.map(entry => entry.studentId))]
  const nameRows = await db.select({ id: smsStudents.id, name: smsStudents.name })
    .from(smsStudents)
    .where(and(
      eq(smsStudents.organizationId, organizationId),
      inArray(smsStudents.id, studentIds)
    ))
  const studentNames = new Map(nameRows.map(row => [row.id, row.name]))

  return await db.transaction(async (tx) => {
    const results: Array<{ studentId: number, recordId: number, status: string }> = []
    let corrected = 0
    for (const entry of entries) {
      const { row, before } = await upsertRecord(tx, {
        organizationId,
        tenantId: actor.tenantId ?? null,
        classId,
        studentId: entry.studentId,
        date,
        session,
        periodNo: null,
        status: entry.status,
        remark: entry.remark ?? null,
        actorUserId: actor.userId
      })
      if (before) corrected += 1
      results.push({ studentId: entry.studentId, recordId: row.id, status: row.status })
    }
    for (const studentId of studentIds) {
      const createdAlerts = await refreshAlerts(tx, organizationId, actor.tenantId ?? null, studentId)
      if (createdAlerts > 0) {
        await notifyAttendanceAlerts(tx, {
          organizationId,
          tenantId: actor.tenantId ?? null,
          studentId,
          classId,
          studentName: studentNames.get(studentId) ?? null,
          alertCount: createdAlerts
        })
      }
    }
    await writeAudit(tx, {
      actorUserId: actor.userId,
      tenantId: actor.tenantId ?? undefined,
      organizationId,
      moduleId: 'sms',
      action: 'attendance.batch-mark',
      resource: 'attendance',
      recordId: results[0]?.recordId ?? 0,
      after: { classId, date, session, entries: results },
      source: 'sms-service'
    })
    return {
      classId,
      className: target.name,
      date,
      session,
      total: results.length,
      corrected,
      created: results.length - corrected,
      results
    }
  })
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

export interface AttendanceRecordQuery {
  classId?: unknown
  studentId?: unknown
  from?: unknown
  to?: unknown
  status?: unknown
  limit?: unknown
}

export async function listAttendanceRecords(actor: SmsActor, options: AttendanceRecordQuery = {}) {
  requireAttendancePermission(actor, 'read')
  const organizationId = requireSmsOrganization(actor)
  const allowed = await scopedClassIds(actor)
  const conditions = [eq(smsAttendanceRecords.organizationId, organizationId)]

  const requestedClassId = optionalId(options.classId)
  if (requestedClassId) {
    await assertClassInScope(actor, requestedClassId)
    conditions.push(eq(smsAttendanceRecords.classId, requestedClassId))
  } else if (allowed) {
    conditions.push(allowed.length ? inArray(smsAttendanceRecords.classId, allowed) : eq(smsAttendanceRecords.id, -1))
  }

  const studentId = optionalId(options.studentId)
  if (studentId) conditions.push(eq(smsAttendanceRecords.studentId, studentId))
  if (options.from !== undefined) {
    conditions.push(gte(smsAttendanceRecords.attendanceDate, normalizeAttendanceDate(options.from)))
  }
  if (options.to !== undefined) {
    const to = normalizeAttendanceDate(options.to)
    conditions.push(sql`${smsAttendanceRecords.attendanceDate} <= ${to}`)
  }
  if (options.status !== undefined && options.status !== null && options.status !== '') {
    conditions.push(eq(smsAttendanceRecords.status, normalizeAttendanceStatus(options.status)))
  }

  const limit = Math.min(Math.max(Math.floor(Number(options.limit ?? 100) || 100), 1), 200)
  const rows = await db.select({
    id: smsAttendanceRecords.id,
    attendanceDate: smsAttendanceRecords.attendanceDate,
    session: smsAttendanceRecords.session,
    periodNo: smsAttendanceRecords.periodNo,
    status: smsAttendanceRecords.status,
    remark: smsAttendanceRecords.remark,
    classId: smsAttendanceRecords.classId,
    className: smsClasses.name,
    studentId: smsAttendanceRecords.studentId,
    studentName: smsStudents.name,
    studentNo: smsStudents.studentNo
  }).from(smsAttendanceRecords)
    .innerJoin(smsStudents, eq(smsStudents.id, smsAttendanceRecords.studentId))
    .leftJoin(smsClasses, eq(smsClasses.id, smsAttendanceRecords.classId))
    .where(and(...conditions))
    .orderBy(desc(smsAttendanceRecords.attendanceDate), asc(smsStudents.studentNo))
    .limit(limit)
  return rows
}

export interface AttendanceSummaryQuery {
  classId?: unknown
  from?: unknown
  to?: unknown
}

export async function summarizeAttendance(actor: SmsActor, options: AttendanceSummaryQuery = {}) {
  requireAttendancePermission(actor, 'read')
  const organizationId = requireSmsOrganization(actor)
  const allowed = await scopedClassIds(actor)
  const to = normalizeAttendanceDate(options.to)
  const from = normalizeAttendanceDate(options.from ?? smsDateDaysAgo(30))
  if (from > to) throw createError({ statusCode: 400, message: 'from must be before to' })

  const conditions = [
    eq(smsAttendanceRecords.organizationId, organizationId),
    gte(smsAttendanceRecords.attendanceDate, from),
    sql`${smsAttendanceRecords.attendanceDate} <= ${to}`
  ]
  const requestedClassId = optionalId(options.classId)
  if (requestedClassId) {
    await assertClassInScope(actor, requestedClassId)
    conditions.push(eq(smsAttendanceRecords.classId, requestedClassId))
  } else if (allowed) {
    conditions.push(allowed.length ? inArray(smsAttendanceRecords.classId, allowed) : eq(smsAttendanceRecords.id, -1))
  }

  const rows = await db.select({
    classId: smsAttendanceRecords.classId,
    className: smsClasses.name,
    total: sql<number>`count(*)::int`,
    present: sql<number>`count(*) filter (where ${smsAttendanceRecords.status} = 'present')::int`,
    late: sql<number>`count(*) filter (where ${smsAttendanceRecords.status} = 'late')::int`,
    absent: sql<number>`count(*) filter (where ${smsAttendanceRecords.status} = 'absent')::int`,
    excused: sql<number>`count(*) filter (where ${smsAttendanceRecords.status} = 'excused')::int`,
    leave: sql<number>`count(*) filter (where ${smsAttendanceRecords.status} = 'leave')::int`
  }).from(smsAttendanceRecords)
    .leftJoin(smsClasses, eq(smsClasses.id, smsAttendanceRecords.classId))
    .where(and(...conditions))
    .groupBy(smsAttendanceRecords.classId, smsClasses.name)
    .orderBy(asc(smsClasses.name))

  return rows.map(row => ({
    ...row,
    absenceRate: row.total > 0 ? round2((row.absent / row.total) * 100) : 0
  }))
}

export interface AttendanceAlertQuery {
  status?: unknown
  limit?: unknown
}

export async function listAttendanceAlerts(actor: SmsActor, options: AttendanceAlertQuery = {}) {
  requireAttendancePermission(actor, 'read')
  const organizationId = requireSmsOrganization(actor)
  const allowed = await scopedClassIds(actor)
  const conditions = [eq(smsAttendanceAlerts.organizationId, organizationId)]
  if (allowed) {
    conditions.push(allowed.length
      ? inArray(smsStudents.classId, allowed)
      : eq(smsAttendanceAlerts.id, -1))
  }
  if (options.status !== undefined && options.status !== null && options.status !== '') {
    const status = String(options.status)
    if (!['open', 'acknowledged', 'resolved'].includes(status)) {
      throw createError({ statusCode: 400, message: 'status must be open, acknowledged or resolved' })
    }
    conditions.push(eq(smsAttendanceAlerts.status, status))
  }
  const limit = Math.min(Math.max(Math.floor(Number(options.limit ?? 50) || 50), 1), 200)
  const rows = await db.select({
    id: smsAttendanceAlerts.id,
    studentId: smsAttendanceAlerts.studentId,
    studentName: smsStudents.name,
    studentNo: smsStudents.studentNo,
    className: smsClasses.name,
    rule: smsAttendanceAlerts.rule,
    windowStart: smsAttendanceAlerts.windowStart,
    windowEnd: smsAttendanceAlerts.windowEnd,
    metric: smsAttendanceAlerts.metric,
    threshold: smsAttendanceAlerts.threshold,
    status: smsAttendanceAlerts.status,
    createdAt: smsAttendanceAlerts.createdAt
  }).from(smsAttendanceAlerts)
    .innerJoin(smsStudents, eq(smsStudents.id, smsAttendanceAlerts.studentId))
    .leftJoin(smsClasses, eq(smsClasses.id, smsStudents.classId))
    .where(and(...conditions))
    .orderBy(desc(smsAttendanceAlerts.createdAt))
    .limit(limit)

  return rows.map(row => ({
    ...row,
    metric: Number(row.metric),
    threshold: Number(row.threshold)
  }))
}

export async function acknowledgeAttendanceAlert(actor: SmsActor, alertId: number) {
  const organizationId = requireAttendancePermission(actor, 'update')
  const [alert] = await db.select({
    id: smsAttendanceAlerts.id,
    studentId: smsAttendanceAlerts.studentId,
    status: smsAttendanceAlerts.status
  }).from(smsAttendanceAlerts)
    .where(and(
      eq(smsAttendanceAlerts.id, alertId),
      eq(smsAttendanceAlerts.organizationId, organizationId)
    ))
    .limit(1)
  if (!alert) throw createError({ statusCode: 404, message: 'Alert not found' })

  const [student] = await db.select({ classId: smsStudents.classId }).from(smsStudents)
    .where(eq(smsStudents.id, alert.studentId))
    .limit(1)
  if (student?.classId) await assertClassInScope(actor, student.classId)

  return await db.transaction(async (tx) => {
    const [row] = await tx.update(smsAttendanceAlerts)
      .set({ status: 'acknowledged', acknowledgedBy: actor.userId, acknowledgedAt: new Date() })
      .where(eq(smsAttendanceAlerts.id, alertId))
      .returning()
    await writeAudit(tx, {
      actorUserId: actor.userId,
      tenantId: actor.tenantId ?? undefined,
      organizationId,
      moduleId: 'sms',
      action: 'attendance.alert.ack',
      resource: 'attendance',
      recordId: alertId,
      before: alert,
      after: { status: 'acknowledged' },
      source: 'sms-service'
    })
    return row
  })
}
