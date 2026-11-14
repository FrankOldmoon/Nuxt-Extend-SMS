/**
 * Reports (Phase 5): read-only aggregates plus an approval-gated CSV export.
 *
 * Reports never mutate data. Each aggregate reuses the existing scope helpers so
 * a teacher sees their own classes while `sms.reports.read` + school-wide
 * scopes see the whole organization.
 */
import { and, asc, eq, gte, inArray, lte, sql } from 'drizzle-orm'
import { createError } from 'h3'
import { db, writeAudit } from '../../../server/sdk'
import {
  smsAttendanceRecords,
  smsClasses,
  smsExamScores,
  smsExams,
  smsInvoices,
  smsPayments,
  smsRefunds,
  smsSubjects
} from './database/schema'
import { canUseSms, isSmsAdmin, requireSmsOrganization, type SmsActor } from './context'
import { scopedClassIds as scopedAttendanceClassIds } from './attendance'
import { scopedExamClassIds } from './exams'
import { smsDateString } from './time'

export const REPORT_TYPES = ['attendance', 'scores', 'finance'] as const
export type ReportType = typeof REPORT_TYPES[number]

const DAY_MS = 24 * 60 * 60 * 1000

function round2(value: number): number {
  return Math.round(value * 100) / 100
}

/** Attendance rate: present + late over all recorded rows, in percent. */
export function attendanceRate(counts: { present: number, late: number, total: number }): number {
  if (counts.total <= 0) return 0
  return round2(((counts.present + counts.late) / counts.total) * 100)
}

/** Minimal CSV writer with RFC 4180 quoting. */
export function buildCsv(headers: readonly string[], rows: ReadonlyArray<ReadonlyArray<string | number | null | undefined>>): string {
  const escape = (value: string | number | null | undefined): string => {
    const text = value === null || value === undefined ? '' : String(value)
    return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
  }
  return [headers, ...rows].map(row => row.map(escape).join(',')).join('\n')
}

export function normalizeReportType(value: unknown): ReportType {
  if (typeof value === 'string' && (REPORT_TYPES as readonly string[]).includes(value)) {
    return value as ReportType
  }
  throw createError({ statusCode: 400, message: `type must be one of ${REPORT_TYPES.join(', ')}` })
}

function normalizeReportDate(value: unknown, fallback: string, field: string): string {
  if (value === undefined || value === null || value === '') return fallback
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw createError({ statusCode: 400, message: `${field} must be YYYY-MM-DD` })
  }
  const parsed = new Date(`${value}T00:00:00Z`)
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) {
    throw createError({ statusCode: 400, message: `${field} is not a valid calendar day` })
  }
  return value
}

function optionalId(value: unknown): number | null {
  if (value === undefined || value === null || value === '') return null
  const id = Number(value)
  return Number.isSafeInteger(id) && id > 0 ? id : null
}

function requireReportRead(actor: SmsActor): number {
  const organizationId = requireSmsOrganization(actor)
  if (!canUseSms(actor, 'read', 'reports')) {
    throw createError({ statusCode: 403, statusMessage: 'Forbidden', message: 'No permission to read reports' })
  }
  return organizationId
}

export function canExportReports(actor: SmsActor): boolean {
  if (isSmsAdmin(actor)) return true
  return (actor.permissions ?? []).includes('sms.reports.export')
}

function defaultRange(from: unknown, to: unknown): { from: string, to: string } {
  const end = normalizeReportDate(to, smsDateString(), 'to')
  const start = new Date(Date.parse(`${end}T00:00:00Z`) - 29 * DAY_MS)
  return {
    from: normalizeReportDate(from, start.toISOString().slice(0, 10), 'from'),
    to: end
  }
}

// ---------------------------------------------------------------------------
// Attendance
// ---------------------------------------------------------------------------

export interface AttendanceReportQuery {
  classId?: unknown
  from?: unknown
  to?: unknown
}

