/**
 * Timetable — every clash in the school.
 *
 * The "before term starts" report, kept separate from the timetable page because
 * it is asked for once and over the whole school rather than for one class. It
 * reuses `findConflicts` and the same label resolution, so a clash that the
 * timetable page shows red is exactly the clash that appears here.
 *
 * Staff only: a student has no business knowing which teacher is double-booked.
 */
import { and, eq, inArray, isNull } from 'drizzle-orm'
import { db } from '../../../../../../server/database'
import { users } from '../../../../../../server/database/schema'
import * as sms from '../../../database/schema'
import { assertStaff, getSmsViewer } from '../../../utils/access'
import { displayName, timetableEntries } from '../../../utils/dto'
import { intParam } from '../../../utils/http'
import { findConflicts } from '../../../utils/timetable'
import type { Conflict } from '../../../utils/timetable'

type ConflictKind = 'teacher' | 'classroom' | 'class'

async function resolveLabels(conflicts: Conflict[]): Promise<Array<{
  kind: ConflictKind
  key: number
  weekday: number
  periodId: number
  entryIds: number[]
  label: string | null
}>> {
  const labels = new Map<string, string>()

  const teacherIds = [...new Set(conflicts.filter(row => row.kind === 'teacher').map(row => row.key))]
  if (teacherIds.length) {
    const rows = await db
      .select({ id: sms.teachers.id, name: displayName })
      .from(sms.teachers)
      .innerJoin(users, eq(sms.teachers.userId, users.id))
      .where(inArray(sms.teachers.id, teacherIds))
    for (const row of rows) labels.set(`teacher:${row.id}`, row.name)
  }

  const classroomIds = [...new Set(conflicts.filter(row => row.kind === 'classroom').map(row => row.key))]
  if (classroomIds.length) {
    const rows = await db
      .select({ id: sms.classrooms.id, name: sms.classrooms.name })
      .from(sms.classrooms)
      .where(inArray(sms.classrooms.id, classroomIds))
    for (const row of rows) labels.set(`classroom:${row.id}`, row.name)
  }

  const classIds = [...new Set(conflicts.filter(row => row.kind === 'class').map(row => row.key))]
  if (classIds.length) {
    const rows = await db
      .select({ id: sms.classes.id, name: sms.classes.name })
      .from(sms.classes)
      .where(inArray(sms.classes.id, classIds))
    for (const row of rows) labels.set(`class:${row.id}`, row.name)
  }

  return conflicts.map(row => ({ ...row, label: labels.get(`${row.kind}:${row.key}`) ?? null }))
}

export default defineEventHandler(async (event) => {
  const viewer = await getSmsViewer(event)
  assertStaff(viewer)

  const query = getQuery(event) as Record<string, unknown>
  const semesterId = intParam(query.semesterId)

  const conditions: Array<ReturnType<typeof and>> = [isNull(sms.timetableEntries.deletedAt)]
  if (semesterId) conditions.push(eq(sms.timetableEntries.semesterId, semesterId))

  const entries = await timetableEntries(and(...conditions))

  return { conflicts: await resolveLabels(findConflicts(entries)) }
})
