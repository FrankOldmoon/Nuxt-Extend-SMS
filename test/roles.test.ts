import { describe, expect, it } from 'vitest'
import { capabilityPermissionMatches } from '../../../server/sdk'
import { smsCapabilities } from '../server/capabilities'
import { canPublishScores } from '../server/exams'
import { canPublishTimetable } from '../server/timetable'
import { SMS_ROLE_PRESETS, mergeRolePermissions, type SmsRolePreset } from '../server/roles'
import { smsModule } from '../module'

type Capability = typeof smsCapabilities[number]

function canRun(preset: SmsRolePreset, capability: Capability): boolean {
  return capabilityPermissionMatches(preset.permissions, capability.permission)
}

function reachableCapabilities(preset: SmsRolePreset): string[] {
  return smsCapabilities.filter(capability => canRun(preset, capability)).map(capability => capability.id)
}

function preset(code: string): SmsRolePreset {
  const found = SMS_ROLE_PRESETS.find(item => item.code === code)
  if (!found) throw new Error(`Missing role preset: ${code}`)
  return found
}

const PLATFORM_ADMIN = 'sms.platform_admin'
const WRITES = smsCapabilities.filter(capability => capability.operation === 'command')

describe('SMS role presets', () => {
  it('defines the 16 namespaced roles from the plan', () => {
    expect(SMS_ROLE_PRESETS).toHaveLength(16)
    const codes = SMS_ROLE_PRESETS.map(item => item.code)
    expect(new Set(codes).size).toBe(codes.length)

    for (const item of SMS_ROLE_PRESETS) {
      expect(item.code, item.code).toMatch(/^sms\.[a-z_]+$/)
      expect(item.description, item.code).toBeTruthy()
      for (const permission of item.permissions) {
        expect(permission, `${item.code}: ${permission}`).toMatch(/^(\*|sms(\.[a-z-]+){1,2})$/)
      }
    }
  })

  it('only references permissions declared by the module manifest', () => {
    const declared = new Set(smsModule.permissions)
    for (const item of SMS_ROLE_PRESETS) {
      if (item.code === PLATFORM_ADMIN) {
        expect(item.permissions).toEqual(['*'])
        continue
      }
      for (const permission of item.permissions) {
        expect(declared.has(permission), `${item.code} -> ${permission}`).toBe(true)
      }
    }
  })

  it('evaluates every role × capability pair', () => {
    // Guards the matrix itself: a new role or capability must be covered here.
    expect(SMS_ROLE_PRESETS).toHaveLength(16)
    expect(smsCapabilities).toHaveLength(81)

    let allowed = 0
    let denied = 0
    for (const role of SMS_ROLE_PRESETS) {
      for (const capability of smsCapabilities) {
        if (canRun(role, capability)) allowed += 1
        else denied += 1
      }
    }
    expect(allowed + denied).toBe(16 * 81)
    expect(allowed).toBeGreaterThan(0)
    expect(denied).toBeGreaterThan(0)
  })

  it('lets platform admin reach every capability', () => {
    expect(reachableCapabilities(preset(PLATFORM_ADMIN))).toHaveLength(smsCapabilities.length)
  })

  it('keeps every capability reachable by at least one business role', () => {
    const business = SMS_ROLE_PRESETS.filter(item => item.code !== PLATFORM_ADMIN)
    for (const capability of smsCapabilities) {
      const owners = business.filter(role => canRun(role, capability)).map(role => role.code)
      expect(owners.length, capability.id).toBeGreaterThan(0)
    }
  })

  it('gives students and guardians their own records, never school-wide writes', () => {
    const writesFor = (code: string) => WRITES
      .filter(capability => canRun(preset(code), capability))
      .map(capability => capability.id)
      .sort()

    // Students may submit coursework and pick courses, but not touch scores.
    expect(writesFor('sms.student')).toEqual([
      'sms.assignments.submit',
      'sms.elections.update',
      'sms.leave.apply',
      'sms.leave.cancel'
    ])
    // Guardians only act on leave for their children.
    expect(writesFor('sms.guardian')).toEqual(['sms.leave.apply', 'sms.leave.cancel'])

    for (const code of ['sms.student', 'sms.guardian']) {
      const role = preset(code)
      expect(canRun(role, smsCapabilities.find(item => item.id === 'sms.scores.save')!)).toBe(false)
      expect(canRun(role, smsCapabilities.find(item => item.id === 'sms.attendance.mark')!)).toBe(false)
    }
  })

  it('lets teachers record attendance and scores but not publish them', () => {
    const teacher = preset('sms.teacher')
    expect(canRun(teacher, smsCapabilities.find(item => item.id === 'sms.attendance.mark')!)).toBe(true)
    expect(canRun(teacher, smsCapabilities.find(item => item.id === 'sms.scores.save')!)).toBe(true)
    expect(canRun(teacher, smsCapabilities.find(item => item.id === 'sms.scores.publish')!)).toBe(false)
    expect(canRun(teacher, smsCapabilities.find(item => item.id === 'sms.timetable.publish')!)).toBe(false)
    expect(canRun(teacher, smsCapabilities.find(item => item.id === 'sms.students.delete')!)).toBe(false)
  })

  it('keeps academic staff out of publish while allowing data entry', () => {
    const staff = preset('sms.academic_staff')
    expect(canRun(staff, smsCapabilities.find(item => item.id === 'sms.scores.save')!)).toBe(true)
    expect(canRun(staff, smsCapabilities.find(item => item.id === 'sms.timetable.create')!)).toBe(true)
    expect(canRun(staff, smsCapabilities.find(item => item.id === 'sms.scores.publish')!)).toBe(false)
    expect(canRun(staff, smsCapabilities.find(item => item.id === 'sms.timetable.publish')!)).toBe(false)
  })

  it('only lets the academic director publish scores and timetables', () => {
    const publishers = SMS_ROLE_PRESETS
      .filter(role => canRun(role, smsCapabilities.find(item => item.id === 'sms.scores.publish')!))
      .map(role => role.code)
    expect(publishers.sort()).toEqual(['sms.academic_director', PLATFORM_ADMIN])

    const timetablePublishers = SMS_ROLE_PRESETS
      .filter(role => canRun(role, smsCapabilities.find(item => item.id === 'sms.timetable.publish')!))
      .map(role => role.code)
    expect(timetablePublishers.sort()).toEqual(['sms.academic_director', PLATFORM_ADMIN])
  })

  it('restricts refund approval to finance and platform admin', () => {
    const approvers = SMS_ROLE_PRESETS
      .filter(role => canRun(role, smsCapabilities.find(item => item.id === 'sms.refunds.approve')!))
      .map(role => role.code)
    expect(approvers.sort()).toEqual(['sms.finance', PLATFORM_ADMIN])
  })

  it('keeps specialist roles inside their own domains', () => {
    const hr = preset('sms.hr')
    expect(canRun(hr, smsCapabilities.find(item => item.id === 'sms.teachers.list')!)).toBe(true)
    expect(canRun(hr, smsCapabilities.find(item => item.id === 'sms.fees.create')!)).toBe(false)
    expect(canRun(hr, smsCapabilities.find(item => item.id === 'sms.scores.save')!)).toBe(false)

    const librarian = preset('sms.librarian')
    expect(canRun(librarian, smsCapabilities.find(item => item.id === 'sms.books.create')!)).toBe(true)
    expect(canRun(librarian, smsCapabilities.find(item => item.id === 'sms.assets.create')!)).toBe(false)

    const logistics = preset('sms.logistics')
    expect(canRun(logistics, smsCapabilities.find(item => item.id === 'sms.assets.create')!)).toBe(true)
    expect(canRun(logistics, smsCapabilities.find(item => item.id === 'sms.books.create')!)).toBe(false)

    const admissions = preset('sms.admissions')
    expect(canRun(admissions, smsCapabilities.find(item => item.id === 'sms.applications.convert')!)).toBe(true)
    expect(canRun(admissions, smsCapabilities.find(item => item.id === 'sms.scores.save')!)).toBe(false)
  })

  it('requires human approval for every high-risk capability', () => {
    const high = smsCapabilities.filter(capability => capability.riskLevel === 'high')
    expect(high.length).toBeGreaterThan(0)
    for (const capability of high) {
      expect(capability.requiresApproval, capability.id).toBe(true)
    }
  })
})

describe('SMS role permission merge', () => {
  it('unions preset permissions without dropping custom grants', () => {
    expect(mergeRolePermissions(['sms.custom.read'], ['sms.students.read', 'sms.custom.read']))
      .toEqual(['sms.custom.read', 'sms.students.read'])
  })

  it('is idempotent', () => {
    const preset = SMS_ROLE_PRESETS[1]!.permissions
    const once = mergeRolePermissions([], preset)
    expect(mergeRolePermissions(once, preset)).toEqual(once)
  })
})

describe('publish permissions are not implied by data scope', () => {
  it('does not treat sms.scores.all as publish', () => {
    expect(canPublishScores({ userId: 1, permissions: ['sms.scores.all'] })).toBe(false)
    expect(canPublishScores({ userId: 1, permissions: ['sms.scores.publish'] })).toBe(true)
  })

  it('does not treat sms.timetable.all as publish', () => {
    expect(canPublishTimetable({ userId: 1, permissions: ['sms.timetable.all'] })).toBe(false)
    expect(canPublishTimetable({ userId: 1, permissions: ['sms.timetable.publish'] })).toBe(true)
  })
})
