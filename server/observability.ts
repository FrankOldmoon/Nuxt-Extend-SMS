/**
 * SMS observability (P2).
 *
 * Two read models for operators: a scoped audit query over `audit_logs` and a
 * one-shot KPI snapshot (notifications, approval SLA, imports, agent failures).
 * Both are read-only and never expose another organization's rows.
 */
import { and, desc, eq, gte, lt, lte, sql } from 'drizzle-orm'
import { createError } from 'h3'
import { db } from '../../../server/sdk'
import { auditLogs } from '../../../server/database/schema'
import {
  smsAgentTasks,
  smsApprovalTasks,
  smsKnowledgeArticles,
  smsNotifications
} from './database/schema'
import { canUseSms, isSmsAdmin, requireSmsOrganization, type SmsActor } from './context'

export function canQueryAudit(actor: SmsActor): boolean {
  if (isSmsAdmin(actor)) return true
  return (actor.permissions ?? []).includes('sms.audit.read')
}

function requireAuditRead(actor: SmsActor): number {
  const organizationId = requireSmsOrganization(actor)
  if (!canQueryAudit(actor)) {
    throw createError({ statusCode: 403, statusMessage: 'Forbidden', message: 'No permission to query audit logs' })
  }
  return organizationId
}

export interface AuditQuery {
  action?: unknown
  resource?: unknown
  from?: unknown
  to?: unknown
  limit?: unknown
  /** 游标分页：上一页最后一条的 id。 */
  cursor?: unknown
}

function parseDate(value: unknown, field: string): Date | null {
  if (value === undefined || value === null || value === '') return null
  const date = new Date(String(value))
  if (Number.isNaN(date.getTime())) throw createError({ statusCode: 400, message: `${field} 不是合法时间` })
  return date
}

/** 仅查询本组织的 SMS 审计记录，避免借审计接口横向读取其他模块。 */
export async function queryAuditLogs(actor: SmsActor, options: AuditQuery = {}) {
  const organizationId = requireAuditRead(actor)
  const conditions = [
    eq(auditLogs.organizationId, organizationId),
    eq(auditLogs.moduleId, 'sms')
  ]
  if (typeof options.action === 'string' && options.action.trim()) {
    conditions.push(eq(auditLogs.action, options.action.trim().slice(0, 100)))
  }
  if (typeof options.resource === 'string' && options.resource.trim()) {
    conditions.push(eq(auditLogs.resource, options.resource.trim().slice(0, 160)))
  }
  const from = parseDate(options.from, 'from')
  if (from) conditions.push(gte(auditLogs.createdAt, from))
  const to = parseDate(options.to, 'to')
  if (to) conditions.push(lte(auditLogs.createdAt, to))
  const cursor = Number(options.cursor)
  if (Number.isSafeInteger(cursor) && cursor > 0) {
    conditions.push(lt(auditLogs.id, cursor))
  }

  const limit = Math.min(Math.max(Math.floor(Number(options.limit ?? 100) || 100), 1), 500)
  return await db.select({
    id: auditLogs.id,
    actorUserId: auditLogs.actorUserId,
    action: auditLogs.action,
    resource: auditLogs.resource,
    recordId: auditLogs.recordId,
    outcome: auditLogs.outcome,
    before: auditLogs.before,
    after: auditLogs.after,
    source: auditLogs.source,
    createdAt: auditLogs.createdAt
  }).from(auditLogs)
    .where(and(...conditions))
    .orderBy(desc(auditLogs.createdAt))
    .limit(limit)
}

export interface SmsMetrics {
  generatedAt: string
  notifications: { total: number, unread: number }
  approvals: { pending: number, overdue: number }
  imports: { batches: number }
  agents: { failed: number, running: number }
  knowledge: { published: number }
}

/**
 * 输出 Prometheus 文本格式（exposition format 0.0.4）。
 * 仅暴露聚合计数，不含学生/通知正文等个人信息。
 */
