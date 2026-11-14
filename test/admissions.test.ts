import { describe, expect, it } from 'vitest'
import {
  allowedAdmissionTransition,
  buildStudentNo,
  normalizeAdmissionDate,
  normalizeAdmissionStatus,
  normalizeCycleStatus
} from '../server/admissions'
import {
  detectTimetableConflicts,
  normalizePeriodNo,
  normalizeTimetableStatus,
  normalizeWeekday
} from '../server/timetable'

describe('admission workflow', () => {
  it('only allows the documented status transitions', () => {
    expect(allowedAdmissionTransition('submitted', 'reviewing')).toBe(true)
    expect(allowedAdmissionTransition('reviewing', 'accepted')).toBe(true)
    expect(allowedAdmissionTransition('accepted', 'converted')).toBe(true)
    expect(allowedAdmissionTransition('rejected', 'reviewing')).toBe(true)
    expect(allowedAdmissionTransition('converted', 'reviewing')).toBe(false)
    expect(allowedAdmissionTransition('submitted', 'converted')).toBe(false)
  })

  it('builds a deterministic fallback student number', () => {
    expect(buildStudentNo(42, 2026)).toBe('A202600042')
  })

  it('normalises cycle/application status and dates', () => {
    expect(normalizeCycleStatus(undefined)).toBe('open')
    expect(normalizeCycleStatus('closed')).toBe('closed')
    expect(() => normalizeCycleStatus('expired')).toThrow(/cycle status/)
    expect(normalizeAdmissionStatus('accepted')).toBe('accepted')
    expect(() => normalizeAdmissionStatus('done')).toThrow(/status must be one of/)
    expect(normalizeAdmissionDate('2026-09-01', 'startDate')).toBe('2026-09-01')
    expect(() => normalizeAdmissionDate('2026-02-30', 'startDate')).toThrow(/valid calendar day/)
  })
})

describe('timetable normalisation and conflicts', () => {
  it('validates weekday, period and status ranges', () => {
    expect(normalizeWeekday('3')).toBe(3)
    expect(() => normalizeWeekday(0)).toThrow(/weekday/)
    expect(() => normalizeWeekday(8)).toThrow(/weekday/)
    expect(normalizePeriodNo(7)).toBe(7)
    expect(() => normalizePeriodNo(13)).toThrow(/periodNo/)
    expect(normalizeTimetableStatus('published')).toBe('published')
    expect(() => normalizeTimetableStatus('archived')).toThrow(/status/)
  })

  it('detects class, teacher and room collisions in the same term', () => {
    const existing = [
      { id: 1, termId: 9, classId: 1, teacherUserId: 7, weekday: 1, periodNo: 2, room: 'A101' },
      { id: 2, termId: 9, classId: 2, teacherUserId: 8, weekday: 1, periodNo: 3, room: 'A101' }
    ]
    expect(detectTimetableConflicts(existing, {
      termId: 9, classId: 1, teacherUserId: 8, weekday: 1, periodNo: 2, room: null
    }).map(item => item.type)).toEqual(['class'])

    expect(detectTimetableConflicts(existing, {
      termId: 9, classId: 3, teacherUserId: 7, weekday: 1, periodNo: 2, room: null
    }).map(item => item.type)).toEqual(['teacher'])

    expect(detectTimetableConflicts(existing, {
      termId: 9, classId: 3, teacherUserId: 9, weekday: 1, periodNo: 3, room: 'A101'
    }).map(item => item.type)).toEqual(['room'])
  })

  it('ignores other terms, other slots and the entry itself', () => {
    const existing = [
      { id: 5, termId: 9, classId: 1, teacherUserId: 7, weekday: 1, periodNo: 1, room: 'A101' }
    ]
    expect(detectTimetableConflicts(existing, {
      id: 5, termId: 9, classId: 1, teacherUserId: 7, weekday: 1, periodNo: 1, room: 'A101'
    })).toEqual([])
    expect(detectTimetableConflicts(existing, {
      termId: 10, classId: 1, teacherUserId: 7, weekday: 1, periodNo: 1, room: 'A101'
    })).toEqual([])
    expect(detectTimetableConflicts(existing, {
      termId: 9, classId: 1, teacherUserId: 7, weekday: 2, periodNo: 1, room: 'A101'
    })).toEqual([])
  })
})
