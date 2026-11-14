/**
 * Finance (Slice D): fee items → invoices → payments → refunds.
 *
 * Money uses `numeric(12,2)` in PostgreSQL and numbers (rounded to cents) in
 * the service layer. Refunds are a high-risk, second-person action: they are
 * requested first and only applied when another approver agrees.
 */
import { and, desc, eq, inArray, isNull } from 'drizzle-orm'
import { createError } from 'h3'
import { db, writeAudit } from '../../../server/sdk'
import {
  smsFeeItems,
  smsInvoices,
  smsPayments,
  smsRefunds,
  smsStudents,
  smsTerms
} from './database/schema'
import { canUseSms, isSmsAdmin, requireSmsOrganization, type SmsActor } from './context'
import { getStudent } from './students'
import { guardianStudentIds } from './guardians'
import { assertTermInContext } from './academics'

export const PAYMENT_METHODS = ['cash', 'transfer', 'wechat', 'alipay', 'other'] as const
export type PaymentMethod = typeof PAYMENT_METHODS[number]

export const INVOICE_STATUSES = ['unpaid', 'partial', 'paid', 'void'] as const
export type InvoiceStatus = typeof INVOICE_STATUSES[number]

export const REFUND_STATUSES = ['pending', 'approved', 'rejected'] as const
export type RefundStatus = typeof REFUND_STATUSES[number]

const MONEY_LIMIT = 99_999_999.99

function round2(value: number): number {
  return Math.round(value * 100) / 100
}

/** Positive money amount rounded to cents. */
export function normalizeAmount(value: unknown, field: string): number {
  const amount = Number(value)
  if (!Number.isFinite(amount) || amount <= 0 || amount > MONEY_LIMIT) {
    throw createError({ statusCode: 400, message: `${field} must be between 0.01 and ${MONEY_LIMIT}` })
  }
  return round2(amount)
}

/** Non-negative money amount (discounts may be zero). */
export function normalizeNonNegativeAmount(value: unknown, field: string): number {
  const amount = Number(value)
  if (!Number.isFinite(amount) || amount < 0 || amount > MONEY_LIMIT) {
    throw createError({ statusCode: 400, message: `${field} must be between 0 and ${MONEY_LIMIT}` })
  }
  return round2(amount)
}

export function computeInvoiceStatus(payable: number, paid: number): InvoiceStatus {
  if (paid <= 0) return 'unpaid'
  if (paid >= payable) return 'paid'
  return 'partial'
}

export function normalizePaymentMethod(value: unknown): PaymentMethod {
  if (value === undefined || value === null || value === '') return 'cash'
  if (typeof value === 'string' && (PAYMENT_METHODS as readonly string[]).includes(value)) {
    return value as PaymentMethod
  }
  throw createError({ statusCode: 400, message: `method must be one of ${PAYMENT_METHODS.join(', ')}` })
}

export function normalizeInvoiceStatus(value: unknown): InvoiceStatus {
  if (typeof value === 'string' && (INVOICE_STATUSES as readonly string[]).includes(value)) {
    return value as InvoiceStatus
  }
  throw createError({ statusCode: 400, message: `status must be one of ${INVOICE_STATUSES.join(', ')}` })
}

export function normalizeRefundStatus(value: unknown): RefundStatus {
  if (typeof value === 'string' && (REFUND_STATUSES as readonly string[]).includes(value)) {
    return value as RefundStatus
  }
  throw createError({ statusCode: 400, message: `status must be one of ${REFUND_STATUSES.join(', ')}` })
}

export function normalizeDueDate(value: unknown): string | null {
  if (value === undefined || value === null || value === '') return null
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw createError({ statusCode: 400, message: 'date must be YYYY-MM-DD' })
  }
  const parsed = new Date(`${value}T00:00:00Z`)
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) {
    throw createError({ statusCode: 400, message: 'date is not a valid calendar day' })
  }
  return value
}

function positiveId(value: unknown, field: string): number {
  const id = Number(value)
  if (!Number.isSafeInteger(id) || id <= 0) {
    throw createError({ statusCode: 400, message: `${field} must be a positive integer` })
  }
  return id
}

function optionalId(value: unknown): number | null {
  if (value === undefined || value === null || value === '') return null
  const id = Number(value)
  return Number.isSafeInteger(id) && id > 0 ? id : null
}

function hasPermission(actor: SmsActor, permission: string): boolean {
  if (isSmsAdmin(actor)) return true
  return (actor.permissions ?? []).includes(permission)
}