export async function attendanceReport(actor: SmsActor, options: AttendanceReportQuery = {}) {
  const organizationId = requireReportRead(actor)
  const { from, to } = defaultRange(options.from, options.to)
  if (from > to) throw createError({ statusCode: 400, message: 'from must not be after to' })

  const conditions = [
    eq(smsAttendanceRecords.organizationId, organizationId),
    gte(smsAttendanceRecords.attendanceDate, from),
    lte(smsAttendanceRecords.attendanceDate, to)
  ]
  const classIds = await scopedAttendanceClassIds(actor)
  if (classIds) {
    conditions.push(classIds.length ? inArray(smsAttendanceRecords.classId, classIds) : eq(smsAttendanceRecords.id, -1))
  }
  const classId = optionalId(options.classId)
  if (classId) conditions.push(eq(smsAttendanceRecords.classId, classId))

  const rows = await db.select({
    classId: smsAttendanceRecords.classId,
    className: smsClasses.name,
    status: smsAttendanceRecords.status,
    count: sql<number>`count(*)::int`
  }).from(smsAttendanceRecords)
    .leftJoin(smsClasses, eq(smsClasses.id, smsAttendanceRecords.classId))
    .where(and(...conditions))
    .groupBy(smsAttendanceRecords.classId, smsClasses.name, smsAttendanceRecords.status)
    .orderBy(asc(smsClasses.name))

  const bucket = new Map<number, {
    classId: number
    className: string | null
    present: number
    late: number
    absent: number
    excused: number
    leave: number
    total: number
  }>()
  for (const row of rows) {
    const item = bucket.get(row.classId) ?? {
      classId: row.classId,
      className: row.className,
      present: 0,
      late: 0,
      absent: 0,
      excused: 0,
      leave: 0,
      total: 0
    }
    const count = Number(row.count)
    if (row.status === 'present') item.present += count
    else if (row.status === 'late') item.late += count
    else if (row.status === 'absent') item.absent += count
    else if (row.status === 'excused') item.excused += count
    else if (row.status === 'leave') item.leave += count
    item.total += count
    bucket.set(row.classId, item)
  }

  return {
    from,
    to,
    rows: [...bucket.values()].map(item => ({ ...item, attendanceRate: attendanceRate(item) }))
  }
}

// ---------------------------------------------------------------------------
// Scores
// ---------------------------------------------------------------------------

export interface ScoreReportQuery {
  classId?: unknown
  termId?: unknown
}

export async function scoreReport(actor: SmsActor, options: ScoreReportQuery = {}) {
  const organizationId = requireReportRead(actor)
  const conditions = [
    eq(smsExams.organizationId, organizationId),
    eq(smsExams.status, 'published')
  ]
  const classIds = await scopedExamClassIds(actor)
  if (classIds) {
    conditions.push(classIds.length ? inArray(smsExams.classId, classIds) : eq(smsExams.id, -1))
  }
  const classId = optionalId(options.classId)
  if (classId) conditions.push(eq(smsExams.classId, classId))
  const termId = optionalId(options.termId)
  if (termId) conditions.push(eq(smsExams.termId, termId))

  const rows = await db.select({
    subjectName: smsSubjects.name,
    count: sql<number>`count(${smsExamScores.score})::int`,
    average: sql<string>`ROUND(AVG(${smsExamScores.score})::numeric, 2)`,
    minimum: sql<string>`MIN(${smsExamScores.score})`,
    maximum: sql<string>`MAX(${smsExamScores.score})`
  }).from(smsExamScores)
    .innerJoin(smsExams, eq(smsExams.id, smsExamScores.examId))
    .leftJoin(smsSubjects, eq(smsSubjects.id, smsExams.subjectId))
    .where(and(...conditions, eq(smsExamScores.absent, false)))
    .groupBy(smsSubjects.name)
    .orderBy(asc(smsSubjects.name))

  return {
    rows: rows.map(row => ({
      subjectName: row.subjectName,
      count: Number(row.count),
      average: row.average === null ? 0 : round2(Number(row.average)),
      minimum: row.minimum === null ? 0 : round2(Number(row.minimum)),
      maximum: row.maximum === null ? 0 : round2(Number(row.maximum))
    }))
  }
}

// ---------------------------------------------------------------------------
// Finance
// ---------------------------------------------------------------------------

export interface FinanceReportQuery {
  from?: unknown
  to?: unknown
}

