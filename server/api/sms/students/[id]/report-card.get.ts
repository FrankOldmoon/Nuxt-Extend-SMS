/**
 * School — a student's report card.
 *
 * The report card is the one screen where the marking model has to be honest, so
 * it is assembled entirely from `utils/grading`: per-course weighted totals (a
 * course with nothing marked reports no total rather than a zero), the term
 * summary, and a class rank. Two decisions are worth stating:
 *
 *   - **The rank cohort is the whole class, same term.** Every classmate's term
 *     average is computed from their own enrolments in the same semester's graded
 *     courses, and `of` counts only the pupils who actually have a mark — a class
 *     of thirty where five have no marks ranks "2 of 25", not "2 of 30".
 *   - **The queries are batched by cohort, not per pupil.** Enrolments,
 *     assessments, scores and teachers are each fetched once for the whole class
 *     and folded in memory, so ranking does not fan out into N round trips.
 *
 * Access is the same scope check as the profile: `mayReadStudent`, and a miss is
 * a 404 rather than a 403.
 */
import { and, desc, eq, inArray, isNull } from 'drizzle-orm'
import { db } from '../../../../../../../server/database'
import { users } from '../../../../../../../server/database/schema'
import * as sms from '../../../../database/schema'
import { assertSignedIn, getCurrentSemesterId, getSchoolSettings, getSmsViewer, mayReadStudent } from '../../../../utils/access'
import { summarizeAttendance } from '../../../../utils/attendance'
import {
  conductRecordQuery,
  conductRecordToDTO,
  displayName,
  semesterQuery,
  studentQuery,
  studentToDTO
} from '../../../../utils/dto'
import { courseTotal, letterGrade, overallAverage, rankStudents, reportCardSummary } from '../../../../utils/grading'
import { intParam } from '../../../../utils/http'

/** The assessment fields the report card needs, stated once so the per-course map is typed. */
interface ReportAssessment {
  id: number
  courseId: number
  name: string
  kind: string
  weight: number
  maxScore: number
  sortOrder: number
}