function requireFinanceRead(actor: SmsActor): number {
  const organizationId = requireSmsOrganization(actor)
  if (!canUseSms(actor, 'read', 'finance')) {
    throw createError({ statusCode: 403, statusMessage: 'Forbidden', message: 'No permission to read finance' })
  }
  return organizationId
}

function requireFinanceWrite(actor: SmsActor): number {
  const organizationId = requireSmsOrganization(actor)
  if (!canUseSms(actor, 'update', 'finance')) {
    throw createError({ statusCode: 403, statusMessage: 'Forbidden', message: 'No permission to update finance' })
  }
  return organizationId
}

export function canApproveRefund(actor: SmsActor): boolean {
  return hasPermission(actor, 'sms.finance.refund-approve')
}

/**
 * Students and guardians only see their own / children's invoices; staff see
 * the organization. `null` means no student restriction.
 */
async function visibleStudentIds(actor: SmsActor, organizationId: number): Promise<number[] | null> {
  if (actor.roleName === 'student') {
    const [row] = await db.select({ id: smsStudents.id }).from(smsStudents)
      .where(and(
        eq(smsStudents.organizationId, organizationId),
        eq(smsStudents.userId, actor.userId),
        isNull(smsStudents.deletedAt)
      ))
      .limit(1)
    return row ? [row.id] : []
  }
  if (actor.roleName === 'guardian') return await guardianStudentIds(actor)
  return null
}

// ---------------------------------------------------------------------------
// Fee items
// ---------------------------------------------------------------------------

export async function listFeeItems(actor: SmsActor, options: { status?: unknown, limit?: unknown } = {}) {
  const organizationId = requireFinanceRead(actor)
  const conditions = [eq(smsFeeItems.organizationId, organizationId)]
  if (options.status !== undefined && options.status !== null && options.status !== '') {
    const status = String(options.status)
    if (status !== 'active' && status !== 'archived') {
      throw createError({ statusCode: 400, message: 'status must be active or archived' })
    }
    conditions.push(eq(smsFeeItems.status, status))
  }
  const limit = Math.min(Math.max(Math.floor(Number(options.limit ?? 50) || 50), 1), 200)
  const rows = await db.select({
    id: smsFeeItems.id,
    name: smsFeeItems.name,
    amount: smsFeeItems.amount,
    termId: smsFeeItems.termId,
    termName: smsTerms.name,
    gradeId: smsFeeItems.gradeId,
    dueDate: smsFeeItems.dueDate,
    status: smsFeeItems.status,
    createdAt: smsFeeItems.createdAt
  }).from(smsFeeItems)
    .leftJoin(smsTerms, eq(smsTerms.id, smsFeeItems.termId))
    .where(and(...conditions))
    .orderBy(desc(smsFeeItems.createdAt))
    .limit(limit)
  return rows.map(row => ({ ...row, amount: Number(row.amount) }))
}

export interface CreateFeeItemInput {
  name?: unknown
  amount?: unknown
  termId?: unknown
  gradeId?: unknown
  dueDate?: unknown
}

export async function createFeeItem(actor: SmsActor, input: CreateFeeItemInput) {
  const organizationId = requireFinanceWrite(actor)
  const name = typeof input.name === 'string' ? input.name.trim() : ''
  if (!name || name.length > 120) throw createError({ statusCode: 400, message: 'name must be 1-120 characters' })
  const amount = normalizeAmount(input.amount, 'amount')
  const termId = optionalId(input.termId)
  if (termId) await assertTermInContext(actor, termId)
  const gradeId = optionalId(input.gradeId)
  const dueDate = normalizeDueDate(input.dueDate)

  return await db.transaction(async (tx) => {
    const [row] = await tx.insert(smsFeeItems).values({
      organizationId,
      tenantId: actor.tenantId ?? null,
      name,
      amount: amount.toFixed(2),
      termId,
      gradeId,
      dueDate,
      status: 'active',
      createdBy: actor.userId
    }).returning()
    if (!row) throw createError({ statusCode: 500, message: 'Failed to create fee item' })
    await writeAudit(tx, {
      actorUserId: actor.userId,
      tenantId: actor.tenantId ?? undefined,
      organizationId,
      moduleId: 'sms',
      action: 'fee-item.create',
      resource: 'finance',
      recordId: row.id,
      after: row,
      source: 'sms-service'
    })
    return { ...row, amount: Number(row.amount) }
  })
}

// ---------------------------------------------------------------------------
// Invoices
// ---------------------------------------------------------------------------

export interface InvoiceListQuery {
  studentId?: unknown
  status?: unknown
  limit?: unknown
}

