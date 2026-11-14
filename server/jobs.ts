/**
 * Phase 5 agent automation — scheduled attendance alert scan and weekly report.
 *
 * The pure helpers (`weekRange`, `previousWeekRange`, `buildWeeklySummary`) are
 * unit-tested; the two `run*` functions are the side-effecting task bodies used
 * by `server/tasks/sms/*` (Nitro scheduled tasks).
 */
import { and, asc, eq, gte, inArray, isNull, lte, sql } from 'drizzle-orm'
import { db } from '../../../server/sdk'
import { evaluateAttendanceAlerts, normalizeAttendanceStatus, type AttendanceDay } from './attendance'
import {
  createNotifications,
  studentNotificationRecipients
} from './notifications'
import {
  smsAttendanceAlerts,
  smsAttendanceRecords,
  smsExams,
  smsInvoices,
  smsLeaveRequests,
  smsRefunds,
  smsReportRuns,
  smsStudents
} from './database/schema'

const DAY_MS = 24 * 60 * 60 * 1000
const ALERT_LOOKBACK_DAYS = 90
const INSERT_CHUNK = 500

export interface DateRange {
  start: string
  end: string
}

function isoDate(date: Date): string {
  return date.toISOString().slice(0, 10)
}

/** Monday–Sunday (UTC) range containing `date`. */
export function weekRange(date: Date): DateRange {
  const day = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()))
  const weekday = day.getUTCDay() // 0 = Sunday
  const offset = weekday === 0 ? -6 : 1 - weekday
  const start = new Date(day.getTime() + offset * DAY_MS)
  const end = new Date(start.getTime() + 6 * DAY_MS)
  return { start: isoDate(start), end: isoDate(end) }
}

/** The full week before the one containing `now`. */
export function previousWeekRange(now: Date): DateRange {
  return weekRange(new Date(now.getTime() - 7 * DAY_MS))
}

export interface WeeklySummaryInput {
  period: DateRange
  attendance: {
    present: number
    late: number
    absent: number
    excused: number
    leave: number
  }
  openAlerts: number
  leave: {
    pending: number
    approved: number
    rejected: number
    cancelled: number
  }
  exams: {
    published: number
    draft: number
  }
  finance: {
    payable: number
    paid: number
    pendingRefunds: number
  }
}

export interface WeeklySummary {
  period: DateRange
  generatedAt: string
  attendance: WeeklySummaryInput['attendance'] & {
    records: number
    /** (present + late) / records, rounded to 1 decimal. */
    attendanceRate: number
  }
  leave: WeeklySummaryInput['leave']
  exams: WeeklySummaryInput['exams']
  finance: WeeklySummaryInput['finance'] & { outstanding: number }
  openAlerts: number
  highlights: string[]
}

function round1(value: number): number {
  return Math.round(value * 10) / 10
}

function money(value: number): string {
  return (Math.round(value * 100) / 100).toFixed(2)
}

/** Deterministic report body: no clock or database access. */
export function buildWeeklySummary(input: WeeklySummaryInput, generatedAt: string): WeeklySummary {
  const { attendance } = input
  const records = attendance.present + attendance.late + attendance.absent
    + attendance.excused + attendance.leave
  const attendanceRate = records === 0
    ? 0
    : round1(((attendance.present + attendance.late) / records) * 100)
  const outstanding = round1(input.finance.payable - input.finance.paid)

  const highlights: string[] = []
  if (attendance.absent > 0) highlights.push(`缺勤 ${attendance.absent} 人次，出勤率 ${attendanceRate}%`)
  if (input.openAlerts > 0) highlights.push(`${input.openAlerts} 条考勤预警待处理`)
  if (input.leave.pending > 0) highlights.push(`${input.leave.pending} 条请假待审批`)
  if (input.exams.draft > 0) highlights.push(`${input.exams.draft} 场考试待发布成绩`)
  if (outstanding > 0) highlights.push(`应收未收 ${money(outstanding)} 元`)
  if (input.finance.pendingRefunds > 0) highlights.push(`${input.finance.pendingRefunds} 笔退费待审批`)
  if (highlights.length === 0) highlights.push('本周无异常')

  return {
    period: input.period,
    generatedAt,
    attendance: { ...attendance, records, attendanceRate },
    leave: input.leave,
    exams: input.exams,
    finance: { ...input.finance, outstanding },
    openAlerts: input.openAlerts,
    highlights
  }
}

interface StudentAttendanceBucket {
  organizationId: number
  studentId: number
  days: AttendanceDay[]
}

/**
 * Scan recent full-day attendance for every student and raise the same alerts
 * `refreshAlerts` raises after a single mark. Idempotent via the alerts unique
 * index `(organization_id, student_id, rule, window_start)`.
 */
