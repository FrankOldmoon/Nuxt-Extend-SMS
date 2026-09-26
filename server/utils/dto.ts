/**
 * School module — the projections the API returns.
 *
 * Every list endpoint reads through a query builder here and then hydrates it, so
 * a "student" always looks the same to the client no matter which page asked for
 * it: the display name resolved from the host user, the class and grade joined in,
 * and the counts computed in SQL rather than by shipping rows to the browser.
 *
 * Two conventions, applied everywhere:
 *
 *   - **Counts are correlated sub-selects, not extra round trips.** A class list
 *     wants a student count per row; doing that as one `select … (subselect)`
 *     keeps the endpoint a single query instead of N+1.
 *   - **`isoOrNull` for anything that came out of raw SQL.** The driver decides
 *     how to parse a value from the column type in the result metadata, and an
 *     aggregate is not always reported with the type the column holds, so a
 *     timestamp from `min()`/`max()` arrives as a string.
 */
import { and, eq, isNull, sql } from 'drizzle-orm'
import { db } from '../../../../server/database'
import { users } from '../../../../server/database/schema'
import * as sms from '../database/schema'

/**
 * A person's display name.
 *
 * `users.name` is optional on the host's user table and `username` is not, so the
 * fallback is the username — a row with a blank name should still be identifiable.
 */
export const displayName = sql<string>`coalesce(nullif(trim(${users.name}), ''), ${users.username})`

/** A timestamp from a hand-written SQL expression, as an ISO string. */
export function isoOrNull(value: unknown): string | null {
  if (value == null) return null
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value.toISOString()
  const parsed = new Date(String(value))
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString()
}

function iso(value: Date | null | undefined): string | null {
  return value ? isoOrNull(value) : null
}

// ============================================================== people =====

export interface StudentDTO {
  id: number
  userId: number
  name: string
  email: string | null
  avatarPath: string | null
  rollId: string
  status: string
  gender: string | null
  birthday: string | null
  enrolledAt: string | null
  photo: string | null
  address: string | null
  note: string | null
  classId: number | null
  className: string | null
  gradeId: number | null
  gradeName: string | null
  departmentName: string | null
}

const STUDENT_COLUMNS = {
  id: sms.students.id,
  userId: sms.students.userId,
  name: displayName,
  email: users.email,
  avatarPath: users.avatarPath,
  rollId: sms.students.rollId,
  status: sms.students.status,
  gender: sms.students.gender,
  birthday: sms.students.birthday,
  enrolledAt: sms.students.enrolledAt,
  photo: sms.students.photo,
  address: sms.students.address,
  note: sms.students.note,
  classId: sms.students.classId,
  className: sms.classes.name,
  gradeId: sms.classes.gradeId,
  gradeName: sms.grades.name,
  departmentName: sms.departments.name
}

export function studentQuery() {
  return db
    .select(STUDENT_COLUMNS)
    .from(sms.students)
    .innerJoin(users, eq(sms.students.userId, users.id))
    .leftJoin(sms.classes, eq(sms.students.classId, sms.classes.id))
    .leftJoin(sms.grades, eq(sms.classes.gradeId, sms.grades.id))
    .leftJoin(sms.departments, eq(sms.classes.departmentId, sms.departments.id))
}

export type StudentRow = Awaited<ReturnType<typeof studentQuery>>[number]

export function studentToDTO(row: StudentRow): StudentDTO {
  return {
    id: row.id,
    userId: row.userId,
    name: row.name,
    email: row.email,
    avatarPath: row.avatarPath,
    rollId: row.rollId,
    status: row.status,
    gender: row.gender,
    birthday: row.birthday,
    enrolledAt: row.enrolledAt,
    photo: row.photo,
    address: row.address,
    note: row.note,
    classId: row.classId,
    className: row.className,
    gradeId: row.gradeId,
    gradeName: row.gradeName,
    departmentName: row.departmentName
  }
}

