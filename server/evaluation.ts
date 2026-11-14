/**
 * Capability-selection golden set (P2).
 *
 * These cases pin the mapping from common Chinese requests to capability ids.
 * CI asserts that every expected id still exists and that write capabilities
 * still expose a preview, which catches accidental renames or permission drift.
 */
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
  { id: 'student-import', prompt: '批量导入一份学生名单 CSV', expected: ['sms.students.import'] }
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