export default defineEventHandler(async (event) => {
  const viewer = await getSmsViewer(event)
  assertSignedIn(viewer)

  const id = intParam(getRouterParam(event, 'id'))
  if (id == null || !mayReadStudent(viewer, id)) {
    throw createError({ statusCode: 404, statusMessage: 'Student not found' })
  }

  const [studentRow] = await studentQuery()
    .where(and(eq(sms.students.id, id), isNull(sms.students.deletedAt)))
    .limit(1)
  if (!studentRow) throw createError({ statusCode: 404, statusMessage: 'Student not found' })
  const student = studentToDTO(studentRow)

  const query = getQuery(event)
  const [school, currentSemesterId] = await Promise.all([getSchoolSettings(), getCurrentSemesterId()])
  const semesterId = intParam(query.semesterId) ?? currentSemesterId

  const semester = semesterId == null
    ? null
    : (await semesterQuery()
        .where(and(eq(sms.semesters.id, semesterId), isNull(sms.semesters.deletedAt)))
        .limit(1))[0] ?? null

  // The cohort: the student's classmates, or just the student when they have no
  // class — so a rank still appears for an unassigned pupil.
  const cohortIds = student.classId == null
    ? [id]
    : (await db
        .select({ id: sms.students.id })
        .from(sms.students)
        .where(and(eq(sms.students.classId, student.classId), isNull(sms.students.deletedAt))))
        .map(row => row.id)

  const enrollments = await db
    .select({
      studentId: sms.courseStudents.studentId,
      courseId: sms.courses.id,
      courseName: sms.courses.name,
      subjectName: sms.subjects.name,
      credits: sms.courses.credits
    })
    .from(sms.courseStudents)
    .innerJoin(sms.courses, eq(sms.courseStudents.courseId, sms.courses.id))
    .leftJoin(sms.subjects, eq(sms.courses.subjectId, sms.subjects.id))
    .where(and(
      inArray(sms.courseStudents.studentId, cohortIds),
      eq(sms.courseStudents.isActive, true),
      eq(sms.courses.isGraded, true),
      isNull(sms.courses.deletedAt),
      semesterId != null ? eq(sms.courses.semesterId, semesterId) : undefined
    ))

  const courseIds = [...new Set(enrollments.map(entry => entry.courseId))]

  const [assessmentRows, teacherRows, conductRows, attendanceRows] = await Promise.all([
    courseIds.length
      ? db
          .select({
            id: sms.assessments.id,
            courseId: sms.assessments.courseId,
            name: sms.assessments.name,
            kind: sms.assessments.kind,
            weight: sms.assessments.weight,
            maxScore: sms.assessments.maxScore,
            sortOrder: sms.assessments.sortOrder
          })
          .from(sms.assessments)
          .where(and(inArray(sms.assessments.courseId, courseIds), isNull(sms.assessments.deletedAt)))
      : Promise.resolve([]),
    courseIds.length
      ? db
          .select({ courseId: sms.courseTeachers.courseId, name: displayName })
          .from(sms.courseTeachers)
          .innerJoin(sms.teachers, eq(sms.courseTeachers.teacherId, sms.teachers.id))
          .innerJoin(users, eq(sms.teachers.userId, users.id))
          .where(inArray(sms.courseTeachers.courseId, courseIds))
      : Promise.resolve([]),
    conductRecordQuery()
      .where(and(
        eq(sms.conductRecords.studentId, id),
        isNull(sms.conductRecords.deletedAt),
        semesterId != null ? eq(sms.conductRecords.semesterId, semesterId) : undefined
      ))
      .orderBy(desc(sms.conductRecords.date), desc(sms.conductRecords.id)),
    db
      .select({
        studentId: sms.attendanceRecords.studentId,
        status: sms.attendanceRecords.status,
        minutesLate: sms.attendanceRecords.minutesLate,
        date: sms.attendanceRecords.date,
        periodId: sms.attendanceRecords.periodId
      })
      .from(sms.attendanceRecords)
      .where(and(eq(sms.attendanceRecords.studentId, id), isNull(sms.attendanceRecords.deletedAt)))
  ])

  const scoreRows = assessmentRows.length
    ? await db
        .select({ assessmentId: sms.scores.assessmentId, studentId: sms.scores.studentId, score: sms.scores.score })
        .from(sms.scores)
        .where(and(
          inArray(sms.scores.assessmentId, assessmentRows.map(row => row.id)),
          inArray(sms.scores.studentId, cohortIds),
          isNull(sms.scores.deletedAt)
        ))
    : []

  const assessmentsByCourse = new Map<number, ReportAssessment[]>()
  for (const row of assessmentRows) {
    const bucket = assessmentsByCourse.get(row.courseId)
    if (bucket) bucket.push(row)
    else assessmentsByCourse.set(row.courseId, [row])
  }

  const teachersByCourse = new Map<number, string[]>()
  for (const row of teacherRows) {
    const bucket = teachersByCourse.get(row.courseId)
    if (bucket) bucket.push(row.name)
    else teachersByCourse.set(row.courseId, [row.name])
  }

  const scoreLookup = new Map<string, number | null>()
  for (const row of scoreRows) scoreLookup.set(`${row.studentId}:${row.assessmentId}`, row.score)

  /** A student's weighted mark per enrolled course, ready for the summary maths. */
  function totalsFor(studentId: number) {
    return enrollments
      .filter(entry => entry.studentId === studentId)
      .map((entry) => {
        const assessments = assessmentsByCourse.get(entry.courseId) ?? []
        const scores = assessments.map(assessment => ({
          assessmentId: assessment.id,
          score: scoreLookup.get(`${studentId}:${assessment.id}`) ?? null
        }))
        const { total } = courseTotal(assessments, scores)
        return { courseId: entry.courseId, total, credits: entry.credits }
      })
  }

  const cohortAverages = cohortIds.map(studentId => ({
    studentId,
    total: overallAverage(totalsFor(studentId))
  }))

  const ranks = rankStudents(cohortAverages)
  const markedAverages = cohortAverages
    .map(entry => entry.total)
    .filter((total): total is number => total != null)
  const classAverage = markedAverages.length
    ? Math.round((markedAverages.reduce((sum, value) => sum + value, 0) / markedAverages.length) * 100) / 100
    : null

  const conduct = conductRows.map(conductRecordToDTO)

  const rows = enrollments
    .filter(entry => entry.studentId === id)
    .map((entry) => {
      const assessments = (assessmentsByCourse.get(entry.courseId) ?? [])
        .slice()
        .sort((a, b) => a.sortOrder - b.sortOrder || a.id - b.id)
      const scores = assessments.map(assessment => ({
        assessmentId: assessment.id,
        score: scoreLookup.get(`${id}:${assessment.id}`) ?? null
      }))
      const { total, coverage } = courseTotal(assessments, scores)

      return {
        courseId: entry.courseId,
        courseName: entry.courseName,
        subjectName: entry.subjectName,
        credits: entry.credits,
        teachers: teachersByCourse.get(entry.courseId) ?? [],
        total,
        letter: letterGrade(total, school.passMark),
        coverage,
        assessments: assessments.map(assessment => ({
          id: assessment.id,
          name: assessment.name,
          kind: assessment.kind,
          weight: assessment.weight,
          maxScore: assessment.maxScore,
          score: scoreLookup.get(`${id}:${assessment.id}`) ?? null
        }))
      }
    })
    .sort((a, b) => a.courseName.localeCompare(b.courseName))

  const summary = reportCardSummary(
    rows.map(row => ({ courseId: row.courseId, total: row.total, credits: row.credits })),
    conduct,
    school.passMark
  )

  return {
    student,
    semester,
    rows,
    summary,
    rank: {
      position: ranks.get(id) ?? null,
      of: markedAverages.length,
      classAverage
    },
    conduct,
    attendance: summarizeAttendance(attendanceRows),
    passMark: school.passMark,
    generatedAt: new Date().toISOString()
  }
})
