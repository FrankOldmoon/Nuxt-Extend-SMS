/**
 * 数据保留策略（P1）。
 *
 * 站内信、Agent 事件流、评估指标与报告快照会随业务持续增长。
 * 定时任务按固定保留窗口清理，并写一条审计记录，便于追溯清理范围。
 */
import { and, inArray, lt } from 'drizzle-orm'
import { db, writeAudit } from '../../../server/sdk'
import {
  smsAgentTaskEvents,
  smsEvaluationMetrics,
  smsNotificationOutbox,
  smsNotifications,
  smsReportRuns
} from './database/schema'

export interface RetentionPolicy {
  /** 站内信保留天数。 */
  notificationsDays: number
  /** Agent 任务事件保留天数。 */
  agentEventsDays: number
  /** 评估指标 / 报告运行保留天数。 */
  metricsDays: number
  /** 报表运行记录保留天数。 */
  reportRunsDays: number
  /** 已投递/已失败 outbox 行保留天数。 */
  outboxDays: number
}

export const DEFAULT_RETENTION: RetentionPolicy = {
  notificationsDays: 90,
  agentEventsDays: 180,
  metricsDays: 365,
  reportRunsDays: 365,
  outboxDays: 30
}

export interface RetentionResult {
  notifications: number
  agentEvents: number
  evaluationMetrics: number
  reportRuns: number
  outbox: number
}

function cutoff(now: Date, days: number): Date {
  return new Date(now.getTime() - days * 24 * 60 * 60 * 1000)
}

/**
 * 删除超过保留窗口的数据。返回各表删除行数。
 * 只做时间维度清理，不触碰仍在业务窗口内的数据。
 */
export async function runRetentionCleanup(
  now: Date = new Date(),
  policy: RetentionPolicy = DEFAULT_RETENTION
): Promise<RetentionResult> {
  const deletedNotifications = await db.delete(smsNotifications)
    .where(lt(smsNotifications.createdAt, cutoff(now, policy.notificationsDays)))
    .returning({ id: smsNotifications.id })

  const deletedAgentEvents = await db.delete(smsAgentTaskEvents)
    .where(lt(smsAgentTaskEvents.createdAt, cutoff(now, policy.agentEventsDays)))
    .returning({ id: smsAgentTaskEvents.id })

  const deletedMetrics = await db.delete(smsEvaluationMetrics)
    .where(lt(smsEvaluationMetrics.recordedAt, cutoff(now, policy.metricsDays)))
    .returning({ id: smsEvaluationMetrics.id })

  const deletedReportRuns = await db.delete(smsReportRuns)
    .where(lt(smsReportRuns.generatedAt, cutoff(now, policy.reportRunsDays)))
    .returning({ id: smsReportRuns.id })

  // 只清理已终结的 outbox 行；pending 行交给重试任务处理。
  const deletedOutbox = await db.delete(smsNotificationOutbox)
    .where(and(
      inArray(smsNotificationOutbox.status, ['delivered', 'failed']),
      lt(smsNotificationOutbox.createdAt, cutoff(now, policy.outboxDays))
    ))
    .returning({ id: smsNotificationOutbox.id })

  const result: RetentionResult = {
    notifications: deletedNotifications.length,
    agentEvents: deletedAgentEvents.length,
    evaluationMetrics: deletedMetrics.length,
    reportRuns: deletedReportRuns.length,
    outbox: deletedOutbox.length
  }

  await writeAudit(db, {
    moduleId: 'sms',
    action: 'retention.cleanup',
    resource: 'maintenance',
    after: { ...result, policy, ranAt: now.toISOString() },
    source: 'sms-retention'
  })

  return result
}
