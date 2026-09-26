/**
 * School — the reference data every picker and filter needs.
 *
 * Departments, grades, subjects, semesters, rooms and the bell schedule are the
 * small, slowly-changing lookup tables. They are served together, in one round
 * trip, because a filter bar that has to fire six requests to draw itself is
 * worse than one payload — and none of them is large enough to paginate.
 *
 * Signed in only: the portal is where these are used, and a caller who cannot
 * see the directory has no business listing its rooms either.
 */
import { asc, isNull, sql } from 'drizzle-orm'
import * as sms from '../../database/schema'
import { assertSignedIn, getSmsViewer } from '../../utils/access'
import {
  classroomQuery,
  departmentQuery,
  gradeQuery,
  periodQuery,
  semesterQuery,
  subjectQuery
} from '../../utils/dto'

export default defineEventHandler(async (event) => {
  const viewer = await getSmsViewer(event)
  assertSignedIn(viewer)

  const [departments, grades, subjects, semesters, classrooms, periods] = await Promise.all([
    departmentQuery()
      .where(isNull(sms.departments.deletedAt))
      .orderBy(asc(sms.departments.sortOrder), asc(sms.departments.name)),
    gradeQuery()
      .where(isNull(sms.grades.deletedAt))
      .orderBy(asc(sms.grades.sortOrder), asc(sms.grades.name)),
    subjectQuery()
      .where(isNull(sms.subjects.deletedAt))
      .orderBy(asc(sms.subjects.sortOrder), asc(sms.subjects.name)),
    semesterQuery()
      .where(isNull(sms.semesters.deletedAt))
      .orderBy(sql`${sms.semesters.isCurrent} desc`, asc(sms.semesters.sortOrder), asc(sms.semesters.name)),
    classroomQuery()
      .where(isNull(sms.classrooms.deletedAt))
      .orderBy(asc(sms.classrooms.name)),
    periodQuery()
  ])

  return { departments, grades, subjects, semesters, classrooms, periods }
})
