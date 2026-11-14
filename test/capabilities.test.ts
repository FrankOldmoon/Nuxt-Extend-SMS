import { beforeEach, describe, expect, it } from 'vitest'
import {
  describeCapabilities,
  getCapability,
  registerCapabilities,
  resetCapabilityCatalog
} from '../../../server/sdk'
import { ToolRegistry } from '../../../server/core/moduleSdk'
import { smsCapabilities } from '../server/capabilities'
import { smsModule } from '../module'
import type { SmsActor } from '../server/context'

describe('SMS capabilities', () => {
  beforeEach(() => resetCapabilityCatalog())

  it('exposes the read and write capability set from the plan', () => {
    const ids = smsCapabilities.map(capability => capability.id).sort()
    expect(ids).toEqual([
      'sms.admission-cycles.create',
      'sms.admission-cycles.list',
      'sms.agent-tasks.advance',
      'sms.agent-tasks.create',
      'sms.agent-tasks.events',
      'sms.agent-tasks.list',
      'sms.applications.convert',
      'sms.applications.create',
      'sms.applications.list',
      'sms.applications.review',
      'sms.approvals.list',
      'sms.assets.create',
      'sms.assets.list',
      'sms.assets.transfer',
      'sms.assignments.create',
      'sms.assignments.grade',
      'sms.assignments.list',
      'sms.assignments.submit',
      'sms.attendance.alerts.ack',
      'sms.attendance.alerts.list',
      'sms.attendance.mark',
      'sms.attendance.records.list',
      'sms.attendance.roster',
      'sms.attendance.summary',
      'sms.audit.query',
      'sms.books.create',
      'sms.books.list',
      'sms.classes.list',
      'sms.elections.list',
      'sms.elections.update',
      'sms.enrollments.create',
      'sms.enrollments.list',
      'sms.enrollments.transfer',
      'sms.enrollments.withdraw',
      'sms.evaluation.metrics',
      'sms.exams.create',
      'sms.exams.list',
      'sms.fees.create',
      'sms.fees.list',
      'sms.guardians.link',
      'sms.guardians.list',
      'sms.invoices.create',
      'sms.invoices.list',
      'sms.knowledge.create',
      'sms.knowledge.search',
      'sms.knowledge.update',
      'sms.leave.apply',
      'sms.leave.approve',
      'sms.leave.cancel',
      'sms.leave.list',
      'sms.leave.reject',
      'sms.loans.borrow',
      'sms.loans.return',
      'sms.notifications.list',
      'sms.notifications.send',
      'sms.payments.create',
      'sms.refunds.approve',
      'sms.refunds.list',
      'sms.refunds.request',
      'sms.report-cards.generate',
      'sms.reports.attendance',
      'sms.reports.daily',
      'sms.reports.export',
      'sms.reports.finance',
      'sms.reports.scores',
      'sms.scores.import',
      'sms.scores.publish',
      'sms.scores.query',
      'sms.scores.save',
      'sms.scores.sheet',
      'sms.students.create',
      'sms.students.delete',
      'sms.students.get',
      'sms.students.import',
      'sms.students.search',
      'sms.students.update',
      'sms.teachers.assign',
      'sms.teachers.list',
      'sms.timetable.create',
      'sms.timetable.list',
      'sms.timetable.publish'
    ])
  })

  it('requires a preview and a form for every write capability', () => {
    const writes = smsCapabilities.filter(capability => capability.operation === 'command')
    expect(writes).toHaveLength(46)
    for (const capability of writes) {
      expect(capability.preview, capability.id).toBeTypeOf('function')
      expect(capability.riskLevel, capability.id).toMatch(/low|medium|high/)
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
    const components = new Set(smsModule.components ?? [])
    for (const capability of reads) {
      expect(capability.resultView?.kind, capability.id).toBe('table')
      expect(capability.resultView?.columns.length, capability.id).toBeGreaterThan(0)
      for (const column of capability.resultView!.columns) {
        expect(column.key, capability.id).toBeTruthy()
        expect(column.label, capability.id).toBeTruthy()
      }
      // Default components must be registered by the module manifest.
      if (capability.resultView?.component) {
        expect(components.has(capability.resultView.component.id), capability.id).toBe(true)
      }
    }
    for (const capability of smsCapabilities.filter(item => item.operation === 'command')) {
      expect(capability.resultView, capability.id).toBeUndefined()
    }
    expect(smsCapabilities.find(item => item.id === 'sms.students.search')?.resultView?.component?.id)
      .toBe('sms.student-table')
    expect(smsCapabilities.find(item => item.id === 'sms.teachers.list')?.resultView?.component?.id)
      .toBe('sms.teacher-table')
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

  it('only accepts query/limit props for chat table components', async () => {
    const { isSmsChatTableProps } = await import('../register')

    expect(isSmsChatTableProps({})).toBe(true)
    expect(isSmsChatTableProps({ query: '张三', limit: 10 })).toBe(true)
    expect(isSmsChatTableProps({ query: 123 })).toBe(false)
    expect(isSmsChatTableProps({ limit: 0 })).toBe(false)
    expect(isSmsChatTableProps({ limit: 201 })).toBe(false)
    expect(isSmsChatTableProps({ limit: 1.5 })).toBe(false)
    // Data must never come from the model.
    expect(isSmsChatTableProps({ rows: [{ name: '伪造学生' }] })).toBe(false)
    expect(isSmsChatTableProps({ students: [{ name: '伪造学生' }] })).toBe(false)
    expect(isSmsChatTableProps({ teachers: [{ name: '伪造教师' }] })).toBe(false)
    expect(isSmsChatTableProps(null)).toBe(false)
  })
})
