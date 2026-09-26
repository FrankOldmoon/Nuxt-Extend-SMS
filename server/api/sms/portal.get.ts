/**
 * School — the per-role dashboard summary.
 *
 * The portal is role-shaped: a teacher, a student, a guardian and an
 * administrator open the same page and need different things, so this endpoint
 * returns one block per applicable role and leaves the rest null. A viewer can
 * legitimately hold several roles at once (a teacher who is also a parent), which
 * is why the blocks are filled independently rather than switched on a single
 * "role" string, and why a signed-out visitor gets every block null and an empty
 * notice list instead of a 401 — the shell still has to render.
 *
 * The "average" figures reuse `courseTotal` / `overallAverage` from
 * `utils/grading`; a course with no marks contributes nothing rather than a zero.
 */
import { and, asc, desc, eq, gte, inArray, isNotNull, isNull, lte, sql } from 'drizzle-orm'
import { db } from '../../../../../server/database'
import { users } from '../../../../../server/database/schema'
import * as sms from '../../database/schema'
import type { SmsViewer } from '../../utils/access'
import { getCurrentSemesterId, getSchoolSettings, getSmsViewer } from '../../utils/access'
import { summarizeAttendance, summarizeByStudent } from '../../utils/attendance'
import {
  assessmentQuery,
  assessmentToDTO,
  classQuery,
  conductRecordQuery,
  conductRecordToDTO,
  courseQuery,
  hydrateCourses,
  noticeQuery,
  noticeToDTO,
  semesterQuery,
  studentQuery,
  studentToDTO,
  timetableEntries
} from '../../utils/dto'
import { courseTotal, overallAverage } from '../../utils/grading'

type ClientRole = 'admin' | 'teacher' | 'student' | 'guardian' | 'anonymous'

function todayIsoWeekday(): number {
  const day = new Date().getDay()
  return day === 0 ? 7 : day
}

async function viewerName(userId: number | null): Promise<string | null> {
  if (userId == null) return null
  const [row] = await db
    .select({ name: users.name, username: users.username })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1)
  if (!row) return null
  return (row.name ?? '').trim() || row.username
}

function clientViewer(viewer: SmsViewer, name: string | null) {
  const role: ClientRole = viewer.admin
    ? 'admin'
    : viewer.teacher
      ? 'teacher'
      : viewer.student
        ? 'student'
        : viewer.guardianIds.length > 0
          ? 'guardian'
          : 'anonymous'

  return {
    signedIn: viewer.userId != null,
    admin: viewer.admin,
    role,
    userId: viewer.userId,
    name,
    teacherId: viewer.teacher?.id ?? null,
    studentId: viewer.student?.id ?? null,
    classId: viewer.student?.classId ?? null,
    guardianIds: viewer.guardianIds,
    wardIds: viewer.wardIds,
    isStaff: viewer.admin || viewer.teacher != null,
    linked: viewer.admin || viewer.teacher != null || viewer.student != null || viewer.guardianIds.length > 0
  }
}

function noticeAudiences(viewer: SmsViewer): string[] {
  if (viewer.admin) return ['all', 'teachers', 'students', 'guardians']
  if (viewer.teacher) return ['all', 'teachers']
  if (viewer.student) return ['all', 'students']
  if (viewer.guardianIds.length > 0) return ['all', 'guardians']
  return ['all']
}

/** The graded, live courses a student is enrolled in, with their credit weight. */
async function studentGradedCourses(studentId: number) {
  return db
    .select({ id: sms.courses.id, credits: sms.courses.credits })
    .from(sms.courseStudents)
    .innerJoin(sms.courses, eq(sms.courseStudents.courseId, sms.courses.id))
    .where(and(
      eq(sms.courseStudents.studentId, studentId),
      eq(sms.courseStudents.isActive, true),
      eq(sms.courses.isGraded, true),
      isNull(sms.courses.deletedAt)
    ))
}

/** One student's weighted mark per course, ready for `overallAverage`. */
async function studentCourseTotals(studentId: number) {
  const courses = await studentGradedCourses(studentId)
  if (!courses.length) return []

  const assessmentRows = await db
    .select({ id: sms.assessments.id, courseId: sms.assessments.courseId, weight: sms.assessments.weight, maxScore: sms.assessments.maxScore })
    .from(sms.assessments)
    .where(and(
      inArray(sms.assessments.courseId, courses.map(course => course.id)),
      isNull(sms.assessments.deletedAt)
    ))

  const scoreRows = await db
    .select({ assessmentId: sms.scores.assessmentId, score: sms.scores.score })
    .from(sms.scores)
    .where(and(eq(sms.scores.studentId, studentId), isNull(sms.scores.deletedAt)))

  const byCourse = new Map<number, Array<{ id: number, weight: number, maxScore: number }>>()
  for (const row of assessmentRows) {
    const entry = { id: row.id, weight: row.weight, maxScore: row.maxScore }
    const bucket = byCourse.get(row.courseId)
    if (bucket) bucket.push(entry)
    else byCourse.set(row.courseId, [entry])
  }

  return courses.map((course) => {
    const { total } = courseTotal(byCourse.get(course.id) ?? [], scoreRows)
    return { courseId: course.id, total, credits: course.credits }
  })
}

