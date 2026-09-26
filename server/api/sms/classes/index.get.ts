/**
 * School — the class directory.
 *
 * The list every class picker and the classes page read. Graduated cohorts are
 * dropped by default (they stay for history but have no place in a picker);
 * `includeGraduated=1` brings them back for the archive view.
 *
 * The count is a plain `count(*)` over `sms_classes` because every filter is a
 * column on that table — no need to repeat the joins `classQuery()` needs for
 * its display columns.
 */
import { and, asc, eq, isNull, like, or, sql } from 'drizzle-orm'
import { db } from '../../../../../../server/database'
import * as sms from '../../../database/schema'
import { assertSignedIn, getSmsViewer } from '../../../utils/access'
import { classQuery } from '../../../utils/dto'
import { boolParam, intParam, likePattern, pagination, textParam } from '../../../utils/http'

export default defineEventHandler(async (event) => {
  const viewer = await getSmsViewer(event)
  assertSignedIn(viewer)

  const query = getQuery(event) as Record<string, unknown>
  const { page, pageSize, limit, offset } = pagination(query)

  const conditions: Array<ReturnType<typeof and>> = [isNull(sms.classes.deletedAt)]

  const q = textParam(query.q, 120)
  if (q) {
    const pattern = likePattern(q)
    conditions.push(or(like(sms.classes.name, pattern), like(sms.classes.code, pattern))!)
  }

  const gradeId = intParam(query.gradeId)
  if (gradeId) conditions.push(eq(sms.classes.gradeId, gradeId))

  const departmentId = intParam(query.departmentId)
  if (departmentId) conditions.push(eq(sms.classes.departmentId, departmentId))

  if (!boolParam(query.includeGraduated)) conditions.push(eq(sms.classes.isGraduated, false))

  const where = and(...conditions)

  const [totals, rows] = await Promise.all([
    db.select({ count: sql<number>`count(*)::int` }).from(sms.classes).where(where),
    classQuery()
      .where(where)
      .orderBy(sql`${sms.grades.sortOrder} asc nulls last`, asc(sms.classes.sortOrder), asc(sms.classes.name))
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
