/**
 * School — the article archive.
 *
 * Unlike a notice, an article has no expiry; it is either published or a draft.
 * Drafts (`publishedAt` null, or a timestamp in the future) are visible to staff
 * only, which is why the published filter is conditional on the viewer while the
 * ordering — newest first, drafts sinking to the bottom for the staff who can see
 * them — is not. `body` is included because the archive renders it in place.
 */
import { and, desc, ilike, isNotNull, isNull, lte, or, sql } from 'drizzle-orm'
import { db } from '../../../../../../server/database'
import * as sms from '../../../database/schema'
import { getSmsViewer, isStaff } from '../../../utils/access'
import { articleQuery, articleToDTO } from '../../../utils/dto'
import { likePattern, pagination, textParam } from '../../../utils/http'

export default defineEventHandler(async (event) => {
  const viewer = await getSmsViewer(event)
  const query = getQuery(event)
  const { page, pageSize, limit, offset } = pagination(query)

  const conditions = [isNull(sms.articles.deletedAt)]

  // Anonymous visitors (and anyone who is not staff) only ever see what has been
  // published; staff also see their drafts.
  if (!isStaff(viewer)) {
    conditions.push(isNotNull(sms.articles.publishedAt), lte(sms.articles.publishedAt, new Date()))
  }

  const q = textParam(query.q, 200)
  if (q) {
    const pattern = likePattern(q)
    conditions.push(or(
      ilike(sms.articles.title, pattern),
      ilike(sms.articles.summary, pattern)
    )!)
  }

  const where = and(...conditions)

  const [rows, [totalRow]] = await Promise.all([
    articleQuery()
      .where(where)
      .orderBy(sql`${sms.articles.publishedAt} desc nulls last`, desc(sms.articles.id))
      .limit(limit)
      .offset(offset),
    db.select({ value: sql<number>`count(*)::int` }).from(sms.articles).where(where)
  ])

  return {
    items: rows.map(articleToDTO),
    total: totalRow?.value ?? 0,
    page,
    pageSize
  }
})
