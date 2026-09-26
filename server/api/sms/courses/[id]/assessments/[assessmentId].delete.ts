/**
 * Course assessment — retire one.
 *
 * Soft-deleted, not removed: a student's history has to survive the assessment
 * being retired, and the scores that hang off it keep pointing at something. The
 * gradebook and the course overview both filter on `deleted_at`, so a retired
 * assessment simply stops being part of the course's weights.
 */
import { and, eq, isNull } from 'drizzle-orm'
import { db } from '../../../../../../../../server/database'
import * as sms from '../../../../../database/schema'
import { assertMayWriteCourse, getSmsViewer } from '../../../../../utils/access'
import { intParam } from '../../../../../utils/http'

export default defineEventHandler(async (event) => {
  const courseId = intParam(getRouterParam(event, 'id'))
  const assessmentId = intParam(getRouterParam(event, 'assessmentId'))
  if (!courseId || !assessmentId) {
    throw createError({ statusCode: 400, statusMessage: 'Invalid assessment id' })
  }

  const viewer = await getSmsViewer(event)
  await assertMayWriteCourse(viewer, courseId)

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

  const now = new Date()
  await db
    .update(sms.assessments)
    .set({ deletedAt: now, updatedAt: now })
    .where(eq(sms.assessments.id, assessmentId))

  return { ok: true }
})