export async function listInvoices(actor: SmsActor, options: InvoiceListQuery = {}) {
  const organizationId = requireFinanceRead(actor)
  const conditions = [eq(smsInvoices.organizationId, organizationId)]
  const visible = await visibleStudentIds(actor, organizationId)
  if (visible) {
    conditions.push(visible.length ? inArray(smsInvoices.studentId, visible) : eq(smsInvoices.id, -1))
  }
  const studentId = optionalId(options.studentId)
  if (studentId) conditions.push(eq(smsInvoices.studentId, studentId))
  if (options.status !== undefined && options.status !== null && options.status !== '') {
    conditions.push(eq(smsInvoices.status, normalizeInvoiceStatus(options.status)))
  }
  const limit = Math.min(Math.max(Math.floor(Number(options.limit ?? 50) || 50), 1), 200)
  const rows = await db.select({
    id: smsInvoices.id,
    studentId: smsInvoices.studentId,
    studentName: smsStudents.name,
    studentNo: smsStudents.studentNo,
    feeItemId: smsInvoices.feeItemId,
    feeName: smsFeeItems.name,
    amount: smsInvoices.amount,
    discount: smsInvoices.discount,
    payable: smsInvoices.payable,
    paid: smsInvoices.paid,
    status: smsInvoices.status,
    dueDate: smsInvoices.dueDate,
    createdAt: smsInvoices.createdAt
  }).from(smsInvoices)
    .leftJoin(smsStudents, eq(smsStudents.id, smsInvoices.studentId))
    .leftJoin(smsFeeItems, eq(smsFeeItems.id, smsInvoices.feeItemId))
    .where(and(...conditions))
    .orderBy(desc(smsInvoices.createdAt))
    .limit(limit)
  return rows.map(row => ({
    ...row,
    amount: Number(row.amount),
    discount: Number(row.discount),
    payable: Number(row.payable),
    paid: Number(row.paid)
  }))
}

export interface CreateInvoiceInput {
  studentId?: unknown
  feeItemId?: unknown
  discount?: unknown
}

export async function createInvoice(actor: SmsActor, input: CreateInvoiceInput) {
  const organizationId = requireFinanceWrite(actor)
  const studentId = positiveId(input.studentId, 'studentId')
  await getStudent(actor, studentId)
  const feeItemId = positiveId(input.feeItemId, 'feeItemId')
  const [fee] = await db.select().from(smsFeeItems)
    .where(and(eq(smsFeeItems.id, feeItemId), eq(smsFeeItems.organizationId, organizationId), eq(smsFeeItems.status, 'active')))
    .limit(1)
  if (!fee) throw createError({ statusCode: 404, message: 'Fee item not found or archived' })
  const amount = Number(fee.amount)
  const discount = input.discount === undefined || input.discount === null || input.discount === ''
    ? 0
    : normalizeNonNegativeAmount(input.discount, 'discount')
  if (discount > amount) throw createError({ statusCode: 400, message: 'discount must not exceed the fee amount' })
  const payable = round2(amount - discount)

  const [duplicate] = await db.select({ id: smsInvoices.id }).from(smsInvoices)
    .where(and(
      eq(smsInvoices.organizationId, organizationId),
      eq(smsInvoices.studentId, studentId),
      eq(smsInvoices.feeItemId, feeItemId)
    ))
    .limit(1)
  if (duplicate) throw createError({ statusCode: 409, message: 'An invoice for this student and fee item already exists' })

  return await db.transaction(async (tx) => {
    const [row] = await tx.insert(smsInvoices).values({
      organizationId,
      tenantId: actor.tenantId ?? null,
      studentId,
      feeItemId,
      amount: amount.toFixed(2),
      discount: discount.toFixed(2),
      payable: payable.toFixed(2),
      paid: '0',
      status: 'unpaid',
      dueDate: fee.dueDate,
      createdBy: actor.userId
    }).returning()
    if (!row) throw createError({ statusCode: 500, message: 'Failed to create invoice' })
    await writeAudit(tx, {
      actorUserId: actor.userId,
      tenantId: actor.tenantId ?? undefined,
      organizationId,
      moduleId: 'sms',
      action: 'invoice.create',
      resource: 'finance',
      recordId: row.id,
      after: row,
      source: 'sms-service'
    })
    return {
      ...row,
      amount: Number(row.amount),
      discount: Number(row.discount),
      payable: Number(row.payable),
      paid: Number(row.paid)
    }
  })
}

// ---------------------------------------------------------------------------
// Payments
// ---------------------------------------------------------------------------

