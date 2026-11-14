/**
 * Generic business approval engine (P0).
 *
 * The existing `sms_approval_tasks` table already stores one row per step.
 * This service owns the *step protocol* (create → pending → decided → next /
 * cancelled) and a time-based escalation scan, so leave and refund approvals
 * share one implementation instead of copying SQL.
 *
 * Escalation is monotonic: homeroom → grade_leader → school_admin. A task is
 * escalated at most once, then gets a fresh SLA window.
 */
import { and, asc, eq, inArray, isNull, lte, or } from 'drizzle-orm'
import { createError } from 'h3'
import { db, pool, writeAudit } from '../../../server/sdk'
import {
  smsApprovalTasks,
  smsLeaveRequests,
  smsRefunds
} from './database/schema'
import { createNotifications, resolvePermissionRecipients } from './notifications'
import { isSmsAdmin, requireSmsOrganization, type SmsActor } from './context'

export const APPROVAL_SLA_HOURS = 48
export const APPROVAL_SUBJECT_TYPES = ['leave', 'refund'] as const
export type ApprovalSubjectType = typeof APPROVAL_SUBJECT_TYPES[number]

export type ApprovalDecision = 'approved' | 'rejected' | 'cancelled'

/** Minimal surface shared by the root database and a transaction. */
export type ApprovalExecutor = Pick<typeof db, 'select' | 'insert' | 'update'>

const HOUR_MS = 60 * 60 * 1000

export function approvalDueAt(from: Date, hours = APPROVAL_SLA_HOURS): Date {
  return new Date(from.getTime() + hours * HOUR_MS)
}

/** Next approver tier; `school_admin` is the top of the ladder. */
export function nextEscalationRole(role: string | null | undefined): 'grade_leader' | 'school_admin' {
  if (role === 'homeroom') return 'grade_leader'
  return 'school_admin'
}

export interface ApprovalStepInput {
  step: number
  assigneeRole: string | null
  assigneeUserId: number | null
}

export interface InsertApprovalStepsInput {
  organizationId: number
  tenantId: number | null
  subjectType: ApprovalSubjectType
  subjectId: number
  steps: readonly ApprovalStepInput[]
  now?: Date
}

export async function insertApprovalSteps(tx: ApprovalExecutor, input: InsertApprovalStepsInput) {
  if (input.steps.length === 0) return []
  const now = input.now ?? new Date()
  return await tx.insert(smsApprovalTasks).values(input.steps.map(step => ({
    organizationId: input.organizationId,
    tenantId: input.tenantId,
    subjectType: input.subjectType,
    subjectId: input.subjectId,
    step: step.step,
    assigneeUserId: step.assigneeUserId,
    assigneeRole: step.assigneeRole,
    status: 'pending' as const,
    dueAt: approvalDueAt(now)
  }))).returning()
}

export interface ApprovalTaskKey {
  organizationId: number
  subjectType: ApprovalSubjectType
  subjectId: number
}

/** First pending step (lowest step number). */
export async function loadPendingApprovalTask(tx: ApprovalExecutor, key: ApprovalTaskKey) {
  const [task] = await tx.select({
    id: smsApprovalTasks.id,
    step: smsApprovalTasks.step,
    assigneeUserId: smsApprovalTasks.assigneeUserId,
    assigneeRole: smsApprovalTasks.assigneeRole,
    dueAt: smsApprovalTasks.dueAt
  }).from(smsApprovalTasks)
    .where(and(
      eq(smsApprovalTasks.organizationId, key.organizationId),
      eq(smsApprovalTasks.subjectType, key.subjectType),
      eq(smsApprovalTasks.subjectId, key.subjectId),
      eq(smsApprovalTasks.status, 'pending')
    ))
    .orderBy(asc(smsApprovalTasks.step))
    .limit(1)
  return task ?? null
}

/** Next pending step *after* `afterStep` was completed. */
export async function loadNextPendingApprovalTask(tx: ApprovalExecutor, key: ApprovalTaskKey) {
  const [task] = await tx.select({
    id: smsApprovalTasks.id,
    step: smsApprovalTasks.step,
    assigneeUserId: smsApprovalTasks.assigneeUserId,
    assigneeRole: smsApprovalTasks.assigneeRole,
    dueAt: smsApprovalTasks.dueAt
  }).from(smsApprovalTasks)
    .where(and(
      eq(smsApprovalTasks.organizationId, key.organizationId),
      eq(smsApprovalTasks.subjectType, key.subjectType),
      eq(smsApprovalTasks.subjectId, key.subjectId),
      eq(smsApprovalTasks.status, 'pending')
    ))
    .orderBy(asc(smsApprovalTasks.step))
    .limit(1)
  return task ?? null
}

