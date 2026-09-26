/**
 * School — one student's record.
 *
 * This is the endpoint that decides whether a guardian may see a name: the scope
 * check (`mayReadStudent`) answers 404 for a student outside the viewer's reach,
 * not 403, because a school hides records rather than confirming that a given
 * pupil exists. The record bundles the profile, the guardians, the recent conduct
 * history and the attendance rate, which is what the profile screen shows without
 * a second round trip.
 */
import { and, desc, eq, isNull } from 'drizzle-orm'
import { db } from '../../../../../../server/database'
import * as sms from '../../../database/schema'
import { assertSignedIn, getSmsViewer, mayReadStudent } from '../../../utils/access'
import { summarizeAttendance } from '../../../utils/attendance'
import {
  conductRecordQuery,
  conductRecordToDTO,
  guardianQuery,
  hydrateGuardians,
  studentQuery,
  studentToDTO
} from '../../../utils/dto'
import { intParam } from '../../../utils/http'

export default defineEventHandler(async (event) => {
  const viewer = await getSmsViewer(event)
  assertSignedIn(viewer)

  const id = intParam(getRouterParam(event, 'id'))
  if (id == null || !mayReadStudent(viewer, id)) {
    throw createError({ statusCode: 404, statusMessage: 'Student not found' })
  }

  const [row] = await studentQuery()
    .where(and(eq(sms.students.id, id), isNull(sms.students.deletedAt)))
    .limit(1)
  if (!row) throw createError({ statusCode: 404, statusMessage: 'Student not found' })

  const [guardianRows, conductRows, attendanceRows] = await Promise.all([
    guardianQuery()
      .innerJoin(sms.studentGuardians, eq(sms.studentGuardians.guardianId, sms.guardians.id))
      .where(and(eq(sms.studentGuardians.studentId, id), isNull(sms.guardians.deletedAt))),
    conductRecordQuery()
      .where(and(eq(sms.conductRecords.studentId, id), isNull(sms.conductRecords.deletedAt)))
      .orderBy(desc(sms.conductRecords.date), desc(sms.conductRecords.id))
      .limit(50),
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

  return {
    student: studentToDTO(row),
    guardians: await hydrateGuardians(guardianRows),
    conduct: conductRows.map(conductRecordToDTO),
    attendance: summarizeAttendance(attendanceRows)
  }
})
