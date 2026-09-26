/**
 * School module — who is looking, and what they may do.
 *
 * The single place the module answers "which role is this, and what does that
 * role see", so no route handler has to invent a policy. The model is small on
 * purpose:
 *
 * | role       | reads                                   | writes                        |
 * | ---------- | --------------------------------------- | ----------------------------- |
 * | admin      | everything                              | everything                    |
 * | teacher    | the school directory and any student    | only the courses they teach   |
 * | student    | their own records, their class timetable | their own feedback            |
 * | guardian   | their children's records                | their own feedback            |
 * | anonymous  | the public home, published content      | nothing                       |
 *
 * Two readings of that table are worth spelling out, because they are judgement
 * calls rather than technicalities:
 *
 *   - a teacher may *read* any student's record. A teacher who cannot look up a
 *     pupil they are about to teach is not helped by a stricter rule, and the
 *     directory is an internal staff tool.
 *   - a teacher may only *write* marks and attendance for courses they are on the
 *     staff of. That is the line that matters, and it is enforced per course
 *     (`mayWriteCourse`) rather than per role.
 *
 * `readableStudentIds` is the read scope: `null` means "every student", an array
 * means "only these", and an empty array means "none" — which is how an anonymous
 * visitor ends up seeing nothing without a special case anywhere else.
 */
import { and, eq, inArray, isNull } from 'drizzle-orm'
import type { H3Event } from 'h3'
import { db } from '../../../../server/database'
import { getSessionUser } from '../../../../server/utils/auth'
import { getConfigValue } from '../../../../server/utils/configs'
import * as sms from '../database/schema'

export interface SmsViewer {
  userId: number | null
  admin: boolean
  teacher: { id: number, departmentId: number | null } | null
  student: { id: number, classId: number | null, rollId: string } | null
  guardianIds: number[]
  /** Students a guardian is responsible for. */
  wardIds: number[]
  /** null = every student is readable; [] = none. */
  readableStudentIds: number[] | null
}

const ANONYMOUS: SmsViewer = {
  userId: null,
  admin: false,
  teacher: null,
  student: null,
  guardianIds: [],
  wardIds: [],
  readableStudentIds: []
}

export async function getSmsViewer(event: H3Event): Promise<SmsViewer> {
  const ctx = await getSessionUser(event)
  if (!ctx) return { ...ANONYMOUS }

  const userId = ctx.user.id
  const admin = ctx.role?.name === 'admin'

  const [teacher, student, guardianRows] = await Promise.all([
    db.select({ id: sms.teachers.id, departmentId: sms.teachers.departmentId })
      .from(sms.teachers)
      .where(and(eq(sms.teachers.userId, userId), isNull(sms.teachers.deletedAt)))
      .limit(1),
    db.select({ id: sms.students.id, classId: sms.students.classId, rollId: sms.students.rollId })
      .from(sms.students)
      .where(and(eq(sms.students.userId, userId), isNull(sms.students.deletedAt)))
      .limit(1),
    db.select({ id: sms.guardians.id })
      .from(sms.guardians)
      .where(and(eq(sms.guardians.userId, userId), isNull(sms.guardians.deletedAt)))
  ])

  const guardianIds = guardianRows.map(row => row.id)
  const wardRows = guardianIds.length
    ? await db.select({ studentId: sms.studentGuardians.studentId })
        .from(sms.studentGuardians)
        .where(inArray(sms.studentGuardians.guardianId, guardianIds))
    : []
  const wardIds = [...new Set(wardRows.map(row => row.studentId))]

  // Admin and teacher see every student; a student sees themselves; a guardian
  // sees their children; anyone else sees nothing.
  let readableStudentIds: number[] | null
  if (admin || teacher.length > 0) readableStudentIds = null
  else if (student.length > 0) readableStudentIds = [student[0]!.id]
  else readableStudentIds = wardIds

  return {
    userId,
    admin,
    teacher: teacher[0] ?? null,
    student: student[0] ?? null,
    guardianIds,
    wardIds,
    readableStudentIds
  }
}

/** Whether the viewer is signed in at all. */
export function isSignedIn(viewer: SmsViewer): boolean {
  return viewer.userId != null
}

/** Whether the viewer is a member of staff (admin or teacher). */
export function isStaff(viewer: SmsViewer): boolean {
  return viewer.admin || viewer.teacher != null
}

