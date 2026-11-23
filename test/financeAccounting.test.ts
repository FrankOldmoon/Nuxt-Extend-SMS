import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import { pool } from '../../../server/sdk'
import { approveRefund, recordPayment, requestRefund } from '../server/finance'
import { decideApprovalBatch } from '../server/approvalActions'
import { smsMigrations } from '../server/database/migrations'

vi.mock('../../../server/sdk', async () => {
  const { drizzle } = await import('drizzle-orm/node-postgres')
  const { Pool } = await import('pg')
  const pool = new Pool({ connectionString: process.env.SMS_FINANCE_TEST_DATABASE_URL, options: `-c search_path=${process.env.SMS_FINANCE_TEST_SCHEMA}`, connectionTimeoutMillis: 5000 })
  return { db: drizzle(pool), pool, writeAudit: vi.fn(), permMatches: () => false, ModuleForbiddenError: Error }
})
vi.mock('../server/notifications', () => ({ notifyRefundDecided: vi.fn(), notifyRefundRequested: vi.fn(), createNotifications: vi.fn(), resolvePermissionRecipients: vi.fn() }))
vi.mock('../server/students', () => ({ getStudent: vi.fn() }))
vi.mock('../server/guardians', () => ({ guardianStudentIds: vi.fn() }))
vi.mock('../server/academics', () => ({ assertTermInContext: vi.fn() }))

// Leave is unrelated to these tests; isolate its imports and business effects.
vi.mock('../server/leave', () => ({ canApproveLeave: vi.fn(), decideLeave: vi.fn() }))

const schema = process.env.SMS_FINANCE_TEST_SCHEMA!
const admin = { userId: 1, roleName: 'admin', permissions: ['*'], organizationId: 1, tenantId: 1 }
const query = (sql: string, args?: unknown[]) => pool.query(sql, args)

describe.skipIf(!process.env.SMS_FINANCE_TEST_DATABASE_URL)('explicitly configured finance database', () => {
  beforeAll(async () => {
    if (!/^sms_finance_test_\d+$/.test(schema)) throw Error('Invalid test schema')
    await query(`CREATE SCHEMA ${schema}`)
    for (const table of ['sms_invoices', 'sms_payments', 'sms_refunds', 'sms_approval_tasks']) {
      await query(`CREATE TABLE ${schema}.${table} (LIKE public.${table} INCLUDING ALL)`)
      await query(`CREATE SEQUENCE ${schema}.${table}_local_seq START 100`)
      await query(`ALTER TABLE ${schema}.${table} ALTER COLUMN id SET DEFAULT nextval('${schema}.${table}_local_seq')`)
    }
    const migration = smsMigrations.find(m => m.id === 'sms:026-refund-accounting')!
    await migration.up(pool)
    await migration.up(pool)
  })

  beforeEach(async () => {
    await query('TRUNCATE sms_approval_tasks, sms_refunds, sms_payments, sms_invoices')
    await query('INSERT INTO sms_invoices (id,organization_id,student_id,fee_item_id,amount,payable,paid,status,created_by) VALUES (1,1,1,1,300,300,300,\'paid\',1)')
    await query('INSERT INTO sms_payments (id,organization_id,invoice_id,amount,method,received_by) VALUES (1,1,1,300,\'cash\',1)')
  })

  afterAll(async () => {
    try {
      if (/^sms_finance_test_\d+$/.test(schema)) await query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`)
    } finally {
      await pool.end()
    }
  })

  async function refund(amount = 300) {
    return await requestRefund(admin, { paymentId: 1, amount, reason: '隔离测试' })
  }
  async function balance() {
    return (await query('SELECT payable,paid,credited,status FROM sms_invoices WHERE id=1')).rows[0]
  }

  describe('refund transactions in an isolated PostgreSQL schema', () => {
    it('cancels fees and finishes the approval task in one transaction', async () => {
      const row = await refund()
      await approveRefund(admin, { refundId: row.id, decision: 'approve', settlement: 'reduce_fee' })
      expect(await balance()).toEqual({ payable: '0.00', paid: '0.00', credited: '300.00', status: 'paid' })
      expect((await query('SELECT status FROM sms_approval_tasks WHERE subject_id=$1', [row.id])).rows[0].status).toBe('approved')
      expect((await query('SELECT settlement FROM sms_refunds WHERE id=$1', [row.id])).rows[0].settlement).toBe('reduce_fee')
      await expect(approveRefund(admin, { refundId: row.id, decision: 'approve', settlement: 'reduce_fee' })).rejects.toThrow('已处理')
    })

    it('does not change balances on rejection or missing settlement', async () => {
      const row = await refund(100)
      await expect(approveRefund(admin, { refundId: row.id, decision: 'approve' })).rejects.toThrow('请选择')
      await approveRefund(admin, { refundId: row.id, decision: 'reject' })
      expect(await balance()).toEqual({ payable: '300.00', paid: '300.00', credited: '0.00', status: 'paid' })
    })

    it('routes the explicit settlement through batch approval', async () => {
      const row = await refund(100)
      const result = await decideApprovalBatch(admin, { items: [{ kind: 'refund', subjectId: row.id }], decision: 'approve', refundSettlement: 'return_payment' })
      expect(result.succeeded).toBe(1)
      expect(await balance()).toEqual({ payable: '300.00', paid: '200.00', credited: '0.00', status: 'partial' })
    })

    it('rejects cumulative over-refunds even when both requests existed before approval', async () => {
      const one = await refund(200)
      const two = await refund(200)
      const results = await Promise.allSettled([one, two].map(row => approveRefund(admin, { refundId: row.id, decision: 'approve', settlement: 'reduce_fee' })))
      expect(results.filter(r => r.status === 'fulfilled')).toHaveLength(1)
      expect(results.filter(r => r.status === 'rejected')).toHaveLength(1)
      expect(await balance()).toEqual({ payable: '100.00', paid: '100.00', credited: '200.00', status: 'paid' })
    })

    it('serializes simultaneous duplicate approvals', async () => {
      const row = await refund(100)
      const results = await Promise.allSettled([1, 2].map(() => approveRefund(admin, { refundId: row.id, decision: 'approve', settlement: 'reduce_fee' })))
      expect(results.filter(r => r.status === 'fulfilled')).toHaveLength(1)
      expect(await balance()).toEqual({ payable: '200.00', paid: '200.00', credited: '100.00', status: 'paid' })
    })

    it('keeps balances and receipts consistent under simultaneous collections', async () => {
      await query('UPDATE sms_invoices SET paid=0,status=\'unpaid\'; DELETE FROM sms_payments')
      const results = await Promise.allSettled([1, 2].map(() => recordPayment(admin, { invoiceId: 1, amount: 200, method: 'cash' })))
      expect(results.filter(r => r.status === 'fulfilled')).toHaveLength(1)
      expect((await balance()).paid).toBe('200.00')
      expect((await query('SELECT sum(amount) AS total FROM sms_payments')).rows[0].total).toBe('200.00')
    })
  })
})
