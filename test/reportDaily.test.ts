import { describe, expect, it } from 'vitest'
import { aggregateAttendance, normalizeReportDate } from '../server/reportDaily'

describe('daily report aggregation', () => {
  it('groups by class and adds a zero-class whole-school row', () => {
    const buckets = aggregateAttendance([
      { organizationId: 1, tenantId: 1, classId: 10, status: 'present' },
      { organizationId: 1, tenantId: 1, classId: 10, status: 'late' },
      { organizationId: 1, tenantId: 1, classId: 11, status: 'absent' },
      { organizationId: 1, tenantId: 1, classId: 11, status: 'leave' },
      { organizationId: 1, tenantId: 1, classId: null, status: 'present' }
    ])
    const class10 = buckets.find(bucket => bucket.classId === 10)!
    expect(class10).toMatchObject({ present: 1, late: 1, total: 2 })
    const class11 = buckets.find(bucket => bucket.classId === 11)!
    expect(class11).toMatchObject({ absent: 1, leave: 1, total: 2 })
    const school = buckets.find(bucket => bucket.classId === 0)!
    expect(school).toMatchObject({ present: 2, late: 1, absent: 1, leave: 1, total: 5 })
  })

  it('normalises report dates', () => {
    expect(normalizeReportDate('2026-02-03')).toBe('2026-02-03')
    expect(normalizeReportDate(undefined)).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    expect(() => normalizeReportDate('2026/02/03')).toThrow()
  })
})
