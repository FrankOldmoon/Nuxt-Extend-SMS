/**
 * School — one class, with the roster and the courses taught to it.
 *
 * The class page needs the cohort, the courses and the weekly grid; the grid is
 * fetched separately through `/api/sms/timetable?classId=…` because a class's
 * timetable and a teacher's timetable are the same query with a different scope.
 * Everything else — the class record, its students and its courses — is one
 * round trip.
 */
import { and, asc, eq, inArray, isNull } from 'drizzle-orm'
import * as sms from '../../../database/schema'
import { assertSignedIn, getSmsViewer, studentScope } from '../../../utils/access'
import {
  classQuery,
  courseQuery,
  hydrateCourses,
  studentQuery,
  studentToDTO
} from '../../../utils/dto'
import { intParam } from '../../../utils/http'

export default defineEventHandler(async (event) => {
  const id = intParam(getRouterParam(event, 'id'))
  if (!id) throw createError({ statusCode: 400, statusMessage: 'Invalid class id' })

  const viewer = await getSmsViewer(event)
  assertSignedIn(viewer)

  const [row] = await classQuery()
    .where(and(eq(sms.classes.id, id), isNull(sms.classes.deletedAt)))
    .limit(1)
  if (!row) throw createError({ statusCode: 404, statusMessage: 'Class not found' })

  // The roster is scoped the same way the student directory is: staff see the
  // class, a student sees only themselves, a guardian only their wards.
  const scope = studentScope(viewer)
  const studentRows = scope !== null && scope.length === 0
    ? []
    : await studentQuery()
        .where(and(
          eq(sms.students.classId, id),
          isNull(sms.students.deletedAt),
          scope !== null ? inArray(sms.students.id, scope) : undefined
        ))
        .orderBy(asc(sms.students.rollId))

  const courseRows = await courseQuery()
    .where(and(eq(sms.courses.classId, id), isNull(sms.courses.deletedAt)))
    .orderBy(asc(sms.courses.name))

  return {
    class: row,
    students: studentRows.map(studentToDTO),
    courses: await hydrateCourses(courseRows)
  }
})
