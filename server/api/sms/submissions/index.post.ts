/**
 * Submissions — open a batch for review.
 *
 * A submission is a group of teacher-entered records, not a copy of them: the
 * records themselves carry the `submissionId`, which is what lets the workflow
 * live on the batch (one "approve the mid-term scores" decision) instead of on
 * every row.
 *
 * Submitting twice must not create two open batches for the same thing, so an
 * existing *pending* submission of the same kind and course is reused — its
 * `submittedAt` is bumped and the new records are attached to it. That keeps the
 * reviewer's queue honest.
 */
import { and, eq, inArray, isNull } from 'drizzle-orm'
import { db } from '../../../../../../server/database'
import * as sms from '../../../database/schema'
import { assertStaff, getCurrentSemesterId, getSmsViewer } from '../../../utils/access'
import { submissionQuery, submissionToDTO } from '../../../utils/dto'
import { idListParam, intParam, textParam } from '../../../utils/http'

const KINDS = ['scores', 'attendance', 'conduct']

export default defineEventHandler(async (event) => {
  const viewer = await getSmsViewer(event)
  assertStaff(viewer)

  const body = await readBody<Record<string, unknown>>(event).catch(() => ({}) as Record<string, unknown>)

  const kind = textParam(body.kind, 20)
  if (!kind || !KINDS.includes(kind)) {
    throw createError({ statusCode: 400, statusMessage: 'kind must be "scores", "attendance" or "conduct"' })
  }

  const courseId = intParam(body.courseId)
  if ((kind === 'scores' || kind === 'attendance') && !courseId) {
    throw createError({ statusCode: 400, statusMessage: 'courseId is required for this kind of submission' })
  }

  let semesterId = intParam(body.semesterId)
  if (!semesterId && courseId) {
    const [course] = await db
      .select({ semesterId: sms.courses.semesterId })
      .from(sms.courses)
      .where(and(eq(sms.courses.id, courseId), isNull(sms.courses.deletedAt)))
      .limit(1)
    semesterId = course?.semesterId ?? null
  }
  if (!semesterId) semesterId = await getCurrentSemesterId()

  const now = new Date()

  const [existing] = await db
    .select({ id: sms.submissions.id })
    .from(sms.submissions)
    .where(and(
      eq(sms.submissions.kind, kind),
      courseId ? eq(sms.submissions.courseId, courseId) : isNull(sms.submissions.courseId),
      eq(sms.submissions.status, 'pending'),
      isNull(sms.submissions.deletedAt)
    ))
    .limit(1)

  let submissionId: number
  if (existing) {
    await db
      .update(sms.submissions)
      .set({
        submittedAt: now,
        submittedBy: viewer.userId,
        semesterId,
        ...(body.title !== undefined ? { title: textParam(body.title, 200) } : {}),
        updatedAt: now
      })
      .where(eq(sms.submissions.id, existing.id))
    submissionId = existing.id
  } else {
    const [created] = await db
      .insert(sms.submissions)
      .values({
        kind,
        title: textParam(body.title, 200),
        courseId,
        semesterId,
        submittedBy: viewer.userId,
        submittedAt: now,
        status: 'pending'
      })
      .returning({ id: sms.submissions.id })
    submissionId = created!.id
  }

  const recordIds = idListParam(body.recordIds)

  if (kind === 'scores') {
    const assessments = await db
      .select({ id: sms.assessments.id })
      .from(sms.assessments)
      .where(and(eq(sms.assessments.courseId, courseId!), isNull(sms.assessments.deletedAt)))
    const assessmentIds = assessments.map(assessment => assessment.id)
    if (assessmentIds.length) {
      await db
        .update(sms.scores)
        .set({ submissionId, updatedAt: now })
        .where(and(inArray(sms.scores.assessmentId, assessmentIds), isNull(sms.scores.deletedAt)))
    }
  } else if (kind === 'attendance') {
    const conditions: Array<ReturnType<typeof and>> = [
      eq(sms.attendanceRecords.courseId, courseId!),
      isNull(sms.attendanceRecords.deletedAt)
    ]
    if (recordIds.length) conditions.push(inArray(sms.attendanceRecords.id, recordIds))
    await db
      .update(sms.attendanceRecords)
      .set({ submissionId, updatedAt: now })
      .where(and(...conditions))
  } else {
    if (!recordIds.length) {
      throw createError({ statusCode: 400, statusMessage: 'recordIds is required for a conduct submission' })
    }
    await db
      .update(sms.conductRecords)
      .set({ submissionId, updatedAt: now })
      .where(and(inArray(sms.conductRecords.id, recordIds), isNull(sms.conductRecords.deletedAt)))
  }

  const [row] = await submissionQuery().where(eq(sms.submissions.id, submissionId)).limit(1)

  return { submission: row ? submissionToDTO(row) : null }
})
