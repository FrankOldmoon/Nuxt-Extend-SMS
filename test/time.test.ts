import { afterEach, describe, expect, it } from 'vitest'
import { DEFAULT_SMS_TIMEZONE, smsDateDaysAgo, smsDateParts, smsDateString, smsTimezone } from '../server/time'

const ORIGINAL = process.env.SMS_TIMEZONE

afterEach(() => {
  if (ORIGINAL === undefined) delete process.env.SMS_TIMEZONE
  else process.env.SMS_TIMEZONE = ORIGINAL
})

describe('smsTimezone', () => {
  it('defaults to Asia/Shanghai', () => {
    delete process.env.SMS_TIMEZONE
    expect(smsTimezone()).toBe(DEFAULT_SMS_TIMEZONE)
  })

  it('honours SMS_TIMEZONE', () => {
    process.env.SMS_TIMEZONE = 'America/New_York'
    expect(smsTimezone()).toBe('America/New_York')
  })
})

describe('smsDateString', () => {
  it('rolls over at Shanghai midnight instead of UTC midnight', () => {
    // 2026-11-14T16:30:00Z = 2026-11-15 00:30 in Shanghai.
    expect(smsDateString(new Date('2026-11-14T16:30:00Z'))).toBe('2026-11-15')
    // 2026-11-14T15:59:00Z = 2026-11-14 23:59 in Shanghai.
    expect(smsDateString(new Date('2026-11-14T15:59:00Z'))).toBe('2026-11-14')
  })

  it('works with an explicit timezone', () => {
    const at = new Date('2026-11-14T16:30:00Z')
    expect(smsDateString(at, 'UTC')).toBe('2026-11-14')
    expect(smsDateString(at, 'America/New_York')).toBe('2026-11-14')
  })

  it('returns numeric date parts', () => {
    expect(smsDateParts(new Date('2026-01-02T04:00:00Z'))).toEqual({ year: 2026, month: 1, day: 2 })
  })
})

describe('smsDateDaysAgo', () => {
  it('subtracts calendar days in the school timezone', () => {
    expect(smsDateDaysAgo(1, new Date('2026-11-15T00:30:00+08:00'))).toBe('2026-11-14')
    expect(smsDateDaysAgo(90, new Date('2026-11-15T00:30:00+08:00'))).toBe('2026-08-17')
  })
})
