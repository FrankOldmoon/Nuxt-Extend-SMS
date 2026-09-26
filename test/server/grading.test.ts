import { describe, it, expect } from 'vitest'
import {
  percentOf,
  validateWeights,
  courseTotal,
  letterGrade,
  gradePoint,
  rankStudents,
  overallAverage,
  reportCardSummary
} from '../../server/utils/grading'

describe('percentOf', () => {
  it('normalises a mark to a percentage', () => {
    expect(percentOf(15, 20)).toBe(75)
    expect(percentOf(150, 150)).toBe(100)
  })

  it('treats "not marked" as null, not zero', () => {
    expect(percentOf(null, 100)).toBeNull()
    expect(percentOf(undefined, 100)).toBeNull()
    expect(percentOf(Number.NaN, 100)).toBeNull()
  })

  it('returns null for a nonsensical maximum', () => {
    expect(percentOf(50, 0)).toBeNull()
    expect(percentOf(50, -10)).toBeNull()
    expect(percentOf(50, Number.NaN)).toBeNull()
  })

  it('clamps to 0–100 so a bonus or a typo cannot exceed the range', () => {
    expect(percentOf(-5, 100)).toBe(0)
    expect(percentOf(120, 100)).toBe(100)
  })
})

describe('validateWeights', () => {
  it('accepts weights that add up to 100', () => {
    expect(validateWeights([{ weight: 60 }, { weight: 40 }])).toEqual({ sum: 100, valid: true })
  })

  it('flags weights that do not add up to 100', () => {
    expect(validateWeights([{ weight: 50 }, { weight: 40 }])).toEqual({ sum: 90, valid: false })
    expect(validateWeights([{ weight: 50 }, { weight: 60 }])).toEqual({ sum: 110, valid: false })
  })

  it('sums an empty scheme to zero and calls it invalid', () => {
    expect(validateWeights([])).toEqual({ sum: 0, valid: false })
  })
})

describe('courseTotal', () => {
  const assessments = [
    { id: 1, weight: 40, maxScore: 100 },
    { id: 2, weight: 60, maxScore: 100 }
  ]

  it('weights each mark and excludes unmarked assessments from the denominator', () => {
    const total = courseTotal(assessments, [
      { assessmentId: 1, score: 80 },
      { assessmentId: 2, score: null }
    ])
    expect(total.total).toBe(80)
    expect(total.coverage).toBe(0.4)
    expect(total.marked).toBe(1)
    expect(total.missing).toBe(1)
    expect(total.weightsValid).toBe(true)
  })

  it('normalises marks out of different maximums before weighting', () => {
    const total = courseTotal(
      [{ id: 1, weight: 50, maxScore: 20 }, { id: 2, weight: 50, maxScore: 100 }],
      [{ assessmentId: 1, score: 10 }, { assessmentId: 2, score: 90 }]
    )
    expect(total.total).toBe(70)
    expect(total.coverage).toBe(1)
  })

  it('reports no total (not zero) when nothing has been marked', () => {
    const total = courseTotal(assessments, [
      { assessmentId: 1, score: null },
      { assessmentId: 2, score: null }
    ])
    expect(total.total).toBeNull()
    expect(total.coverage).toBe(0)
    expect(total.marked).toBe(0)
    expect(total.missing).toBe(2)
  })

  it('carries the weight validation through', () => {
    const total = courseTotal([{ id: 1, weight: 50, maxScore: 100 }], [{ assessmentId: 1, score: 90 }])
    expect(total.weightsValid).toBe(false)
    expect(total.weightSum).toBe(50)
  })
})

describe('letterGrade', () => {
  it('maps bands with the default (60) pass mark', () => {
    expect(letterGrade(95)).toBe('A')
    expect(letterGrade(85)).toBe('B')
    expect(letterGrade(75)).toBe('C')
    expect(letterGrade(65)).toBe('D')
    expect(letterGrade(55)).toBe('F')
  })

  it('moves the D/F floor with the configured pass mark', () => {
    expect(letterGrade(55, 50)).toBe('D')
    expect(letterGrade(45, 50)).toBe('F')
  })

  it('returns null when there is nothing to grade', () => {
    expect(letterGrade(null)).toBeNull()
    expect(letterGrade(Number.NaN)).toBeNull()
  })
})

describe('gradePoint', () => {
  it('maps a letter to the 4.0 scale', () => {
    expect(gradePoint(95)).toBe(4)
    expect(gradePoint(85)).toBe(3)
    expect(gradePoint(75)).toBe(2)
    expect(gradePoint(65)).toBe(1)
    expect(gradePoint(30)).toBe(0)
  })

  it('returns null when there is no mark', () => {
    expect(gradePoint(null)).toBeNull()
  })
})

describe('rankStudents', () => {
  it('uses competition ranking and leaves unmarked students unranked', () => {
    const ranks = rankStudents([
      { studentId: 1, total: 90 },
      { studentId: 2, total: 80 },
      { studentId: 3, total: 80 },
      { studentId: 4, total: 70 },
      { studentId: 5, total: null }
    ])
    expect(ranks.get(1)).toBe(1)
    expect(ranks.get(2)).toBe(2)
    expect(ranks.get(3)).toBe(2)
    expect(ranks.get(4)).toBe(4)
    expect(ranks.get(5)).toBeNull()
  })
})

describe('overallAverage', () => {
  it('averages course totals', () => {
    expect(overallAverage([{ total: 80, credits: 1 }, { total: 90, credits: 1 }])).toBe(85)
  })

  it('weights by credits', () => {
    expect(overallAverage([{ total: 80, credits: 2 }, { total: 90, credits: 1 }])).toBe(83.33)
  })

  it('skips unmarked courses rather than pulling the average down', () => {
    expect(overallAverage([{ total: 80, credits: 1 }, { total: null, credits: 1 }])).toBe(80)
    expect(overallAverage([{ total: null, credits: 1 }])).toBeNull()
  })
})

describe('reportCardSummary', () => {
  it('summarises passes, fails, best/worst and conduct points', () => {
    const summary = reportCardSummary(
      [
        { courseId: 1, total: 80, credits: 1 },
        { courseId: 2, total: 50, credits: 1 }
      ],
      [{ kind: 'merit', points: 3 }, { kind: 'demerit', points: 2 }],
      60
    )
    expect(summary.average).toBe(65)
    expect(summary.courses).toBe(2)
    expect(summary.passed).toBe(1)
    expect(summary.failed).toBe(1)
    expect(summary.best).toEqual({ courseId: 1, total: 80 })
    expect(summary.worst).toEqual({ courseId: 2, total: 50 })
    expect(summary.merits).toBe(3)
    expect(summary.demerits).toBe(2)
  })

  it('ignores unmarked courses for the pass/fail counts', () => {
    const summary = reportCardSummary([{ courseId: 1, total: null, credits: 1 }], [], 60)
    expect(summary.courses).toBe(0)
    expect(summary.average).toBeNull()
    expect(summary.best).toBeNull()
  })
})