export interface TeacherDTO {
  id: number
  userId: number
  name: string
  email: string | null
  avatarPath: string | null
  employeeNo: string | null
  title: string | null
  isForeign: boolean
  hiredAt: string | null
  note: string | null
  departmentId: number | null
  departmentName: string | null
  courseCount: number
}

const TEACHER_COLUMNS = {
  id: sms.teachers.id,
  userId: sms.teachers.userId,
  name: displayName,
  email: users.email,
  avatarPath: users.avatarPath,
  employeeNo: sms.teachers.employeeNo,
  title: sms.teachers.title,
  isForeign: sms.teachers.isForeign,
  hiredAt: sms.teachers.hiredAt,
  note: sms.teachers.note,
  departmentId: sms.teachers.departmentId,
  departmentName: sms.departments.name,
  courseCount: sql<number>`(select count(*)::int from sms_course_teachers ct join sms_courses c on c.id = ct.course_id
    where ct.teacher_id = ${sms.teachers.id} and c.deleted_at is null)`
}

export function teacherQuery() {
  return db
    .select(TEACHER_COLUMNS)
    .from(sms.teachers)
    .innerJoin(users, eq(sms.teachers.userId, users.id))
    .leftJoin(sms.departments, eq(sms.teachers.departmentId, sms.departments.id))
}

export type TeacherRow = Awaited<ReturnType<typeof teacherQuery>>[number]

export function teacherToDTO(row: TeacherRow): TeacherDTO {
  return {
    id: row.id,
    userId: row.userId,
    name: row.name,
    email: row.email,
    avatarPath: row.avatarPath,
    employeeNo: row.employeeNo,
    title: row.title,
    isForeign: row.isForeign,
    hiredAt: row.hiredAt,
    note: row.note,
    departmentId: row.departmentId,
    departmentName: row.departmentName,
    courseCount: row.courseCount
  }
}

export interface GuardianDTO {
  id: number
  userId: number | null
  name: string
  relation: string | null
  phone: string | null
  email: string | null
  occupation: string | null
  company: string | null
  address: string | null
  /** Children this guardian is responsible for. */
  students: Array<{ id: number, name: string, rollId: string, className: string | null, isPrimary: boolean }>
}

export function guardianQuery() {
  return db
    .select({
      id: sms.guardians.id,
      userId: sms.guardians.userId,
      name: sms.guardians.name,
      relation: sms.guardians.relation,
      phone: sms.guardians.phone,
      email: sms.guardians.email,
      occupation: sms.guardians.occupation,
      company: sms.guardians.company,
      address: sms.guardians.address
    })
    .from(sms.guardians)
}

export type GuardianRow = Awaited<ReturnType<typeof guardianQuery>>[number]

/** Attach each guardian's children in one extra query rather than N. */
export async function hydrateGuardians(rows: GuardianRow[]): Promise<GuardianDTO[]> {
  const ids = rows.map(row => row.id)
  const links = ids.length
    ? await db
        .select({
          guardianId: sms.studentGuardians.guardianId,
          isPrimary: sms.studentGuardians.isPrimary,
          id: sms.students.id,
          rollId: sms.students.rollId,
          name: displayName,
          className: sms.classes.name
        })
        .from(sms.studentGuardians)
        .innerJoin(sms.students, eq(sms.studentGuardians.studentId, sms.students.id))
        .innerJoin(users, eq(sms.students.userId, users.id))
        .leftJoin(sms.classes, eq(sms.students.classId, sms.classes.id))
        .where(and(sql`${sms.studentGuardians.guardianId} in (${sql.raw(ids.join(','))})`, isNull(sms.students.deletedAt)))
    : []

  const byGuardian = new Map<number, GuardianDTO['students']>()
  for (const link of links) {
    const bucket = byGuardian.get(link.guardianId)
    const entry = { id: link.id, name: link.name, rollId: link.rollId, className: link.className, isPrimary: link.isPrimary }
    if (bucket) bucket.push(entry)
    else byGuardian.set(link.guardianId, [entry])
  }

  return rows.map(row => ({ ...row, students: byGuardian.get(row.id) ?? [] }))
}

