/**
 * Durable task-agent state machine (P2).
 *
 * The model does not get to invent lifecycle transitions: every advance is
 * validated against a small table and persisted, so a retry after a restart
 * resumes from the last durable step instead of replaying side effects.
 */
import { and, desc, eq, lt } from 'drizzle-orm'
import { createError } from 'h3'
import { db, writeAudit } from '../../../server/sdk'
import { smsAgentTaskEvents, smsAgentTasks } from './database/schema'
import { canUseSms, isSmsAdmin, requireSmsOrganization, type SmsActor } from './context'

export const AGENT_TASK_STATUSES = [
  'pending',
  'running',
  'waiting_approval',
  'done',
  'failed',
  'cancelled'
] as const
export type AgentTaskStatus = typeof AGENT_TASK_STATUSES[number]

export const AGENT_TASK_EVENTS = ['start', 'wait', 'resume', 'complete', 'fail', 'cancel', 'retry'] as const
export type AgentTaskEvent = typeof AGENT_TASK_EVENTS[number]

const TRANSITIONS: Record<AgentTaskStatus, Partial<Record<AgentTaskEvent, AgentTaskStatus>>> = {
  pending: { start: 'running', cancel: 'cancelled', fail: 'failed' },
  running: {
    wait: 'waiting_approval',
    complete: 'done',
    fail: 'failed',
    cancel: 'cancelled'
  },
  waiting_approval: {
    resume: 'running',
    complete: 'done',
    fail: 'failed',
    cancel: 'cancelled'
  },
  done: {},
  failed: { retry: 'pending' },
  cancelled: {}
}

export function nextAgentTaskStatus(
  current: AgentTaskStatus,
  event: AgentTaskEvent
): AgentTaskStatus | null {
  return TRANSITIONS[current][event] ?? null
}

export function normalizeAgentTaskStatus(value: unknown): AgentTaskStatus | 'all' {
  if (value === undefined || value === null || value === '' || value === 'all') return 'all'
  if (typeof value === 'string' && (AGENT_TASK_STATUSES as readonly string[]).includes(value)) {
    return value as AgentTaskStatus
  }
  throw createError({ statusCode: 400, message: `status must be one of ${AGENT_TASK_STATUSES.join(', ')}` })
}

function normalizeEvent(value: unknown): AgentTaskEvent {
  if (typeof value === 'string' && (AGENT_TASK_EVENTS as readonly string[]).includes(value)) {
    return value as AgentTaskEvent
  }
  throw createError({ statusCode: 400, message: `event must be one of ${AGENT_TASK_EVENTS.join(', ')}` })
}

function requireAgentRead(actor: SmsActor): number {
  const organizationId = requireSmsOrganization(actor)
  if (!canUseSms(actor, 'read', 'agent-tasks')) {
    throw createError({ statusCode: 403, statusMessage: 'Forbidden', message: 'No permission to read agent tasks' })
  }
  return organizationId
}

function requireAgentWrite(actor: SmsActor): number {
  const organizationId = requireSmsOrganization(actor)
  if (!isSmsAdmin(actor) && !(actor.permissions ?? []).includes('sms.agent-tasks.create')) {
    throw createError({ statusCode: 403, statusMessage: 'Forbidden', message: 'No permission to create agent tasks' })
  }
  return organizationId
}

export interface AgentTaskQuery {
  status?: unknown
  limit?: unknown
}

export async function listAgentTasks(actor: SmsActor, options: AgentTaskQuery = {}) {
  const organizationId = requireAgentRead(actor)
  const conditions = [eq(smsAgentTasks.organizationId, organizationId)]
  if (!isSmsAdmin(actor)) conditions.push(eq(smsAgentTasks.ownerUserId, actor.userId))
  const status = normalizeAgentTaskStatus(options.status)
  if (status !== 'all') conditions.push(eq(smsAgentTasks.status, status))
  const limit = Math.min(Math.max(Math.floor(Number(options.limit ?? 20) || 20), 1), 100)

  return await db.select({
    id: smsAgentTasks.id,
    title: smsAgentTasks.title,
    goal: smsAgentTasks.goal,
    status: smsAgentTasks.status,
    step: smsAgentTasks.step,
    maxSteps: smsAgentTasks.maxSteps,
    lastError: smsAgentTasks.lastError,
    updatedAt: smsAgentTasks.updatedAt,
    createdAt: smsAgentTasks.createdAt
  }).from(smsAgentTasks)
    .where(and(...conditions))
    .orderBy(desc(smsAgentTasks.updatedAt))
    .limit(limit)
}

export interface CreateAgentTaskInput {
  title?: unknown
  goal?: unknown
  payload?: unknown
  /** 同一组织内重复提交同一个键会返回既有任务，避免重试产生重复执行。 */
  idempotencyKey?: unknown
}

