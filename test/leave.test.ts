import { describe, expect, it } from 'vitest'
import {
  LEAVE_ESCALATION_DAYS,
  LEAVE_TYPES,
  canApproveLeave,
  hasSchoolWideLeave,
  leaveDateRange,
  normalizeLeaveStatus,
  normalizeLeaveSubjectType,
  normalizeLeaveType,
  normalizeLeaveWindow,
  resolveLeaveRoute
} from '../server/leave'

describe('leave normalisation', () => {
  it('accepts the three leave types and the four statuses', () => {
    expect(LEAVE_TYPES).toEqual(['sick', 'personal', 'other'])
    expect(normalizeLeaveType('sick')).toBe('sick')
    expect(() => normalizeLeaveType('holiday')).toThrow(/type must be one of/)
    expect(normalizeLeaveStatus('approved')).toBe('approved')
    expect(() => normalizeLeaveStatus('done')).toThrow(/status must be one of/)
  })

  it('defaults the subject to student and rejects unknown subjects', () => {
    expect(normalizeLeaveSubjectType(undefined)).toBe('student')
    expect(normalizeLeaveSubjectType('staff')).toBe('staff')
    expect(() => normalizeLeaveSubjectType('parent')).toThrow(/subjectType/)
  })

  it('derives an inclusive day count from calendar days', () => {
    const single = normalizeLeaveWindow('2026-11-14', '2026-11-14')
    expect(single).toMatchObject({ startDate: '2026-11-14', endDate: '2026-11-14', days: 1 })
    expect(leaveDateRange(single)).toEqual(['2026-11-14'])

    const multi = normalizeLeaveWindow('2026-11-14', '2026-11-16')
    expect(multi.days).toBe(3)
    expect(leaveDateRange(multi)).toEqual(['2026-11-14', '2026-11-15', '2026-11-16'])
  })

  it('rejects reversed windows, impossible days and over-long leave', () => {
    expect(() => normalizeLeaveWindow('2026-11-16', '2026-11-14')).toThrow(/before startAt/)
    expect(() => normalizeLeaveWindow('2026-02-30', '2026-03-01')).toThrow(/valid calendar day/)
    expect(() => normalizeLeaveWindow('2026-01-01', '2026-12-31')).toThrow(/exceed/)
  })
})

describe('leave approval routing', () => {
  it('routes short leave to the homeroom teacher only', () => {
    expect(resolveLeaveRoute({ days: 1, homeroomUserId: 7 })).toEqual([
      { step: 1, assigneeRole: 'homeroom', assigneeUserId: 7 }
    ])
  })

  it('escalates leave of three days or more to the grade leader', () => {
    const steps = resolveLeaveRoute({ days: LEAVE_ESCALATION_DAYS, homeroomUserId: 7 })
    expect(steps).toEqual([
      { step: 1, assigneeRole: 'homeroom', assigneeUserId: 7 },
      { step: 2, assigneeRole: 'grade_leader', assigneeUserId: null }
    ])
  })

  it('falls back to a school admin when the class has no homeroom teacher', () => {
    expect(resolveLeaveRoute({ days: 2, homeroomUserId: null })).toEqual([
      { step: 1, assigneeRole: 'school_admin', assigneeUserId: null }
    ])
  })
})

describe('leave scope flags', () => {
  it('grants whole-school leave to admins and the explicit grant only', () => {
    expect(hasSchoolWideLeave({ userId: 1, roleName: 'admin', permissions: ['*'] })).toBe(true)
    expect(hasSchoolWideLeave({ userId: 1, permissions: ['sms.leave.all'] })).toBe(true)
    expect(hasSchoolWideLeave({ userId: 1, permissions: ['sms.leave.approve'] })).toBe(false)
    expect(hasSchoolWideLeave({ userId: 1 })).toBe(false)
  })

  it('only approvers (or coarse SMS writers) may decide leave', () => {
    expect(canApproveLeave({ userId: 1, roleName: 'admin', permissions: ['*'] })).toBe(true)
    expect(canApproveLeave({ userId: 1, permissions: ['sms.leave.approve'] })).toBe(true)
    expect(canApproveLeave({ userId: 1, permissions: ['sms:update'] })).toBe(true)
    expect(canApproveLeave({ userId: 1, permissions: ['sms.leave.read'] })).toBe(false)
    expect(canApproveLeave({ userId: 1 })).toBe(false)
  })
})
