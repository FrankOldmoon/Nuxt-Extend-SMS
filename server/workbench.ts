/**
 * Role workbench (P1).
 *
 * One endpoint answers "what needs my attention right now" for every SMS role.
 * Cards are permission- and data-scope-aware: a homeroom teacher only sees their
 * own classes' alerts, while school leaders see organization totals.
 */
import { and, eq, inArray, isNull, lt, or, sql } from 'drizzle-orm'
import { db } from '../../../server/sdk'
import {
  smsAdmissionApplications,
  smsApprovalTasks,
  smsAttendanceAlerts,
  smsExams,
  smsInvoices,
  smsRefunds,
  smsStudents
} from './database/schema'
import { canUseSms, type SmsActor } from './context'
import { canApproveLeave, hasSchoolWideLeave, listLeaveRequests } from './leave'
import { hasSchoolWideAttendance, scopedClassIds } from './attendance'
import { canApproveRefund } from './finance'
import { canPublishScores, scopedExamClassIds } from './exams'
import { canReviewApplications } from './admissions'
import { unreadNotificationCount } from './notifications'

export interface WorkbenchCard {
  id: string
  title: string
  count: number
  link: string
  icon: string
}

export interface SmsWorkbench {
  role: string | null
  generatedAt: string
  cards: WorkbenchCard[]
}

async function pendingApprovalCount(actor: SmsActor, organizationId: number): Promise<number> {
  const conditions = [
    eq(smsApprovalTasks.organizationId, organizationId),
    eq(smsApprovalTasks.status, 'pending')
  ]
  if (!hasSchoolWideLeave(actor)) {
    const own = eq(smsApprovalTasks.assigneeUserId, actor.userId)
    const unassigned = canApproveLeave(actor) ? or(own, isNull(smsApprovalTasks.assigneeUserId)) : own
    if (unassigned) conditions.push(unassigned)
  }
  const [row] = await db.select({ value: sql<number>`count(*)::int` })
    .from(smsApprovalTasks)
    .where(and(...conditions))
  return Number(row?.value ?? 0)
}

async function openAlertCount(actor: SmsActor, organizationId: number): Promise<number> {
  const conditions = [
    eq(smsAttendanceAlerts.organizationId, organizationId),
    eq(smsAttendanceAlerts.status, 'open')
  ]
  if (!hasSchoolWideAttendance(actor)) {
    const classIds = await scopedClassIds(actor)
    if (!classIds || classIds.length === 0) return 0
    conditions.push(inArray(smsStudents.classId, classIds))
  }
  // 直接 join 学生表按班级过滤，避免先把全班学生 id 拉到应用层。
  const [row] = await db.select({ value: sql<number>`count(*)::int` })
    .from(smsAttendanceAlerts)
    .innerJoin(smsStudents, and(
      eq(smsStudents.id, smsAttendanceAlerts.studentId),
      eq(smsStudents.organizationId, organizationId)
    ))
    .where(and(...conditions))
  return Number(row?.value ?? 0)
}

/** 超过 SLA 且尚未升级的审批任务数。 */
async function overdueApprovalCount(actor: SmsActor, organizationId: number): Promise<number> {
  const conditions = [
    eq(smsApprovalTasks.organizationId, organizationId),
    eq(smsApprovalTasks.status, 'pending'),
    isNull(smsApprovalTasks.escalatedAt),
    lt(smsApprovalTasks.dueAt, new Date())
  ]
  if (!hasSchoolWideLeave(actor)) {
    const own = eq(smsApprovalTasks.assigneeUserId, actor.userId)
    const unassigned = canApproveLeave(actor) ? or(own, isNull(smsApprovalTasks.assigneeUserId)) : own
    if (unassigned) conditions.push(unassigned)
  }
  const [row] = await db.select({ value: sql<number>`count(*)::int` })
    .from(smsApprovalTasks)
    .where(and(...conditions))
  return Number(row?.value ?? 0)
}

/** 未结清账单（未缴 + 部分缴）。学生/家长的范围由 finance 服务负责，这里只对职工展示全校计数。 */
async function unpaidInvoiceCount(actor: SmsActor, organizationId: number): Promise<number> {
  if (actor.roleName === 'student' || actor.roleName === 'guardian') return 0
  const [row] = await db.select({ value: sql<number>`count(*)::int` })
    .from(smsInvoices)
    .where(and(
      eq(smsInvoices.organizationId, organizationId),
      inArray(smsInvoices.status, ['unpaid', 'partial'])
    ))
  return Number(row?.value ?? 0)
}

