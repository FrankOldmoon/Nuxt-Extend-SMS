import { describe, expect, it } from 'vitest'
import { formatSmsRecordValue, type SmsRecordField } from '../app/composables/useSmsRecord'

describe('chat record formatting', () => {
  it('masks sensitive fields but keeps the last two characters', () => {
    const field: SmsRecordField = { key: 'userId', label: '用户 ID', mask: true }
    expect(formatSmsRecordValue(field, 123456)).toBe('••••56')
    expect(formatSmsRecordValue(field, 7)).toBe('••••')
  })

  it('resolves select option labels and empty values', () => {
    const field: SmsRecordField = {
      key: 'classId',
      label: '班级',
      type: 'select',
      options: [{ label: '未分班', value: null }, { label: 'Grade 7 - A', value: 11 }]
    }
    expect(formatSmsRecordValue(field, 11)).toBe('Grade 7 - A')
    expect(formatSmsRecordValue(field, null)).toBe('—')
    expect(formatSmsRecordValue(field, 99)).toBe('99')
  })
})
