/**
 * School — the activities list.
 *
 * Two readings of the same table: the archive (most recent first) and the
 * "what's on" view (`?upcoming=1`, soonest first, past events dropped). Doing
 * both here keeps one ordering rule per use instead of pushing a filter the
 * database can answer into the browser.
 */
import { and, asc, desc, gte, isNotNull, isNull, sql } from 'drizzle-orm'
import { db } from '../../../../../../server/database'
import * as sms from '../../../database/schema'
import { activityQuery, activityToDTO } from '../../../utils/dto'
import { boolParam, pagination } from '../../../utils/http'

export default defineEventHandler(async (event) => {
  const query = getQuery(event)
  const { page, pageSize, limit, offset } = pagination(query)
  const upcoming = boolParam(query.upcoming)

  const conditions = [isNull(sms.activities.deletedAt)]
  if (upcoming) conditions.push(isNotNull(sms.activities.startAt), gte(sms.activities.startAt, new Date()))

  const where = and(...conditions)

  const [rows, [totalRow]] = await Promise.all([
    activityQuery()
      .where(where)
      .orderBy(upcoming ? asc(sms.activities.startAt) : desc(sms.activities.startAt), desc(sms.activities.id))
      .limit(limit)
      .offset(offset),
    db.select({ value: sql<number>`count(*)::int` }).from(sms.activities).where(where)
  ])

  return {
    items: rows.map(activityToDTO),
    total: totalRow?.value ?? 0,
    page,
    pageSize
  }
})
