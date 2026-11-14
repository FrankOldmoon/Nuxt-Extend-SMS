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
import { and, asc, eq, isNull, lte } from 'drizzle-orm'
import { db, writeAudit } from '../../../server/sdk'
import { smsApprovalTasks } from './database/schema'
import { createNotifications, resolvePermissionRecipients } from './notifications'

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
