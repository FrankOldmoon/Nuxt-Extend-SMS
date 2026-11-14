import { describe, expect, it } from 'vitest'
import {
  ATTENDANCE_RULES,
  evaluateAttendanceAlerts,
  hasSchoolWideAttendance,
  normalizeAttendanceDate,
  normalizeAttendanceSession,
  normalizeAttendanceStatus,
  normalizeBatchEntries,
  normalizePeriodNo
} from '../server/attendance'

describe('attendance normalisation', () => {
  it('accepts a plain calendar day and rejects impossible dates', () => {
    expect(normalizeAttendanceDate('2026-11-14')).toBe('2026-11-14')
    expect(() => normalizeAttendanceDate('2026-02-30')).toThrow(/valid calendar day/)
    expect(() => normalizeAttendanceDate('14/11/2026')).toThrow(/YYYY-MM-DD/)
  })

  it('defaults the session to full_day and validates period numbers', () => {
    expect(normalizeAttendanceSession(undefined)).toBe('full_day')
    expect(normalizeAttendanceSession('morning')).toBe('morning')
    expect(() => normalizeAttendanceSession('evening')).toThrow(/session must be one of/)
    expect(normalizePeriodNo('full_day', 5)).toBeNull()
    expect(normalizePeriodNo('period', 3)).toBe(3)
    expect(() => normalizePeriodNo('period', 0)).toThrow(/periodNo/)
  })

  it('only accepts the five attendance statuses', () => {
    expect(normalizeAttendanceStatus('absent')).toBe('absent')
    expect(() => normalizeAttendanceStatus('hungry')).toThrow(/status must be one of/)
  })
})

describe('attendance alerts', () => {
  it('raises a consecutive-absence alert once the run reaches the threshold', () => {
    const alerts = evaluateAttendanceAlerts([
      { date: '2026-11-02', status: 'present' },
      { date: '2026-11-03', status: 'absent' },
      { date: '2026-11-04', status: 'absent' },
      { date: '2026-11-05', status: 'absent' }
    ])
    const consecutive = alerts.find(alert => alert.rule === 'consecutive_absent')
    expect(consecutive).toEqual({
      rule: 'consecutive_absent',
      windowStart: '2026-11-03',
      windowEnd: '2026-11-05',
      metric: 3,
      threshold: ATTENDANCE_RULES.consecutiveAbsentDays
    })
  })

  it('does not alert on short runs or when leave breaks the run', () => {
    const shortRun = evaluateAttendanceAlerts([
      { date: '2026-11-03', status: 'absent' },
      { date: '2026-11-04', status: 'absent' }
    ])
    expect(shortRun.some(alert => alert.rule === 'consecutive_absent')).toBe(false)

    const alerts = evaluateAttendanceAlerts([
      { date: '2026-11-03', status: 'absent' },
      { date: '2026-11-04', status: 'absent' },
      { date: '2026-11-05', status: 'leave' },
      { date: '2026-11-06', status: 'absent' }
    ])
    expect(alerts.some(alert => alert.rule === 'consecutive_absent')).toBe(false)
  })

  it('raises a monthly-rate alert per calendar month', () => {
    const alerts = evaluateAttendanceAlerts([
      { date: '2026-10-29', status: 'present' },
      { date: '2026-10-30', status: 'absent' },
      { date: '2026-10-31', status: 'present' },
      { date: '2026-10-31', status: 'absent' }
    ])
    const monthly = alerts.find(alert => alert.rule === 'monthly_rate')
    expect(monthly).toEqual({
      rule: 'monthly_rate',
      windowStart: '2026-10-01',
      windowEnd: '2026-10-31',
      metric: 50,
      threshold: ATTENDANCE_RULES.monthlyAbsenceRate
    })
  })
})

describe('batch entries', () => {
  it('trims remarks and rejects duplicates or empty batches', () => {
    expect(normalizeBatchEntries([
      { studentId: 1, status: 'present', remark: '  已到  ' },
      { studentId: 2, status: 'absent' }
    ])).toEqual([
      { studentId: 1, status: 'present', remark: '已到' },
      { studentId: 2, status: 'absent', remark: null }
    ])

    expect(() => normalizeBatchEntries([])).toThrow(/non-empty/)
    expect(() => normalizeBatchEntries([
      { studentId: 1, status: 'present' },
      { studentId: 1, status: 'absent' }
    ])).toThrow(/duplicates/)
    expect(() => normalizeBatchEntries([{ studentId: 0, status: 'present' }])).toThrow(/positive integer/)
  })
})

describe('attendance scope flag', () => {
  it('grants whole-school scope to admins and the explicit grant only', () => {
    expect(hasSchoolWideAttendance({ userId: 1, roleName: 'admin', permissions: ['*'] })).toBe(true)
    expect(hasSchoolWideAttendance({ userId: 1, permissions: ['sms.attendance.all'] })).toBe(true)
    expect(hasSchoolWideAttendance({ userId: 1, permissions: ['sms.attendance.update'] })).toBe(false)
    expect(hasSchoolWideAttendance({ userId: 1 })).toBe(false)
  })
})
