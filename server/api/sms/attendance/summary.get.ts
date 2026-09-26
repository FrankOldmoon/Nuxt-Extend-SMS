/**
 * Attendance report — attendance over a window, for a course, class or student.
 *
 * The read scope is applied to the student set, not to the response code: a
 * student asking about themselves and a guardian asking about a ward get a real
 * report, while anyone asking about a student outside their scope is refused.
 * Staff (`studentScope` null) may ask about everything.
 *
 * `overall` is every record in the window run through `summarizeAttendance`, and
 * `dates` is the distinct days those records fall on — which is what a report
 * needs to render a column per day.
 */
import { and, asc, eq, gte, inArray, isNull, lte, sql } from 'drizzle-orm'
import { db } from '../../../../../../server/database'
import * as sms from '../../../database/schema'
import { assertSignedIn, getSmsViewer, mayReadStudent, studentScope } from '../../../utils/access'
import { summarizeAttendance, summarizeByStudent } from '../../../utils/attendance'
import { courseQuery, hydrateCourses, studentQuery, studentToDTO } from '../../../utils/dto'
import { dateParam, intParam } from '../../../utils/http'

export default defineEventHandler(async (event) => {
  const viewer = await getSmsViewer(event)
  assertSignedIn(viewer)

  const query = getQuery(event) as Record<string, unknown>
  const courseId = intParam(query.courseId)
  const studentId = intParam(query.studentId)
  const classId = intParam(query.classId)
  const from = dateParam(query.from)
  const to = dateParam(query.to)

  const scope = studentScope(viewer)

  // Which students the report covers. `null` means "all students".
  let targetIds: number[] | null = null
  if (studentId) {
    if (!mayReadStudent(viewer, studentId)) {
      throw createError({ statusCode: 403, statusMessage: 'You may not read that student' })
    }
    targetIds = [studentId]
  } else if (classId) {
    const rows = await db
      .select({ id: sms.students.id })
      .from(sms.students)
      .where(and(eq(sms.students.classId, classId), isNull(sms.students.deletedAt)))
    targetIds = rows.map(row => row.id).filter(id => scope === null || scope.includes(id))
  } else if (courseId) {
    const rows = await db
      .select({ studentId: sms.courseStudents.studentId })
      .from(sms.courseStudents)
      .where(and(eq(sms.courseStudents.courseId, courseId), eq(sms.courseStudents.isActive, true)))
    targetIds = rows.map(row => row.studentId).filter(id => scope === null || scope.includes(id))
  } else if (scope !== null) {
    targetIds = scope
  }

  const conditions: Array<ReturnType<typeof and>> = [isNull(sms.attendanceRecords.deletedAt)]
  if (courseId) conditions.push(eq(sms.attendanceRecords.courseId, courseId))
  if (targetIds !== null) {
    conditions.push(targetIds.length ? inArray(sms.attendanceRecords.studentId, targetIds) : sql`false`)
  }
  if (from) conditions.push(gte(sms.attendanceRecords.date, from))
  if (to) conditions.push(lte(sms.attendanceRecords.date, to))

  const records = await db
    .select({
      studentId: sms.attendanceRecords.studentId,
      status: sms.attendanceRecords.status,
      minutesLate: sms.attendanceRecords.minutesLate,
      date: sms.attendanceRecords.date,
      periodId: sms.attendanceRecords.periodId
    })
    .from(sms.attendanceRecords)
    .where(and(...conditions))

  const stats = summarizeByStudent(records)
  // With no explicit target set every student who has a record is listed;
  // otherwise the requested roster is listed even with no records.
  const ids = targetIds ?? [...new Set(records.map(record => record.studentId))]

  const studentRows = ids.length
    ? await studentQuery()
        .where(and(inArray(sms.students.id, ids), isNull(sms.students.deletedAt)))
        .orderBy(asc(sms.students.rollId))
    : []

  const course = courseId
    ? (await hydrateCourses(await courseQuery().where(and(eq(sms.courses.id, courseId), isNull(sms.courses.deletedAt))).limit(1)))[0] ?? null
    : null

  return {
    students: studentRows.map((row) => {
      const student = studentToDTO(row)
      return { student, stats: stats.get(student.id) ?? summarizeAttendance([]) }
    }),
    overall: summarizeAttendance(records),
    dates: [...new Set(records.map(record => record.date))].sort(),
    course,
    from,
    to
  }
})
