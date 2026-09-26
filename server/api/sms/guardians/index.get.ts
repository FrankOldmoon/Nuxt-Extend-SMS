/**
 * School — the guardian directory.
 *
 * A guardian may have any number of children and may have no login at all, so
 * the list is about reachability: name, phone, email and the children attached
 * through `sms_student_guardians`. The children are hydrated in one extra query
 * (`hydrateGuardians`) rather than N.
 */
import { and, asc, ilike, isNull, or, sql } from 'drizzle-orm'
import { db } from '../../../../../../server/database'
import * as sms from '../../../database/schema'
import { assertSignedIn, getSmsViewer } from '../../../utils/access'
import { guardianQuery, hydrateGuardians } from '../../../utils/dto'
import { likePattern, pagination, textParam } from '../../../utils/http'

export default defineEventHandler(async (event) => {
  const viewer = await getSmsViewer(event)
  assertSignedIn(viewer)

  const query = getQuery(event) as Record<string, unknown>
  const { page, pageSize, limit, offset } = pagination(query)

  const conditions: Array<ReturnType<typeof and>> = [isNull(sms.guardians.deletedAt)]

  const q = textParam(query.q, 120)
  if (q) {
    const pattern = likePattern(q)
    conditions.push(or(
      ilike(sms.guardians.name, pattern),
      ilike(sms.guardians.phone, pattern),
      ilike(sms.guardians.email, pattern),
      ilike(sms.guardians.company, pattern)
    )!)
  }

  const where = and(...conditions)

  const [totals, rows] = await Promise.all([
    db.select({ count: sql<number>`count(*)::int` }).from(sms.guardians).where(where),
    guardianQuery()
      .where(where)
      .orderBy(asc(sms.guardians.name))
      .limit(limit)
      .offset(offset)
  ])

  return {
    items: await hydrateGuardians(rows),
    total: totals[0]?.count ?? 0,
    page,
    pageSize
  }
})
