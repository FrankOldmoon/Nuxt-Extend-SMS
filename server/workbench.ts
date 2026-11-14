/**
 * Role workbench (P1).
 *
 * One endpoint answers "what needs my attention right now" for every SMS role.
 * Cards are permission- and data-scope-aware: a homeroom teacher only sees their
 * own classes' alerts, while school leaders see organization totals.
 */
import { and, eq, inArray, isNull, or, sql } from 'drizzle-orm'
import { db } from '../../../server/sdk'
import {
  smsApprovalTasks,
  smsAttendanceAlerts,
  smsRefunds,
  smsStudents
} from './database/schema'
import { canUseSms, type SmsActor } from './context'
import { canApproveLeave, hasSchoolWideLeave, listLeaveRequests } from './leave'
import { hasSchoolWideAttendance, scopedClassIds } from './attendance'
import { canApproveRefund } from './finance'
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
    const students = await db.select({ id: smsStudents.id }).from(smsStudents)
      .where(and(
        eq(smsStudents.organizationId, organizationId),
        inArray(smsStudents.classId, classIds)
      ))
    if (students.length === 0) return 0
    conditions.push(inArray(smsAttendanceAlerts.studentId, students.map(student => student.id)))
  }
  const [row] = await db.select({ value: sql<number>`count(*)::int` })
    .from(smsAttendanceAlerts)
    .where(and(...conditions))
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
      link: '/sms/notifications',
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
      link: '/sms/chat',
      icon: 'i-lucide-check-square'
    })
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
      link: '/sms/chat',
      icon: 'i-lucide-badge-dollar-sign'
    })
  }

  return {
    role: actor.roleName ?? null,
    generatedAt: new Date().toISOString(),
    cards
  }
}
