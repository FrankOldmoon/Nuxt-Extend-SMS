/**
 * SMS 业务时区工具。
 *
 * 进程通常跑在 UTC，但「今天」「本周」属于学校所在时区。直接使用
 * `toISOString().slice(0, 10)` 会在上海 00:00–08:00 之间把日期算成前一天。
 * 这里统一按 `SMS_TIMEZONE`（默认 Asia/Shanghai）取日历日期。
 */

export const DEFAULT_SMS_TIMEZONE = 'Asia/Shanghai'

/** 学校所在时区；可通过 `SMS_TIMEZONE` 覆盖。 */
export function smsTimezone(): string {
  return process.env.SMS_TIMEZONE?.trim() || DEFAULT_SMS_TIMEZONE
}

export interface SmsDateParts {
  year: number
  month: number
  day: number
}

/** 按业务时区拆出年/月/日（与运行环境时区无关）。 */
export function smsDateParts(date: Date = new Date(), timeZone: string = smsTimezone()): SmsDateParts {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).formatToParts(date)
  const read = (type: Intl.DateTimeFormatPartTypes): number =>
    Number(parts.find(part => part.type === type)?.value ?? 0)
  return { year: read('year'), month: read('month'), day: read('day') }
}

/** 按业务时区输出 `YYYY-MM-DD`。 */
export function smsDateString(date: Date = new Date(), timeZone: string = smsTimezone()): string {
  const { year, month, day } = smsDateParts(date, timeZone)
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}

/** 业务时区下「今天减去 N 天」的日期。 */
export function smsDateDaysAgo(days: number, now: Date = new Date()): string {
  return smsDateString(new Date(now.getTime() - days * 24 * 60 * 60 * 1000))
}
