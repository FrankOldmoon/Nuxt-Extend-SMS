/**
 * Capability-selection golden set (P2).
 *
 * These cases pin the mapping from common Chinese requests to capability ids.
 * CI asserts that every expected id still exists and that write capabilities
 * still expose a preview, which catches accidental renames or permission drift.
 */
import { and, desc, eq, gte } from 'drizzle-orm'
import { createError } from 'h3'
import { db } from '../../../server/sdk'
import { smsEvaluationMetrics } from './database/schema'
import { canUseSms, requireSmsOrganization, type SmsActor } from './context'

export interface GoldenCase {
  id: string
  prompt: string
  expected: string[]
}

export const SMS_GOLDEN_CASES: GoldenCase[] = [
  { id: 'student-search', prompt: '帮我查一下三年级二班的学生名单', expected: ['sms.students.search'] },
  { id: 'attendance-mark', prompt: '把今天三年级二班的考勤登记为全勤', expected: ['sms.attendance.mark'] },
  { id: 'attendance-alert', prompt: '看看本周有哪些考勤预警', expected: ['sms.attendance.alerts.list'] },
  { id: 'leave-apply', prompt: '我要给孩子请两天病假', expected: ['sms.leave.apply'] },
  { id: 'leave-approve', prompt: '同意这条请假申请', expected: ['sms.leave.approve'] },
  { id: 'scores-save', prompt: '录入这次期中考试的数学成绩', expected: ['sms.scores.save'] },
  { id: 'scores-publish', prompt: '把这次考试成绩发布给家长', expected: ['sms.scores.publish'] },
  { id: 'refund-approve', prompt: '审批通过这条退费申请', expected: ['sms.refunds.approve'] },
  { id: 'knowledge-search', prompt: '学校的请假制度是怎么规定的', expected: ['sms.knowledge.search'] },
  { id: 'notification-list', prompt: '我有哪些未读通知', expected: ['sms.notifications.list'] },
  { id: 'report-daily', prompt: '看一下昨天的班级考勤日报', expected: ['sms.reports.daily'] },
  { id: 'student-import', prompt: '批量导入一份学生名单 CSV', expected: ['sms.students.import'] },
  { id: 'approval-inbox', prompt: '看看我的待审批事项', expected: ['sms.approvals.list'] },
  { id: 'assignment-create', prompt: '给三年级二班布置数学作业', expected: ['sms.assignments.create'] },
  { id: 'assignment-submit', prompt: '提交我的数学作业', expected: ['sms.assignments.submit'] },
  { id: 'election-update', prompt: '我要选这门选修课', expected: ['sms.elections.update'] },
  { id: 'exam-create', prompt: '新建一次期中考试', expected: ['sms.exams.create'] },
  { id: 'timetable-list', prompt: '查一下三年级二班的课表', expected: ['sms.timetable.list'] },
  { id: 'application-list', prompt: '查看今年的报名申请', expected: ['sms.applications.list'] },
  { id: 'asset-list', prompt: '查一下实验室的资产', expected: ['sms.assets.list'] },
  { id: 'loan-borrow', prompt: '借一本数学教材', expected: ['sms.loans.borrow'] },
  { id: 'report-export', prompt: '导出本月考勤报表', expected: ['sms.reports.export'] },
  { id: 'agent-create', prompt: '帮我创建一个批量通知任务', expected: ['sms.agent-tasks.create'] },
  { id: 'audit-query', prompt: '查一下最近的敏感操作审计', expected: ['sms.audit.query'] },
  { id: 'evaluation-metrics', prompt: '看看本周的能力命中率', expected: ['sms.evaluation.metrics'] },
  { id: 'knowledge-update', prompt: '把旧的请假制度文章下架', expected: ['sms.knowledge.update'] },
  { id: 'scores-import', prompt: '批量导入这次考试的成绩 CSV', expected: ['sms.scores.import'] },
  { id: 'attendance-summary', prompt: '查一下本月出勤率', expected: ['sms.attendance.summary'] },
  { id: 'finance-report', prompt: '生成财务收入报表', expected: ['sms.reports.finance'] },
  { id: 'notification-send', prompt: '给全体教师发一条通知', expected: ['sms.notifications.send'] }
]

