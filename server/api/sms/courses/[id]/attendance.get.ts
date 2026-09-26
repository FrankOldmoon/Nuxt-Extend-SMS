/**
 * Course attendance — one day's (or one period's) roll sheet.
 *
 * The roster is read from the enrolment, and every student appears even with no
 * record yet (pre-filled `present`, matching `defaultSheet` — an empty sheet
 * cannot be told apart from an unsaved one). A student or guardian may open the
 * page: instead of a 403 the rows are filtered to the people they may read, so
 * the sheet is still a coherent page for whoever asked.
 *
 * `summary` is each student's whole-course rate, computed by `attendance.ts` so
 * authorised leave never counts against them.
 */
import { and, asc, desc, eq, isNull } from 'drizzle-orm'
import { db } from '../../../../../../../server/database'
import * as sms from '../../../../database/schema'
import { assertSignedIn, getSmsViewer, mayReadStudent, mayWriteCourse } from '../../../../utils/access'
import { summarizeAttendance, summarizeByStudent } from '../../../../utils/attendance'
import {
  courseQuery,
  hydrateCourses,
  studentQuery,
  studentToDTO,
  submissionQuery,
  submissionToDTO
} from '../../../../utils/dto'
import { dateParam, intParam, today } from '../../../../utils/http'

export default defineEventHandler(async (event) => {
  const courseId = intParam(getRouterParam(event, 'id'))
  if (!courseId) throw createError({ statusCode: 400, statusMessage: 'Invalid course id' })

  const viewer = await getSmsViewer(event)
  assertSignedIn(viewer)

  const [courseRow] = await courseQuery()
    .where(and(eq(sms.courses.id, courseId), isNull(sms.courses.deletedAt)))
    .limit(1)
  if (!courseRow) throw createError({ statusCode: 404, statusMessage: 'Course not found' })
  const [course] = await hydrateCourses([courseRow])

  const query = getQuery(event) as Record<string, unknown>
  const date = dateParam(query.date) ?? today()
  const periodId = intParam(query.periodId)

  const studentRows = await studentQuery()
    .innerJoin(sms.courseStudents, and(
      eq(sms.courseStudents.studentId, sms.students.id),
      eq(sms.courseStudents.courseId, courseId),
      eq(sms.courseStudents.isActive, true)
    ))
    .where(isNull(sms.students.deletedAt))
    .orderBy(asc(sms.students.rollId))
  const roster = studentRows.map(studentToDTO)

  const slotConditions: Array<ReturnType<typeof and>> = [
    eq(sms.attendanceRecords.courseId, courseId),
    eq(sms.attendanceRecords.date, date),
    isNull(sms.attendanceRecords.deletedAt)
  ]
  slotConditions.push(periodId ? eq(sms.attendanceRecords.periodId, periodId) : isNull(sms.attendanceRecords.periodId))

  const [records, history] = await Promise.all([
    db
      .select({
        id: sms.attendanceRecords.id,
        studentId: sms.attendanceRecords.studentId,
        status: sms.attendanceRecords.status,
        minutesLate: sms.attendanceRecords.minutesLate,
        note: sms.attendanceRecords.note
      })
      .from(sms.attendanceRecords)
      .where(and(...slotConditions)),
    db
      .select({
        studentId: sms.attendanceRecords.studentId,
        status: sms.attendanceRecords.status,
        minutesLate: sms.attendanceRecords.minutesLate,
        date: sms.attendanceRecords.date,
        periodId: sms.attendanceRecords.periodId
      })
      .from(sms.attendanceRecords)
      .where(and(eq(sms.attendanceRecords.courseId, courseId), isNull(sms.attendanceRecords.deletedAt)))
  ])

  const byStudent = new Map(records.map(record => [record.studentId, record]))
  const stats = summarizeByStudent(history)
  const visible = roster.filter(student => mayReadStudent(viewer, student.id))

  const [submissionRow] = await submissionQuery()
    .where(and(
      eq(sms.submissions.courseId, courseId),
      eq(sms.submissions.kind, 'attendance'),
      isNull(sms.submissions.deletedAt)
    ))
    .orderBy(desc(sms.submissions.submittedAt))
    .limit(1)

  return {
    course,
    date,
    periodId,
    canEdit: await mayWriteCourse(viewer, courseId),
    submission: submissionRow ? submissionToDTO(submissionRow) : null,
    rows: visible.map((student) => {
      const record = byStudent.get(student.id)
      return {
        studentId: student.id,
        studentName: student.name,
        rollId: student.rollId,
        recordId: record?.id ?? null,
        status: record?.status ?? 'present',
        minutesLate: record?.minutesLate ?? null,
        note: record?.note ?? null
      }
    }),
    summary: visible.map(student => ({
      studentId: student.id,
      stats: stats.get(student.id) ?? summarizeAttendance([])
    }))
  }
})
