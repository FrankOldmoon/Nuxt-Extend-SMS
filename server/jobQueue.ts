/**
 * 轻量后台任务队列（P2）。
 *
 * 重任务（学生/成绩导入、日报）可以入队，由 `sms:job-worker` 定时消费。
 * 队列只依赖 PostgreSQL，不引入额外中间件；失败按指数退避重试。
 */
import { and, asc, eq, lte } from 'drizzle-orm'
import { createError } from 'h3'
import { db } from '../../../server/sdk'
import { smsBackgroundJobs } from './database/schema'
import type { SmsActor } from './context'

export const BACKGROUND_JOB_KINDS = ['student-import', 'score-import', 'daily-report'] as const
export type BackgroundJobKind = typeof BACKGROUND_JOB_KINDS[number]

export function isBackgroundJobKind(value: unknown): value is BackgroundJobKind {
  return typeof value === 'string' && (BACKGROUND_JOB_KINDS as readonly string[]).includes(value)
}

/** 入队所需的 actor 快照；worker 以当时的权限执行并继续做组织校验。 */
export interface QueuedActor {
  userId: number
  roleName?: string | null
  permissions?: string[]
  organizationId?: number | null
  tenantId?: number | null
}

export function snapshotActor(actor: SmsActor): QueuedActor {
  return {
    userId: actor.userId,
    roleName: actor.roleName ?? null,
    permissions: actor.permissions ? [...actor.permissions] : [],
    organizationId: actor.organizationId ?? null,
    tenantId: actor.tenantId ?? null
  }
}

export async function enqueueBackgroundJob(
  kind: BackgroundJobKind,
  payload: Record<string, unknown>,
  organizationId?: number | null
): Promise<{ id: number }> {
  const [row] = await db.insert(smsBackgroundJobs).values({
    kind,
    payload,
    organizationId: organizationId ?? null,
    status: 'pending'
  }).returning({ id: smsBackgroundJobs.id })
  if (!row) throw createError({ statusCode: 500, message: 'Failed to enqueue background job' })
  return row
}

export function backgroundJobBackoffMs(attempts: number): number {
  return Math.min(30 * 60_000, 30_000 * 2 ** Math.max(0, attempts - 1))
}

async function executeJob(kind: string, payload: Record<string, unknown>): Promise<Record<string, unknown>> {
  if (kind === 'daily-report') {
    const { runDailyReport } = await import('./reportDaily')
    const result = await runDailyReport(payload.date)
    return { ...result }
  }
  if (kind === 'student-import' || kind === 'score-import') {
    const actor = payload.actor as SmsActor | undefined
    const input = (payload.input ?? {}) as Record<string, unknown>
    if (!actor || !Number.isSafeInteger(actor.userId)) {
      throw new Error('job payload is missing a valid actor snapshot')
    }
    const imports = await import('./imports')
    const result = kind === 'student-import'
      ? await imports.importStudentsCsv(actor, input)
      : await imports.importScoresCsv(actor, input)
    return { ...result, errorsCsv: undefined }
  }
  throw new Error(`Unsupported background job kind: ${kind}`)
}

/** 消费一批到期任务；单条失败不会阻塞后续任务。 */
export async function runBackgroundJobs(
  limit = 10,
  now: Date = new Date()
): Promise<{ attempted: number, succeeded: number, retried: number, failed: number }> {
  const rows = await db.select().from(smsBackgroundJobs)
    .where(and(
      eq(smsBackgroundJobs.status, 'pending'),
      lte(smsBackgroundJobs.nextAttemptAt, now)
    ))
    .orderBy(asc(smsBackgroundJobs.nextAttemptAt))
    .limit(limit)

  let succeeded = 0
  let retried = 0
  let failed = 0
  for (const row of rows) {
    const attempts = row.attempts + 1
    await db.update(smsBackgroundJobs)
      .set({ status: 'running', attempts })
      .where(eq(smsBackgroundJobs.id, row.id))
    try {
      const result = await executeJob(row.kind, row.payload)
      await db.update(smsBackgroundJobs)
        .set({ status: 'succeeded', result, lastError: null, finishedAt: now })
        .where(eq(smsBackgroundJobs.id, row.id))
      succeeded += 1
    } catch (error) {
      const message = (error instanceof Error ? error.message : String(error)).slice(0, 500)
      const exhausted = attempts >= row.maxAttempts
      await db.update(smsBackgroundJobs)
        .set({
          status: exhausted ? 'failed' : 'pending',
          lastError: message,
          nextAttemptAt: new Date(now.getTime() + backgroundJobBackoffMs(attempts)),
          finishedAt: exhausted ? now : null
        })
        .where(eq(smsBackgroundJobs.id, row.id))
      if (exhausted) failed += 1
      else retried += 1
    }
  }
  return { attempted: rows.length, succeeded, retried, failed }
}
