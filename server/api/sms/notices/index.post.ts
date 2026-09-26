/**
 * School — publish a notice.
 *
 * Staff-only. A notice without a `publishedAt` is a draft, so the default is now:
 * a teacher who writes an announcement means to post it. An administrator who
 * wants to schedule one can pass an explicit timestamp (or edit the row in the
 * back office).
 */
import { eq } from 'drizzle-orm'
import { db } from '../../../../../../server/database'
import * as sms from '../../../database/schema'
import { assertStaff, getSmsViewer } from '../../../utils/access'
import { noticeQuery, noticeToDTO } from '../../../utils/dto'
import { boolParam, textParam } from '../../../utils/http'

const AUDIENCES = ['all', 'teachers', 'students', 'guardians'] as const

function timestampParam(value: unknown): Date | null {
  const raw = String(value ?? '').trim()
  if (!raw) return null
  const date = new Date(raw)
  return Number.isNaN(date.getTime()) ? null : date
}

export default defineEventHandler(async (event) => {
  const viewer = await getSmsViewer(event)
  assertStaff(viewer)

  const body = (await readBody<Record<string, unknown>>(event)) ?? {}

  const title = textParam(body.title, 300)
  if (!title) throw createError({ statusCode: 400, statusMessage: 'title is required' })

  const requested = textParam(body.audience, 20)
  const audience = requested && (AUDIENCES as readonly string[]).includes(requested)
    ? requested
    : 'all'

  const [inserted] = await db
    .insert(sms.notices)
    .values({
      title,
      body: textParam(body.body, 20000),
      audience,
      isPinned: boolParam(body.isPinned),
      publishedAt: timestampParam(body.publishedAt) ?? new Date(),
      expiresAt: timestampParam(body.expiresAt),
      authorId: viewer.userId
    })
    .returning({ id: sms.notices.id })

  const [row] = await noticeQuery().where(eq(sms.notices.id, inserted!.id)).limit(1)
  return { notice: noticeToDTO(row!) }
})