async function studentAverage(studentId: number): Promise<number | null> {
  return overallAverage(await studentCourseTotals(studentId))
}

async function teacherPanel(viewer: SmsViewer, weekday: number) {
  const teacherId = viewer.teacher!.id

  const courseRows = await courseQuery()
    .where(and(
      isNull(sms.courses.deletedAt),
      sql`${sms.courses.id} in (select course_id from sms_course_teachers where teacher_id = ${teacherId})`
    ))
    .orderBy(asc(sms.courses.name))
  const courses = await hydrateCourses(courseRows)
  const courseIds = courseRows.map(row => row.id)

  const classIds = [...new Set(courseRows.map(row => row.classId).filter((id): id is number => id != null))]
  const classes = classIds.length
    ? await classQuery()
        .where(and(inArray(sms.classes.id, classIds), isNull(sms.classes.deletedAt)))
        .orderBy(asc(sms.classes.name))
    : []

  const [pendingRow] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(sms.submissions)
    .where(and(
      eq(sms.submissions.status, 'pending'),
      isNull(sms.submissions.deletedAt),
      courseIds.length ? inArray(sms.submissions.courseId, courseIds) : sql`false`
    ))

  const todayLessons = courseIds.length
    ? await timetableEntries(and(
        eq(sms.timetableEntries.weekday, weekday),
        isNull(sms.timetableEntries.deletedAt),
        inArray(sms.timetableEntries.courseId, courseIds)
      ))
    : []

  return { courses, classes, pendingSubmissions: pendingRow?.n ?? 0, todayLessons }
}

async function studentPanel(viewer: SmsViewer, weekday: number) {
  const studentId = viewer.student!.id
  const classId = viewer.student!.classId

  const [profileRow] = await studentQuery()
    .where(and(eq(sms.students.id, studentId), isNull(sms.students.deletedAt)))
    .limit(1)
  const profile = profileRow ? studentToDTO(profileRow) : null

  const courseRows = await courseQuery()
    .where(and(
      isNull(sms.courses.deletedAt),
      sql`${sms.courses.id} in (select course_id from sms_course_students where student_id = ${studentId} and is_active)`
    ))
    .orderBy(asc(sms.courses.name))
  const courses = await hydrateCourses(courseRows)

  const todayLessons = classId == null
    ? []
    : await timetableEntries(and(
        eq(sms.timetableEntries.weekday, weekday),
        isNull(sms.timetableEntries.deletedAt),
        eq(sms.courses.classId, classId)
      ))

  const attendanceRows = await db
    .select({
      studentId: sms.attendanceRecords.studentId,
      status: sms.attendanceRecords.status,
      minutesLate: sms.attendanceRecords.minutesLate,
      date: sms.attendanceRecords.date,
      periodId: sms.attendanceRecords.periodId
    })
    .from(sms.attendanceRecords)
    .where(and(eq(sms.attendanceRecords.studentId, studentId), isNull(sms.attendanceRecords.deletedAt)))

  const recentConduct = (await conductRecordQuery()
    .where(and(eq(sms.conductRecords.studentId, studentId), isNull(sms.conductRecords.deletedAt)))
    .orderBy(desc(sms.conductRecords.date), desc(sms.conductRecords.id))
    .limit(5)).map(conductRecordToDTO)

  const courseIds = courseRows.map(row => row.id)
  const pendingHomework = courseIds.length
    ? (await assessmentQuery()
        .where(and(
          isNull(sms.assessments.deletedAt),
          inArray(sms.assessments.courseId, courseIds),
          isNotNull(sms.assessments.dueAt),
          gte(sms.assessments.dueAt, new Date()),
          // Anything already marked (a real score, not merely a row) is done.
          sql`not exists (select 1 from sms_scores sc where sc.assessment_id = ${sms.assessments.id}
            and sc.student_id = ${studentId} and sc.score is not null and sc.deleted_at is null)`
        ))
        .orderBy(asc(sms.assessments.dueAt))
        .limit(5)).map(assessmentToDTO)
    : []

  return {
    profile,
    courses,
    todayLessons,
    average: await studentAverage(studentId),
    attendance: summarizeAttendance(attendanceRows),
    recentConduct,
    pendingHomework
  }
}