// ========================================================== structure ======

export interface ClassDTO {
  id: number
  name: string
  code: string | null
  capacity: number | null
  isGraduated: boolean
  gradeId: number | null
  gradeName: string | null
  departmentId: number | null
  departmentName: string | null
  headTeacherId: number | null
  headTeacherName: string | null
  classroomId: number | null
  classroomName: string | null
  studentCount: number
}

const headTeacher = sql<string | null>`(select coalesce(nullif(trim(u2.name), ''), u2.username) from sms_teachers t2
  join users u2 on u2.id = t2.user_id where t2.id = ${sms.classes.headTeacherId})`

export function classQuery() {
  return db
    .select({
      id: sms.classes.id,
      name: sms.classes.name,
      code: sms.classes.code,
      capacity: sms.classes.capacity,
      isGraduated: sms.classes.isGraduated,
      gradeId: sms.classes.gradeId,
      gradeName: sms.grades.name,
      departmentId: sms.classes.departmentId,
      departmentName: sms.departments.name,
      headTeacherId: sms.classes.headTeacherId,
      headTeacherName: headTeacher,
      classroomId: sms.classes.classroomId,
      classroomName: sms.classrooms.name,
      studentCount: sql<number>`(select count(*)::int from sms_students s
        where s.class_id = ${sms.classes.id} and s.deleted_at is null and s.status = 'enrolled')`
    })
    .from(sms.classes)
    .leftJoin(sms.grades, eq(sms.classes.gradeId, sms.grades.id))
    .leftJoin(sms.departments, eq(sms.classes.departmentId, sms.departments.id))
    .leftJoin(sms.classrooms, eq(sms.classes.classroomId, sms.classrooms.id))
}

export type ClassRow = Awaited<ReturnType<typeof classQuery>>[number]

export interface DepartmentDTO {
  id: number
  name: string
  code: string | null
  description: string | null
  sortOrder: number
  gradeCount: number
  teacherCount: number
}

export function departmentQuery() {
  return db
    .select({
      id: sms.departments.id,
      name: sms.departments.name,
      code: sms.departments.code,
      description: sms.departments.description,
      sortOrder: sms.departments.sortOrder,
      gradeCount: sql<number>`(select count(*)::int from sms_grades g where g.department_id = ${sms.departments.id} and g.deleted_at is null)`,
      teacherCount: sql<number>`(select count(*)::int from sms_teachers t where t.department_id = ${sms.departments.id} and t.deleted_at is null)`
    })
    .from(sms.departments)
}

export interface GradeDTO {
  id: number
  name: string
  code: string | null
  sortOrder: number
  departmentId: number | null
  departmentName: string | null
  classCount: number
  studentCount: number
}

export function gradeQuery() {
  return db
    .select({
      id: sms.grades.id,
      name: sms.grades.name,
      code: sms.grades.code,
      sortOrder: sms.grades.sortOrder,
      departmentId: sms.grades.departmentId,
      departmentName: sms.departments.name,
      classCount: sql<number>`(select count(*)::int from sms_classes c where c.grade_id = ${sms.grades.id} and c.deleted_at is null)`,
      studentCount: sql<number>`(select count(*)::int from sms_students s
        join sms_classes c on c.id = s.class_id
        where c.grade_id = ${sms.grades.id} and s.deleted_at is null and s.status = 'enrolled')`
    })
    .from(sms.grades)
    .leftJoin(sms.departments, eq(sms.grades.departmentId, sms.departments.id))
}

export interface SubjectDTO {
  id: number
  name: string
  code: string | null
  description: string | null
  sortOrder: number
  courseCount: number
}

export function subjectQuery() {
  return db
    .select({
      id: sms.subjects.id,
      name: sms.subjects.name,
      code: sms.subjects.code,
      description: sms.subjects.description,
      sortOrder: sms.subjects.sortOrder,
      courseCount: sql<number>`(select count(*)::int from sms_courses c where c.subject_id = ${sms.subjects.id} and c.deleted_at is null)`
    })
    .from(sms.subjects)
}

