import { describe, expect, it } from 'vitest'
import {
  AGENT_TASK_EVENTS,
  AGENT_TASK_STATUSES,
  nextAgentTaskStatus,
  normalizeAgentTaskStatus
} from '../server/agentTasks'
import { SMS_GOLDEN_CASES, scoreSelection } from '../server/evaluation'
import { smsCapabilities } from '../server/capabilities'

describe('agent task state machine', () => {
  it('walks the happy path and rejects illegal transitions', () => {
    expect(nextAgentTaskStatus('pending', 'start')).toBe('running')
    expect(nextAgentTaskStatus('running', 'wait')).toBe('waiting_approval')
    expect(nextAgentTaskStatus('waiting_approval', 'resume')).toBe('running')
    expect(nextAgentTaskStatus('running', 'complete')).toBe('done')
    expect(nextAgentTaskStatus('done', 'start')).toBeNull()
    expect(nextAgentTaskStatus('cancelled', 'resume')).toBeNull()
    expect(nextAgentTaskStatus('pending', 'complete')).toBeNull()
    expect(nextAgentTaskStatus('failed', 'retry')).toBe('pending')
  })

  it('normalises task status filters', () => {
    expect(normalizeAgentTaskStatus(undefined)).toBe('all')
    for (const status of AGENT_TASK_STATUSES) {
      expect(normalizeAgentTaskStatus(status)).toBe(status)
    }
    expect(() => normalizeAgentTaskStatus('paused')).toThrow()
  })

  it('declares only supported events', () => {
    expect(AGENT_TASK_EVENTS).toEqual(['start', 'wait', 'resume', 'complete', 'fail', 'cancel', 'retry'])
  })
})

describe('capability selection golden set', () => {
  it('covers 30 representative prompts', () => {
    expect(SMS_GOLDEN_CASES).toHaveLength(30)
    expect(new Set(SMS_GOLDEN_CASES.map(item => item.id)).size).toBe(SMS_GOLDEN_CASES.length)
  })

  it('maps every golden prompt to existing capabilities', () => {
    const byId = new Map(smsCapabilities.map(capability => [capability.id, capability]))
    for (const golden of SMS_GOLDEN_CASES) {
      expect(golden.expected.length).toBeGreaterThan(0)
      for (const id of golden.expected) {
        const capability = byId.get(id)
        expect(capability, `missing capability ${id}`).toBeTruthy()
        if (capability?.operation === 'command') {
          expect(capability.preview, `${id} must expose a preview`).toBeTypeOf('function')
        }
      }
      const score = scoreSelection(golden.expected, golden.expected)
      expect(score).toMatchObject({ hit: golden.expected.length, miss: 0, extra: 0, precision: 1, recall: 1 })
    }
  })

  it('penalises misses and extras', () => {
    const score = scoreSelection(['a', 'b'], ['a', 'c', 'd'])
    expect(score).toMatchObject({ hit: 1, miss: 1, extra: 2 })
    expect(score.precision).toBeCloseTo(1 / 3)
    expect(score.recall).toBeCloseTo(1 / 2)
  })
})