export interface SelectionScore {
  hit: number
  miss: number
  extra: number
  precision: number
  recall: number
}

export function scoreSelection(
  expected: readonly string[],
  selected: readonly string[]
): SelectionScore {
  const expectedSet = new Set(expected)
  const selectedSet = new Set(selected)
  let hit = 0
  for (const id of expectedSet) if (selectedSet.has(id)) hit += 1
  const miss = expectedSet.size - hit
  const extra = selectedSet.size - hit
  return {
    hit,
    miss,
    extra,
    precision: selectedSet.size === 0 ? 0 : hit / selectedSet.size,
    recall: expectedSet.size === 0 ? 1 : hit / expectedSet.size
  }
}

// ---------------------------------------------------------------------------
// 在线指标（P2）：把每次评估/工具调用的结果写成时序数据
// ---------------------------------------------------------------------------

function requireMetricsAccess(actor: SmsActor): number {
  const organizationId = requireSmsOrganization(actor)
  if (!canUseSms(actor, 'read', 'reports')) {
    throw createError({ statusCode: 403, statusMessage: 'Forbidden', message: 'No permission to read metrics' })
  }
  return organizationId
}

export interface RecordMetricInput {
  metric?: unknown
  value?: unknown
  labels?: unknown
}

export async function recordEvaluationMetric(actor: SmsActor, input: RecordMetricInput) {
  const organizationId = requireMetricsAccess(actor)
  const metric = typeof input.metric === 'string' ? input.metric.trim() : ''
  if (!/^[a-z0-9._-]{1,80}$/i.test(metric)) {
    throw createError({ statusCode: 400, message: 'metric 必须是 1-80 位字母、数字、点、下划线或连字符' })
  }
  const value = Number(input.value)
  if (!Number.isFinite(value)) throw createError({ statusCode: 400, message: 'value 必须是数字' })
  const labels = typeof input.labels === 'object' && input.labels !== null && !Array.isArray(input.labels)
    ? input.labels as Record<string, unknown>
    : null

  const [row] = await db.insert(smsEvaluationMetrics).values({
    organizationId,
    metric,
    value: value.toFixed(4),
    labels
  }).returning()
  return row ?? null
}

export interface EvaluationMetricQuery {
  metric?: unknown
  since?: unknown
  limit?: unknown
}

export async function listEvaluationMetrics(actor: SmsActor, options: EvaluationMetricQuery = {}) {
  const organizationId = requireMetricsAccess(actor)
  const conditions = [eq(smsEvaluationMetrics.organizationId, organizationId)]
  if (typeof options.metric === 'string' && options.metric.trim()) {
    conditions.push(eq(smsEvaluationMetrics.metric, options.metric.trim().slice(0, 80)))
  }
  if (typeof options.since === 'string' && options.since.trim()) {
    const since = new Date(options.since)
    if (Number.isNaN(since.getTime())) throw createError({ statusCode: 400, message: 'since 不是合法时间' })
    conditions.push(gte(smsEvaluationMetrics.recordedAt, since))
  }
  const limit = Math.min(Math.max(Math.floor(Number(options.limit ?? 100) || 100), 1), 500)
  return await db.select({
    id: smsEvaluationMetrics.id,
    metric: smsEvaluationMetrics.metric,
    value: smsEvaluationMetrics.value,
    labels: smsEvaluationMetrics.labels,
    recordedAt: smsEvaluationMetrics.recordedAt
  }).from(smsEvaluationMetrics)
    .where(and(...conditions))
    .orderBy(desc(smsEvaluationMetrics.recordedAt))
    .limit(limit)
}