export interface RecordPaymentInput {
  invoiceId?: unknown
  amount?: unknown
  method?: unknown
  reference?: unknown
}

export async function recordPayment(actor: SmsActor, input: RecordPaymentInput) {
  const organizationId = requireFinanceWrite(actor)
  const invoiceId = positiveId(input.invoiceId, 'invoiceId')
  const amount = normalizeAmount(input.amount, 'amount')
  const method = normalizePaymentMethod(input.method)
  const reference = typeof input.reference === 'string' && input.reference.trim()
    ? input.reference.trim().slice(0, 80)
    : null

  const [invoice] = await db.select().from(smsInvoices)
    .where(and(eq(smsInvoices.id, invoiceId), eq(smsInvoices.organizationId, organizationId)))
    .limit(1)
  if (!invoice) throw createError({ statusCode: 404, message: 'Invoice not found' })
  if (invoice.status === 'void') throw createError({ statusCode: 409, message: 'Void invoices cannot receive payments' })

  const payable = Number(invoice.payable)
  const paid = Number(invoice.paid)
  const outstanding = round2(payable - paid)
  if (amount > outstanding + 0.001) {
    throw createError({ statusCode: 400, message: `amount exceeds the outstanding balance (${outstanding})` })
  }

  return await db.transaction(async (tx) => {
    const [payment] = await tx.insert(smsPayments).values({
      organizationId,
      tenantId: actor.tenantId ?? null,
      invoiceId,
      amount: amount.toFixed(2),
      method,
      reference,
      receivedBy: actor.userId
    }).returning()
    if (!payment) throw createError({ statusCode: 500, message: 'Failed to record payment' })

    const newPaid = round2(paid + amount)
    const status = computeInvoiceStatus(payable, newPaid)
    await tx.update(smsInvoices)
      .set({ paid: newPaid.toFixed(2), status, updatedAt: new Date() })
      .where(eq(smsInvoices.id, invoiceId))

    await writeAudit(tx, {
      actorUserId: actor.userId,
      tenantId: actor.tenantId ?? undefined,
      organizationId,
      moduleId: 'sms',
      action: 'payment.create',
      resource: 'finance',
      recordId: payment.id,
      after: { invoiceId, amount, method, paid: newPaid, status },
      source: 'sms-service'
    })
    return {
      paymentId: payment.id,
      invoiceId,
      amount,
      method,
      paid: newPaid,
      outstanding: round2(payable - newPaid),
      status
    }
  })
}

// ---------------------------------------------------------------------------
// Refunds
// ---------------------------------------------------------------------------

export interface RequestRefundInput {
  paymentId?: unknown
  amount?: unknown
  reason?: unknown
}

export async function requestRefund(actor: SmsActor, input: RequestRefundInput) {
  const organizationId = requireFinanceWrite(actor)
  const paymentId = positiveId(input.paymentId, 'paymentId')
  const amount = normalizeAmount(input.amount, 'amount')
  const reason = typeof input.reason === 'string' ? input.reason.trim().slice(0, 255) : null

  const [payment] = await db.select().from(smsPayments)
    .where(and(eq(smsPayments.id, paymentId), eq(smsPayments.organizationId, organizationId)))
    .limit(1)
  if (!payment) throw createError({ statusCode: 404, message: 'Payment not found' })

  const approved = await db.select({ amount: smsRefunds.amount }).from(smsRefunds)
    .where(and(
      eq(smsRefunds.organizationId, organizationId),
      eq(smsRefunds.paymentId, paymentId),
      eq(smsRefunds.status, 'approved')
    ))
  const refunded = round2(approved.reduce((sum, row) => sum + Number(row.amount), 0))
  const refundable = round2(Number(payment.amount) - refunded)
  if (amount > refundable + 0.001) {
    throw createError({ statusCode: 400, message: `amount exceeds the refundable balance (${refundable})` })
  }

  return await db.transaction(async (tx) => {
    const [row] = await tx.insert(smsRefunds).values({
      organizationId,
      tenantId: actor.tenantId ?? null,
      paymentId,
      invoiceId: payment.invoiceId,
      amount: amount.toFixed(2),
      reason,
      status: 'pending',
      requestedBy: actor.userId
    }).returning()
    if (!row) throw createError({ statusCode: 500, message: 'Failed to request refund' })
    await writeAudit(tx, {
      actorUserId: actor.userId,
      tenantId: actor.tenantId ?? undefined,
      organizationId,
      moduleId: 'sms',
      action: 'refund.request',
      resource: 'finance',
      recordId: row.id,
      after: { paymentId, invoiceId: payment.invoiceId, amount },
      source: 'sms-service'
    })
    return { id: row.id, status: 'pending', paymentId, invoiceId: payment.invoiceId, amount }
  })
}