export interface SemesterDTO {
  id: number
  name: string
  code: string | null
  startDate: string | null
  endDate: string | null
  isCurrent: boolean
  courseCount: number
}

export function semesterQuery() {
  return db
    .select({
      id: sms.semesters.id,
      name: sms.semesters.name,
      code: sms.semesters.code,
      startDate: sms.semesters.startDate,
      endDate: sms.semesters.endDate,
      isCurrent: sms.semesters.isCurrent,
      courseCount: sql<number>`(select count(*)::int from sms_courses c where c.semester_id = ${sms.semesters.id} and c.deleted_at is null)`
    })
    .from(sms.semesters)
}

export interface ClassroomDTO {
  id: number
  name: string
  code: string | null
  building: string | null
  seats: number | null
  kind: string
}

export function classroomQuery() {
  return db
    .select({
      id: sms.classrooms.id,
      name: sms.classrooms.name,
      code: sms.classrooms.code,
      building: sms.classrooms.building,
      seats: sms.classrooms.seats,
      kind: sms.classrooms.kind
    })
    .from(sms.classrooms)
}

export function periodQuery() {
  return db
    .select({
      id: sms.periods.id,
      name: sms.periods.name,
      index: sms.periods.index,
      startTime: sms.periods.startTime,
      endTime: sms.periods.endTime,
      kind: sms.periods.kind
    })
    .from(sms.periods)
    .orderBy(sms.periods.index)
}

// ============================================================ courses ======

export interface CourseTeacherRef {
  teacherId: number
  name: string
  role: string
}

export interface CourseDTO {
  id: number
  name: string
  code: string | null
  description: string | null
  cover: string | null
  credits: number
  isGraded: boolean
  subjectId: number | null
  subjectName: string | null
  classId: number | null
  className: string | null
  departmentId: number | null
  departmentName: string | null
  semesterId: number | null
  semesterName: string | null
  classroomId: number | null
  classroomName: string | null
  studentCount: number
  assessmentCount: number
  teachers: CourseTeacherRef[]
}

export function courseQuery() {
  return db
    .select({
      id: sms.courses.id,
      name: sms.courses.name,
      code: sms.courses.code,
      description: sms.courses.description,
      cover: sms.courses.cover,
      credits: sms.courses.credits,
      isGraded: sms.courses.isGraded,
      subjectId: sms.courses.subjectId,
      subjectName: sms.subjects.name,
      classId: sms.courses.classId,
      className: sms.classes.name,
      departmentId: sms.courses.departmentId,
      departmentName: sms.departments.name,
      semesterId: sms.courses.semesterId,
      semesterName: sms.semesters.name,
      classroomId: sms.courses.classroomId,
      classroomName: sms.classrooms.name,
      studentCount: sql<number>`(select count(*)::int from sms_course_students cs
        where cs.course_id = ${sms.courses.id} and cs.is_active)`,
      assessmentCount: sql<number>`(select count(*)::int from sms_assessments a
        where a.course_id = ${sms.courses.id} and a.deleted_at is null)`
    })
    .from(sms.courses)
    .leftJoin(sms.subjects, eq(sms.courses.subjectId, sms.subjects.id))
    .leftJoin(sms.classes, eq(sms.courses.classId, sms.classes.id))
    .leftJoin(sms.departments, eq(sms.courses.departmentId, sms.departments.id))
    .leftJoin(sms.semesters, eq(sms.courses.semesterId, sms.semesters.id))
    .leftJoin(sms.classrooms, eq(sms.courses.classroomId, sms.classrooms.id))
}

export type CourseRow = Awaited<ReturnType<typeof courseQuery>>[number]

