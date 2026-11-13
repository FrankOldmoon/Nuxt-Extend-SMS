import { beforeEach, describe, expect, it } from 'vitest'
import {
  describeCapabilities,
  getCapability,
  registerCapabilities,
  resetCapabilityCatalog
} from '../../../server/sdk'
import { ToolRegistry } from '../../../server/core/moduleSdk'
import { smsCapabilities } from '../server/capabilities'
import type { SmsActor } from '../server/context'

describe('SMS capabilities', () => {
  beforeEach(() => resetCapabilityCatalog())

  it('exposes the read and write capability set from the plan', () => {
    const ids = smsCapabilities.map(capability => capability.id).sort()
    expect(ids).toEqual([
      'sms.classes.list',
      'sms.enrollments.create',
      'sms.enrollments.list',
      'sms.enrollments.withdraw',
      'sms.guardians.link',
      'sms.guardians.list',
      'sms.students.create',
      'sms.students.delete',
      'sms.students.get',
      'sms.students.search',
      'sms.students.update',
      'sms.teachers.assign',
      'sms.teachers.list'
    ])
  })

  it('requires a preview and a form for every write capability', () => {
    const writes = smsCapabilities.filter(capability => capability.operation === 'command')
    expect(writes).toHaveLength(7)
    for (const capability of writes) {
      expect(capability.preview, capability.id).toBeTypeOf('function')
      expect(capability.riskLevel, capability.id).toMatch(/medium|high/)
    }
    expect(smsCapabilities.find(capability => capability.id === 'sms.students.create')?.form)
      .toBeTruthy()
    expect(smsCapabilities.find(capability => capability.id === 'sms.students.delete')?.requiresApproval)
      .toBe(true)
    expect(smsCapabilities.find(capability => capability.id === 'sms.students.delete')?.form)
      .toBeUndefined()
  })

  it('registers every capability into a module tool registry', () => {
    const tools = new ToolRegistry<SmsActor>()
    registerCapabilities(tools, 'sms', smsCapabilities)

    for (const capability of smsCapabilities) {
      expect(tools.get(capability.id), capability.id).toBeDefined()
      expect(getCapability(capability.id)?.moduleId, capability.id).toBe('sms')
    }
  })

  it('hides write capabilities from read-only roles', () => {
    const tools = new ToolRegistry<SmsActor>()
    registerCapabilities(tools, 'sms', smsCapabilities)

    const teacherRead = describeCapabilities(['sms:read']).map(tool => tool.name)
    expect(teacherRead).toContain('sms.students.search')
    expect(teacherRead).not.toContain('sms.students.create')

    const teacherWrite = describeCapabilities(['sms:read', 'sms:create']).map(tool => tool.name)
    expect(teacherWrite).toContain('sms.students.create')
    expect(teacherWrite).not.toContain('sms.students.delete')
    expect(teacherWrite).not.toContain('sms.students.update')

    expect(describeCapabilities(['*'])).toHaveLength(smsCapabilities.length)
  })
})
