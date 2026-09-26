/**
 * Course attendance — take the roll.
 *
 * The upsert targets the schema's expression index, `(student_id, course_id,
 * date, coalesce(period_id, 0))` — the `coalesce` is there because Postgres
 * treats NULLs as distinct, so a plain index would allow several "whole day"
 * rows. The conflict target therefore has to repeat that exact expression.
 *
 * An approved attendance batch locks its own dates: re-taking a roll that has
 * been signed off is refused (409) until the batch is withdrawn, so the tidied
 * numbers an approver saw cannot change underneath them.
 */
import { and, eq, inArray, isNull, sql } from 'drizzle-orm'
import { db } from '../../../../../../../server/database'
import * as sms from '../../../../database/schema'
import { assertMayWriteCourse, getSmsViewer } from '../../../../utils/access'
import { isAttendanceStatus } from '../../../../utils/attendance'
import { dateParam, intParam, textParam } from '../../../../utils/http'

export default defineEventHandler(async (event) => {
  const courseId = intParam(getRouterParam(event, 'id'))
  if (!courseId) throw createError({ statusCode: 400, statusMessage: 'Invalid course id' })

  const viewer = await getSmsViewer(event)
  await assertMayWriteCourse(viewer, courseId)

  const body = await readBody<{ date?: unknown, periodId?: unknown, records?: unknown }>(event)
    .catch(() => ({}) as Record<string, unknown>)

  const date = dateParam(body.date)
  if (!date) throw createError({ statusCode: 400, statusMessage: 'A valid date is required' })

  let periodId: number | null = null
  if (body.periodId !== null && body.periodId !== undefined && body.periodId !== '') {
    periodId = intParam(body.periodId)
    if (!periodId) throw createError({ statusCode: 400, statusMessage: 'Invalid periodId' })
  }

  // Refuse when an approved batch already covers this date for this course.
  const approved = await db
    .select({ id: sms.submissions.id })
    .from(sms.submissions)
    .where(and(
      eq(sms.submissions.courseId, courseId),
      eq(sms.submissions.kind, 'attendance'),
      eq(sms.submissions.status, 'approved'),
      isNull(sms.submissions.deletedAt)
    ))
  if (approved.length) {
    const [locked] = await db
      .select({ id: sms.attendanceRecords.id })
      .from(sms.attendanceRecords)
      .where(and(
        eq(sms.attendanceRecords.courseId, courseId),
        eq(sms.attendanceRecords.date, date),
        inArray(sms.attendanceRecords.submissionId, approved.map(row => row.id)),
        isNull(sms.attendanceRecords.deletedAt)
      ))
      .limit(1)
    if (locked) {
      throw createError({ statusCode: 409, statusMessage: 'Attendance for that date has been approved' })
    }
  }

  const raw = Array.isArray(body.records) ? body.records : []
  const recordedBy = viewer.teacher?.id ?? null
  // Keyed by student so a duplicate in one request cannot make Postgres reject
  // the statement ("cannot affect row a second time").
  const values = new Map<number, {
    courseId: number
    studentId: number
    date: string
    periodId: number | null
    status: string
    minutesLate: number | null
    note: string | null
    recordedBy: number | null
  }>()

  for (const entry of raw) {
    if (!entry || typeof entry !== 'object') continue
    const row = entry as Record<string, unknown>
    const studentId = intParam(row.studentId)
    if (!studentId) continue

    const status = String(row.status ?? '')
    if (!isAttendanceStatus(status)) {
      throw createError({ statusCode: 400, statusMessage: `Invalid attendance status "${status}"` })
    }

    let minutesLate: number | null = null
    if (row.minutesLate != null && row.minutesLate !== '') {
      const parsed = Number(row.minutesLate)
      if (!Number.isFinite(parsed) || parsed < 0) {
        throw createError({ statusCode: 400, statusMessage: `Invalid minutesLate for student ${studentId}` })
      }
      minutesLate = Math.trunc(parsed)
    }

    values.set(studentId, {
      courseId,
      studentId,
      date,
      periodId,
      status,
      minutesLate,
      note: textParam(row.note, 300),
      recordedBy
    })
  }

  if (values.size) {
    const rows = [...values.values()]
    // `onConflictDoUpdate` can only name plain columns in `target` (pg's
    // `IndexColumn` is a column, never an expression), while this table's unique
    // index is on `coalesce(period_id, 0)`. The matching ON CONFLICT therefore
    // has to be spelled out by hand — drizzle would otherwise emit a bogus
    // column name for the expression.
    const tuples = rows.map(row => sql`(
      ${row.courseId}, ${row.studentId}, ${row.date}, ${row.periodId},
      ${row.status}, ${row.minutesLate}, ${row.note}, ${row.recordedBy}
    )`)
    await db.execute(sql`
      insert into sms_attendance_records
        (course_id, student_id, date, period_id, status, minutes_late, note, recorded_by)
      values ${sql.join(tuples, sql`, `)}
      on conflict (student_id, course_id, date, coalesce(period_id, 0)) do update set
        status = excluded.status,
        minutes_late = excluded.minutes_late,
        note = excluded.note,
        recorded_by = excluded.recorded_by,
        updated_at = now()
    `)
  }

  return { saved: values.size }
})