/** Attach the staff list to each course, in one extra query. */
export async function hydrateCourses(rows: CourseRow[]): Promise<CourseDTO[]> {
  const ids = rows.map(row => row.id)
  const staff = ids.length
    ? await db
        .select({
          courseId: sms.courseTeachers.courseId,
          teacherId: sms.courseTeachers.teacherId,
          role: sms.courseTeachers.role,
          name: displayName
        })
        .from(sms.courseTeachers)
        .innerJoin(sms.teachers, eq(sms.courseTeachers.teacherId, sms.teachers.id))
        .innerJoin(users, eq(sms.teachers.userId, users.id))
        .where(sql`${sms.courseTeachers.courseId} in (${sql.raw(ids.join(','))})`)
    : []

  const byCourse = new Map<number, CourseTeacherRef[]>()
  for (const row of staff) {
    const bucket = byCourse.get(row.courseId)
    const entry = { teacherId: row.teacherId, name: row.name, role: row.role }
    if (bucket) bucket.push(entry)
    else byCourse.set(row.courseId, [entry])
  }

  return rows.map(row => ({ ...row, teachers: byCourse.get(row.id) ?? [] }))
}

// ========================================================== timetable ======

export interface TimetableEntryDTO {
  id: number
  courseId: number
  courseName: string
  subjectName: string | null
  classId: number | null
  className: string | null
  semesterId: number | null
  periodId: number
  periodName: string | null
  weekday: number
  classroomId: number | null
  classroomName: string | null
  teacherIds: number[]
  teacherNames: string[]
  note: string | null
}

/**
 * Placements, already carrying the teacher list and the class they belong to —
 * which is what `findConflicts` needs, so the timetable endpoint can check its own
 * work without a second pass over the database.
 */
export async function timetableEntries(where: ReturnType<typeof and>): Promise<TimetableEntryDTO[]> {
  const rows = await db
    .select({
      id: sms.timetableEntries.id,
      courseId: sms.timetableEntries.courseId,
      courseName: sms.courses.name,
      subjectName: sms.subjects.name,
      classId: sms.courses.classId,
      className: sms.classes.name,
      semesterId: sms.timetableEntries.semesterId,
      periodId: sms.timetableEntries.periodId,
      periodName: sms.periods.name,
      weekday: sms.timetableEntries.weekday,
      classroomId: sms.timetableEntries.classroomId,
      classroomName: sms.classrooms.name,
      note: sms.timetableEntries.note
    })
    .from(sms.timetableEntries)
    .innerJoin(sms.courses, eq(sms.timetableEntries.courseId, sms.courses.id))
    .leftJoin(sms.subjects, eq(sms.courses.subjectId, sms.subjects.id))
    .leftJoin(sms.classes, eq(sms.courses.classId, sms.classes.id))
    .leftJoin(sms.periods, eq(sms.timetableEntries.periodId, sms.periods.id))
    .leftJoin(sms.classrooms, eq(sms.timetableEntries.classroomId, sms.classrooms.id))
    .where(where)

  const ids = rows.map(row => row.id)
  const staff = ids.length
    ? await db
        .select({
          entryId: sms.timetableEntries.id,
          teacherId: sms.courseTeachers.teacherId,
          name: displayName
        })
        .from(sms.timetableEntries)
        .innerJoin(sms.courseTeachers, eq(sms.courseTeachers.courseId, sms.timetableEntries.courseId))
        .innerJoin(sms.teachers, eq(sms.courseTeachers.teacherId, sms.teachers.id))
        .innerJoin(users, eq(sms.teachers.userId, users.id))
        .where(sql`${sms.timetableEntries.id} in (${sql.raw(ids.join(','))})`)
    : []

  const byEntry = new Map<number, { ids: number[], names: string[] }>()
  for (const row of staff) {
    const bucket = byEntry.get(row.entryId) ?? { ids: [], names: [] }
    bucket.ids.push(row.teacherId)
    bucket.names.push(row.name)
    byEntry.set(row.entryId, bucket)
  }

  return rows.map(row => ({
    ...row,
    teacherIds: byEntry.get(row.id)?.ids ?? [],
    teacherNames: byEntry.get(row.id)?.names ?? []
  }))
}

// ======================================================== assessments ======

