/**
 * School — the student directory.
 *
 * A directory is the one place a school is most tempting to expose completely, so
 * the read scope from `studentScope(viewer)` is applied in SQL: a teacher or admin
 * gets `null` meaning "all", a student gets their own id, a guardian their wards,
 * and an anonymous visitor an empty array — which is answered as an empty page
 * without touching the database at all.
 *
 * The name search is expressed as a sub-select over host `users` rather than an
 * `ilike` on a joined column, so the count query can stay a plain `count(*)` over
 * `sms_students` without re-joining the host table.
 */
import { and, asc, eq, ilike, inArray, isNull, or, sql } from 'drizzle-orm'
import { db } from '../../../../../../server/database'
import * as sms from '../../../database/schema'
import { assertSignedIn, getSmsViewer, studentScope } from '../../../utils/access'
import { studentQuery, studentToDTO } from '../../../utils/dto'
import { intParam, likePattern, pagination, textParam } from '../../../utils/http'

export default defineEventHandler(async (event) => {
  const viewer = await getSmsViewer(event)
  assertSignedIn(viewer)

  const query = getQuery(event)
  const { page, pageSize, limit, offset } = pagination(query)

  const scope = studentScope(viewer)
  if (scope !== null && scope.length === 0) {
    return { items: [], total: 0, page, pageSize }
  }

  const conditions = [isNull(sms.students.deletedAt)]
  if (scope !== null) conditions.push(inArray(sms.students.id, scope))

  const q = textParam(query.q, 200)
  if (q) {
    const pattern = likePattern(q)
    conditions.push(or(
      ilike(sms.students.rollId, pattern),
      sql`${sms.students.userId} in (select id from users u
        where coalesce(nullif(trim(u.name), ''), u.username) ilike ${pattern})`
    )!)
  }

  const classId = intParam(query.classId)
  if (classId) conditions.push(eq(sms.students.classId, classId))

  const gradeId = intParam(query.gradeId)
  if (gradeId) {
    conditions.push(sql`${sms.students.classId} in (select id from sms_classes
      where grade_id = ${gradeId} and deleted_at is null)`)
  }

  const status = textParam(query.status, 20)
  if (status) conditions.push(eq(sms.students.status, status))

  const where = and(...conditions)

  const [rows, [totalRow]] = await Promise.all([
    studentQuery()
      .where(where)
      .orderBy(asc(sms.classes.name), asc(sms.students.rollId))
      .limit(limit)
      .offset(offset),
    db.select({ value: sql<number>`count(*)::int` }).from(sms.students).where(where)
  ])

  return {
    items: rows.map(studentToDTO),
    total: totalRow?.value ?? 0,
    page,
    pageSize
  }
})
