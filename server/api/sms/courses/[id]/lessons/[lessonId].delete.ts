/**
 * Course lesson — remove a weekly placement.
 *
 * A weekly placement is a pattern, not history: removing one is a real delete
 * (there are no marks or attendance hanging off it), which is what makes "the
 * timetabler moved Tuesday's lesson" behave the way they expect.
 */
import { and, eq, isNull } from 'drizzle-orm'
import { db } from '../../../../../../../../server/database'
import * as sms from '../../../../../database/schema'
import { assertMayWriteCourse, getSmsViewer } from '../../../../../utils/access'
import { intParam } from '../../../../../utils/http'

export default defineEventHandler(async (event) => {
  const courseId = intParam(getRouterParam(event, 'id'))
  const lessonId = intParam(getRouterParam(event, 'lessonId'))
  if (!courseId || !lessonId) {
    throw createError({ statusCode: 400, statusMessage: 'Invalid lesson id' })
  }

  const viewer = await getSmsViewer(event)
  await assertMayWriteCourse(viewer, courseId)

  const [entry] = await db
    .select({ id: sms.timetableEntries.id })
    .from(sms.timetableEntries)
    .where(and(
      eq(sms.timetableEntries.id, lessonId),
      eq(sms.timetableEntries.courseId, courseId),
      isNull(sms.timetableEntries.deletedAt)
    ))
    .limit(1)
  if (!entry) throw createError({ statusCode: 404, statusMessage: 'Lesson not found' })

  await db.delete(sms.timetableEntries).where(eq(sms.timetableEntries.id, lessonId))

  return { ok: true }
})
