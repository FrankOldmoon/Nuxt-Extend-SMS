/**
 * Courses — the list every picker and the course directory read.
 *
 * Reads through `courseQuery()` and hydrates the staff list, so a course always
 * reaches the client with its teachers attached whether it came from here or
 * from the detail endpoint. `mine=1` is the only scope filter: an admin teaches
 * nothing, so for them "mine" deliberately means "everything" (`courseScope`
 * returns null for an admin), while a teacher gets exactly their own courses.
 *
 * Ordering is by class then name, which is how a school reads a list of courses
 * — grouped by cohort, not alphabetically across the whole school.
 */
import { and, asc, eq, inArray, isNull, like, or, sql } from 'drizzle-orm'
import { db } from '../../../../../../server/database'
import * as sms from '../../../database/schema'
import { assertSignedIn, courseScope, getSmsViewer } from '../../../utils/access'
import { courseQuery, hydrateCourses } from '../../../utils/dto'
import { boolParam, intParam, likePattern, pagination, textParam } from '../../../utils/http'

export default defineEventHandler(async (event) => {
  const viewer = await getSmsViewer(event)
  assertSignedIn(viewer)

  const query = getQuery(event) as Record<string, unknown>
  const { page, pageSize, limit, offset } = pagination(query)

  const conditions: Array<ReturnType<typeof and>> = [isNull(sms.courses.deletedAt)]

  const q = textParam(query.q, 120)
  if (q) {
    const pattern = likePattern(q)
    conditions.push(or(like(sms.courses.name, pattern), like(sms.courses.code, pattern)))
  }

  const classId = intParam(query.classId)
  if (classId) conditions.push(eq(sms.courses.classId, classId))

  const semesterId = intParam(query.semesterId)
  if (semesterId) conditions.push(eq(sms.courses.semesterId, semesterId))

  const subjectId = intParam(query.subjectId)
  if (subjectId) conditions.push(eq(sms.courses.subjectId, subjectId))

  const departmentId = intParam(query.departmentId)
  if (departmentId) conditions.push(eq(sms.courses.departmentId, departmentId))

  if (boolParam(query.mine)) {
    const scope = await courseScope(viewer)
    // `null` is the admin's "all courses"; an empty array means the teacher
    // teaches nothing, which must yield no rows rather than every row.
    if (scope !== null) conditions.push(scope.length ? inArray(sms.courses.id, scope) : sql`false`)
  }

  const where = and(...conditions)

  const [totals, rows] = await Promise.all([
    db.select({ count: sql<number>`count(*)::int` }).from(sms.courses).where(where),
    courseQuery()
      .where(where)
      .orderBy(asc(sms.classes.name), asc(sms.courses.name))
      .limit(limit)
      .offset(offset)
  ])

  return {
    items: await hydrateCourses(rows),
    total: totals[0]?.count ?? 0,
    page,
    pageSize
  }
})