export async function runAttendanceAlertScan(now: Date = new Date()): Promise<{
  organizations: number
  studentsScanned: number
  alertsCreated: number
  notified: number
}> {
  const since = isoDate(new Date(now.getTime() - ALERT_LOOKBACK_DAYS * DAY_MS))
  const rows = await db.select({
    organizationId: smsAttendanceRecords.organizationId,
    tenantId: smsAttendanceRecords.tenantId,
    studentId: smsAttendanceRecords.studentId,
    date: smsAttendanceRecords.attendanceDate,
    status: smsAttendanceRecords.status
  }).from(smsAttendanceRecords)
    .where(and(
      eq(smsAttendanceRecords.session, 'full_day'),
      gte(smsAttendanceRecords.attendanceDate, since)
    ))
    .orderBy(
      asc(smsAttendanceRecords.organizationId),
      asc(smsAttendanceRecords.studentId),
      asc(smsAttendanceRecords.attendanceDate)
    )

  const buckets = new Map<string, StudentAttendanceBucket & { tenantId: number | null }>()
  for (const row of rows) {
    const key = `${row.organizationId}:${row.studentId}`
    const bucket = buckets.get(key) ?? {
      organizationId: row.organizationId,
      tenantId: row.tenantId,
      studentId: row.studentId,
      days: []
    }
    bucket.days.push({ date: row.date, status: normalizeAttendanceStatus(row.status) })
    buckets.set(key, bucket)
  }

  const organizations = new Set<number>()
  const orgTenants = new Map<number, number | null>()
  const values: Array<typeof smsAttendanceAlerts.$inferInsert> = []
  for (const bucket of buckets.values()) {
    organizations.add(bucket.organizationId)
    orgTenants.set(bucket.organizationId, bucket.tenantId)
    for (const alert of evaluateAttendanceAlerts(bucket.days)) {
      values.push({
        organizationId: bucket.organizationId,
        tenantId: bucket.tenantId,
        studentId: bucket.studentId,
        rule: alert.rule,
        windowStart: alert.windowStart,
        windowEnd: alert.windowEnd,
        metric: alert.metric.toFixed(2),
        threshold: alert.threshold.toFixed(2)
      })
    }
  }

  let alertsCreated = 0
  /** 新增预警按学生聚合，扫描结束后统一发通知，避免一条预警一条消息。 */
  const newAlerts = new Map<string, {
    organizationId: number
    tenantId: number | null
    studentId: number
    count: number
  }>()
  for (let index = 0; index < values.length; index += INSERT_CHUNK) {
    const inserted = await db.insert(smsAttendanceAlerts)
      .values(values.slice(index, index + INSERT_CHUNK))
      .onConflictDoNothing()
      .returning({
        id: smsAttendanceAlerts.id,
        organizationId: smsAttendanceAlerts.organizationId,
        tenantId: smsAttendanceAlerts.tenantId,
        studentId: smsAttendanceAlerts.studentId
      })
    alertsCreated += inserted.length
    for (const row of inserted) {
      const key = `${row.organizationId}:${row.studentId}`
      const bucket = newAlerts.get(key) ?? {
        organizationId: row.organizationId,
        tenantId: row.tenantId,
        studentId: row.studentId,
        count: 0
      }
      bucket.count += 1
      newAlerts.set(key, bucket)
    }
  }

  const notified = await notifyNewAlerts(newAlerts)
  await recordScanRuns(orgTenants, since, isoDate(now), now, alertsCreated)

  return { organizations: organizations.size, studentsScanned: buckets.size, alertsCreated, notified }
}

/** 为新增预警找到学生姓名/班级，再投递站内通知。 */
async function notifyNewAlerts(
  alerts: Map<string, { organizationId: number, tenantId: number | null, studentId: number, count: number }>
): Promise<number> {
  if (alerts.size === 0) return 0
  const studentIds = [...new Set([...alerts.values()].map(item => item.studentId))]
  const students = await db.select({
    id: smsStudents.id,
    name: smsStudents.name,
    classId: smsStudents.classId
  }).from(smsStudents)
    .where(and(inArray(smsStudents.id, studentIds), isNull(smsStudents.deletedAt)))
  const byId = new Map(students.map(student => [student.id, student]))

  let notified = 0
  for (const item of alerts.values()) {
    const student = byId.get(item.studentId)
    const recipients = await studentNotificationRecipients(
      item.organizationId,
      item.studentId,
      student?.classId ?? null
    )
    if (recipients.length === 0) continue
    await db.transaction(async (tx) => {
      notified += await createNotifications(tx, {
        organizationId: item.organizationId,
        tenantId: item.tenantId,
        recipientUserIds: recipients,
        category: 'attendance',
        title: `考勤预警：${student?.name ?? `学生 #${item.studentId}`}`,
        body: `定时扫描新增 ${item.count} 条考勤预警，请查看并跟进。`,
        link: '/sms',
        entityType: 'attendance',
        entityId: item.studentId
      })
    })
  }
  return notified
}

/** 记录每次扫描结果，便于运维查看调度是否正常。 */
async function recordScanRuns(
  orgTenants: Map<number, number | null>,
  since: string,
  today: string,
  now: Date,
  alertsCreated: number
): Promise<void> {
  for (const [organizationId, tenantId] of orgTenants) {
    await db.insert(smsReportRuns).values({
      organizationId,
      tenantId,
      kind: 'attendance_scan',
      periodStart: since,
      periodEnd: today,
      status: 'succeeded',
      payload: { alertsCreated },
      generatedAt: now
    })
  }
}

