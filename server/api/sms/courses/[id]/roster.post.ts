/**
 * Course roster — enrol and un-enrol students.
 *
 * `sms_course_students` is the enrolment every gradebook and attendance sheet
 * reads, so this is the endpoint that actually adds someone to a class. Enrol is
 * idempotent (an upsert that flips `is_active` back on), and un-enrol is a flag
 * rather than a delete — a student who leaves mid-term keeps their marks and the
 * row that proves they were there.
 */
import { and, eq, inArray } from 'drizzle-orm'
import { db } from '../../../../../../../server/database'
import * as sms from '../../../../database/schema'
import { assertMayWriteCourse, getSmsViewer } from '../../../../utils/access'
import { idListParam, intParam, today } from '../../../../utils/http'

export default defineEventHandler(async (event) => {
  const courseId = intParam(getRouterParam(event, 'id'))
  if (!courseId) throw createError({ statusCode: 400, statusMessage: 'Invalid course id' })

  const viewer = await getSmsViewer(event)
  await assertMayWriteCourse(viewer, courseId)

  const body = await readBody<{ add?: unknown, remove?: unknown }>(event).catch(() => ({}) as Record<string, unknown>)
  const add = idListParam(body.add)
  const remove = idListParam(body.remove)

  if (add.length) {
    await db
      .insert(sms.courseStudents)
      .values(add.map(studentId => ({ courseId, studentId, enrolledAt: today(), isActive: true })))
      .onConflictDoUpdate({
        target: [sms.courseStudents.courseId, sms.courseStudents.studentId],
        set: { isActive: true }
      })
  }

  if (remove.length) {
    await db
      .update(sms.courseStudents)
      .set({ isActive: false })
      .where(and(eq(sms.courseStudents.courseId, courseId), inArray(sms.courseStudents.studentId, remove)))
  }

  return { enrolled: add.length, removed: remove.length }
})
