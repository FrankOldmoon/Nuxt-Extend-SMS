/**
 * School — send feedback.
 *
 * Any signed-in user may post; the row is always attributed to the session user
 * (never to a client-supplied id, which would let one user file a report as
 * another) and opens in the `open` state. Anonymous visitors are rejected with
 * 401 — unlike the read endpoint, there is nothing sensible to show them and
 * nothing to file without an owner.
 */
import { eq } from 'drizzle-orm'
import { db } from '../../../../../../server/database'
import * as sms from '../../../database/schema'
import { assertSignedIn, getSmsViewer } from '../../../utils/access'
import { feedbackQuery, feedbackToDTO } from '../../../utils/dto'
import { textParam } from '../../../utils/http'

const KINDS = ['bug', 'suggestion', 'other'] as const

export default defineEventHandler(async (event) => {
  const viewer = await getSmsViewer(event)
  assertSignedIn(viewer)

  const payload = (await readBody<Record<string, unknown>>(event)) ?? {}
  const title = textParam(payload.title, 300)
  if (!title) throw createError({ statusCode: 400, statusMessage: 'title is required' })

  const requested = textParam(payload.kind, 20)
  const kind = requested && (KINDS as readonly string[]).includes(requested) ? requested : 'bug'

  const [inserted] = await db
    .insert(sms.feedback)
    .values({
      userId: viewer.userId,
      kind,
      title,
      body: textParam(payload.body, 20000),
      status: 'open'
    })
    .returning({ id: sms.feedback.id })

  const [row] = await feedbackQuery().where(eq(sms.feedback.id, inserted!.id)).limit(1)
  return { feedback: feedbackToDTO(row!) }
})