export interface CompleteApprovalTaskInput {
  taskId: number
  actorUserId: number
  decision: Exclude<ApprovalDecision, 'cancelled'>
  comment?: string | null
}

export async function completeApprovalTask(tx: ApprovalExecutor, input: CompleteApprovalTaskInput) {
  const [row] = await tx.update(smsApprovalTasks)
    .set({
      status: input.decision,
      decidedBy: input.actorUserId,
      decidedAt: new Date(),
      comment: input.comment ?? null
    })
    .where(eq(smsApprovalTasks.id, input.taskId))
    .returning()
  return row ?? null
}

export async function cancelPendingApprovalTasks(
  tx: ApprovalExecutor,
  key: ApprovalTaskKey,
  actorUserId: number
): Promise<number> {
  const rows = await tx.update(smsApprovalTasks)
    .set({ status: 'cancelled', decidedBy: actorUserId, decidedAt: new Date() })
    .where(and(
      eq(smsApprovalTasks.organizationId, key.organizationId),
      eq(smsApprovalTasks.subjectType, key.subjectType),
      eq(smsApprovalTasks.subjectId, key.subjectId),
      eq(smsApprovalTasks.status, 'pending')
    ))
    .returning({ id: smsApprovalTasks.id })
  return rows.length
}

const ESCALATION_PERMISSION: Record<ApprovalSubjectType, string> = {
  leave: 'sms.leave.approve',
  refund: 'sms.finance.refund-approve'
}

/**
 * Escalate every pending task whose SLA has expired. Runs in small batches so a
 * backlog cannot lock the table; each organization is notified independently.
 */
export async function escalateOverdueApprovals(now: Date = new Date()): Promise<{
  scanned: number
  escalated: number
  notified: number
}> {
  const overdue = await db.select({
    id: smsApprovalTasks.id,
    organizationId: smsApprovalTasks.organizationId,
    tenantId: smsApprovalTasks.tenantId,
    subjectType: smsApprovalTasks.subjectType,
    subjectId: smsApprovalTasks.subjectId,
    step: smsApprovalTasks.step,
    assigneeRole: smsApprovalTasks.assigneeRole
  }).from(smsApprovalTasks)
    .where(and(
      eq(smsApprovalTasks.status, 'pending'),
      isNull(smsApprovalTasks.escalatedAt),
      lte(smsApprovalTasks.dueAt, now)
    ))
    .orderBy(asc(smsApprovalTasks.dueAt))
    .limit(200)

  let escalated = 0
  let notified = 0
  for (const task of overdue) {
    const subjectType = task.subjectType === 'refund' ? 'refund' : 'leave'
    const role = nextEscalationRole(task.assigneeRole)
    const recipients = await resolvePermissionRecipients(
      task.organizationId,
      ESCALATION_PERMISSION[subjectType]
    )
    await db.transaction(async (tx) => {
      await tx.update(smsApprovalTasks)
        .set({
          assigneeRole: role,
          assigneeUserId: null,
          escalatedAt: now,
          dueAt: approvalDueAt(now)
        })
        .where(eq(smsApprovalTasks.id, task.id))
      notified += await createNotifications(tx, {
        organizationId: task.organizationId,
        tenantId: task.tenantId,
        recipientUserIds: recipients,
        category: 'approval',
        title: `审批超时升级（${subjectType === 'leave' ? '请假' : '退费'}）`,
        body: '有审批任务超过 SLA，已升级到更高审批层级。',
        link: '/sms',
        entityType: subjectType,
        entityId: task.subjectId
      })
      await writeAudit(tx, {
        actorUserId: 0,
        tenantId: task.tenantId ?? undefined,
        organizationId: task.organizationId,
        moduleId: 'sms',
        action: 'approval.escalate',
        resource: 'approvals',
        recordId: task.id,
        before: { assigneeRole: task.assigneeRole, step: task.step },
        after: { assigneeRole: role, dueAt: approvalDueAt(now).toISOString() },
        source: 'sms-job'
      })
    })
    escalated += 1
  }

  return { scanned: overdue.length, escalated, notified }
}

// ---------------------------------------------------------------------------
// 统一审批收件箱（P1）
// ---------------------------------------------------------------------------

export const APPROVAL_INBOX_STATUSES = ['pending', 'approved', 'rejected', 'cancelled', 'all'] as const
export type ApprovalInboxStatus = typeof APPROVAL_INBOX_STATUSES[number]

export interface ApprovalInboxItem {
  kind: ApprovalSubjectType
  taskId: number | null
  subjectId: number
  step: number
  title: string
  assigneeUserId: number | null
  dueAt: string | null
  overdue: boolean
  status: Exclude<ApprovalInboxStatus, 'all'>
  comment: string | null
  decidedAt: string | null
  link: string
}

