import { describe, expect, it } from 'vitest'
import {
  KNOWLEDGE_AUDIENCES,
  knowledgeAudiencesFor,
  normalizeKnowledgeAudience,
  normalizeKnowledgeStatus
} from '../server/knowledge'

describe('SMS knowledge base rules', () => {
  it('limits students and guardians to public plus their own audience', () => {
    expect(knowledgeAudiencesFor('student')).toEqual(['all', 'student'])
    expect(knowledgeAudiencesFor('guardian')).toEqual(['all', 'guardian'])
    expect(knowledgeAudiencesFor('teacher')).toEqual(['all', 'staff'])
    expect(knowledgeAudiencesFor(null)).toEqual(['all', 'staff'])
  })

  it('normalises audience and status values', () => {
    expect(normalizeKnowledgeAudience(undefined)).toBe('all')
    for (const audience of KNOWLEDGE_AUDIENCES) {
      expect(normalizeKnowledgeAudience(audience)).toBe(audience)
    }
    expect(() => normalizeKnowledgeAudience('alumni')).toThrow()

    expect(normalizeKnowledgeStatus(undefined)).toBe('published')
    expect(normalizeKnowledgeStatus('draft')).toBe('draft')
    expect(() => normalizeKnowledgeStatus('archived')).toThrow()
  })
})
