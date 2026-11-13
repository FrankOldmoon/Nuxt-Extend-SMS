// Phase 5 acceptance: SMS is an independent module that uses Core permission,
// data scope, Generic CRUD, Tool Registry and UI Registry without Core changes.
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { pool } from '../../../server/database'
import { applyModuleMigrations } from '../../../server/database/moduleMigrations'
import { smsModule } from '../module'
import { getRegisteredTable, getTableMeta } from '../../../server/utils/dashboard/tables'
import { assertRelationScope, insertRow, listTableData, type DataScopeActor } from '../../../server/utils/dashboard/crudService'
import { ModuleApiRouter, ToolRegistry, UiRegistry } from '../../../server/core/moduleSdk'
import { describeAgentTools, extractUiDirective, runAgentLoop } from '../../../server/core/agent'
import { registerSmsModule } from '../register'
import { createStudent, searchStudents } from '../server/students'
import type { SmsActor } from '../server/context'

describe('SMS demo module (database)', () => {
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  let tenantId = 0
  let organizationId = 0
  let otherOrganizationId = 0
  let classA = 0
  let classB = 0
  let foreignClass = 0

  const teacher: SmsActor = {
    userId: 1001,
    roleName: 'teacher',
    permissions: ['sms:read', 'sms:create'],
    organizationId: 0,
    tenantId: 0
  }
  const admin: SmsActor = {
    userId: 1,
    roleName: 'admin',
    permissions: ['*'],
    organizationId: 0,
    tenantId: 0
  }
  const api = new ModuleApiRouter<SmsActor>()
  const tools = new ToolRegistry<SmsActor>()
  const ui = new UiRegistry<unknown, unknown>()

  beforeAll(async () => {
    await applyModuleMigrations(pool, [smsModule])
    registerSmsModule({ api, tools, ui })

    const tenant = await pool.query(
      `INSERT INTO tenants (name, slug) VALUES ($1, $2) RETURNING id`,
      ['sms-itest', `sms-${suffix}`]
    )
    tenantId = tenant.rows[0].id
    const org = await pool.query(
      `INSERT INTO organizations (tenant_id, name, slug) VALUES ($1, 'SMS Org', $2) RETURNING id`,
      [tenantId, `sms-org-${suffix}`]
    )
    organizationId = org.rows[0].id
    teacher.organizationId = organizationId
    teacher.tenantId = tenantId
    admin.organizationId = organizationId
    admin.tenantId = tenantId

    const classes = await pool.query(
      `INSERT INTO sms_classes (organization_id, name, grade) VALUES ($1, 'Class A', '1'), ($1, 'Class B', '1') RETURNING id`,
      [organizationId]
    )
    classA = classes.rows[0].id
    classB = classes.rows[1].id

    const otherOrg = await pool.query(
      `INSERT INTO organizations (tenant_id, name, slug) VALUES ($1, 'Other Org', $2) RETURNING id`,
      [tenantId, `sms-other-${suffix}`]
    )
    otherOrganizationId = otherOrg.rows[0].id
    const foreign = await pool.query(
      `INSERT INTO sms_classes (organization_id, name, grade) VALUES ($1, 'Foreign Class', '1') RETURNING id`,
      [otherOrganizationId]
    )
    foreignClass = foreign.rows[0].id

    await pool.query(
      `INSERT INTO sms_students (organization_id, class_id, name, student_no) VALUES
        ($1, $2, 'Alice', 'S001'),
        ($1, $3, 'Bob', 'S002')`,
      [organizationId, classA, classB]
    )
    await pool.query(
      `INSERT INTO sms_teacher_assignments (organization_id, teacher_user_id, class_id) VALUES ($1, $2, $3)`,
      [organizationId, teacher.userId, classA]
    )
  }, 60000)

  afterAll(async () => {
    if (organizationId) {
      await pool.query('DELETE FROM sms_students WHERE organization_id = $1', [organizationId])
      await pool.query('DELETE FROM sms_teacher_assignments WHERE organization_id = $1', [organizationId])
      await pool.query('DELETE FROM sms_classes WHERE organization_id = $1', [organizationId])
      await pool.query('DELETE FROM organizations WHERE id = $1', [organizationId])
    }
    if (otherOrganizationId) {
      await pool.query('DELETE FROM sms_classes WHERE organization_id = $1', [otherOrganizationId])
      await pool.query('DELETE FROM organizations WHERE id = $1', [otherOrganizationId])
    }
    if (tenantId) await pool.query('DELETE FROM tenants WHERE id = $1', [tenantId])
    await pool.end()
  })

  it('shares one search service between the module API and the agent tool', async () => {
    expect((await searchStudents(teacher)).map(student => student.name)).toEqual(['Alice'])
    expect((await searchStudents(admin)).map(student => student.name)).toEqual(['Alice', 'Bob'])

    const viaApi = await api.dispatch('GET', 'sms/students', {}, teacher, { q: '' })
    expect((viaApi as Array<{ name: string }>).map(student => student.name)).toEqual(['Alice'])
  })

  it('applies TeacherAssignment scope to Generic CRUD lists', async () => {
    const meta = getRegisteredTable('students')?.meta
    expect(meta?.exposure).toBe('generic-crud')
    expect(meta?.features.dataScope?.resolver).toBe('sms.teacherAssignedClasses')

    const actor: DataScopeActor = {
      userId: teacher.userId,
      roleName: 'teacher',
      dataScope: 'all',
      permissions: ['sms:read'],
      organizationId,
      tenantId
    }
    const result = await listTableData(meta!, { offset: 0, limit: 50, trashed: false } as never, actor)
    expect((result.rows as Array<{ name: string }>).map(row => row.name)).toEqual(['Alice'])
  })

  it('lets the agent call the student search tool with the same scope', async () => {
    const descriptors = describeAgentTools(tools as never, teacher.permissions)
    expect(descriptors.map(tool => tool.name)).toContain('sms.students.search')

    const result = await runAgentLoop({
      model: async messages => messages.some(message => message.role === 'tool')
        ? { content: 'Found your students.' }
        : {
            content: '',
            toolCalls: [{
              id: 'call-1',
              type: 'function',
              function: { name: 'sms.students.search', arguments: '{"query":""}' }
            }]
          },
      registry: tools as never,
      context: teacher,
      messages: [{ role: 'user', content: 'show my students' }],
      tools: descriptors
    })

    expect(result.status).toBe('completed')
    const toolMessage = result.messages.find(message => message.role === 'tool')
    expect(toolMessage?.content).toContain('Alice')
    expect(toolMessage?.content).not.toContain('Bob')
  })

  it('registers the fixed student table UI component', () => {
    const component = ui.get('sms.student-table')
    expect(component?.version).toBe('1.0')
    const extraction = extractUiDirective(
      '```ui\n{"ui":"sms.student-table","version":"1.0","presentation":{"mode":"inline"}}\n```',
      ui
    )
    expect(extraction.ui?.component).toBe('sms.student-table')
    expect(extraction.error).toBeUndefined()
  })

  it('injects tenant/organization context on generic CRUD creation', async () => {
    const meta = getRegisteredTable('students')!.meta
    const actor: DataScopeActor = {
      userId: 1,
      roleName: 'admin',
      dataScope: 'all',
      permissions: ['*'],
      organizationId,
      tenantId
    }
    const row = await insertRow(meta, {
      name: 'Created By Admin',
      studentNo: 'S100',
      classId: classB,
      // Hostile browser values must be overwritten by the server context.
      organizationId: 999999,
      tenantId: 999999
    }, actor)

    expect(row.organizationId).toBe(organizationId)
    expect(row.tenantId).toBe(tenantId)

    const audit = await pool.query(
      `SELECT module_id, resource, action FROM audit_logs WHERE record_id = $1 AND action = 'create' ORDER BY id DESC LIMIT 1`,
      [String(row.id)]
    )
    expect(audit.rows[0]).toEqual({ module_id: 'sms', resource: 'students', action: 'create' })
  })

  it('rejects cross-organization relations at the generic CRUD layer', async () => {
    const meta = getTableMeta('students')!
    const actor: DataScopeActor = {
      userId: 1,
      roleName: 'admin',
      dataScope: 'all',
      permissions: ['*'],
      organizationId,
      tenantId
    }

    await expect(assertRelationScope(meta, { classId: foreignClass }, actor))
      .rejects.toThrow('Cross-organization relation rejected for classId')
    await expect(assertRelationScope(meta, { classId: classB }, actor)).resolves.toBeUndefined()
    await expect(assertRelationScope(meta, { classId: 9_999_999 }, actor))
      .rejects.toThrow('does not exist')
  })

  it('rejects cross-organization classes and tenant spoofing on dedicated creation', async () => {
    await expect(createStudent(teacher, {
      name: 'Cross Org',
      studentNo: 'S200',
      classId: foreignClass
    })).rejects.toMatchObject({ statusCode: 400 })

    await expect(createStudent(teacher, {
      name: 'Unassigned Class',
      studentNo: 'S202',
      classId: classB
    })).rejects.toMatchObject({ statusCode: 403 })

    const created = await createStudent(teacher, {
      name: 'Teacher Student',
      studentNo: 'S201',
      classId: classA
    })
    expect(created.organizationId).toBe(organizationId)
    expect(created.tenantId).toBe(tenantId)

    const audit = await pool.query(
      `SELECT module_id, source FROM audit_logs WHERE record_id = $1 AND action = 'student.create' ORDER BY id DESC LIMIT 1`,
      [created.id]
    )
    expect(audit.rows[0]).toEqual({ module_id: 'sms', source: 'sms-api' })
  })

  it('does not require the agent module to use SMS services', async () => {
    // Searching directly (traditional page path) works without Tool Registry.
    const rows = await searchStudents(teacher)
    expect(rows.some(student => student.name === 'Teacher Student')).toBe(true)
  })
})
