/**
 * Chat workbench flow (database): capability selection → preview/form draft →
 * submit → audit, plus idempotency and permission re-checks. No LLM is called.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { pool } from '../../../server/database'
import {
  registerCapabilities,
  resetCapabilityCatalog
} from '../../../server/core/capability'
import type { ChatFormUi } from '../../../server/core/conversation'
import type { AgentToolCall } from '../../../server/core/agent'
import { moduleTools } from '../../../server/utils/moduleRuntime'
import { finalizeChatResult } from '../../../server/utils/agentChatRuntime'
import { submitAgentDraft } from '../../../server/utils/agentDraftService'
import {
  createAgentConversation,
  createAgentDraft,
  startAgentExecution
} from '../../../server/utils/agentStore'
import { smsCapabilities } from '../server/capabilities'
import type { SmsActor } from '../server/context'

describe('SMS chat flow (database)', () => {
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  let tenantId = 0
  let organizationId = 0
  let otherOrganizationId = 0
  let classId = 0
  let foreignClassId = 0

  const userId = 990001
  const teacherId = 990002
  const admin: SmsActor = {
    userId,
    roleName: 'admin',
    permissions: ['*'],
    organizationId: 0,
    tenantId: 0
  }
  const teacher: SmsActor = {
    userId: teacherId,
    roleName: 'teacher',
    permissions: ['sms:read'],
    organizationId: 0,
    tenantId: 0
  }
  const recordActor = { userId, tenantId: 0, organizationId: 0 }

  beforeAll(async () => {
    resetCapabilityCatalog()
    registerCapabilities(moduleTools as never, 'sms', smsCapabilities)

    const tenant = await pool.query(
      `INSERT INTO tenants (name, slug) VALUES ('chat-itest', $1) RETURNING id`,
      [`chat-${suffix}`]
    )
    tenantId = tenant.rows[0].id
    const org = await pool.query(
      `INSERT INTO organizations (tenant_id, name, slug) VALUES ($1, 'Chat Org', $2) RETURNING id`,
      [tenantId, `chat-org-${suffix}`]
    )
    organizationId = org.rows[0].id
    admin.organizationId = organizationId
    admin.tenantId = tenantId
    teacher.organizationId = organizationId
    teacher.tenantId = tenantId
    recordActor.organizationId = organizationId
    recordActor.tenantId = tenantId

    const classes = await pool.query(
      `INSERT INTO sms_classes (organization_id, name) VALUES ($1, 'Chat A') RETURNING id`,
      [organizationId]
    )
    classId = classes.rows[0].id

    const otherOrg = await pool.query(
      `INSERT INTO organizations (tenant_id, name, slug) VALUES ($1, 'Chat Other', $2) RETURNING id`,
      [tenantId, `chat-other-${suffix}`]
    )
    otherOrganizationId = otherOrg.rows[0].id
    const foreign = await pool.query(
      `INSERT INTO sms_classes (organization_id, name) VALUES ($1, 'Foreign') RETURNING id`,
      [otherOrganizationId]
    )
    foreignClassId = foreign.rows[0].id
  }, 60000)

  afterAll(async () => {
    if (organizationId) {
      await pool.query(
        `DELETE FROM agent_messages WHERE conversation_id IN (SELECT id FROM agent_conversations WHERE organization_id = $1)`,
        [organizationId]
      )
      await pool.query('DELETE FROM agent_drafts WHERE organization_id = $1', [organizationId])
      await pool.query('DELETE FROM agent_conversations WHERE organization_id = $1', [organizationId])
      await pool.query('DELETE FROM agent_executions WHERE user_id IN ($1, $2)', [userId, teacherId])
      await pool.query('DELETE FROM sms_students WHERE organization_id = $1', [organizationId])
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

  async function openForm(studentNo: string) {
    const conversation = await createAgentConversation({ ...recordActor, title: 'flow' })
    const executionId = await startAgentExecution({
      ...recordActor,
      agentId: 'chat-test',
      metadata: { conversationId: conversation.id }
    })
    const call: AgentToolCall = {
      id: `call-${studentNo}`,
      type: 'function',
      function: {
        name: 'sms.students.create',
        arguments: JSON.stringify({ name: 'Flow Student', studentNo })
      }
    }
    const response = await finalizeChatResult({
      result: {
        status: 'pending_confirmation',
        content: '',
        pending: [call],
        messages: [{ role: 'assistant', content: '', tool_calls: [call] }],
        toolCalls: 0
      },
      conversationId: conversation.id,
      executionId,
      actor: admin,
      recordActor,
      tools: [],
      modelInfo: { modelId: null, providerId: null }
    })
    return { conversation, executionId, response }
  }

  it('turns a write capability call into a previewed form draft', async () => {
    const { response } = await openForm('FLOW-1')

    expect(response.status).toBe('pending_form')
    const ui = response.ui as ChatFormUi
    expect(ui.kind).toBe('form')
    expect(ui.capabilityId).toBe('sms.students.create')
    expect(ui.draftId).toBeGreaterThan(0)
    expect(ui.form.fields.map(field => field.key)).toEqual(['name', 'studentNo', 'classId'])
    expect(ui.form.fields.find(field => field.key === 'classId')?.options?.length).toBeGreaterThan(0)
    expect(ui.preview?.summary).toContain('Flow Student')

    // Nothing was written before the user confirmed.
    const before = await pool.query(
      `SELECT count(*)::int AS count FROM sms_students WHERE organization_id = $1 AND student_no = 'FLOW-1'`,
      [organizationId]
    )
    expect(before.rows[0].count).toBe(0)
  })

  it('executes a submitted draft exactly once and writes audit', async () => {
    const { response } = await openForm('FLOW-2')
    const ui = response.ui as ChatFormUi

    const submitted = await submitAgentDraft({
      draftId: ui.draftId,
      payload: { name: 'Flow Student', studentNo: 'FLOW-2', classId },
      actor: admin,
      recordActor
    })
    expect(submitted.status).toBe('completed')
    expect(submitted.ui?.kind).toBe('result')

    const row = await pool.query(
      `SELECT id, class_id FROM sms_students WHERE organization_id = $1 AND student_no = 'FLOW-2'`,
      [organizationId]
    )
    expect(row.rows[0]?.class_id).toBe(classId)

    const audit = await pool.query(
      `SELECT module_id, source FROM audit_logs WHERE record_id = $1 AND action = 'student.create' ORDER BY id DESC LIMIT 1`,
      [String(row.rows[0].id)]
    )
    expect(audit.rows[0]).toEqual({ module_id: 'sms', source: 'sms-api' })

    await expect(submitAgentDraft({
      draftId: ui.draftId,
      payload: { name: 'Flow Student', studentNo: 'FLOW-2' },
      actor: admin,
      recordActor
    })).rejects.toMatchObject({ statusCode: 409 })
  })

  it('rejects a draft whose capability the caller may not use', async () => {
    const conversation = await createAgentConversation({
      userId: teacherId,
      organizationId,
      tenantId
    })
    const draft = await createAgentDraft({
      conversationId: conversation.id,
      userId: teacherId,
      organizationId,
      tenantId,
      capabilityId: 'sms.students.create',
      payload: { name: 'Nope', studentNo: 'NOPE-1' }
    })

    await expect(submitAgentDraft({
      draftId: draft.id,
      actor: teacher,
      recordActor: { userId: teacherId, organizationId, tenantId }
    })).rejects.toMatchObject({ statusCode: 403 })
  })

  it('rejects cross-organization class ids before the draft is claimed', async () => {
    const { response } = await openForm('FLOW-3')
    const ui = response.ui as ChatFormUi

    await expect(submitAgentDraft({
      draftId: ui.draftId,
      payload: { name: 'Cross Org', studentNo: 'FLOW-3', classId: foreignClassId },
      actor: admin,
      recordActor
    })).rejects.toMatchObject({ statusCode: 400 })

    // The draft stays available for a corrected retry.
    const draft = await pool.query('SELECT status FROM agent_drafts WHERE id = $1', [ui.draftId])
    expect(draft.rows[0].status).toBe('draft')

    const retried = await submitAgentDraft({
      draftId: ui.draftId,
      payload: { name: 'Cross Org', studentNo: 'FLOW-3', classId },
      actor: admin,
      recordActor
    })
    expect(retried.status).toBe('completed')
  })
})
