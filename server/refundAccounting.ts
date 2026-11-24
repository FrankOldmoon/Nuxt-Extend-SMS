import { createError } from 'h3'

export const REFUND_SETTLEMENTS = ['reduce_fee', 'return_payment'] as const
export type RefundSettlement = typeof REFUND_SETTLEMENTS[number]

export function normalizeRefundSettlement(value: unknown): RefundSettlement {
  if (value === 'reduce_fee' || value === 'return_payment') return value
  throw createError({ statusCode: 400, message: '请选择退费账务处理：取消/减免费用，或仅退回款项（费用仍需缴纳）' })
}

/** Amounts are converted to integer cents before adjusting either side of the ledger. */
export function applyRefundAccounting(invoice: { payable: number, paid: number, credited: number }, amount: number, settlement: RefundSettlement) {
  const cents = (value: number) => Math.round(value * 100)
  const refund = cents(amount)
  const payable = cents(invoice.payable)
  const paid = cents(invoice.paid)
  if (!Number.isFinite(refund) || refund <= 0 || refund > paid) {
    throw createError({ statusCode: 409, message: '退款金额超过账单当前已缴余额' })
  }
  if (settlement === 'reduce_fee' && refund > payable) {
    throw createError({ statusCode: 409, message: '减免费用不得超过当前应收金额' })
  }
  const nextPayable = payable - (settlement === 'reduce_fee' ? refund : 0)
  const nextPaid = paid - refund
  return {
    payable: nextPayable / 100,
    paid: nextPaid / 100,
    credited: (cents(invoice.credited) + (settlement === 'reduce_fee' ? refund : 0)) / 100,
    status: nextPaid >= nextPayable ? 'paid' : nextPaid <= 0 ? 'unpaid' : 'partial'
  }
}
