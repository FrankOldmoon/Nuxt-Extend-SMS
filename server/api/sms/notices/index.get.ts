/**
 * School — the notice board.
 *
 * Notices are time-boxed: a row that is not published yet, or whose `expiresAt`
 * has passed, must not appear on the public board. That rule is applied here
 * rather than left to the client, so the pagination total is honest. The endpoint
 * is readable anonymously — the board is part of the public site.
 */
import { and, desc, eq, gt, ilike, isNotNull, isNull, lte, or, sql } from 'drizzle-orm'
import { db } from '../../../../../../server/database'
import * as sms from '../../../database/schema'
import { noticeQuery, noticeToDTO } from '../../../utils/dto'
import { likePattern, pagination, textParam } from '../../../utils/http'

export default defineEventHandler(async (event) => {
  const query = getQuery(event)
  const { page, pageSize, limit, offset } = pagination(query)
  const now = new Date()

  const conditions = [
    isNull(sms.notices.deletedAt),
    isNotNull(sms.notices.publishedAt),
    lte(sms.notices.publishedAt, now),
    // An expiry is optional; when present the notice drops off the board once it
    // has passed.
    or(isNull(sms.notices.expiresAt), gt(sms.notices.expiresAt, now))!
  ]

  const q = textParam(query.q, 200)
  if (q) {
    const pattern = likePattern(q)
    conditions.push(or(
      ilike(sms.notices.title, pattern),
      ilike(sms.notices.body, pattern)
    )!)
  }

  const audience = textParam(query.audience, 20)
  if (audience) conditions.push(eq(sms.notices.audience, audience))

  const where = and(...conditions)

  const [rows, [totalRow]] = await Promise.all([
    noticeQuery()
      .where(where)
      .orderBy(
        desc(sms.notices.isPinned),
        sql`${sms.notices.publishedAt} desc nulls last`,
        desc(sms.notices.id)
      )
      .limit(limit)
      .offset(offset),
    db.select({ value: sql<number>`count(*)::int` }).from(sms.notices).where(where)
  ])

  return {
    items: rows.map(noticeToDTO),
    total: totalRow?.value ?? 0,
    page,
    pageSize
  }
})
