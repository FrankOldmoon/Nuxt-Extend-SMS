/**
 * Submissions — the review queue.
 *
 * A teacher sees their own submissions plus any belonging to a course they
 * teach; an admin sees everything. A student or guardian sees nothing at all
 * (an empty page, not a 403): they have no submissions of their own, and the
 * queue is an internal staff tool.
 */
import { and, desc, eq, inArray, isNull, or, sql } from 'drizzle-orm'
import { db } from '../../../../../../server/database'
import * as sms from '../../../database/schema'
import { assertSignedIn, courseScope, getSmsViewer, isStaff } from '../../../utils/access'
import { submissionQuery, submissionToDTO } from '../../../utils/dto'
import { boolParam, intParam, pagination, textParam } from '../../../utils/http'

export default defineEventHandler(async (event) => {
  const viewer = await getSmsViewer(event)
  assertSignedIn(viewer)

  const query = getQuery(event) as Record<string, unknown>
  const { page, pageSize, limit, offset } = pagination(query)

  if (!isStaff(viewer)) {
    return { items: [], total: 0, page, pageSize }
  }

  const conditions: Array<ReturnType<typeof and>> = [isNull(sms.submissions.deletedAt)]

  const status = textParam(query.status, 20)
  if (status) conditions.push(eq(sms.submissions.status, status))

  const kind = textParam(query.kind, 20)
  if (kind) conditions.push(eq(sms.submissions.kind, kind))

  const courseId = intParam(query.courseId)
  if (courseId) conditions.push(eq(sms.submissions.courseId, courseId))

  const mine = boolParam(query.mine)
  const own = eq(sms.submissions.submittedBy, viewer.userId!)

  if (viewer.admin) {
    if (mine) conditions.push(own)
  } else if (mine) {
    conditions.push(own)
  } else {
    const scope = await courseScope(viewer)
    conditions.push(scope && scope.length
      ? or(own, inArray(sms.submissions.courseId, scope))
      : own)
  }

  const where = and(...conditions)

  const [totals, rows] = await Promise.all([
    db.select({ count: sql<number>`count(*)::int` }).from(sms.submissions).where(where),
    submissionQuery()
      .where(where)
      .orderBy(desc(sms.submissions.submittedAt), desc(sms.submissions.id))
      .limit(limit)
      .offset(offset)
  ])

  return {
    items: rows.map(submissionToDTO),
    total: totals[0]?.count ?? 0,
    page,
    pageSize
  }
})
