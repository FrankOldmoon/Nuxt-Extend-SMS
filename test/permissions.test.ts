import { describe, expect, it } from 'vitest'
import { smsPermissionMatches } from '../app/composables/useSmsPermission'

describe('SMS chat permission matcher', () => {
  it('accepts the canonical resource.action grant used by generic CRUD', () => {
    expect(smsPermissionMatches(['sms.teachers.update'], 'teachers', 'update')).toBe(true)
    expect(smsPermissionMatches(['sms.teachers.update'], 'teachers', 'read')).toBe(false)
  })

  it('accepts coarse module grants', () => {
    expect(smsPermissionMatches(['*'], 'students', 'delete')).toBe(true)
    expect(smsPermissionMatches(['sms'], 'students', 'update')).toBe(true)
    expect(smsPermissionMatches(['sms:update'], 'students', 'update')).toBe(true)
    expect(smsPermissionMatches(['sms.students'], 'students', 'read')).toBe(true)
    expect(smsPermissionMatches(['students:update'], 'students', 'update')).toBe(true)
  })

  it('denies other resources and missing permissions', () => {
    expect(smsPermissionMatches(['sms.students.update'], 'teachers', 'update')).toBe(false)
    expect(smsPermissionMatches(['sms:read'], 'students', 'update')).toBe(false)
    expect(smsPermissionMatches(undefined, 'students', 'read')).toBe(false)
  })
})