export interface ApprovalInboxQuery {
  kind?: unknown
  status?: unknown
  limit?: unknown
}

function normalizeInboxStatus(value: unknown): ApprovalInboxStatus {
  return typeof value === 'string' && (APPROVAL_INBOX_STATUSES as readonly string[]).includes(value)
    ? value as ApprovalInboxStatus
    : 'pending'
}

function hasSchoolWide(actor: SmsActor): boolean {
  return isSmsAdmin(actor) || (actor.permissions ?? []).includes('sms.leave.all')
}

function canApproveKind(actor: SmsActor, kind: ApprovalSubjectType): boolean {
  if (isSmsAdmin(actor)) return true
  const permission = ESCALATION_PERMISSION[kind]
  return (actor.permissions ?? []).includes(permission)
}

/**
 * 收件箱 = 待办审批步骤 + 尚未生成步骤的待审批退费（兼容旧数据）。
 * 行范围与审批权限一致，返回统一的 DTO，前端/聊天无需分别查询请假与退费。
 */
export async function listApprovalInbox(
  actor: SmsActor,
  options: ApprovalInboxQuery = {}
): Promise<ApprovalInboxItem[]> {
  const organizationId = requireSmsOrganization(actor)
  const kind = options.kind === 'leave' || options.kind === 'refund' ? options.kind : null
  const status = normalizeInboxStatus(options.status)
  const limit = Math.min(Math.max(Math.floor(Number(options.limit ?? 50) || 50), 1), 200)
  const now = new Date()

  const conditions = [eq(smsApprovalTasks.organizationId, organizationId)]
  if (status !== 'all') conditions.push(eq(smsApprovalTasks.status, status))
  if (kind) conditions.push(eq(smsApprovalTasks.subjectType, kind))
  if (!hasSchoolWide(actor)) {
    const approvable = (['leave', 'refund'] as const).filter(item => canApproveKind(actor, item))
    if (approvable.length === 0) return []
    const scope = approvable.map(item => (item === 'refund'
      ? and(eq(smsApprovalTasks.subjectType, 'refund'), isNull(smsApprovalTasks.assigneeUserId))
      : and(eq(smsApprovalTasks.subjectType, 'leave'), or(
          eq(smsApprovalTasks.assigneeUserId, actor.userId),
          isNull(smsApprovalTasks.assigneeUserId)
        ))))
    const scoped = or(...scope)
    if (scoped) conditions.push(scoped)
  }

  const tasks = await db.select().from(smsApprovalTasks)
    .where(and(...conditions))
    .orderBy(asc(smsApprovalTasks.dueAt))
    .limit(limit)

  const leaveIds = tasks.filter(task => task.subjectType === 'leave').map(task => task.subjectId)
  const refundIds = tasks.filter(task => task.subjectType === 'refund').map(task => task.subjectId)
  const [leaves, refunds] = await Promise.all([
    leaveIds.length
      ? db.select({ id: smsLeaveRequests.id, type: smsLeaveRequests.type, startAt: smsLeaveRequests.startAt })
          .from(smsLeaveRequests)
          .where(and(eq(smsLeaveRequests.organizationId, organizationId), inArray(smsLeaveRequests.id, leaveIds)))
      : Promise.resolve([]),
    refundIds.length
      ? db.select({ id: smsRefunds.id, amount: smsRefunds.amount })
          .from(smsRefunds)
          .where(and(eq(smsRefunds.organizationId, organizationId), inArray(smsRefunds.id, refundIds)))
      : Promise.resolve([])
  ])
  const leaveById = new Map(leaves.map(row => [row.id, row]))
  const refundById = new Map(refunds.map(row => [row.id, row]))

  const items: ApprovalInboxItem[] = tasks.map((task) => {
    const subjectType: ApprovalSubjectType = task.subjectType === 'refund' ? 'refund' : 'leave'
    const leave = leaveById.get(task.subjectId)
    const refund = refundById.get(task.subjectId)
    const title = subjectType === 'leave'
      ? `请假审批（${leave?.type ?? 'leave'}，${leave?.startAt ? new Date(leave.startAt).toISOString().slice(0, 10) : '—'}）`
      : `退费审批（${Number(refund?.amount ?? 0).toFixed(2)} 元）`
    return {
      kind: subjectType,
      taskId: task.id,
      subjectId: task.subjectId,
      step: task.step,
      title,
      assigneeUserId: task.assigneeUserId,
      dueAt: task.dueAt ? task.dueAt.toISOString() : null,
      overdue: Boolean(task.status === 'pending' && task.dueAt && task.dueAt.getTime() < now.getTime()),
      status: task.status as Exclude<ApprovalInboxStatus, 'all'>,
      comment: task.comment ?? null,
      decidedAt: task.decidedAt ? task.decidedAt.toISOString() : null,
      link: '/sms/approvals'
    }
  })
  // 只有待办收件箱才需要兼容历史遗留、尚未生成审批步骤的退费。
  if (status !== 'pending' || kind === 'leave') return items.slice(0, limit)
  return await appendOrphanRefunds(items, actor, organizationId, refundIds, limit)
}

