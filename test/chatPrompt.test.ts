import { describe, expect, it } from 'vitest'
import { buildSmsChatPrompt } from '../server/chatPrompt'
import { SMS_ROLE_PRESETS } from '../server/roles'
import type { SmsActor } from '../server/context'

function actorFor(code: string, roleName: string): SmsActor {
  const preset = SMS_ROLE_PRESETS.find(item => item.code === code)
  if (!preset) throw new Error(`Missing preset ${code}`)
  return {
    userId: 1,
    organizationId: 1,
    tenantId: null,
    roleName,
    permissions: preset.permissions
  }
}

describe('dynamic SMS chat prompt', () => {
  it('lists the writes a student can actually perform', () => {
    const prompt = buildSmsChatPrompt(actorFor('sms.student', 'student'))
    expect(prompt).toContain('sms.assignments.submit')
    expect(prompt).toContain('sms.elections.update')
    expect(prompt).toContain('sms.leave.apply')
    // 学生不应看到管理员写能力。
    expect(prompt).not.toContain('sms.students.delete')
    expect(prompt).not.toContain('sms.scores.publish')
  })

  it('keeps manager capabilities out of the guardian prompt', () => {
    const prompt = buildSmsChatPrompt(actorFor('sms.guardian', 'guardian'))
    expect(prompt).toContain('sms.leave.apply')
    expect(prompt).not.toContain('sms.knowledge.update')
    expect(prompt).not.toContain('sms.audit.query')
  })

  it('falls back to a capability-free prompt without an actor', () => {
    const prompt = buildSmsChatPrompt(undefined)
    expect(prompt).toContain('可用只读能力')
    expect(prompt).toContain('（无）')
  })
})
