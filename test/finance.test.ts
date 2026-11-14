import { describe, expect, it } from 'vitest'
import {
  PAYMENT_METHODS,
  computeInvoiceStatus,
  normalizeAmount,
  normalizeDueDate,
  normalizeInvoiceStatus,
  normalizeNonNegativeAmount,
  normalizePaymentMethod,
  normalizeRefundStatus
} from '../server/finance'
import { ASSET_STATUSES, normalizeAssetStatus } from '../server/assets'
import { defaultDueDate, normalizeDueAt } from '../server/library'

describe('finance money rules', () => {
  it('normalises positive and non-negative amounts to cents', () => {
    expect(normalizeAmount('12.345', 'amount')).toBe(12.35)
    expect(() => normalizeAmount(0, 'amount')).toThrow(/amount/)
    expect(() => normalizeAmount(-1, 'amount')).toThrow(/amount/)
    expect(normalizeNonNegativeAmount(0, 'discount')).toBe(0)
    expect(() => normalizeNonNegativeAmount(-1, 'discount')).toThrow(/discount/)
  })

  it('derives invoice status from payable and paid amounts', () => {
    expect(computeInvoiceStatus(100, 0)).toBe('unpaid')
    expect(computeInvoiceStatus(100, 40)).toBe('partial')
    expect(computeInvoiceStatus(100, 100)).toBe('paid')
    expect(computeInvoiceStatus(100, 120)).toBe('paid')
  })

  it('validates payment methods, statuses and due dates', () => {
    expect(PAYMENT_METHODS).toContain('wechat')
    expect(normalizePaymentMethod(undefined)).toBe('cash')
    expect(() => normalizePaymentMethod('bitcoin')).toThrow(/method/)
    expect(normalizeInvoiceStatus('partial')).toBe('partial')
    expect(() => normalizeInvoiceStatus('closed')).toThrow(/status/)
    expect(normalizeRefundStatus('approved')).toBe('approved')
    expect(() => normalizeRefundStatus('done')).toThrow(/status/)
    expect(normalizeDueDate(undefined)).toBeNull()
    expect(() => normalizeDueDate('2026-02-30')).toThrow(/valid calendar day/)
  })
})

describe('asset and library rules', () => {
  it('validates asset statuses', () => {
    expect(ASSET_STATUSES).toContain('disposed')
    expect(normalizeAssetStatus(undefined)).toBe('idle')
    expect(normalizeAssetStatus('maintenance')).toBe('maintenance')
    expect(() => normalizeAssetStatus('lost')).toThrow(/status/)
  })

  it('defaults a loan to thirty days and rejects past due dates', () => {
    const from = new Date('2026-11-14T00:00:00Z')
    expect(defaultDueDate(from).toISOString().slice(0, 10)).toBe('2026-12-14')
    expect(normalizeDueAt('2999-01-01').toISOString().slice(0, 10)).toBe('2999-01-01')
    expect(() => normalizeDueAt('2000-01-01')).toThrow(/future/)
  })
})
