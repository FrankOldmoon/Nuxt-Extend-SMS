import { describe, expect, it } from 'vitest'
import {
  EXAM_TYPES,
  computeAverage,
  normalizeExamDate,
  normalizeExamStatus,
  normalizeExamType,
  normalizeFullScore,
  normalizeScoreEntries,
  normalizeScoreValue
} from '../server/exams'

describe('exam normalisation', () => {
  it('accepts a plain calendar day and rejects impossible dates', () => {
    expect(normalizeExamDate('2026-11-14')).toBe('2026-11-14')
    expect(() => normalizeExamDate('2026-11-31')).toThrow(/valid calendar day/)
    expect(() => normalizeExamDate('14/11/2026')).toThrow(/YYYY-MM-DD/)
  })

  it('defaults the exam type and validates status', () => {
    expect(EXAM_TYPES).toContain('midterm')
    expect(normalizeExamType(undefined)).toBe('regular')
    expect(normalizeExamType('final')).toBe('final')
    expect(() => normalizeExamType('pop')).toThrow(/examType/)
    expect(normalizeExamStatus('published')).toBe('published')
    expect(() => normalizeExamStatus('done')).toThrow(/status must be one of/)
  })

  it('bounds the full score and per-student scores', () => {
    expect(normalizeFullScore(undefined)).toBe(100)
    expect(normalizeFullScore('150')).toBe(150)
    expect(() => normalizeFullScore(0)).toThrow(/fullScore/)
    expect(() => normalizeFullScore(2000)).toThrow(/fullScore/)

    expect(normalizeScoreValue('88.5', 100)).toBe(88.5)
    expect(normalizeScoreValue('', 100)).toBeNull()
    expect(() => normalizeScoreValue(120, 100)).toThrow(/between 0 and 100/)
    expect(normalizeScoreValue(120, 100, true)).toBeNull()
  })
})

describe('score entries', () => {
  it('normalises absent rows and trims remarks', () => {
    expect(normalizeScoreEntries([
      { studentId: 1, score: 90, remark: '  稳定  ' },
      { studentId: 2, absent: true, score: 70 }
    ], 100)).toEqual([
      { studentId: 1, score: 90, absent: false, remark: '稳定' },
      { studentId: 2, score: null, absent: true, remark: null }
    ])
  })

  it('rejects empty batches, duplicates and out-of-range scores', () => {
    expect(() => normalizeScoreEntries([], 100)).toThrow(/non-empty/)
    expect(() => normalizeScoreEntries([
      { studentId: 1, score: 10 },
      { studentId: 1, score: 20 }
    ], 100)).toThrow(/duplicates/)
    expect(() => normalizeScoreEntries([{ studentId: 1, score: 101 }], 100)).toThrow(/between 0 and 100/)
  })
})

describe('report-card averages', () => {
  it('averages recorded scores and ignores absent rows', () => {
    expect(computeAverage([
      { score: 90 },
      { score: 80 },
      { score: null, absent: true }
    ])).toBe(85)
    expect(computeAverage([])).toBe(0)
  })
})
