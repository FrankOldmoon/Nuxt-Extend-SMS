/**
 * School — the teaching-staff directory.
 *
 * Reads through `teacherQuery()` so a teacher always arrives with the resolved
 * display name and course count. The name search is a sub-select over the host
 * `users` table (the same shape the student directory uses), which keeps the
 * count query a plain `count(*)` over `sms_teachers`.
 */
import { and, asc, eq, isNull, like, or, sql } from 'drizzle-orm'
import { db } from '../../../../../../server/database'
import * as sms from '../../../database/schema'
import { assertSignedIn, getSmsViewer } from '../../../utils/access'
import { displayName, teacherQuery } from '../../../utils/dto'
import { intParam, likePattern, pagination, textParam } from '../../../utils/http'

export default defineEventHandler(async (event) => {
  const viewer = await getSmsViewer(event)
  assertSignedIn(viewer)

  const query = getQuery(event) as Record<string, unknown>
  const { page, pageSize, limit, offset } = pagination(query)

  const conditions: Array<ReturnType<typeof and>> = [isNull(sms.teachers.deletedAt)]

  const q = textParam(query.q, 120)
  if (q) {
    const pattern = likePattern(q)
    conditions.push(or(
      like(sms.teachers.employeeNo, pattern),
      sql`${sms.teachers.userId} in (select id from users u
        where coalesce(nullif(trim(u.name), ''), u.username) ilike ${pattern})`
    )!)
  }

  const departmentId = intParam(query.departmentId)
  if (departmentId) conditions.push(eq(sms.teachers.departmentId, departmentId))

  const where = and(...conditions)

  const [totals, rows] = await Promise.all([
    db.select({ count: sql<number>`count(*)::int` }).from(sms.teachers).where(where),
    teacherQuery()
      .where(where)
      .orderBy(asc(sms.departments.name), asc(displayName))
      .limit(limit)
      .offset(offset)
  ])

  return {
    items: rows,
    total: totals[0]?.count ?? 0,
    page,
    pageSize
  }
})
