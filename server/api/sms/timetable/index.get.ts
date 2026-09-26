/**
 * Timetable — the week, drawn and checked.
 *
 * One endpoint answers every way a week is looked at: a class's week, a
 * teacher's week, a room's week, or the whole school's. The scope is whichever
 * of `classId` / `teacherId` / `roomId` is given; with none, a staff viewer sees
 * everything. A student or guardian is deliberately restricted to a class they
 * belong to (their own, or a ward's) — an anonymous request is refused outright.
 *
 * `grid` and `conflicts` are both produced here from the same entries via the
 * `timetable.ts` helpers, so what the page draws and what it flags can never
 * disagree. Saturday only appears in the columns when it is actually used and
 * the scope is a class, so a Monday–Friday school never renders a dead column.
 */
import { and, eq, inArray, isNull, sql } from 'drizzle-orm'
import { db } from '../../../../../../server/database'
import { users } from '../../../../../../server/database/schema'
import * as sms from '../../../database/schema'
import { getCurrentSemesterId, getSmsViewer, isSignedIn, isStaff } from '../../../utils/access'
import { displayName, periodQuery, timetableEntries } from '../../../utils/dto'
import { intParam } from '../../../utils/http'
import { buildWeekGrid, findConflicts, SCHOOL_WEEKDAYS } from '../../../utils/timetable'
import type { Conflict, Period } from '../../../utils/timetable'

type ConflictKind = 'teacher' | 'classroom' | 'class'

interface Scope {
  kind: 'class' | 'teacher' | 'room' | 'all'
  id: number | null
  name: string | null
}

/**
 * Give each conflict its resource's display name.
 *
 * A conflict is described by (kind, key); turning the key into a name needs a
 * lookup on the right table. Only the keys actually present are fetched, and an
 * unresolvable key becomes a null label rather than a fabricated one.
 */
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
  if (!isSignedIn(viewer)) {
    throw createError({ statusCode: 403, statusMessage: 'Sign in to view a timetable' })
  }

  const query = getQuery(event) as Record<string, unknown>
  const semesterId = intParam(query.semesterId) ?? await getCurrentSemesterId()
  const classId = intParam(query.classId)
  const teacherId = intParam(query.teacherId)
  const roomId = intParam(query.roomId)

  // A student/guardian may look at a class timetable, and only for a class they
  // are attached to — never a teacher's or a room's week.
  if (!isStaff(viewer)) {
    const allowed = new Set<number>()
    if (viewer.student?.classId) allowed.add(viewer.student.classId)
    if (viewer.wardIds.length) {
      const wards = await db
        .select({ classId: sms.students.classId })
        .from(sms.students)
        .where(inArray(sms.students.id, viewer.wardIds))
      for (const ward of wards) if (ward.classId) allowed.add(ward.classId)
    }
    if (!classId || !allowed.has(classId)) {
      throw createError({ statusCode: 403, statusMessage: 'You may only view your own class timetable' })
    }
  }

  const conditions: Array<ReturnType<typeof and>> = [isNull(sms.timetableEntries.deletedAt)]
  if (semesterId) conditions.push(eq(sms.timetableEntries.semesterId, semesterId))

  const scope: Scope = { kind: 'all', id: null, name: null }
  if (classId) {
    conditions.push(eq(sms.courses.classId, classId))
    scope.kind = 'class'
    scope.id = classId
  } else if (teacherId) {
    const taught = await db
      .select({ courseId: sms.courseTeachers.courseId })
      .from(sms.courseTeachers)
      .where(eq(sms.courseTeachers.teacherId, teacherId))
    const courseIds = [...new Set(taught.map(row => row.courseId))]
    conditions.push(courseIds.length ? inArray(sms.timetableEntries.courseId, courseIds) : sql`false`)
    scope.kind = 'teacher'
    scope.id = teacherId
  } else if (roomId) {
    conditions.push(eq(sms.timetableEntries.classroomId, roomId))
    scope.kind = 'room'
    scope.id = roomId
  }

  const [periods, entries] = await Promise.all([
    periodQuery(),
    timetableEntries(and(...conditions))
  ])

  // Resolve the scope's own name for the page heading.
  if (scope.kind === 'class' && scope.id) {
    const [row] = await db.select({ name: sms.classes.name }).from(sms.classes).where(eq(sms.classes.id, scope.id)).limit(1)
    scope.name = row?.name ?? null
  } else if (scope.kind === 'teacher' && scope.id) {
    const [row] = await db
      .select({ name: displayName })
      .from(sms.teachers)
      .innerJoin(users, eq(sms.teachers.userId, users.id))
      .where(eq(sms.teachers.id, scope.id))
      .limit(1)
    scope.name = row?.name ?? null
  } else if (scope.kind === 'room' && scope.id) {
    const [row] = await db.select({ name: sms.classrooms.name }).from(sms.classrooms).where(eq(sms.classrooms.id, scope.id)).limit(1)
    scope.name = row?.name ?? null
  }

  const usesSaturday = entries.some(entry => entry.weekday === 6)
  const weekdays: number[] = scope.kind === 'class' && usesSaturday
    ? [...SCHOOL_WEEKDAYS, 6]
    : [...SCHOOL_WEEKDAYS]

  return {
    periods: periods as Period[],
    weekdays,
    entries,
    conflicts: await resolveLabels(findConflicts(entries)),
    grid: buildWeekGrid(periods, entries, weekdays),
    scope,
    semesterId
  }
})
