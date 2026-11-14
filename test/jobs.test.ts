import { describe, expect, it } from 'vitest'
import { buildWeeklySummary, previousWeekRange, weekRange, type WeeklySummaryInput } from '../server/jobs'

const emptyInput: WeeklySummaryInput = {
  period: { start: '2026-11-02', end: '2026-11-08' },
  attendance: { present: 0, late: 0, absent: 0, excused: 0, leave: 0 },
  openAlerts: 0,
  leave: { pending: 0, approved: 0, rejected: 0, cancelled: 0 },
  exams: { published: 0, draft: 0 },
  finance: { payable: 0, paid: 0, pendingRefunds: 0 }
}

describe('weekRange', () => {
  it('returns Monday–Sunday for any day in the week', () => {
    // 2026-11-14 is a Saturday; Monday is 2026-11-09.
    expect(weekRange(new Date('2026-11-14T12:00:00Z'))).toEqual({
      start: '2026-11-09',
      end: '2026-11-15'
    })
  })

  it('treats Sunday as the last day of the same week', () => {
    expect(weekRange(new Date('2026-11-15T00:00:00Z'))).toEqual({
      start: '2026-11-09',
      end: '2026-11-15'
    })
  })

  it('handles weeks crossing a year boundary', () => {
    // 2026-01-01 is a Thursday; the week starts on 2025-12-29.
    expect(weekRange(new Date('2026-01-01T08:00:00Z'))).toEqual({
      start: '2025-12-29',
      end: '2026-01-04'
    })
  })

  it('uses UTC dates regardless of the time of day', () => {
    expect(weekRange(new Date('2026-11-09T23:59:59Z')).start).toBe('2026-11-09')
  })
})

describe('previousWeekRange', () => {
  it('returns the full week before the current one', () => {
    expect(previousWeekRange(new Date('2026-11-14T12:00:00Z'))).toEqual({
      start: '2026-11-02',
      end: '2026-11-08'
    })
  })

  it('crosses month boundaries', () => {
    expect(previousWeekRange(new Date('2026-12-02T12:00:00Z'))).toEqual({
      start: '2026-11-23',
      end: '2026-11-29'
    })
  })
})

describe('buildWeeklySummary', () => {
  it('summarises an empty week without inventing problems', () => {
    const summary = buildWeeklySummary(emptyInput, '2026-11-09T02:00:00.000Z')
    expect(summary.attendance.records).toBe(0)
    expect(summary.attendance.attendanceRate).toBe(0)
    expect(summary.finance.outstanding).toBe(0)
    expect(summary.highlights).toEqual(['本周无异常'])
    expect(summary.generatedAt).toBe('2026-11-09T02:00:00.000Z')
  })

  it('computes attendance rate, outstanding balance and highlights', () => {
    const summary = buildWeeklySummary({
      ...emptyInput,
      attendance: { present: 18, late: 1, absent: 1, excused: 0, leave: 0 },
      openAlerts: 2,
      leave: { pending: 1, approved: 3, rejected: 0, cancelled: 0 },
      exams: { published: 1, draft: 1 },
      finance: { payable: 1000, paid: 700, pendingRefunds: 1 }
    }, '2026-11-09T02:00:00.000Z')

    expect(summary.attendance.records).toBe(20)
    expect(summary.attendance.attendanceRate).toBe(95)
    expect(summary.finance.outstanding).toBe(300)
    expect(summary.highlights).toHaveLength(6)
    expect(summary.highlights.join('|')).toContain('出勤率 95%')
    expect(summary.highlights.join('|')).toContain('2 条考勤预警')
    expect(summary.highlights.join('|')).toContain('1 条请假待审批')
    expect(summary.highlights.join('|')).toContain('1 场考试待发布成绩')
    expect(summary.highlights.join('|')).toContain('300.00 元')
    expect(summary.highlights.join('|')).toContain('1 笔退费待审批')
  })

  it('rounds money and rates to a stable precision', () => {
    const summary = buildWeeklySummary({
      ...emptyInput,
      attendance: { present: 1, late: 0, absent: 2, excused: 0, leave: 0 },
      finance: { payable: 10.005, paid: 0, pendingRefunds: 0 }
    }, '2026-11-09T02:00:00.000Z')

    expect(summary.attendance.attendanceRate).toBe(33.3)
    expect(summary.finance.outstanding).toBe(10)
  })
})
