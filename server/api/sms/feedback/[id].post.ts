/**
 * School — handle one feedback item.
 *
 * Staff move a report through `open` / `in_progress` / `closed` and may leave a
 * reply; doing so stamps who handled it and when, so the queue answers "who is
 * dealing with this". The owner of a report may read their own item here (the
 * detail view uses this route), but only read: the moment they could edit the
 * status they could also close their own bug.
 */
import { and, eq, isNull } from 'drizzle-orm'
import { db } from '../../../../../../server/database'
import * as sms from '../../../database/schema'
import { assertSignedIn, getSmsViewer, isStaff } from '../../../utils/access'
import { feedbackQuery, feedbackToDTO } from '../../../utils/dto'
import { intParam, textParam } from '../../../utils/http'

const STATUSES = ['open', 'in_progress', 'closed'] as const

export default defineEventHandler(async (event) => {
  const viewer = await getSmsViewer(event)
  assertSignedIn(viewer)

  const id = intParam(getRouterParam(event, 'id'))
  if (id == null) throw createError({ statusCode: 404, statusMessage: 'Feedback not found' })

  const [row] = await feedbackQuery()
    .where(and(eq(sms.feedback.id, id), isNull(sms.feedback.deletedAt)))
    .limit(1)
  if (!row) throw createError({ statusCode: 404, statusMessage: 'Feedback not found' })
  const current = feedbackToDTO(row)

  if (!isStaff(viewer)) {
    // A non-staff caller may only read their own item, and only read it.
    if (current.userId !== viewer.userId) {
      throw createError({ statusCode: 403, statusMessage: 'Forbidden' })
    }
    return { feedback: current }
  }

  const payload = (await readBody<Record<string, unknown>>(event)) ?? {}
  const requested = textParam(payload.status, 20)
  const status = requested && (STATUSES as readonly string[]).includes(requested) ? requested : null
  const hasReply = payload.reply !== undefined

  if (status != null || hasReply) {
    await db
      .update(sms.feedback)
      .set({
        status: status ?? current.status,
        reply: hasReply ? textParam(payload.reply, 20000) : current.reply,
        handledBy: viewer.userId,
        handledAt: new Date(),
        updatedAt: new Date()
      })
      .where(eq(sms.feedback.id, id))
  }

  const [updated] = await feedbackQuery().where(eq(sms.feedback.id, id)).limit(1)
  return { feedback: feedbackToDTO(updated!) }
})