async function guardianPanel(viewer: SmsViewer) {
  const wardIds = viewer.wardIds
  if (!wardIds.length) return { children: [] }

  const studentRows = await studentQuery()
    .where(and(inArray(sms.students.id, wardIds), isNull(sms.students.deletedAt)))
  const byId = new Map(studentRows.map(row => [row.id, studentToDTO(row)]))

  const attendanceRows = await db
    .select({
      studentId: sms.attendanceRecords.studentId,
      status: sms.attendanceRecords.status,
      minutesLate: sms.attendanceRecords.minutesLate,
      date: sms.attendanceRecords.date,
      periodId: sms.attendanceRecords.periodId
    })
    .from(sms.attendanceRecords)
    .where(and(inArray(sms.attendanceRecords.studentId, wardIds), isNull(sms.attendanceRecords.deletedAt)))
  const attendanceByStudent = summarizeByStudent(attendanceRows)

  const conductRows = await db
    .select({ studentId: sms.conductRecords.studentId, kind: sms.conductRecords.kind, points: sms.conductRecords.points })
    .from(sms.conductRecords)
    .where(and(inArray(sms.conductRecords.studentId, wardIds), isNull(sms.conductRecords.deletedAt)))

  const merits = new Map<number, number>()
  const demerits = new Map<number, number>()
  for (const row of conductRows) {
    const bucket = row.kind === 'merit' ? merits : demerits
    bucket.set(row.studentId, (bucket.get(row.studentId) ?? 0) + row.points)
  }

  const children = await Promise.all(wardIds.map(async (id) => {
    const student = byId.get(id)
    if (!student) return null
    return {
      student,
      average: await studentAverage(id),
      attendance: attendanceByStudent.get(id) ?? summarizeAttendance([]),
      demerits: demerits.get(id) ?? 0,
      merits: merits.get(id) ?? 0
    }
  }))

  return { children: children.filter((child): child is NonNullable<typeof child> => child != null) }
}

async function adminPanel() {
  const [[pending], [students], [teachers], [guardians], [courses], [classes]] = await Promise.all([
    db.select({ n: sql<number>`count(*)::int` }).from(sms.submissions)
      .where(and(eq(sms.submissions.status, 'pending'), isNull(sms.submissions.deletedAt))),
    db.select({ n: sql<number>`count(*)::int` }).from(sms.students)
      .where(and(eq(sms.students.status, 'enrolled'), isNull(sms.students.deletedAt))),
    db.select({ n: sql<number>`count(*)::int` }).from(sms.teachers).where(isNull(sms.teachers.deletedAt)),
    db.select({ n: sql<number>`count(*)::int` }).from(sms.guardians).where(isNull(sms.guardians.deletedAt)),
    db.select({ n: sql<number>`count(*)::int` }).from(sms.courses).where(isNull(sms.courses.deletedAt)),
    db.select({ n: sql<number>`count(*)::int` }).from(sms.classes).where(isNull(sms.classes.deletedAt))
  ])

  return {
    pendingSubmissions: pending?.n ?? 0,
    counts: {
      students: students?.n ?? 0,
      teachers: teachers?.n ?? 0,
      guardians: guardians?.n ?? 0,
      courses: courses?.n ?? 0,
      classes: classes?.n ?? 0
    }
  }
}

export default defineEventHandler(async (event) => {
  const viewer = await getSmsViewer(event)
  const weekday = todayIsoWeekday()
  const now = new Date()

  const [name, school, currentSemesterId] = await Promise.all([
    viewerName(viewer.userId),
    getSchoolSettings(),
    getCurrentSemesterId()
  ])

  const semester = currentSemesterId == null
    ? null
    : (await semesterQuery()
        .where(and(eq(sms.semesters.id, currentSemesterId), isNull(sms.semesters.deletedAt)))
        .limit(1))[0] ?? null

  const notices = (await noticeQuery()
    .where(and(
      isNull(sms.notices.deletedAt),
      isNotNull(sms.notices.publishedAt),
      lte(sms.notices.publishedAt, now),
      inArray(sms.notices.audience, noticeAudiences(viewer))
    ))
    .orderBy(desc(sms.notices.isPinned), desc(sms.notices.publishedAt))
    .limit(5)).map(noticeToDTO)

  const [teacher, student, guardian, admin] = await Promise.all([
    viewer.teacher ? teacherPanel(viewer, weekday) : null,
    viewer.student ? studentPanel(viewer, weekday) : null,
    viewer.guardianIds.length > 0 ? guardianPanel(viewer) : null,
    viewer.admin ? adminPanel() : null
  ])

  return {
    viewer: clientViewer(viewer, name),
    schoolName: school.schoolName,
    semester,
    teacher,
    student,
    guardian,
    admin,
    notices
  }
})