export async function financeReport(actor: SmsActor, options: FinanceReportQuery = {}) {
  const organizationId = requireReportRead(actor)
  if (!canUseSms(actor, 'read', 'finance')) {
    throw createError({ statusCode: 403, statusMessage: 'Forbidden', message: 'No permission to read finance reports' })
  }
  const { from, to } = defaultRange(options.from, options.to)
  if (from > to) throw createError({ statusCode: 400, message: 'from must not be after to' })

  const invoiceRows = await db.select({
    status: smsInvoices.status,
    count: sql<number>`count(*)::int`,
    payable: sql<string>`COALESCE(SUM(${smsInvoices.payable}), 0)`,
    paid: sql<string>`COALESCE(SUM(${smsInvoices.paid}), 0)`
  }).from(smsInvoices)
    .where(eq(smsInvoices.organizationId, organizationId))
    .groupBy(smsInvoices.status)

  const start = new Date(`${from}T00:00:00Z`)
  const end = new Date(`${to}T23:59:59.999Z`)
  const [payments] = await db.select({
    count: sql<number>`count(*)::int`,
    total: sql<string>`COALESCE(SUM(${smsPayments.amount}), 0)`
  }).from(smsPayments)
    .where(and(
      eq(smsPayments.organizationId, organizationId),
      gte(smsPayments.paidAt, start),
      lte(smsPayments.paidAt, end)
    ))

  const [refunds] = await db.select({
    count: sql<number>`count(*)::int`,
    total: sql<string>`COALESCE(SUM(${smsRefunds.amount}), 0)`
  }).from(smsRefunds)
    .where(and(
      eq(smsRefunds.organizationId, organizationId),
      eq(smsRefunds.status, 'approved'),
      gte(smsRefunds.createdAt, start),
      lte(smsRefunds.createdAt, end)
    ))

  return {
    from,
    to,
    invoices: invoiceRows.map(row => ({
      status: row.status,
      count: Number(row.count),
      payable: round2(Number(row.payable)),
      paid: round2(Number(row.paid))
    })),
    payments: { count: Number(payments?.count ?? 0), total: round2(Number(payments?.total ?? 0)) },
    refunds: { count: Number(refunds?.count ?? 0), total: round2(Number(refunds?.total ?? 0)) }
  }
}

// ---------------------------------------------------------------------------
// Export
// ---------------------------------------------------------------------------

export interface ExportReportInput {
  type?: unknown
  classId?: unknown
  termId?: unknown
  from?: unknown
  to?: unknown
}

const EXPORT_LIMIT = 500

export async function exportReport(actor: SmsActor, input: ExportReportInput) {
  const organizationId = requireSmsOrganization(actor)
  if (!canExportReports(actor)) {
    throw createError({ statusCode: 403, statusMessage: 'Forbidden', message: 'No permission to export reports' })
  }
  const type = normalizeReportType(input.type)

  let csv: string
  let rowCount = 0
  if (type === 'attendance') {
    const report = await attendanceReport(actor, { classId: input.classId, from: input.from, to: input.to })
    const rows = report.rows.slice(0, EXPORT_LIMIT)
    rowCount = rows.length
    csv = buildCsv(
      ['classId', 'className', 'present', 'late', 'absent', 'excused', 'leave', 'total', 'attendanceRate'],
      rows.map(row => [row.classId, row.className, row.present, row.late, row.absent, row.excused, row.leave, row.total, row.attendanceRate])
    )
  } else if (type === 'scores') {
    const report = await scoreReport(actor, { classId: input.classId, termId: input.termId })
    const rows = report.rows.slice(0, EXPORT_LIMIT)
    rowCount = rows.length
    csv = buildCsv(
      ['subjectName', 'count', 'average', 'minimum', 'maximum'],
      rows.map(row => [row.subjectName, row.count, row.average, row.minimum, row.maximum])
    )
  } else {
    const report = await financeReport(actor, { from: input.from, to: input.to })
    rowCount = report.invoices.length + 2
    csv = buildCsv(
      ['section', 'key', 'count', 'value1', 'value2'],
      [
        ...report.invoices.map(row => ['invoice', row.status, row.count, row.payable, row.paid]),
        ['payments', 'range', report.payments.count, report.payments.total, ''],
        ['refunds', 'approved', report.refunds.count, report.refunds.total, '']
      ]
    )
  }

  await db.transaction(async (tx) => {
    await writeAudit(tx, {
      actorUserId: actor.userId,
      tenantId: actor.tenantId ?? undefined,
      organizationId,
      moduleId: 'sms',
      action: 'report.export',
      resource: 'reports',
      recordId: 0,
      after: { type, rowCount },
      source: 'sms-service'
    })
  })

  return { type, rowCount, csv }
}