export function assertSignedIn(viewer: SmsViewer): void {
  if (!isSignedIn(viewer)) {
    throw createError({ statusCode: 401, statusMessage: 'Sign in to use the school portal' })
  }
}

export function assertStaff(viewer: SmsViewer): void {
  assertSignedIn(viewer)
  if (!isStaff(viewer)) {
    throw createError({ statusCode: 403, statusMessage: 'Staff only' })
  }
}

export function assertAdmin(viewer: SmsViewer): void {
  assertSignedIn(viewer)
  if (!viewer.admin) {
    throw createError({ statusCode: 403, statusMessage: 'Administrators only' })
  }
}

// ------------------------------------------------------------- scoping ----

/** The student ids a read query should be limited to, or null for "all". */
export function studentScope(viewer: SmsViewer): number[] | null {
  return viewer.readableStudentIds
}

/** Whether a specific student may be read (an empty scope means no). */
export function mayReadStudent(viewer: SmsViewer, studentId: number): boolean {
  if (viewer.readableStudentIds === null) return true
  return viewer.readableStudentIds.includes(studentId)
}

/**
 * The courses a teacher is on the staff of.
 *
 * Returns null for an admin, meaning "all courses" — so `courseScope` composes
 * the same way `studentScope` does.
 */
export async function courseScope(viewer: SmsViewer): Promise<number[] | null> {
  if (viewer.admin) return null
  if (!viewer.teacher) return []
  const rows = await db
    .select({ courseId: sms.courseTeachers.courseId })
    .from(sms.courseTeachers)
    .where(eq(sms.courseTeachers.teacherId, viewer.teacher.id))
  return [...new Set(rows.map(row => row.courseId))]
}

/**
 * Whether the viewer may write marks, attendance or conduct for a course.
 *
 * Admins may write anything; a teacher must be on the course's staff. Note that
 * this is the check for *course-scoped* records — conduct against a student is
 * staff-level, because any teacher who saw something happen should be able to
 * record it.
 */
export async function mayWriteCourse(viewer: SmsViewer, courseId: number): Promise<boolean> {
  if (viewer.admin) return true
  if (!viewer.teacher) return false
  const [row] = await db
    .select({ courseId: sms.courseTeachers.courseId })
    .from(sms.courseTeachers)
    .where(and(
      eq(sms.courseTeachers.courseId, courseId),
      eq(sms.courseTeachers.teacherId, viewer.teacher.id)
    ))
    .limit(1)
  return Boolean(row)
}

export async function assertMayWriteCourse(viewer: SmsViewer, courseId: number): Promise<void> {
  assertStaff(viewer)
  if (!await mayWriteCourse(viewer, courseId)) {
    throw createError({ statusCode: 403, statusMessage: 'You do not teach this course' })
  }
}

// ------------------------------------------------------------ settings ----

/**
 * The semester new records should default to.
 *
 * Prefers the configured id, falls back to whichever semester is flagged current.
 * Returns null only when the school has no semesters at all.
 */
export async function getCurrentSemesterId(): Promise<number | null> {
  const configured = await getConfigValue<number>(sms.SMS_CURRENT_SEMESTER_KEY, 0).catch(() => 0)
  if (configured) {
    const [row] = await db
      .select({ id: sms.semesters.id })
      .from(sms.semesters)
      .where(and(eq(sms.semesters.id, configured), isNull(sms.semesters.deletedAt)))
      .limit(1)
    if (row) return row.id
  }
  const [current] = await db
    .select({ id: sms.semesters.id })
    .from(sms.semesters)
    .where(and(eq(sms.semesters.isCurrent, true), isNull(sms.semesters.deletedAt)))
    .limit(1)
  return current?.id ?? null
}

/** The school's display name and pass mark, for the public home and grading. */
export async function getSchoolSettings(): Promise<{ schoolName: string, passMark: number }> {
  const [schoolName, passMark] = await Promise.all([
    getConfigValue<string>(sms.SMS_SCHOOL_NAME_KEY, 'School').catch(() => 'School'),
    getConfigValue<number>(sms.SMS_PASS_MARK_KEY, 60).catch(() => 60)
  ])
  return { schoolName, passMark: Number.isFinite(passMark) ? passMark : 60 }
}