export interface AssessmentDTO {
  id: number
  courseId: number
  semesterId: number | null
  name: string
  kind: string
  weight: number
  maxScore: number
  dueAt: string | null
  description: string | null
  sortOrder: number
  /** How many of the course's students have a mark. */
  markedCount: number
  /** The course's student count — the denominator for "markedCount". */
  studentCount: number
}

export function assessmentQuery() {
  return db
    .select({
      id: sms.assessments.id,
      courseId: sms.assessments.courseId,
      semesterId: sms.assessments.semesterId,
      name: sms.assessments.name,
      kind: sms.assessments.kind,
      weight: sms.assessments.weight,
      maxScore: sms.assessments.maxScore,
      dueAt: sms.assessments.dueAt,
      description: sms.assessments.description,
      sortOrder: sms.assessments.sortOrder,
      markedCount: sql<number>`(select count(*)::int from sms_scores sc
        where sc.assessment_id = ${sms.assessments.id} and sc.deleted_at is null and sc.score is not null)`,
      studentCount: sql<number>`(select count(*)::int from sms_course_students cs
        where cs.course_id = ${sms.assessments.courseId} and cs.is_active)`
    })
    .from(sms.assessments)
}

export type AssessmentRow = Awaited<ReturnType<typeof assessmentQuery>>[number]

export function assessmentToDTO(row: AssessmentRow): AssessmentDTO {
  return { ...row, dueAt: iso(row.dueAt) }
}

// =========================================================== workflow =====

export interface SubmissionDTO {
  id: number
  kind: string
  title: string | null
  status: string
  courseId: number | null
  courseName: string | null
  className: string | null
  semesterId: number | null
  semesterName: string | null
  submittedBy: number | null
  submitterName: string | null
  submittedAt: string | null
  reviewedBy: number | null
  reviewerName: string | null
  reviewedAt: string | null
  reviewNote: string | null
  /** How many records are attached, so a reviewer knows the size of the batch. */
  recordCount: number
}

const submitter = sql<string | null>`(select coalesce(nullif(trim(u3.name), ''), u3.username) from users u3
  where u3.id = ${sms.submissions.submittedBy})`
const reviewer = sql<string | null>`(select coalesce(nullif(trim(u4.name), ''), u4.username) from users u4
  where u4.id = ${sms.submissions.reviewedBy})`

/** The record count depends on which kind of batch this is. */
const recordCount = sql<number>`(
  case ${sms.submissions.kind}
    when 'scores' then (select count(*)::int from sms_scores sc where sc.submission_id = ${sms.submissions.id})
    when 'attendance' then (select count(*)::int from sms_attendance_records ar where ar.submission_id = ${sms.submissions.id})
    when 'conduct' then (select count(*)::int from sms_conduct_records cr where cr.submission_id = ${sms.submissions.id})
    else 0
  end)`

export function submissionQuery() {
  return db
    .select({
      id: sms.submissions.id,
      kind: sms.submissions.kind,
      title: sms.submissions.title,
      status: sms.submissions.status,
      courseId: sms.submissions.courseId,
      courseName: sms.courses.name,
      className: sms.classes.name,
      semesterId: sms.submissions.semesterId,
      semesterName: sms.semesters.name,
      submittedBy: sms.submissions.submittedBy,
      submitterName: submitter,
      submittedAt: sms.submissions.submittedAt,
      reviewedBy: sms.submissions.reviewedBy,
      reviewerName: reviewer,
      reviewedAt: sms.submissions.reviewedAt,
      reviewNote: sms.submissions.reviewNote,
      recordCount
    })
    .from(sms.submissions)
    .leftJoin(sms.courses, eq(sms.submissions.courseId, sms.courses.id))
    .leftJoin(sms.classes, eq(sms.courses.classId, sms.classes.id))
    .leftJoin(sms.semesters, eq(sms.submissions.semesterId, sms.semesters.id))
}

export type SubmissionRow = Awaited<ReturnType<typeof submissionQuery>>[number]

