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
      'sms.enrollments.transfer',
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
    expect(writes).toHaveLength(8)
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

  it('keeps the module manifest in sync with the capability set', async () => {
    const { smsModule } = await import('../module')

    expect([...smsModule.tools].sort()).toEqual(smsCapabilities.map(capability => capability.id).sort())

    for (const permission of smsModule.permissions) {
      expect(permission, permission).toMatch(/^sms(\.|:|$)/)
    }
    for (const table of smsModule.database) {
      expect(table, table).toMatch(/^sms_/)
    }
    for (const route of smsModule.api) {
      expect(route, route).toMatch(/^(GET|POST|PUT|PATCH|DELETE) \/api\/modules\/sms\//)
    }
    expect(smsModule.migrationScope).toBe('global')
    expect(smsModule.apiVersion).toBe('1')
  })

  it('declares a fixed result table for every read capability', () => {
    const reads = smsCapabilities.filter(capability => capability.operation === 'query')
    expect(reads.length).toBeGreaterThan(0)
    for (const capability of reads) {
      expect(capability.resultView?.kind, capability.id).toBe('table')
      expect(capability.resultView?.columns.length, capability.id).toBeGreaterThan(0)
      for (const column of capability.resultView!.columns) {
        expect(column.key, capability.id).toBeTruthy()
        expect(column.label, capability.id).toBeTruthy()
      }
    }
    for (const capability of smsCapabilities.filter(item => item.operation === 'command')) {
      expect(capability.resultView, capability.id).toBeUndefined()
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
