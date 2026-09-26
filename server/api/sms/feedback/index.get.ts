/**
 * School — the feedback queue.
 *
 * Two audiences share this route. Staff read the whole queue and filter it by
 * status, kind or text; everyone else reads only their own submissions, which is
 * enforced by a `userId` filter rather than by post-filtering in memory. A
 * signed-out visitor gets an empty page instead of a 401 so the portal shell can
 * still render its "sign in to send feedback" state.
 */
import { and, desc, eq, ilike, isNull, or, sql } from 'drizzle-orm'
import { db } from '../../../../../../server/database'
import * as sms from '../../../database/schema'
import { getSmsViewer, isSignedIn, isStaff } from '../../../utils/access'
import { feedbackQuery, feedbackToDTO } from '../../../utils/dto'
import { likePattern, pagination, textParam } from '../../../utils/http'

export default defineEventHandler(async (event) => {
  const viewer = await getSmsViewer(event)
  const query = getQuery(event)
  const { page, pageSize, limit, offset } = pagination(query)

  if (!isSignedIn(viewer)) return { items: [], total: 0, page, pageSize }

  const conditions = [isNull(sms.feedback.deletedAt)]
  // Non-staff may only ever see their own rows; staff see the whole queue.
  if (!isStaff(viewer)) conditions.push(eq(sms.feedback.userId, viewer.userId!))

  const status = textParam(query.status, 20)
  if (status) conditions.push(eq(sms.feedback.status, status))

  const kind = textParam(query.kind, 20)
  if (kind) conditions.push(eq(sms.feedback.kind, kind))

  const q = textParam(query.q, 200)
  if (q) {
    const pattern = likePattern(q)
    conditions.push(or(
      ilike(sms.feedback.title, pattern),
      ilike(sms.feedback.body, pattern)
    )!)
  }

  const where = and(...conditions)

  const [rows, [totalRow]] = await Promise.all([
    feedbackQuery()
      .where(where)
      .orderBy(desc(sms.feedback.createdAt), desc(sms.feedback.id))
      .limit(limit)
      .offset(offset),
    db.select({ value: sql<number>`count(*)::int` }).from(sms.feedback).where(where)
  ])

  return {
    items: rows.map(feedbackToDTO),
    total: totalRow?.value ?? 0,
    page,
    pageSize
  }
})