interface WeeklyOrgReport {
  organizationId: number
  summary: WeeklySummary | null
  error?: string
}

async function weeklyReportFor(
  organizationId: number,
  period: DateRange,
  now: Date
): Promise<WeeklyOrgReport> {
  try {
    const start = new Date(`${period.start}T00:00:00.000Z`)
    const end = new Date(`${period.end}T23:59:59.999Z`)

    const attendance = new Map((await db.select({
      status: smsAttendanceRecords.status,
      total: sql<number>`count(*)::int`
    }).from(smsAttendanceRecords)
      .where(and(
        eq(smsAttendanceRecords.organizationId, organizationId),
        eq(smsAttendanceRecords.session, 'full_day'),
        gte(smsAttendanceRecords.attendanceDate, period.start),
        lte(smsAttendanceRecords.attendanceDate, period.end)
      ))
      .groupBy(smsAttendanceRecords.status))
      .map(row => [row.status, Number(row.total)] as const))

    const leave = new Map((await db.select({
      status: smsLeaveRequests.status,
      total: sql<number>`count(*)::int`
    }).from(smsLeaveRequests)
      .where(and(
        eq(smsLeaveRequests.organizationId, organizationId),
        lte(smsLeaveRequests.startAt, end),
        gte(smsLeaveRequests.endAt, start)
      ))
      .groupBy(smsLeaveRequests.status))
      .map(row => [row.status, Number(row.total)] as const))

    const exams = new Map((await db.select({
      status: smsExams.status,
      total: sql<number>`count(*)::int`
    }).from(smsExams)
      .where(and(
        eq(smsExams.organizationId, organizationId),
        gte(smsExams.examDate, period.start),
        lte(smsExams.examDate, period.end)
      ))
      .groupBy(smsExams.status))
      .map(row => [row.status, Number(row.total)] as const))

    const [financeRow] = await db.select({
      payable: sql<string>`coalesce(sum(${smsInvoices.payable}), 0)`,
      paid: sql<string>`coalesce(sum(${smsInvoices.paid}), 0)`
    }).from(smsInvoices)
      .where(and(
        eq(smsInvoices.organizationId, organizationId),
        gte(smsInvoices.createdAt, start),
        lte(smsInvoices.createdAt, end)
      ))

    const [refundRow] = await db.select({ total: sql<number>`count(*)::int` })
      .from(smsRefunds)
      .where(and(
        eq(smsRefunds.organizationId, organizationId),
        eq(smsRefunds.status, 'pending')
      ))

    const [alertRow] = await db.select({ total: sql<number>`count(*)::int` })
      .from(smsAttendanceAlerts)
      .where(and(
        eq(smsAttendanceAlerts.organizationId, organizationId),
        eq(smsAttendanceAlerts.status, 'open')
      ))

    const summary = buildWeeklySummary({
      period,
      attendance: {
        present: attendance.get('present') ?? 0,
        late: attendance.get('late') ?? 0,
        absent: attendance.get('absent') ?? 0,
        excused: attendance.get('excused') ?? 0,
        leave: attendance.get('leave') ?? 0
      },
      openAlerts: Number(alertRow?.total ?? 0),
      leave: {
        pending: leave.get('pending') ?? 0,
        approved: leave.get('approved') ?? 0,
        rejected: leave.get('rejected') ?? 0,
        cancelled: leave.get('cancelled') ?? 0
      },
      exams: {
        published: exams.get('published') ?? 0,
        draft: exams.get('draft') ?? 0
      },
      finance: {
        payable: Number(financeRow?.payable ?? 0),
        paid: Number(financeRow?.paid ?? 0),
        pendingRefunds: Number(refundRow?.total ?? 0)
      }
    }, now.toISOString())

    return { organizationId, summary }
  } catch (error) {
    return {
      organizationId,
      summary: null,
      error: error instanceof Error ? error.message : String(error)
    }
  }
}

/**
 * Generate the previous week's report for every organization that has students
 * and persist one `sms_report_runs` row per organization. A failure in one
 * organization is recorded as `failed` and does not stop the others.
 */
export async function runWeeklyReport(now: Date = new Date()): Promise<{
  period: DateRange
  organizations: number
  failed: number
}> {
  const period = previousWeekRange(now)
  const organizations = await db.selectDistinct({ organizationId: smsStudents.organizationId })
    .from(smsStudents)
    .orderBy(asc(smsStudents.organizationId))

  let failed = 0
  for (const organization of organizations) {
    const report = await weeklyReportFor(organization.organizationId, period, now)
    if (report.error) failed += 1
    await db.insert(smsReportRuns).values({
      organizationId: organization.organizationId,
      tenantId: null,
      kind: 'weekly',
      periodStart: period.start,
      periodEnd: period.end,
      status: report.error ? 'failed' : 'succeeded',
      payload: report.summary
        ? report.summary as unknown as Record<string, unknown>
        : null,
      error: report.error ? report.error.slice(0, 500) : null,
      generatedAt: now
    })
  }

  return { period, organizations: organizations.length, failed }
}
