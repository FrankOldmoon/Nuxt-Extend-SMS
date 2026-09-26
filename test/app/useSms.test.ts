import { describe, it, expect } from 'vitest'
import {
  formatDate,
  formatDateTime,
  formatPercent,
  formatMark,
  todayISO,
  ageFrom,
  passesMark,
  relationKey
} from '../../app/composables/useSms'

describe('formatDate', () => {
  it('formats a calendar date without timezone drift', () => {
    expect(formatDate('2024-09-01', 'en-US')).toBe('Sep 1, 2024')
    expect(formatDate('2024-01-01', 'en-US')).toBe('Jan 1, 2024')
    // A real leap day must survive the round-trip validation.
    expect(formatDate('2024-02-29', 'en-US')).toBe('Feb 29, 2024')
  })

  it('degrades to an em dash for missing or malformed dates', () => {
    expect(formatDate(null)).toBe('—')
    expect(formatDate('')).toBe('—')
    expect(formatDate('not-a-date')).toBe('—')
    expect(formatDate('2024-13-01')).toBe('—')
  })
})

describe('formatDateTime', () => {
  it('formats a real instant and degrades gracefully', () => {
    const formatted = formatDateTime('2024-09-01T12:00:00Z', 'en-US')
    expect(formatted).not.toBe('—')
    expect(formatted).toContain('2024')
    expect(formatDateTime(null)).toBe('—')
    expect(formatDateTime('junk')).toBe('—')
  })
})

describe('formatPercent', () => {
  it('renders a fraction as a percentage', () => {
    expect(formatPercent(0.9134)).toBe('91.3%')
    expect(formatPercent(1)).toBe('100.0%')
  })

  it('renders an em dash when there is no rate', () => {
    expect(formatPercent(null)).toBe('—')
    expect(formatPercent(Number.NaN)).toBe('—')
  })
})

describe('formatMark', () => {
  it('rounds to two decimals', () => {
    expect(formatMark(91.333)).toBe('91.33')
    expect(formatMark(80)).toBe('80')
  })

  it('renders an em dash when nothing has been marked', () => {
    expect(formatMark(null)).toBe('—')
  })
})

describe('todayISO', () => {
  it('is a YYYY-MM-DD string', () => {
    expect(todayISO()).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  })
})

describe('ageFrom', () => {
  it('computes an age from a birthday', () => {
    const age = ageFrom('2000-01-01')
    expect(typeof age).toBe('number')
    expect(age).toBeGreaterThanOrEqual(20)
  })

  it('returns null without a usable date', () => {
    expect(ageFrom(null)).toBeNull()
    expect(ageFrom('junk')).toBeNull()
  })
})

describe('passesMark', () => {
  it('compares against the school pass mark', () => {
    expect(passesMark(60, 60)).toBe(true)
    expect(passesMark(59, 60)).toBe(false)
    expect(passesMark(50, 50)).toBe(true)
  })

  it('treats an unmarked score as not passing', () => {
    expect(passesMark(null, 60)).toBe(false)
    expect(passesMark(Number.NaN, 60)).toBe(false)
  })
})

describe('relationKey', () => {
  it('maps the stored relation to its label key', () => {
    expect(relationKey('father')).toBe('father')
    expect(relationKey('mother')).toBe('mother')
    expect(relationKey('guardian')).toBe('guardianRelation')
  })

  it('falls back to a generic key', () => {
    expect(relationKey(null)).toBe('relation')
    expect(relationKey('other')).toBe('relation')
  })
})
