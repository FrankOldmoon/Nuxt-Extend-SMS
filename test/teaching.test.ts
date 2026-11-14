import { describe, expect, it } from 'vitest'
import { ASSIGNMENT_STATUSES, normalizeAssignmentStatus } from '../server/teaching'

describe('teaching domain rules', () => {
  it('defaults assignments to draft and validates status', () => {
    expect(normalizeAssignmentStatus(undefined)).toBe('draft')
    for (const status of ASSIGNMENT_STATUSES) {
      expect(normalizeAssignmentStatus(status)).toBe(status)
    }
    expect(() => normalizeAssignmentStatus('archived')).toThrow()
  })
})
