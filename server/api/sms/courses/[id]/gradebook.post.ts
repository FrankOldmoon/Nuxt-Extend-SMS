/**
 * Course gradebook — save marks for one assessment.
 *
 * The whole batch is one upsert against the `(assessment_id, student_id)` unique
 * pair, so re-saving the grid is idempotent. A null score is a real edit — it
 * clears the mark back to "not marked" without deleting the row, which keeps the
 * row's audit trail.
 *
 * The one refusal is the point of the workflow: once an administrator has
 * approved this course's scores, the marks are frozen until the batch is
 * withdrawn, so an approved report cannot silently change under a parent's eyes.
 */
import { and, desc, eq, isNull, sql } from 'drizzle-orm'
import { db } from '../../../../../../../server/database'
import * as sms from '../../../../database/schema'
import { assertMayWriteCourse, getSmsViewer } from '../../../../utils/access'
import { submissionQuery } from '../../../../utils/dto'
import { intParam, textParam } from '../../../../utils/http'

export default defineEventHandler(async (event) => {
  const courseId = intParam(getRouterParam(event, 'id'))
  if (!courseId) throw createError({ statusCode: 400, statusMessage: 'Invalid course id' })

  const viewer = await getSmsViewer(event)
  await assertMayWriteCourse(viewer, courseId)

  const body = await readBody<{ assessmentId?: unknown, scores?: unknown }>(event).catch(() => ({}) as Record<string, unknown>)
  const assessmentId = intParam(body.assessmentId)
  if (!assessmentId) throw createError({ statusCode: 400, statusMessage: 'assessmentId is required' })

  const [assessment] = await db
    .select({ id: sms.assessments.id })
    .from(sms.assessments)
    .where(and(
      eq(sms.assessments.id, assessmentId),
      eq(sms.assessments.courseId, courseId),
      isNull(sms.assessments.deletedAt)
    ))
    .limit(1)
  if (!assessment) throw createError({ statusCode: 404, statusMessage: 'Assessment not found' })

  const [latest] = await submissionQuery()
    .where(and(
      eq(sms.submissions.courseId, courseId),
      eq(sms.submissions.kind, 'scores'),
      isNull(sms.submissions.deletedAt)
    ))
    .orderBy(desc(sms.submissions.submittedAt))
    .limit(1)
  if (latest?.status === 'approved') {
    throw createError({ statusCode: 409, statusMessage: 'This course\'s marks are approved and cannot be edited' })
  }

  const raw = Array.isArray(body.scores) ? body.scores : []
  const now = new Date()
  const gradedBy = viewer.teacher?.id ?? null
  // Keyed by student so a duplicated id in one request cannot make Postgres
  // reject the statement ("cannot affect row a second time").
  const values = new Map<number, {
    assessmentId: number
    studentId: number
    score: number | null
    comment: string | null
    gradedBy: number | null
    gradedAt: Date
  }>()

  for (const entry of raw) {
    if (!entry || typeof entry !== 'object') continue
    const row = entry as Record<string, unknown>
    const studentId = intParam(row.studentId)
    if (!studentId) continue

    let score: number | null = null
    if (row.score !== null && row.score !== undefined && row.score !== '') {
      const parsed = Number(row.score)
      if (!Number.isFinite(parsed)) {
        throw createError({ statusCode: 400, statusMessage: `Invalid score for student ${studentId}` })
      }
      score = parsed
    }

    values.set(studentId, {
      assessmentId,
      studentId,
      score,
      comment: textParam(row.comment, 300),
      gradedBy,
      gradedAt: now
    })
  }

  if (values.size) {
    await db
      .insert(sms.scores)
      .values([...values.values()])
      .onConflictDoUpdate({
        target: [sms.scores.assessmentId, sms.scores.studentId],
        // `excluded` is the row we just tried to insert, so each row keeps its
        // own score — including a null that clears the mark.
        set: {
          score: sql`excluded.score`,
          comment: sql`excluded.comment`,
          gradedBy: sql`excluded.graded_by`,
          gradedAt: sql`excluded.graded_at`,
          updatedAt: now
        }
      })
  }

  return { saved: values.size }
})
