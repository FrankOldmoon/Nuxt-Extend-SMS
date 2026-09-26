/**
 * Course gradebook — the marking grid a teacher works in.
 *
 * One row per enrolled student with every assessment's mark on it, the weighted
 * course total computed by `grading.ts`, a letter, and a competition rank across
 * the whole roster (a student with no marks gets no rank rather than last place).
 *
 * Two deliberate choices:
 *   - the per-assessment marks are shipped as a `scores` array on each row, in
 *     addition to the single `score`/`scoreId`/`comment` the shared `ScoreRow`
 *     carries — a grid needs every cell, and the frozen row type only names one;
 *     the single fields mirror the first assessment so they are never a lie.
 *   - `canEdit` and the locking `submission` are computed server-side, so the UI
 *     only ever shows an editor the API would accept.
 */
import { and, asc, desc, eq, inArray, isNull } from 'drizzle-orm'
import { db } from '../../../../../../../server/database'
import * as sms from '../../../../database/schema'
import { assertSignedIn, getSchoolSettings, getSmsViewer, mayWriteCourse } from '../../../../utils/access'
import {
  assessmentQuery,
  assessmentToDTO,
  courseQuery,
  hydrateCourses,
  studentQuery,
  studentToDTO,
  submissionQuery,
  submissionToDTO
} from '../../../../utils/dto'
import { courseTotal, letterGrade, rankStudents, validateWeights } from '../../../../utils/grading'
import { intParam } from '../../../../utils/http'

function round2(value: number): number {
  return Math.round(value * 100) / 100
}

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
  const roster = studentRows.map(studentToDTO)

  const assessmentIds = assessments.map(assessment => assessment.id)
  const scoreRows = assessmentIds.length
    ? await db
        .select({
          id: sms.scores.id,
          assessmentId: sms.scores.assessmentId,
          studentId: sms.scores.studentId,
          score: sms.scores.score,
          comment: sms.scores.comment
        })
        .from(sms.scores)
        .where(and(inArray(sms.scores.assessmentId, assessmentIds), isNull(sms.scores.deletedAt)))
    : []

  // One cell per (student, assessment), so the row loop never re-scans the marks.
  const byStudent = new Map<number, Map<number, { id: number, score: number | null, comment: string | null }>>()
  for (const row of scoreRows) {
    let cells = byStudent.get(row.studentId)
    if (!cells) {
      cells = new Map()
      byStudent.set(row.studentId, cells)
    }
    cells.set(row.assessmentId, { id: row.id, score: row.score, comment: row.comment })
  }

  const passMark = (await getSchoolSettings()).passMark
  const firstId = assessments[0]?.id ?? null

  const rows = roster.map((student) => {
    const cells = byStudent.get(student.id) ?? new Map()
    const inputs = assessments.map(assessment => ({
      assessmentId: assessment.id,
      score: cells.get(assessment.id)?.score ?? null
    }))
    const total = courseTotal(assessments, inputs)
    const first = firstId == null ? null : cells.get(firstId) ?? null

    return {
      studentId: student.id,
      studentName: student.name,
      rollId: student.rollId,
      scoreId: first?.id ?? null,
      score: first?.score ?? null,
      comment: first?.comment ?? null,
      scores: assessments.map(assessment => ({
        assessmentId: assessment.id,
        scoreId: cells.get(assessment.id)?.id ?? null,
        score: cells.get(assessment.id)?.score ?? null,
        comment: cells.get(assessment.id)?.comment ?? null
      })),
      total: total.total,
      coverage: total.coverage,
      letter: letterGrade(total.total, passMark),
      rank: null as number | null,
      marked: total.marked,
      missing: total.missing
    }
  })

  const ranks = rankStudents(rows.map(row => ({ studentId: row.studentId, total: row.total })))
  for (const row of rows) row.rank = ranks.get(row.studentId) ?? null

  const statistics = assessments.map((assessment) => {
    const marks = scoreRows
      .filter(row => row.assessmentId === assessment.id && row.score != null)
      .map(row => row.score as number)
    return {
      assessmentId: assessment.id,
      average: marks.length ? round2(marks.reduce((sum, mark) => sum + mark, 0) / marks.length) : null,
      highest: marks.length ? Math.max(...marks) : null,
      lowest: marks.length ? Math.min(...marks) : null,
      marked: marks.length
    }
  })

  const [submissionRow] = await submissionQuery()
    .where(and(
      eq(sms.submissions.courseId, id),
      eq(sms.submissions.kind, 'scores'),
      isNull(sms.submissions.deletedAt)
    ))
    .orderBy(desc(sms.submissions.submittedAt))
    .limit(1)

  return {
    course,
    assessments,
    weights: validateWeights(assessments),
    rows,
    statistics,
    canEdit: await mayWriteCourse(viewer, id),
    submission: submissionRow ? submissionToDTO(submissionRow) : null,
    passMark
  }
})
