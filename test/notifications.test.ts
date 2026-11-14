import { describe, expect, it } from 'vitest'
import {
  NOTIFICATION_CATEGORIES,
  normalizeNotificationCategory,
  normalizeNotificationStatus,
  outboxBackoffMs,
  signNotificationPayload
} from '../server/notifications'
import { approvalDueAt, nextEscalationRole, APPROVAL_SLA_HOURS } from '../server/approvals'

describe('SMS notification normalisation', () => {
  it('accepts every declared category and defaults to system', () => {
    expect(normalizeNotificationCategory(undefined)).toBe('system')
    for (const category of NOTIFICATION_CATEGORIES) {
      expect(normalizeNotificationCategory(category)).toBe(category)
    }
    expect(() => normalizeNotificationCategory('spam')).toThrow()
  })

  it('normalises read status', () => {
    expect(normalizeNotificationStatus(undefined)).toBe('unread')
    expect(normalizeNotificationStatus('read')).toBe('read')
    expect(() => normalizeNotificationStatus('archived')).toThrow()
  })
})

describe('notification outbox', () => {
  it('signs webhook bodies with HMAC-SHA256', () => {
    const signature = signNotificationPayload('{"a":1}', 'secret')
    expect(signature).toMatch(/^sha256=[0-9a-f]{64}$/)
    expect(signature).toBe(signNotificationPayload('{"a":1}', 'secret'))
    expect(signature).not.toBe(signNotificationPayload('{"a":2}', 'secret'))
  })

  it('backs off exponentially and caps at one hour', () => {
    expect(outboxBackoffMs(1)).toBe(60_000)
    expect(outboxBackoffMs(2)).toBe(120_000)
    expect(outboxBackoffMs(6)).toBe(32 * 60_000)
    expect(outboxBackoffMs(20)).toBe(60 * 60_000)
  })
})

describe('SMS approval escalation ladder', () => {
  it('adds the SLA window to a timestamp', () => {
    const from = new Date('2026-01-01T00:00:00Z')
    expect(approvalDueAt(from).toISOString()).toBe('2026-01-03T00:00:00.000Z')
    expect(approvalDueAt(from, 1).toISOString()).toBe('2026-01-01T01:00:00.000Z')
    expect(APPROVAL_SLA_HOURS).toBe(48)
  })

  it('escalates homeroom to grade leader, then to school admin', () => {
    expect(nextEscalationRole('homeroom')).toBe('grade_leader')
    expect(nextEscalationRole('grade_leader')).toBe('school_admin')
    expect(nextEscalationRole(null)).toBe('school_admin')
  })
})
