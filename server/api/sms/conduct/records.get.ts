/**
 * Conduct records — the history of merits and demerits.
 *
 * The read scope is the school's: a student sees only their own records, a
 * guardian only their wards', staff see everyone. That scope is applied as an
 * impossible condition (`sql false`) when it is an empty list, so a signed-in
 * user with no linked student gets an empty page rather than an error.
 *
 * The count query repeats the joins the row query needs, because `q` searches the
 * student's name (a joined column) as well as the rule and description.
 */
import { and, desc, eq, inArray, isNull, like, or, sql } from 'drizzle-orm'
import { db } from '../../../../../../server/database'
import { users } from '../../../../../../server/database/schema'
import * as sms from '../../../database/schema'
import { assertSignedIn, getSmsViewer, studentScope } from '../../../utils/access'
import { conductRecordQuery, conductRecordToDTO, displayName } from '../../../utils/dto'
import { intParam, likePattern, pagination, textParam } from '../../../utils/http'

export default defineEventHandler(async (event) => {
  const viewer = await getSmsViewer(event)
  assertSignedIn(viewer)

  const query = getQuery(event) as Record<string, unknown>
  const { page, pageSize, limit, offset } = pagination(query)

  const scope = studentScope(viewer)
  const conditions: Array<ReturnType<typeof and>> = [isNull(sms.conductRecords.deletedAt)]
  if (scope !== null) {
    conditions.push(scope.length ? inArray(sms.conductRecords.studentId, scope) : sql`false`)
  }

  const studentId = intParam(query.studentId)
  if (studentId) conditions.push(eq(sms.conductRecords.studentId, studentId))

  const kind = textParam(query.kind, 20)
  if (kind) conditions.push(eq(sms.conductRecords.kind, kind))

  const classId = intParam(query.classId)
  if (classId) conditions.push(eq(sms.students.classId, classId))

  const semesterId = intParam(query.semesterId)
  if (semesterId) conditions.push(eq(sms.conductRecords.semesterId, semesterId))

  const q = textParam(query.q, 120)
  if (q) {
    const pattern = likePattern(q)
    conditions.push(or(
      like(displayName, pattern),
      like(sms.conductRules.name, pattern),
      like(sms.conductRecords.description, pattern)
    ))
  }

  const where = and(...conditions)

  const [totals, rows] = await Promise.all([
    db.select({ count: sql<number>`count(*)::int` })
      .from(sms.conductRecords)
      .innerJoin(sms.students, eq(sms.conductRecords.studentId, sms.students.id))
      .innerJoin(users, eq(sms.students.userId, users.id))
      .leftJoin(sms.classes, eq(sms.students.classId, sms.classes.id))
      .leftJoin(sms.conductRules, eq(sms.conductRecords.ruleId, sms.conductRules.id))
      .leftJoin(sms.courses, eq(sms.conductRecords.courseId, sms.courses.id))
      .where(where),
    conductRecordQuery()
      .where(where)
      .orderBy(desc(sms.conductRecords.date), desc(sms.conductRecords.id))
      .limit(limit)
      .offset(offset)
  ])

  return {
    items: rows.map(conductRecordToDTO),
    total: totals[0]?.count ?? 0,
    page,
    pageSize
  }
})