/** 待发布成绩：仅统计当前用户可发布范围内的草稿考试。 */
async function draftExamCount(actor: SmsActor, organizationId: number): Promise<number> {
  if (!canPublishScores(actor)) return 0
  const conditions = [eq(smsExams.organizationId, organizationId), eq(smsExams.status, 'draft')]
  const classIds = await scopedExamClassIds(actor)
  if (classIds && classIds.length > 0) conditions.push(inArray(smsExams.classId, classIds))
  if (classIds && classIds.length === 0) return 0
  const [row] = await db.select({ value: sql<number>`count(*)::int` })
    .from(smsExams)
    .where(and(...conditions))
  return Number(row?.value ?? 0)
}

/** 待审核报名数。 */
async function pendingApplicationCount(organizationId: number): Promise<number> {
  const [row] = await db.select({ value: sql<number>`count(*)::int` })
    .from(smsAdmissionApplications)
    .where(and(
      eq(smsAdmissionApplications.organizationId, organizationId),
      inArray(smsAdmissionApplications.status, ['submitted', 'reviewing'])
    ))
  return Number(row?.value ?? 0)
}

export async function buildWorkbench(actor: SmsActor): Promise<SmsWorkbench> {
  const organizationId = actor.organizationId
  if (!organizationId) {
    return { role: actor.roleName ?? null, generatedAt: new Date().toISOString(), cards: [] }
  }

  const cards: WorkbenchCard[] = []

  if (canUseSms(actor, 'read', 'notifications')) {
    cards.push({
      id: 'notifications',
      title: '未读通知',
      count: await unreadNotificationCount(actor),
      link: '/notifications',
      icon: 'i-lucide-bell'
    })
  }

  if (canUseSms(actor, 'read', 'leave') || canApproveLeave(actor)) {
    const pendingLeave = await listLeaveRequests(actor, { status: 'pending', limit: 200 })
    cards.push({
      id: 'leave',
      title: '待审批请假',
      count: pendingLeave.length,
      link: '/sms/chat',
      icon: 'i-lucide-calendar-clock'
    })
    cards.push({
      id: 'approvals',
      title: '审批任务',
      count: await pendingApprovalCount(actor, organizationId),
      link: '/sms/approvals',
      icon: 'i-lucide-check-square'
    })
    const overdue = await overdueApprovalCount(actor, organizationId)
    if (overdue > 0) {
      cards.push({
        id: 'approvals-overdue',
        title: '超时审批',
        count: overdue,
        link: '/sms/approvals',
        icon: 'i-lucide-timer-off'
      })
    }
  }

  if (canUseSms(actor, 'read', 'attendance')) {
    cards.push({
      id: 'attendance-alerts',
      title: '待处理考勤预警',
      count: await openAlertCount(actor, organizationId),
      link: '/sms/chat',
      icon: 'i-lucide-triangle-alert'
    })
  }

  if (canApproveRefund(actor)) {
    const [row] = await db.select({ value: sql<number>`count(*)::int` })
      .from(smsRefunds)
      .where(and(
        eq(smsRefunds.organizationId, organizationId),
        eq(smsRefunds.status, 'pending')
      ))
    cards.push({
      id: 'refunds',
      title: '待审批退费',
      count: Number(row?.value ?? 0),
      link: '/sms/approvals',
      icon: 'i-lucide-badge-dollar-sign'
    })
  }

  if (canUseSms(actor, 'read', 'finance')) {
    const unpaid = await unpaidInvoiceCount(actor, organizationId)
    if (unpaid > 0) {
      cards.push({
        id: 'unpaid-invoices',
        title: '未结清账单',
        count: unpaid,
        link: '/sms/chat',
        icon: 'i-lucide-receipt-text'
      })
    }
  }

  const draftExams = await draftExamCount(actor, organizationId)
  if (draftExams > 0) {
    cards.push({
      id: 'draft-exams',
      title: '待发布成绩',
      count: draftExams,
      link: '/sms/scores',
      icon: 'i-lucide-file-check'
    })
  }

  if (canReviewApplications(actor)) {
    const pendingApplications = await pendingApplicationCount(organizationId)
    if (pendingApplications > 0) {
      cards.push({
        id: 'pending-applications',
        title: '待审核报名',
        count: pendingApplications,
        link: '/sms/chat',
        icon: 'i-lucide-user-plus'
      })
    }
  }

  return {
    role: actor.roleName ?? null,
    generatedAt: new Date().toISOString(),
    cards
  }
}
