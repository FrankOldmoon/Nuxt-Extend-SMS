/**
 * Course — everything the overview page needs in one round trip.
 *
 * The five pieces are the course itself, its assessments, its enrolled roster,
 * its weekly placements and the weight validation. Assembling them here (rather
 * than making the client fire five requests) keeps "what is this course" a
 * single question, and the roster is read from `sms_course_students` because
 * that enrolment — not `students.class_id` — is what grading and attendance
 * actually use.
 */
import { and, asc, eq, isNull } from 'drizzle-orm'
import * as sms from '../../../database/schema'
import { assertSignedIn, getSmsViewer } from '../../../utils/access'
import {
  assessmentQuery,
  assessmentToDTO,
  courseQuery,
  hydrateCourses,
  studentQuery,
  studentToDTO,
  timetableEntries
} from '../../../utils/dto'
import { validateWeights } from '../../../utils/grading'
import { intParam } from '../../../utils/http'

export default defineEventHandler(async (event) => {
  const id = intParam(getRouterParam(event, 'id'))
  if (!id) throw createError({ statusCode: 400, statusMessage: 'Invalid course id' })

  const viewer = await getSmsViewer(event)
  assertSignedIn(viewer)

  const [courseRow] = await courseQuery()
    .where(and(eq(sms.courses.id, id), isNull(sms.courses.deletedAt)))
    .limit(1)
  if (!courseRow) throw createError({ statusCode: 404, statusMessage: 'Course not found' })
  const [course] = await hydrateCourses([courseRow])

  const assessmentRows = await assessmentQuery()
    .where(and(eq(sms.assessments.courseId, id), isNull(sms.assessments.deletedAt)))
    .orderBy(asc(sms.assessments.sortOrder), asc(sms.assessments.id))
  const assessments = assessmentRows.map(assessmentToDTO)

  const studentRows = await studentQuery()
    .innerJoin(sms.courseStudents, and(
      eq(sms.courseStudents.studentId, sms.students.id),
      eq(sms.courseStudents.courseId, id),
      eq(sms.courseStudents.isActive, true)
    ))
    .where(isNull(sms.students.deletedAt))
    .orderBy(asc(sms.students.rollId))
  const students = studentRows.map(studentToDTO)

  const lessons = await timetableEntries(
    and(eq(sms.timetableEntries.courseId, id), isNull(sms.timetableEntries.deletedAt))
  )

  return {
    course,
    assessments,
    students,
    lessons,
    weights: validateWeights(assessments)
  }
})
