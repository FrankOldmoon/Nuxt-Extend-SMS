import { describe, expect, it } from 'vitest'
import { REPORT_TYPES, attendanceRate, buildCsv, normalizeReportType } from '../server/reports'

describe('report helpers', () => {
  it('computes an attendance rate excluding unrecorded rows', () => {
    expect(attendanceRate({ present: 18, late: 2, total: 20 })).toBe(100)
    expect(attendanceRate({ present: 15, late: 0, total: 20 })).toBe(75)
    expect(attendanceRate({ present: 0, late: 0, total: 0 })).toBe(0)
  })

  it('escapes commas, quotes and newlines in CSV cells', () => {
    const csv = buildCsv(['name', 'note'], [
      ['张三', 'a,b'],
      ['李四', 'say "hi"'],
      [null, 'line\nbreak']
    ])
    expect(csv.split('\n').slice(0, 2)).toEqual(['name,note', '张三,"a,b"'])
    expect(csv).toContain('"say ""hi"""')
  })

  it('validates report types', () => {
    expect(REPORT_TYPES).toEqual(['attendance', 'scores', 'finance'])
    expect(normalizeReportType('scores')).toBe('scores')
    expect(() => normalizeReportType('students')).toThrow(/type must be one of/)
  })
})
