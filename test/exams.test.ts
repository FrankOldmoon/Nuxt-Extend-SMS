import { describe, expect, it } from 'vitest'
import {
  EXAM_TYPES,
  computeAverage,
  detectExamSessionConflicts,
  normalizeExamDate,
  normalizeExamStatus,
  normalizeExamType,
  normalizeFullScore,
  normalizeScoreEntries,
  normalizeScoreValue,
  normalizeSessionTime
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

describe('exam session conflicts', () => {
  const at = (value: string) => new Date(value)

  it('parses ISO timestamps and rejects invalid input', () => {
    expect(normalizeSessionTime('2026-06-20T09:00:00.000Z', 'startsAt').toISOString())
      .toBe('2026-06-20T09:00:00.000Z')
    expect(() => normalizeSessionTime('', 'startsAt')).toThrow(/不能为空/)
    expect(() => normalizeSessionTime('not-a-date', 'startsAt')).toThrow(/不是合法时间/)
  })

  it('detects overlapping exam, room and invigilator slots', () => {
    const existing = [{
      id: 1,
      examId: 10,
      room: 'A101',
      startsAt: at('2026-06-20T09:00:00Z'),
      endsAt: at('2026-06-20T11:00:00Z'),
      invigilatorUserId: 7,
      assistantInvigilatorUserId: 8 as number | null
    }]
    const candidate = {
      examId: 10,
      room: 'A101',
      startsAt: at('2026-06-20T10:00:00Z'),
      endsAt: at('2026-06-20T12:00:00Z'),
      invigilatorUserId: 9 as number,
      assistantInvigilatorUserId: 8 as number | null
    }
    expect(detectExamSessionConflicts(existing, candidate).map(item => item.type).sort())
      .toEqual(['exam', 'invigilator', 'room'])
  })

  it('treats back-to-back sessions as free and ignores itself', () => {
    const existing = [{
      id: 1,
      examId: 10,
      room: 'A101',
      startsAt: at('2026-06-20T09:00:00Z'),
      endsAt: at('2026-06-20T11:00:00Z'),
      invigilatorUserId: 7,
      assistantInvigilatorUserId: null
    }]
    expect(detectExamSessionConflicts(existing, {
      examId: 11,
      room: 'A101',
      startsAt: at('2026-06-20T11:00:00Z'),
      endsAt: at('2026-06-20T12:00:00Z'),
      invigilatorUserId: 7,
      assistantInvigilatorUserId: null
    })).toEqual([])
    expect(detectExamSessionConflicts(existing, {
      id: 1,
      examId: 10,
      room: 'A101',
      startsAt: at('2026-06-20T09:30:00Z'),
      endsAt: at('2026-06-20T10:30:00Z'),
      invigilatorUserId: 7,
      assistantInvigilatorUserId: null
    })).toEqual([])
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
