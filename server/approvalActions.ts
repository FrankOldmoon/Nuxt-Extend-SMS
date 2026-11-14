/**
 * 批量审批动作（P0 审批工作台）。
 *
 * 单条审批仍由 leave / finance 领域服务负责（事务、审计、通知、下一级流转），
 * 这里只做批量编排：逐条执行、单条失败不影响其他条，并把失败原因返回给页面。
 */
import { createError } from 'h3'
import type { SmsActor } from './context'
import { canApproveLeave, decideLeave } from './leave'
import { approveRefund, canApproveRefund } from './finance'
import type { ApprovalSubjectType } from './approvals'

export const APPROVAL_BATCH_MAX = 50

export type ApprovalBatchDecision = 'approve' | 'reject'

export interface ApprovalBatchItemInput {
  kind?: unknown
  subjectId?: unknown
}

export interface ApprovalBatchInput {
  items?: unknown
  decision?: unknown
  comment?: unknown
}

export interface ApprovalBatchResultItem {
  kind: ApprovalSubjectType
  subjectId: number
  ok: boolean
  message?: string
}

export interface ApprovalBatchResult {
  decision: ApprovalBatchDecision
  total: number
  succeeded: number
  failed: number
  results: ApprovalBatchResultItem[]
}

function normalizeItem(value: unknown): { kind: ApprovalSubjectType, subjectId: number } | null {
  if (typeof value !== 'object' || value === null) return null
  const record = value as ApprovalBatchItemInput
  const kind: ApprovalSubjectType = record.kind === 'refund' ? 'refund' : 'leave'
  const subjectId = Number(record.subjectId)
  if (!Number.isSafeInteger(subjectId) || subjectId <= 0) return null
  return { kind, subjectId }
}

export async function decideApprovalBatch(actor: SmsActor, input: ApprovalBatchInput): Promise<ApprovalBatchResult> {
  const decision: ApprovalBatchDecision | null = input.decision === 'approve' || input.decision === 'reject'
    ? input.decision
    : null
  if (!decision) {
    throw createError({ statusCode: 400, message: 'decision 必须是 approve 或 reject' })
  }
  if (!Array.isArray(input.items) || input.items.length === 0) {
    throw createError({ statusCode: 400, message: 'items 不能为空' })
  }
  if (input.items.length > APPROVAL_BATCH_MAX) {
    throw createError({ statusCode: 400, message: `单次最多批量审批 ${APPROVAL_BATCH_MAX} 条` })
  }
  const comment = typeof input.comment === 'string' && input.comment.trim()
    ? input.comment.trim().slice(0, 500)
    : undefined

  const items = input.items
    .map(normalizeItem)
    .filter((item): item is { kind: ApprovalSubjectType, subjectId: number } => item !== null)
  if (items.length === 0) {
    throw createError({ statusCode: 400, message: 'items 中没有有效的审批项' })
  }

  const results: ApprovalBatchResultItem[] = []
  for (const item of items) {
    const permitted = item.kind === 'leave' ? canApproveLeave(actor) : canApproveRefund(actor)
    if (!permitted) {
      results.push({ ...item, ok: false, message: '没有该类型的审批权限' })
      continue
    }
    try {
      if (item.kind === 'leave') {
        await decideLeave(actor, { leaveId: item.subjectId, decision, comment })
      } else {
        await approveRefund(actor, { refundId: item.subjectId, decision, comment })
      }
      results.push({ ...item, ok: true })
    } catch (error) {
      results.push({
        ...item,
        ok: false,
        message: error instanceof Error ? error.message : '审批失败'
      })
    }
  }

  const succeeded = results.filter(item => item.ok).length
  return {
    decision,
    total: results.length,
    succeeded,
    failed: results.length - succeeded,
    results
  }
}
