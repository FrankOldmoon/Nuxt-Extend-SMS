import { describe, it, expect } from 'vitest'
import {
  isAttendanceStatus,
  summarizeAttendance,
  summarizeByStudent,
  attendanceRate,
  defaultSheet
} from '../../server/utils/attendance'

describe('isAttendanceStatus', () => {
  it('accepts the known statuses', () => {
    for (const status of ['present', 'late', 'absent', 'leave', 'excused']) {
      expect(isAttendanceStatus(status)).toBe(true)
    }
  })

  it('rejects anything else', () => {
    expect(isAttendanceStatus('holiday')).toBe(false)
    expect(isAttendanceStatus(undefined)).toBe(false)
  })
})

describe('summarizeAttendance', () => {
  it('excludes authorised leave from the denominator and counts lateness as attended', () => {
    const stats = summarizeAttendance([
      { studentId: 1, status: 'present', date: '2024-09-02' },
      { studentId: 1, status: 'late', minutesLate: 5, date: '2024-09-03' },
      { studentId: 1, status: 'absent', date: '2024-09-04' },
      { studentId: 1, status: 'leave', date: '2024-09-05' },
      { studentId: 1, status: 'excused', date: '2024-09-06' }
    ])
    expect(stats.total).toBe(5)
    expect(stats.present).toBe(1)
    expect(stats.late).toBe(1)
    expect(stats.absent).toBe(1)
    expect(stats.leave).toBe(1)
    expect(stats.excused).toBe(1)
    expect(stats.attended).toBe(2)
    expect(stats.counted).toBe(3)
    expect(stats.rate).toBe(0.6667)
    expect(stats.minutesLate).toBe(5)
    expect(stats.sessions).toBe(5)
  })

  it('gives a student on approved leave a perfect rate', () => {
    const stats = summarizeAttendance([
      { studentId: 1, status: 'present', date: '2024-09-02' },
      { studentId: 1, status: 'leave', date: '2024-09-03' }
    ])
    expect(stats.rate).toBe(1)
  })

  it('returns a null rate when there is nothing to rate', () => {
    expect(summarizeAttendance([]).rate).toBeNull()
  })

  it('counts an unknown status in the total but not in any bucket', () => {
    const stats = summarizeAttendance([{ studentId: 1, status: 'mystery', date: '2024-09-02' }])
    expect(stats.total).toBe(1)
    expect(stats.present + stats.late + stats.absent + stats.leave + stats.excused).toBe(0)
  })
})

describe('summarizeByStudent', () => {
  it('groups records by student', () => {
    const map = summarizeByStudent([
      { studentId: 1, status: 'present', date: '2024-09-02' },
      { studentId: 1, status: 'absent', date: '2024-09-03' },
      { studentId: 2, status: 'present', date: '2024-09-02' }
    ])
    expect(map.get(1)?.total).toBe(2)
    expect(map.get(1)?.rate).toBe(0.5)
    expect(map.get(2)?.rate).toBe(1)
  })
})

describe('attendanceRate', () => {
  it('returns just the rate', () => {
    expect(attendanceRate([{ studentId: 1, status: 'present', date: '2024-09-02' }])).toBe(1)
    expect(attendanceRate([])).toBeNull()
  })
})

describe('defaultSheet', () => {
  it('pre-fills everyone present', () => {
    expect(defaultSheet([1, 2])).toEqual([
      { studentId: 1, status: 'present' },
      { studentId: 2, status: 'present' }
    ])
  })
})
