/**
 * Course lessons — add a weekly placement.
 *
 * A timetable that merely *stores* a slot is not a timetable: the value is in
 * refusing the clash. Before the row is written we re-read this semester's
 * placements, add the candidate to the set, and run the same `findConflicts`
 * the timetable page uses. If the candidate is part of any clash the insert is
 * rejected with the conflict list, so the teacher sees *why* the slot is taken
 * (double-booked teacher, room, or class) instead of a generic error.
 */
import { and, eq, isNull } from 'drizzle-orm'
import { db } from '../../../../../../../server/database'
import * as sms from '../../../../database/schema'
import { assertMayWriteCourse, getSmsViewer } from '../../../../utils/access'
import { timetableEntries } from '../../../../utils/dto'
import { intParam, textParam } from '../../../../utils/http'
import { findConflicts } from '../../../../utils/timetable'

// A sentinel id for the not-yet-inserted candidate; real placements are serial
// and always positive, so this can never collide with one.
const CANDIDATE_ID = -1

export default defineEventHandler(async (event) => {
  const courseId = intParam(getRouterParam(event, 'id'))
  if (!courseId) throw createError({ statusCode: 400, statusMessage: 'Invalid course id' })

  const viewer = await getSmsViewer(event)
  await assertMayWriteCourse(viewer, courseId)

  const [course] = await db
    .select({ id: sms.courses.id, classId: sms.courses.classId, semesterId: sms.courses.semesterId })
    .from(sms.courses)
    .where(and(eq(sms.courses.id, courseId), isNull(sms.courses.deletedAt)))
    .limit(1)
  if (!course) throw createError({ statusCode: 404, statusMessage: 'Course not found' })

  const body = await readBody<Record<string, unknown>>(event).catch(() => ({}) as Record<string, unknown>)
  const periodId = intParam(body.periodId)
  const weekday = intParam(body.weekday)
  if (!periodId) throw createError({ statusCode: 400, statusMessage: 'periodId is required' })
  if (!weekday || weekday < 1 || weekday > 7) {
    throw createError({ statusCode: 400, statusMessage: 'weekday must be between 1 and 7' })
  }

  const [period] = await db
    .select({ id: sms.periods.id })
    .from(sms.periods)
    .where(eq(sms.periods.id, periodId))
    .limit(1)
  if (!period) throw createError({ statusCode: 400, statusMessage: 'Unknown period' })

  const classroomId = intParam(body.classroomId)
  const note = textParam(body.note, 300)

  const teacherRows = await db
    .select({ teacherId: sms.courseTeachers.teacherId })
    .from(sms.courseTeachers)
    .where(eq(sms.courseTeachers.courseId, courseId))

  const semesterFilter = course.semesterId == null
    ? isNull(sms.timetableEntries.semesterId)
    : eq(sms.timetableEntries.semesterId, course.semesterId)
  const placements = await timetableEntries(and(semesterFilter, isNull(sms.timetableEntries.deletedAt)))

  const conflicts = findConflicts([
    ...placements,
    {
      id: CANDIDATE_ID,
      courseId,
      periodId,
      weekday,
      classroomId,
      teacherIds: teacherRows.map(row => row.teacherId),
      classId: course.classId
    }
  ]).filter(conflict => conflict.entryIds.includes(CANDIDATE_ID))

  if (conflicts.length) {
    throw createError({
      statusCode: 409,
      statusMessage: 'That slot is already taken',
      data: { conflicts }
    })
  }

  const [inserted] = await db
    .insert(sms.timetableEntries)
    .values({
      semesterId: course.semesterId,
      courseId,
      periodId,
      weekday,
      classroomId,
      note
    })
    .returning({ id: sms.timetableEntries.id })

  const [entry] = await timetableEntries(and(
    eq(sms.timetableEntries.id, inserted!.id),
    isNull(sms.timetableEntries.deletedAt)
  ))

  return { entry: entry ?? null, conflicts: [] }
})