/** 合并「有审批步骤的任务」与「历史遗留、无步骤的待审批退费」。 */
async function appendOrphanRefunds(
  items: ApprovalInboxItem[],
  actor: SmsActor,
  organizationId: number,
  refundIds: number[],
  limit: number
): Promise<ApprovalInboxItem[]> {
  if (!canApproveKind(actor, 'refund')) return items
  const withTasks = new Set(refundIds)
  const pending = await db.select({ id: smsRefunds.id, amount: smsRefunds.amount })
    .from(smsRefunds)
    .where(and(
      eq(smsRefunds.organizationId, organizationId),
      eq(smsRefunds.status, 'pending')
    ))
    .limit(limit)
  for (const row of pending) {
    if (withTasks.has(row.id)) continue
    items.push({
      kind: 'refund',
      taskId: null,
      subjectId: row.id,
      step: 0,
      title: `退费审批（${Number(row.amount).toFixed(2)} 元）`,
      assigneeUserId: null,
      dueAt: null,
      overdue: false,
      status: 'pending',
      comment: null,
      decidedAt: null,
      link: '/sms/approvals'
    })
  }
  return items.slice(0, limit)
}

export interface ReassignApprovalInput {
  taskId?: unknown
  assigneeUserId?: unknown
}

/** 转交审批：仅持有对应审批权限的人可操作，转交后重置 SLA。 */
export async function reassignApprovalTask(actor: SmsActor, input: ReassignApprovalInput) {
  const organizationId = requireSmsOrganization(actor)
  const taskId = Number(input.taskId)
  const assigneeUserId = Number(input.assigneeUserId)
  if (!Number.isSafeInteger(taskId) || taskId <= 0) {
    throw createError({ statusCode: 400, message: 'taskId 必须是正整数' })
  }
  if (!Number.isSafeInteger(assigneeUserId) || assigneeUserId <= 0) {
    throw createError({ statusCode: 400, message: 'assigneeUserId 必须是正整数' })
  }
  const [task] = await db.select().from(smsApprovalTasks)
    .where(and(
      eq(smsApprovalTasks.id, taskId),
      eq(smsApprovalTasks.organizationId, organizationId),
      eq(smsApprovalTasks.status, 'pending')
    ))
    .limit(1)
  if (!task) throw createError({ statusCode: 404, message: 'Approval task not found' })
  const kind: ApprovalSubjectType = task.subjectType === 'refund' ? 'refund' : 'leave'
  if (!canApproveKind(actor, kind)) {
    throw createError({ statusCode: 403, statusMessage: 'Forbidden', message: 'No permission to reassign this approval' })
  }

  const { rows } = await pool.query<{ user_id: number }>(
    `SELECT user_id FROM organization_memberships
      WHERE organization_id = $1 AND status = 'active' AND user_id = $2`,
    [organizationId, assigneeUserId]
  )
  if (rows.length === 0) {
    throw createError({ statusCode: 400, message: 'assigneeUserId 不是当前组织的有效成员' })
  }

  const dueAt = approvalDueAt(new Date())
  return await db.transaction(async (tx) => {
    const [row] = await tx.update(smsApprovalTasks)
      .set({ assigneeUserId, assigneeRole: null, dueAt, escalatedAt: null })
      .where(eq(smsApprovalTasks.id, taskId))
      .returning()
    await createNotifications(tx, {
      organizationId,
      tenantId: task.tenantId,
      recipientUserIds: [assigneeUserId],
      category: 'approval',
      title: `审批已转交：${kind === 'leave' ? '请假' : '退费'}`,
      body: '有审批任务转交给你，请在 SLA 内处理。',
      link: '/sms/approvals',
      entityType: kind,
      entityId: task.subjectId
    })
    await writeAudit(tx, {
      actorUserId: actor.userId,
      tenantId: actor.tenantId ?? undefined,
      organizationId,
      moduleId: 'sms',
      action: 'approval.reassign',
      resource: 'approvals',
      recordId: taskId,
      before: { assigneeUserId: task.assigneeUserId },
      after: { assigneeUserId, dueAt: dueAt.toISOString() },
      source: 'sms-service'
    })
    return row ?? null
  })
}