export async function createAgentTask(actor: SmsActor, input: CreateAgentTaskInput) {
  const organizationId = requireAgentWrite(actor)
  const title = typeof input.title === 'string' ? input.title.trim().slice(0, 200) : ''
  if (!title) throw createError({ statusCode: 400, message: 'title 不能为空' })
  const goal = typeof input.goal === 'string' ? input.goal.trim().slice(0, 2000) : null
  const payload = typeof input.payload === 'object' && input.payload !== null && !Array.isArray(input.payload)
    ? input.payload as Record<string, unknown>
    : null
  const idempotencyKey = typeof input.idempotencyKey === 'string' && input.idempotencyKey.trim()
    ? input.idempotencyKey.trim().slice(0, 80)
    : null

  if (idempotencyKey) {
    const [existing] = await db.select().from(smsAgentTasks)
      .where(and(
        eq(smsAgentTasks.organizationId, organizationId),
        eq(smsAgentTasks.idempotencyKey, idempotencyKey)
      ))
      .limit(1)
    if (existing) return existing
  }

  return await db.transaction(async (tx) => {
    const [row] = await tx.insert(smsAgentTasks).values({
      organizationId,
      tenantId: actor.tenantId ?? null,
      ownerUserId: actor.userId,
      title,
      goal,
      payload,
      status: 'pending',
      idempotencyKey
    }).returning()
    if (!row) throw createError({ statusCode: 500, message: 'Failed to create agent task' })
    await tx.insert(smsAgentTaskEvents).values({
      organizationId,
      taskId: row.id,
      event: 'create',
      fromStatus: null,
      toStatus: 'pending',
      actorUserId: actor.userId
    })
    await writeAudit(tx, {
      actorUserId: actor.userId,
      tenantId: actor.tenantId ?? undefined,
      organizationId,
      moduleId: 'sms',
      action: 'agent-task.create',
      resource: 'agent-tasks',
      recordId: row.id,
      after: { title, status: row.status, idempotent: Boolean(idempotencyKey) },
      source: 'sms-service'
    })
    return row
  })
}

export interface AdvanceAgentTaskInput {
  taskId?: unknown
  event?: unknown
  note?: unknown
}

export async function advanceAgentTask(actor: SmsActor, input: AdvanceAgentTaskInput) {
  const organizationId = requireAgentRead(actor)
  const taskId = Number(input.taskId)
  if (!Number.isSafeInteger(taskId) || taskId <= 0) {
    throw createError({ statusCode: 400, message: 'taskId 必须是正整数' })
  }
  const event = normalizeEvent(input.event)
  const conditions = [
    eq(smsAgentTasks.id, taskId),
    eq(smsAgentTasks.organizationId, organizationId)
  ]
  if (!isSmsAdmin(actor)) conditions.push(eq(smsAgentTasks.ownerUserId, actor.userId))
  const [task] = await db.select().from(smsAgentTasks)
    .where(and(...conditions))
    .limit(1)
  if (!task) throw createError({ statusCode: 404, message: 'Agent task not found' })

  const current = task.status as AgentTaskStatus
  const next = nextAgentTaskStatus(current, event)
  if (!next) {
    throw createError({
      statusCode: 409,
      message: `Cannot apply ${event} to a ${current} task`
    })
  }
  if (event === 'start' || event === 'resume') {
    if (task.step >= task.maxSteps) {
      throw createError({ statusCode: 409, message: 'Agent task reached max steps' })
    }
  }
  const note = typeof input.note === 'string' ? input.note.trim().slice(0, 500) : null

  return await db.transaction(async (tx) => {
    const patch: Partial<typeof smsAgentTasks.$inferInsert> = {
      status: next,
      step: event === 'start' || event === 'resume' ? task.step + 1 : task.step,
      lastError: event === 'fail' ? note : task.lastError,
      result: event === 'complete' && note ? { note } : task.result,
      updatedAt: new Date()
    }
    if (event === 'retry') patch.lastError = null
    // 取消时把已登记的步骤标记为取消，避免调用方继续轮询未完成步骤。
    if (event === 'cancel' && task.payload) {
      patch.payload = { ...task.payload, cancelledAt: new Date().toISOString() }
    }
    const [updated] = await tx.update(smsAgentTasks)
      .set(patch)
      .where(eq(smsAgentTasks.id, taskId))
      .returning()
    await tx.insert(smsAgentTaskEvents).values({
      organizationId,
      taskId,
      event,
      fromStatus: current,
      toStatus: next,
      note,
      actorUserId: actor.userId
    })
    await writeAudit(tx, {
      actorUserId: actor.userId,
      tenantId: actor.tenantId ?? undefined,
      organizationId,
      moduleId: 'sms',
      action: 'agent-task.advance',
      resource: 'agent-tasks',
      recordId: taskId,
      before: { status: current, step: task.step },
      after: { status: next, step: updated?.step ?? task.step, event },
      source: 'sms-service'
    })
    return updated ?? null
  })
}

export interface AgentTaskEventQuery {
  taskId?: unknown
  limit?: unknown
  /** 游标分页：上一页最后一条的 id。 */
  cursor?: unknown
}

/** 事件流按时间倒序返回，用于回放一次任务执行。 */
export async function listAgentTaskEvents(actor: SmsActor, options: AgentTaskEventQuery = {}) {
  const organizationId = requireAgentRead(actor)
  const taskId = Number(options.taskId)
  if (!Number.isSafeInteger(taskId) || taskId <= 0) {
    throw createError({ statusCode: 400, message: 'taskId 必须是正整数' })
  }
  const conditions = [
    eq(smsAgentTaskEvents.organizationId, organizationId),
    eq(smsAgentTaskEvents.taskId, taskId)
  ]
  const cursor = Number(options.cursor)
  if (Number.isSafeInteger(cursor) && cursor > 0) {
    conditions.push(lt(smsAgentTaskEvents.id, cursor))
  }
  const limit = Math.min(Math.max(Math.floor(Number(options.limit ?? 100) || 100), 1), 200)
  return await db.select({
    id: smsAgentTaskEvents.id,
    event: smsAgentTaskEvents.event,
    fromStatus: smsAgentTaskEvents.fromStatus,
    toStatus: smsAgentTaskEvents.toStatus,
    note: smsAgentTaskEvents.note,
    actorUserId: smsAgentTaskEvents.actorUserId,
    createdAt: smsAgentTaskEvents.createdAt
  }).from(smsAgentTaskEvents)
    .where(and(...conditions))
    .orderBy(desc(smsAgentTaskEvents.createdAt))
    .limit(limit)
}