export function submissionToDTO(row: SubmissionRow): SubmissionDTO {
  return {
    ...row,
    submittedAt: iso(row.submittedAt),
    reviewedAt: iso(row.reviewedAt)
  }
}

// ============================================================ conduct ======

export interface ConductCategoryDTO {
  id: number
  name: string
  kind: string
  description: string | null
  sortOrder: number
  ruleCount: number
}

export function conductCategoryQuery() {
  return db
    .select({
      id: sms.conductCategories.id,
      name: sms.conductCategories.name,
      kind: sms.conductCategories.kind,
      description: sms.conductCategories.description,
      sortOrder: sms.conductCategories.sortOrder,
      ruleCount: sql<number>`(select count(*)::int from sms_conduct_rules r
        where r.category_id = ${sms.conductCategories.id} and r.deleted_at is null)`
    })
    .from(sms.conductCategories)
}

export interface ConductRuleDTO {
  id: number
  categoryId: number | null
  categoryName: string | null
  categoryKind: string | null
  name: string
  description: string | null
  points: number
  sortOrder: number
}

export function conductRuleQuery() {
  return db
    .select({
      id: sms.conductRules.id,
      categoryId: sms.conductRules.categoryId,
      categoryName: sms.conductCategories.name,
      categoryKind: sms.conductCategories.kind,
      name: sms.conductRules.name,
      description: sms.conductRules.description,
      points: sms.conductRules.points,
      sortOrder: sms.conductRules.sortOrder
    })
    .from(sms.conductRules)
    .leftJoin(sms.conductCategories, eq(sms.conductRules.categoryId, sms.conductCategories.id))
}

export interface ConductRecordDTO {
  id: number
  studentId: number
  studentName: string
  rollId: string
  className: string | null
  ruleId: number | null
  ruleName: string | null
  kind: string
  points: number
  courseId: number | null
  courseName: string | null
  semesterId: number | null
  date: string
  description: string | null
  recordedBy: number | null
  recorderName: string | null
  submissionId: number | null
}

const recorder = sql<string | null>`(select coalesce(nullif(trim(u6.name), ''), u6.username) from sms_teachers t6
  join users u6 on u6.id = t6.user_id where t6.id = ${sms.conductRecords.recordedBy})`

export function conductRecordQuery() {
  return db
    .select({
      id: sms.conductRecords.id,
      studentId: sms.conductRecords.studentId,
      studentName: displayName,
      rollId: sms.students.rollId,
      className: sms.classes.name,
      ruleId: sms.conductRecords.ruleId,
      ruleName: sms.conductRules.name,
      kind: sms.conductRecords.kind,
      points: sms.conductRecords.points,
      courseId: sms.conductRecords.courseId,
      courseName: sms.courses.name,
      semesterId: sms.conductRecords.semesterId,
      date: sms.conductRecords.date,
      description: sms.conductRecords.description,
      recordedBy: sms.conductRecords.recordedBy,
      recorderName: recorder,
      submissionId: sms.conductRecords.submissionId
    })
    .from(sms.conductRecords)
    .innerJoin(sms.students, eq(sms.conductRecords.studentId, sms.students.id))
    .innerJoin(users, eq(sms.students.userId, users.id))
    .leftJoin(sms.classes, eq(sms.students.classId, sms.classes.id))
    .leftJoin(sms.conductRules, eq(sms.conductRecords.ruleId, sms.conductRules.id))
    .leftJoin(sms.courses, eq(sms.conductRecords.courseId, sms.courses.id))
}

export type ConductRecordRow = Awaited<ReturnType<typeof conductRecordQuery>>[number]

export function conductRecordToDTO(row: ConductRecordRow): ConductRecordDTO {
  return { ...row }
}

// ============================================================ content ======

export interface NoticeDTO {
  id: number
  title: string
  body: string | null
  audience: string
  isPinned: boolean
  publishedAt: string | null
  expiresAt: string | null
  authorName: string | null
}