export interface ApproveRefundInput {
  refundId?: unknown
  decision?: unknown
  comment?: unknown
}

export async function approveRefund(actor: SmsActor, input: ApproveRefundInput) {
  const organizationId = requireSmsOrganization(actor)
  if (!canApproveRefund(actor)) {
    throw createError({ statusCode: 403, statusMessage: 'Forbidden', message: 'No permission to approve refunds' })
  }
  const refundId = positiveId(input.refundId, 'refundId')
  const decision = input.decision === 'approve' || input.decision === 'reject' ? input.decision : null
  if (!decision) throw createError({ statusCode: 400, message: 'decision must be approve or reject' })

  const [refund] = await db.select().from(smsRefunds)
    .where(and(eq(smsRefunds.id, refundId), eq(smsRefunds.organizationId, organizationId)))
    .limit(1)
  if (!refund) throw createError({ statusCode: 404, message: 'Refund not found' })
  if (refund.status !== 'pending') throw createError({ statusCode: 409, message: `Refund is already ${refund.status}` })
  if (refund.requestedBy === actor.userId && !isSmsAdmin(actor)) {
    throw createError({ statusCode: 403, statusMessage: 'Forbidden', message: 'Refunds require a second approver' })
  }

  return await db.transaction(async (tx) => {
    const [updated] = await tx.update(smsRefunds)
      .set({
        status: decision === 'approve' ? 'approved' : 'rejected',
        approvedBy: actor.userId,
        approvedAt: new Date()
      })
      .where(eq(smsRefunds.id, refundId))
      .returning()
    let invoicePaid: number | null = null
    if (decision === 'approve') {
      const [invoice] = await tx.select().from(smsInvoices)
        .where(eq(smsInvoices.id, refund.invoiceId))
        .limit(1)
      if (invoice) {
        const amount = Number(refund.amount)
        const newPaid = Math.max(0, round2(Number(invoice.paid) - amount))
        const payable = Number(invoice.payable)
        await tx.update(smsInvoices)
          .set({ paid: newPaid.toFixed(2), status: computeInvoiceStatus(payable, newPaid), updatedAt: new Date() })
          .where(eq(smsInvoices.id, invoice.id))
        invoicePaid = newPaid
      }
    }
    await writeAudit(tx, {
      actorUserId: actor.userId,
      tenantId: actor.tenantId ?? undefined,
      organizationId,
      moduleId: 'sms',
      action: 'refund.approve',
      resource: 'finance',
      recordId: refundId,
      before: { status: refund.status },
      after: { status: updated?.status ?? decision, invoicePaid },
      source: 'sms-service'
    })
    return { id: refundId, status: updated?.status ?? decision, invoiceId: refund.invoiceId, invoicePaid }
  })
}

export async function listRefunds(actor: SmsActor, options: { status?: unknown, limit?: unknown } = {}) {
  const organizationId = requireFinanceRead(actor)
  const conditions = [eq(smsRefunds.organizationId, organizationId)]
  if (options.status !== undefined && options.status !== null && options.status !== '') {
    conditions.push(eq(smsRefunds.status, normalizeRefundStatus(options.status)))
  }
  const limit = Math.min(Math.max(Math.floor(Number(options.limit ?? 50) || 50), 1), 200)
  const rows = await db.select({
    id: smsRefunds.id,
    paymentId: smsRefunds.paymentId,
    invoiceId: smsRefunds.invoiceId,
    amount: smsRefunds.amount,
    reason: smsRefunds.reason,
    status: smsRefunds.status,
    requestedBy: smsRefunds.requestedBy,
    approvedBy: smsRefunds.approvedBy,
    approvedAt: smsRefunds.approvedAt,
    createdAt: smsRefunds.createdAt,
    studentName: smsStudents.name,
    studentNo: smsStudents.studentNo,
    feeName: smsFeeItems.name
  }).from(smsRefunds)
    .leftJoin(smsInvoices, eq(smsInvoices.id, smsRefunds.invoiceId))
    .leftJoin(smsStudents, eq(smsStudents.id, smsInvoices.studentId))
    .leftJoin(smsFeeItems, eq(smsFeeItems.id, smsInvoices.feeItemId))
    .where(and(...conditions))
    .orderBy(desc(smsRefunds.createdAt))
    .limit(limit)
  return rows.map(row => ({ ...row, amount: Number(row.amount) }))
}
