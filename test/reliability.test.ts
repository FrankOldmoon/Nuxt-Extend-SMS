import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { and, eq } from 'drizzle-orm'
import { db, pool } from '../../../server/database'
import { applyModuleMigrations } from '../../../server/database/moduleMigrations'
import { smsModule } from '../module'
import {
  deliverNotificationOutboxBatch,
  enqueueExternalNotification,
  signNotificationPayload
} from '../server/notifications'
import {
  backgroundJobBackoffMs,
  enqueueBackgroundJob,
  runBackgroundJobs
} from '../server/jobQueue'
import { smsBackgroundJobs, smsNotificationOutbox } from '../server/database/schema'

const ORG_ID = 999_001
const ENV_KEYS = [
  'SMS_NOTIFICATION_WEBHOOK_URL',
  'SMS_NOTIFICATION_WEBHOOK_SECRET',
  'SMS_NOTIFICATION_EMAIL_MODE'
] as const

const savedEnv = new Map<string, string | undefined>()

describe('SMS reliability (database)', () => {
  beforeAll(async () => {
    await applyModuleMigrations(pool, [smsModule])
    for (const key of ENV_KEYS) savedEnv.set(key, process.env[key])
    await pool.query('DELETE FROM sms_notification_outbox WHERE organization_id = $1', [ORG_ID])
    await pool.query('DELETE FROM sms_background_jobs WHERE organization_id = $1', [ORG_ID])
  }, 60_000)

  afterEach(() => {
    vi.unstubAllGlobals()
    for (const key of ENV_KEYS) {
      const value = savedEnv.get(key)
      if (value === undefined) Reflect.deleteProperty(process.env, key)
      else process.env[key] = value
    }
  })

  afterAll(async () => {
    await pool.query('DELETE FROM sms_notification_outbox WHERE organization_id = $1', [ORG_ID])
    await pool.query('DELETE FROM sms_background_jobs WHERE organization_id = $1', [ORG_ID])
  })

  it('enqueues external notifications and signs webhook deliveries', async () => {
    process.env.SMS_NOTIFICATION_WEBHOOK_URL = 'https://example.test/hook'
    process.env.SMS_NOTIFICATION_WEBHOOK_SECRET = 'top-secret'
    let signature: string | undefined
    let body: string | undefined
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init?: RequestInit) => {
      signature = (init?.headers as Record<string, string> | undefined)?.['x-sms-signature']
      body = String(init?.body ?? '')
      return new Response('ok', { status: 200 })
    }))

    await enqueueExternalNotification({
      organizationId: ORG_ID,
      recipients: [1],
      category: 'system',
      title: 'hello',
      body: 'world',
      link: null
    })

    const result = await deliverNotificationOutboxBatch(10, new Date(Date.now() + 1_000))
    expect(result.delivered).toBeGreaterThanOrEqual(1)
    expect(body).toContain('"title":"hello"')
    expect(signature).toBe(signNotificationPayload(body ?? '', 'top-secret'))
  })

  it('marks outbox rows failed after exhausting attempts', async () => {
    process.env.SMS_NOTIFICATION_WEBHOOK_URL = 'https://example.test/hook'
    vi.stubGlobal('fetch', vi.fn(async () => new Response('nope', { status: 500 })))

    await enqueueExternalNotification({
      organizationId: ORG_ID,
      recipients: [2],
      category: 'system',
      title: 'retry-me',
      body: null,
      link: null
    })
    await db.update(smsNotificationOutbox)
      .set({ maxAttempts: 1 })
      .where(eq(smsNotificationOutbox.organizationId, ORG_ID))

    const result = await deliverNotificationOutboxBatch(10, new Date(Date.now() + 2_000))
    expect(result.failed).toBeGreaterThanOrEqual(1)

    const failedRows = await db.select().from(smsNotificationOutbox)
      .where(and(
        eq(smsNotificationOutbox.organizationId, ORG_ID),
        eq(smsNotificationOutbox.status, 'failed')
      ))
    expect(failedRows.length).toBeGreaterThanOrEqual(1)
    expect(failedRows[0]?.lastError).toContain('500')
  })

  it('retries invalid background jobs then marks them failed', async () => {
    const job = await enqueueBackgroundJob('score-import', {}, ORG_ID)
    await db.update(smsBackgroundJobs)
      .set({ maxAttempts: 1 })
      .where(eq(smsBackgroundJobs.id, job.id))

    const result = await runBackgroundJobs(10, new Date(Date.now() + 1_000))
    expect(result.failed).toBeGreaterThanOrEqual(1)

    const [row] = await db.select().from(smsBackgroundJobs)
      .where(eq(smsBackgroundJobs.id, job.id))
    expect(row?.status).toBe('failed')
    expect(row?.lastError).toContain('actor snapshot')
  })

  it('backs off exponentially', () => {
    expect(backgroundJobBackoffMs(1)).toBe(30_000)
    expect(backgroundJobBackoffMs(3)).toBe(120_000)
    expect(backgroundJobBackoffMs(30)).toBe(30 * 60_000)
  })
})