const authorName = sql<string | null>`(select coalesce(nullif(trim(u7.name), ''), u7.username) from users u7
  where u7.id = ${sms.notices.authorId})`

export function noticeQuery() {
  return db
    .select({
      id: sms.notices.id,
      title: sms.notices.title,
      body: sms.notices.body,
      audience: sms.notices.audience,
      isPinned: sms.notices.isPinned,
      publishedAt: sms.notices.publishedAt,
      expiresAt: sms.notices.expiresAt,
      authorName
    })
    .from(sms.notices)
}

export type NoticeRow = Awaited<ReturnType<typeof noticeQuery>>[number]

export function noticeToDTO(row: NoticeRow): NoticeDTO {
  return { ...row, publishedAt: iso(row.publishedAt), expiresAt: iso(row.expiresAt) }
}

export interface ArticleDTO {
  id: number
  title: string
  slug: string
  summary: string | null
  body: string | null
  cover: string | null
  publishedAt: string | null
  readCount: number
  authorName: string | null
}

export function articleQuery() {
  return db
    .select({
      id: sms.articles.id,
      title: sms.articles.title,
      slug: sms.articles.slug,
      summary: sms.articles.summary,
      body: sms.articles.body,
      cover: sms.articles.cover,
      publishedAt: sms.articles.publishedAt,
      readCount: sms.articles.readCount,
      authorName: sql<string | null>`(select coalesce(nullif(trim(u8.name), ''), u8.username) from users u8
        where u8.id = ${sms.articles.authorId})`
    })
    .from(sms.articles)
}

export type ArticleRow = Awaited<ReturnType<typeof articleQuery>>[number]

export function articleToDTO(row: ArticleRow): ArticleDTO {
  return { ...row, publishedAt: iso(row.publishedAt) }
}

export interface ActivityDTO {
  id: number
  name: string
  description: string | null
  location: string | null
  startAt: string | null
  endAt: string | null
  semesterId: number | null
  semesterName: string | null
  cover: string | null
  publishedAt: string | null
}

export function activityQuery() {
  return db
    .select({
      id: sms.activities.id,
      name: sms.activities.name,
      description: sms.activities.description,
      location: sms.activities.location,
      startAt: sms.activities.startAt,
      endAt: sms.activities.endAt,
      semesterId: sms.activities.semesterId,
      semesterName: sms.semesters.name,
      cover: sms.activities.cover,
      publishedAt: sms.activities.publishedAt
    })
    .from(sms.activities)
    .leftJoin(sms.semesters, eq(sms.activities.semesterId, sms.semesters.id))
}

export type ActivityRow = Awaited<ReturnType<typeof activityQuery>>[number]

export function activityToDTO(row: ActivityRow): ActivityDTO {
  return { ...row, startAt: iso(row.startAt), endAt: iso(row.endAt), publishedAt: iso(row.publishedAt) }
}

export interface FeedbackDTO {
  id: number
  userId: number | null
  userName: string | null
  kind: string
  title: string
  body: string | null
  status: string
  handledBy: number | null
  handledAt: string | null
  reply: string | null
  createdAt: string | null
}

export function feedbackQuery() {
  return db
    .select({
      id: sms.feedback.id,
      userId: sms.feedback.userId,
      userName: sql<string | null>`(select coalesce(nullif(trim(u9.name), ''), u9.username) from users u9
        where u9.id = ${sms.feedback.userId})`,
      kind: sms.feedback.kind,
      title: sms.feedback.title,
      body: sms.feedback.body,
      status: sms.feedback.status,
      handledBy: sms.feedback.handledBy,
      handledAt: sms.feedback.handledAt,
      reply: sms.feedback.reply,
      createdAt: sms.feedback.createdAt
    })
    .from(sms.feedback)
}

export type FeedbackRow = Awaited<ReturnType<typeof feedbackQuery>>[number]

export function feedbackToDTO(row: FeedbackRow): FeedbackDTO {
  return { ...row, handledAt: iso(row.handledAt), createdAt: iso(row.createdAt) }
}
