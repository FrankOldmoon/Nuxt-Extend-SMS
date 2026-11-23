import { describe, expect, it } from 'vitest'
import { applyRefundAccounting, normalizeRefundSettlement } from '../server/refundAccounting'

describe('refund accounting', () => {
  it('closes a cancelled fully paid fee without recreating debt', () => {
    expect(applyRefundAccounting({ payable: 300, paid: 300, credited: 0 }, 300, 'reduce_fee'))
      .toEqual({ payable: 0, paid: 0, credited: 300, status: 'paid' })
  })
  it('preserves existing debt when only the refunded fee is waived', () => {
    const result = applyRefundAccounting({ payable: 600, paid: 300, credited: 0 }, 100, 'reduce_fee')
    expect(result).toEqual({ payable: 500, paid: 200, credited: 100, status: 'partial' })
    expect(result.payable - result.paid).toBe(300)
  })
  it('reopens debt only when explicitly returning payment without cancelling fees', () => {
    expect(applyRefundAccounting({ payable: 200, paid: 200, credited: 0 }, 100, 'return_payment'))
      .toEqual({ payable: 200, paid: 100, credited: 0, status: 'partial' })
  })
  it('handles cents and cumulative fee credits', () => {
    expect(applyRefundAccounting({ payable: 0.3, paid: 0.3, credited: 0.2 }, 0.1, 'reduce_fee'))
      .toEqual({ payable: 0.2, paid: 0.2, credited: 0.3, status: 'paid' })
  })
  it('requires an explicit choice and rejects excess or zero refunds', () => {
    expect(() => normalizeRefundSettlement(undefined)).toThrow('请选择')
    expect(() => normalizeRefundSettlement('cancel')).toThrow('请选择')
    expect(normalizeRefundSettlement('reduce_fee')).toBe('reduce_fee')
    expect(() => applyRefundAccounting({ payable: 200, paid: 50, credited: 0 }, 51, 'reduce_fee')).toThrow('余额')
    expect(() => applyRefundAccounting({ payable: 200, paid: 50, credited: 0 }, 0, 'reduce_fee')).toThrow('余额')
  })
})
