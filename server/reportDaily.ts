/**
 * Daily report pre-aggregation (P1).
 *
 * One nightly job turns raw attendance rows into per-class daily totals. The
 * dashboard then reads a tiny table instead of scanning `sms_attendance_records`.
 */
import { and, asc, eq, gte, isNull, lte } from 'drizzle-orm'
import { createError } from 'h3'
import { db } from '../../../server/sdk'
import {
  smsAttendanceRecords,
  smsReportDaily,
  smsStudents
} from './database/schema'
import { canUseSms, requireSmsOrganization, type SmsActor } from './context'

export const DAILY_REPORT_SESSIONS = ['full_day'] as const

export function normalizeReportDate(value: unknown): string {
  const text = typeof value === 'string' ? value.trim() : ''
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return text
  if (value === undefined || value === null || value === '') {
    return new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString().slice(0, 10)
  }
  throw createError({ statusCode: 400, message: 'date 必须是 YYYY-MM-DD' })
}

interface Bucket {
  organizationId: number
  tenantId: number | null
  classId: number
  present: number
  late: number
  absent: number
  leave: number
  total: number
}

export function aggregateAttendance(
  rows: ReadonlyArray<{
    organizationId: number
    tenantId: number | null
    classId: number | null
    status: string
  }>
): Bucket[] {
  const buckets = new Map<string, Bucket>()
  for (const row of rows) {
    const classId = row.classId ?? 0
    const key = `${row.organizationId}:${classId}`
    const bucket = buckets.get(key) ?? {
      organizationId: row.organizationId,
      tenantId: row.tenantId,
      classId,
      present: 0,
      late: 0,
      absent: 0,
      leave: 0,
      total: 0
    }
    if (row.status === 'present') bucket.present += 1
    else if (row.status === 'late') bucket.late += 1
    else if (row.status === 'absent') bucket.absent += 1
    else if (row.status === 'leave') bucket.leave += 1
    bucket.total += 1
    buckets.set(key, bucket)
  }

  // Add a whole-school row (classId 0) per organization.
  const organizations = new Set([...buckets.values()].map(bucket => bucket.organizationId))
  for (const organizationId of organizations) {
    const classes = [...buckets.values()].filter(bucket => bucket.organizationId === organizationId)
    buckets.set(`${organizationId}:0`, {
      organizationId,
      tenantId: classes[0]?.tenantId ?? null,
      classId: 0,
      present: classes.reduce((sum, bucket) => sum + bucket.present, 0),
      late: classes.reduce((sum, bucket) => sum + bucket.late, 0),
      absent: classes.reduce((sum, bucket) => sum + bucket.absent, 0),
      leave: classes.reduce((sum, bucket) => sum + bucket.leave, 0),
      total: classes.reduce((sum, bucket) => sum + bucket.total, 0)
    })
  }
  return [...buckets.values()]
}

export async function runDailyReport(targetDate?: unknown): Promise<{
  date: string
  rows: number
}> {
  const date = normalizeReportDate(targetDate)
  const raw = await db.select({
    organizationId: smsAttendanceRecords.organizationId,
    tenantId: smsAttendanceRecords.tenantId,
    classId: smsStudents.classId,
    status: smsAttendanceRecords.status
  }).from(smsAttendanceRecords)
    .innerJoin(smsStudents, eq(smsStudents.id, smsAttendanceRecords.studentId))
    .where(and(
      eq(smsAttendanceRecords.attendanceDate, date),
      eq(smsAttendanceRecords.session, 'full_day'),
      isNull(smsStudents.deletedAt)
    ))

  const buckets = aggregateAttendance(raw)
  for (const bucket of buckets) {
    await db.insert(smsReportDaily).values({
      organizationId: bucket.organizationId,
      tenantId: bucket.tenantId,
      reportDate: date,
      classId: bucket.classId,
      present: bucket.present,
      late: bucket.late,
      absent: bucket.absent,
      leave: bucket.leave,
      total: bucket.total
    }).onConflictDoUpdate({
      target: [smsReportDaily.organizationId, smsReportDaily.reportDate, smsReportDaily.classId],
      set: {
        present: bucket.present,
        late: bucket.late,
        absent: bucket.absent,
        leave: bucket.leave,
        total: bucket.total,
        generatedAt: new Date()
      }
    })
  }
  return { date, rows: buckets.length }
}

export interface DailyReportQuery {
  from?: unknown
  to?: unknown
  classId?: unknown
  limit?: unknown
}

export async function listDailyReport(actor: SmsActor, options: DailyReportQuery = {}) {
  const organizationId = requireSmsOrganization(actor)
  if (!canUseSms(actor, 'read', 'reports')) {
    throw createError({ statusCode: 403, statusMessage: 'Forbidden', message: 'No permission to read reports' })
  }
  const to = normalizeReportDate(options.to)
  const from = normalizeReportDate(options.from ?? to)
  const conditions = [
    eq(smsReportDaily.organizationId, organizationId),
    gte(smsReportDaily.reportDate, from),
    lte(smsReportDaily.reportDate, to)
  ]
  if (options.classId !== undefined && options.classId !== null && options.classId !== '') {
    const classId = Number(options.classId)
    if (!Number.isSafeInteger(classId) || classId < 0) {
      throw createError({ statusCode: 400, message: 'classId 必须是非负整数' })
    }
    conditions.push(eq(smsReportDaily.classId, classId))
  }
  const limit = Math.min(Math.max(Math.floor(Number(options.limit ?? 200) || 200), 1), 500)
  return await db.select({
    reportDate: smsReportDaily.reportDate,
    classId: smsReportDaily.classId,
    present: smsReportDaily.present,
    late: smsReportDaily.late,
    absent: smsReportDaily.absent,
    leave: smsReportDaily.leave,
    total: smsReportDaily.total,
    generatedAt: smsReportDaily.generatedAt
  }).from(smsReportDaily)
    .where(and(...conditions))
    .orderBy(asc(smsReportDaily.reportDate), asc(smsReportDaily.classId))
    .limit(limit)
}