export function formatPrometheusMetrics(metrics: SmsMetrics, organizationId?: number | null): string {
  const label = organizationId ? `{organization_id="${organizationId}"}` : ''
  const lines: Array<[string, string, number]> = [
    ['sms_notifications_total', 'Total in-app notifications', metrics.notifications.total],
    ['sms_notifications_unread', 'Unread in-app notifications', metrics.notifications.unread],
    ['sms_approvals_pending', 'Pending approval tasks', metrics.approvals.pending],
    ['sms_approvals_overdue', 'Overdue approval tasks', metrics.approvals.overdue],
    ['sms_import_batches_total', 'Student import batches', metrics.imports.batches],
    ['sms_agent_tasks_failed', 'Failed agent tasks', metrics.agents.failed],
    ['sms_agent_tasks_running', 'Running agent tasks', metrics.agents.running],
    ['sms_knowledge_articles_published', 'Published knowledge articles', metrics.knowledge.published]
  ]
  const output: string[] = []
  for (const [name, help, value] of lines) {
    output.push(`# HELP ${name} ${help}`)
    output.push(`# TYPE ${name} gauge`)
    output.push(`${name}${label} ${value}`)
  }
  output.push('# HELP sms_metrics_generated_at_seconds Unix timestamp of this snapshot')
  output.push('# TYPE sms_metrics_generated_at_seconds gauge')
  const generatedAt = Date.parse(metrics.generatedAt)
  output.push(`sms_metrics_generated_at_seconds ${Number.isFinite(generatedAt) ? Math.floor(generatedAt / 1000) : 0}`)
  return `${output.join('\n')}\n`
}

/** 工作台/监控页一次取齐关键指标，避免多次往返。 */
export async function buildSmsMetrics(actor: SmsActor): Promise<SmsMetrics> {
  const organizationId = requireSmsOrganization(actor)
  if (!canUseSms(actor, 'read', 'reports')) {
    throw createError({ statusCode: 403, statusMessage: 'Forbidden', message: 'No permission to read metrics' })
  }
  const now = new Date()
  const [notificationRow] = await db.select({
    total: sql<number>`count(*)::int`,
    unread: sql<number>`count(*) filter (where ${smsNotifications.status} = 'unread')::int`
  }).from(smsNotifications)
    .where(eq(smsNotifications.organizationId, organizationId))

  const [approvalRow] = await db.select({
    pending: sql<number>`count(*)::int`,
    overdue: sql<number>`count(*) filter (where ${smsApprovalTasks.dueAt} < now())::int`
  }).from(smsApprovalTasks)
    .where(and(
      eq(smsApprovalTasks.organizationId, organizationId),
      eq(smsApprovalTasks.status, 'pending')
    ))

  const [importRow] = await db.select({ total: sql<number>`count(*)::int` }).from(auditLogs)
    .where(and(
      eq(auditLogs.organizationId, organizationId),
      eq(auditLogs.moduleId, 'sms'),
      sql`${auditLogs.action} in ('student.import', 'scores.import')`
    ))

  const [agentRow] = await db.select({
    failed: sql<number>`count(*) filter (where ${smsAgentTasks.status} = 'failed')::int`,
    running: sql<number>`count(*) filter (where ${smsAgentTasks.status} in ('running', 'waiting_approval'))::int`
  }).from(smsAgentTasks)
    .where(eq(smsAgentTasks.organizationId, organizationId))

  const [knowledgeRow] = await db.select({ total: sql<number>`count(*)::int` }).from(smsKnowledgeArticles)
    .where(and(
      eq(smsKnowledgeArticles.organizationId, organizationId),
      eq(smsKnowledgeArticles.status, 'published')
    ))

  return {
    generatedAt: now.toISOString(),
    notifications: {
      total: Number(notificationRow?.total ?? 0),
      unread: Number(notificationRow?.unread ?? 0)
    },
    approvals: {
      pending: Number(approvalRow?.pending ?? 0),
      overdue: Number(approvalRow?.overdue ?? 0)
    },
    imports: { batches: Number(importRow?.total ?? 0) },
    agents: {
      failed: Number(agentRow?.failed ?? 0),
      running: Number(agentRow?.running ?? 0)
    },
    knowledge: { published: Number(knowledgeRow?.total ?? 0) }
  }
}
