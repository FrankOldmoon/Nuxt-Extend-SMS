/**
 * SMS observability (P2).
 *
 * Two read models for operators: a scoped audit query over `audit_logs` and a
 * one-shot KPI snapshot (notifications, approval SLA, imports, agent failures).
 * Both are read-only and never expose another organization's rows.
 */
import { and, desc, eq, gte, lte, sql } from 'drizzle-orm'
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
