/**
 * School management system — Drizzle schema.
 *
 * A generic school information system. All tables use the `sms_` prefix and live
 * only inside this module. The host's generic dashboard CRUD is wired up for
 * every table (see `server/plugins/sms.ts`), so an administrator can enter and
 * approve raw data in the existing back office, while the module ships its own
 * multi-role portal for teachers, students and guardians.
 *
 * ## The five design decisions worth knowing
 *
 * **1. One assessment model, not four.** The obvious way to model marking is
 * separate tables for `exams`, `quizzes`, `homeworks` and a `usual` column on the
 * enrolment. That gives four vocabularies for the same thing and makes a report
 * card a union of four queries. Here a course has *assessments*
 * (`sms_assessments`) — each with a `kind` (usual / homework / quiz / midterm /
 * final / project) and a `weight` in percent — and *scores*
 * (`sms_scores`). A homework is an assessment. A final exam is an assessment. The
 * report card is one weighted sum, and "what did the homework count for" is a
 * column rather than an implementation detail. Weights must add up to 100 per
 * course; `server/utils/grading.ts` validates that and computes the total.
 *
 * **2. The timetable is periods + placements.** A `courses.weekday` column
 * cannot express "Tuesday, 3rd period, in Lab 2" and cannot be checked for
 * clashes. `sms_periods` defines the bell (name, index, start/end time, and
 * whether it is a lesson or a break); `sms_timetable_entries` places a course at
 * a (weekday, period) in an optional room. `server/utils/timetable.ts` finds
 * teacher / room / class clashes, which is only possible because a placement
 * names all three.
 *
 * **3. Attendance is per student, per date, optionally per period.** A full day
 * of approved leave and "was late to 3rd period" are both real records, so
 * `periodId` is nullable and a partial unique index (`coalesce(period_id, 0)`)
 * keeps one record per student per date per slot.
 *
 * **4. Teacher work is submitted, then reviewed.** Scores, attendance and
 * conduct records carry a nullable `submissionId` and are grouped into a
 * `sms_submissions` row that an administrator approves or rejects. Putting the
 * workflow on the batch instead of on every row means "approve this class's
 * mid-term scores" is one action, and a score row has no status to get out of
 * step with its siblings. Editing an approved batch is refused until it is
 * withdrawn, which is the point of the workflow.
 *
 * **5. Conduct is symmetric.** `sms_conduct_rules` / `sms_conduct_records` cover
 * both commendations and violations (`kind` = merit | demerit) with always
 * positive `points`. A record stores the points it awarded *at the time*,
 * because editing a rule must not silently rewrite history.
 *
 * ## Foreign keys
 *
 * Keys between `sms_` tables are real database foreign keys. Keys to the host's
 * `users` table (teacher / student / guardian accounts, authorship, feedback)
 * deliberately have no DB constraint — this module must not depend on the host's
 * migration, and a school can run before every person has an account — but the
 * relation is still declared in the dashboard metadata so the back office can
 * resolve the name.
 */
import { sql } from 'drizzle-orm'
import {
  boolean,
  date,
  doublePrecision,
  foreignKey,
  index,
  integer,
  pgTable,
  primaryKey,
  serial,
  text,
  timestamp,
  uniqueIndex,
  varchar
} from 'drizzle-orm/pg-core'

// ---------------------------------------------------------------- helpers ----

/** Every table carries the same audit columns; the host's CRUD relies on them. */
const audit = {
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  deletedAt: timestamp('deleted_at', { withTimezone: true })
}

// ======================================================= organisation ========

/** 学部 / 校区 — the top of the org chart. */
export const departments = pgTable('sms_departments', {
  id: serial('id').primaryKey(),
  name: varchar('name', { length: 200 }).notNull(),
  code: varchar('code', { length: 40 }),
  description: text('description'),
  sortOrder: integer('sort_order').notNull().default(0),
  ...audit
}, t => [
  uniqueIndex('sms_departments_code_idx').on(t.code),
  index('sms_departments_order_idx').on(t.sortOrder)
])

/** 年级 */
export const grades = pgTable('sms_grades', {
  id: serial('id').primaryKey(),
  name: varchar('name', { length: 200 }).notNull(),
  code: varchar('code', { length: 40 }),
  departmentId: integer('department_id'),
  sortOrder: integer('sort_order').notNull().default(0),
  ...audit
}, t => [
  index('sms_grades_department_idx').on(t.departmentId),
  foreignKey({ columns: [t.departmentId], foreignColumns: [departments.id] }).onDelete('set null')
])

/** 班级 — the unit a student belongs to and a timetable is drawn for. */
export const classes = pgTable('sms_classes', {
  id: serial('id').primaryKey(),
  name: varchar('name', { length: 200 }).notNull(),
  code: varchar('code', { length: 40 }),
  gradeId: integer('grade_id'),
  departmentId: integer('department_id'),
  headTeacherId: integer('head_teacher_id'),
  classroomId: integer('classroom_id'),
  capacity: integer('capacity'),
  /** A graduated class stays for history but drops out of the pickers. */
  isGraduated: boolean('is_graduated').notNull().default(false),
  sortOrder: integer('sort_order').notNull().default(0),
  ...audit
}, t => [
  index('sms_classes_grade_idx').on(t.gradeId),
  index('sms_classes_department_idx').on(t.departmentId),
  foreignKey({ columns: [t.gradeId], foreignColumns: [grades.id] }).onDelete('set null'),
  foreignKey({ columns: [t.departmentId], foreignColumns: [departments.id] }).onDelete('set null')
])

/** 科目 */
export const subjects = pgTable('sms_subjects', {
  id: serial('id').primaryKey(),
  name: varchar('name', { length: 200 }).notNull(),
  code: varchar('code', { length: 40 }),
  description: text('description'),
  sortOrder: integer('sort_order').notNull().default(0),
  ...audit
}, t => [
  uniqueIndex('sms_subjects_code_idx').on(t.code),
  index('sms_subjects_order_idx').on(t.sortOrder)
])

/** 学期 — one is flagged current; everything time-bound hangs off it. */
export const semesters = pgTable('sms_semesters', {
  id: serial('id').primaryKey(),
  name: varchar('name', { length: 200 }).notNull(),
  code: varchar('code', { length: 40 }),
  startDate: date('start_date', { mode: 'string' }),
  endDate: date('end_date', { mode: 'string' }),
  isCurrent: boolean('is_current').notNull().default(false),
  sortOrder: integer('sort_order').notNull().default(0),
  ...audit
}, t => [
  uniqueIndex('sms_semesters_code_idx').on(t.code),
  index('sms_semesters_current_idx').on(t.isCurrent)
])

/** 教室 — a resource the timetable has to share fairly. */
export const classrooms = pgTable('sms_classrooms', {
  id: serial('id').primaryKey(),
  name: varchar('name', { length: 200 }).notNull(),
  code: varchar('code', { length: 40 }),
  building: varchar('building', { length: 120 }),
  seats: integer('seats'),
  /** `normal` | `lab` | `gym` | `hall` — free text, shown as-is. */
  kind: varchar('kind', { length: 20 }).notNull().default('normal'),
  ...audit
}, t => [
  uniqueIndex('sms_classrooms_code_idx').on(t.code)
])

// ============================================================= people ========

/** 教师 — a role a host user holds, not a second account. */
export const teachers = pgTable('sms_teachers', {
  id: serial('id').primaryKey(),
  /** Host `users.id`. No DB FK on purpose — see the file header. */
  userId: integer('user_id').notNull(),
  employeeNo: varchar('employee_no', { length: 60 }),
  departmentId: integer('department_id'),
  title: varchar('title', { length: 120 }),
  isForeign: boolean('is_foreign').notNull().default(false),
  hiredAt: date('hired_at', { mode: 'string' }),
  note: text('note'),
  ...audit
}, t => [
  uniqueIndex('sms_teachers_user_idx').on(t.userId),
  index('sms_teachers_department_idx').on(t.departmentId),
  foreignKey({ columns: [t.departmentId], foreignColumns: [departments.id] }).onDelete('set null')
])

/** 学生 */
export const students = pgTable('sms_students', {
  id: serial('id').primaryKey(),
  userId: integer('user_id').notNull(),
  classId: integer('class_id'),
  /** 学号 — unique across the school. */
  rollId: varchar('roll_id', { length: 60 }).notNull(),
  /** `enrolled` | `graduated` | `left` | `suspended` */
  status: varchar('status', { length: 20 }).notNull().default('enrolled'),
  gender: varchar('gender', { length: 10 }),
  birthday: date('birthday', { mode: 'string' }),
  enrolledAt: date('enrolled_at', { mode: 'string' }),
  idNumber: varchar('id_number', { length: 60 }),
  passportName: varchar('passport_name', { length: 200 }),
  passportNumber: varchar('passport_number', { length: 60 }),
  photo: varchar('photo', { length: 500 }),
  address: varchar('address', { length: 300 }),
  note: text('note'),
  ...audit
}, t => [
  uniqueIndex('sms_students_user_idx').on(t.userId),
  uniqueIndex('sms_students_roll_idx').on(t.rollId),
  index('sms_students_class_idx').on(t.classId),
  index('sms_students_status_idx').on(t.status),
  foreignKey({ columns: [t.classId], foreignColumns: [classes.id] }).onDelete('set null')
])

/**
 * 监护人 — kept separate from the host user because a guardian may have no
 * account at all, and because one adult can be responsible for several children.
 */
export const guardians = pgTable('sms_guardians', {
  id: serial('id').primaryKey(),
  /** Null until (or unless) this guardian gets a login of their own. */
  userId: integer('user_id'),
  name: varchar('name', { length: 200 }).notNull(),
  /** `father` | `mother` | `guardian` */
  relation: varchar('relation', { length: 20 }),
  phone: varchar('phone', { length: 60 }),
  email: varchar('email', { length: 200 }),
  occupation: varchar('occupation', { length: 120 }),
  company: varchar('company', { length: 200 }),
  address: varchar('address', { length: 300 }),
  ...audit
}, t => [
  index('sms_guardians_user_idx').on(t.userId),
  index('sms_guardians_name_idx').on(t.name)
])

/** 学生 ↔ 监护人。`isPrimary` marks who to call first. */
export const studentGuardians = pgTable('sms_student_guardians', {
  studentId: integer('student_id').notNull(),
  guardianId: integer('guardian_id').notNull(),
  isPrimary: boolean('is_primary').notNull().default(false),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
}, t => [
  primaryKey({ columns: [t.studentId, t.guardianId] }),
  index('sms_student_guardians_guardian_idx').on(t.guardianId),
  foreignKey({ columns: [t.studentId], foreignColumns: [students.id] }).onDelete('cascade'),
  foreignKey({ columns: [t.guardianId], foreignColumns: [guardians.id] }).onDelete('cascade')
])

// ============================================================ teaching =======

/**
 * 开课 — one subject taught to one cohort in one semester.
 *
 * `classId` is nullable so the same table covers a whole-grade elective that has
 * no home class; the enrolment (`sms_course_students`) is what actually says who
 * attends, and it is what every gradebook query reads.
 */
export const courses = pgTable('sms_courses', {
  id: serial('id').primaryKey(),
  name: varchar('name', { length: 200 }).notNull(),
  code: varchar('code', { length: 60 }),
  subjectId: integer('subject_id'),
  classId: integer('class_id'),
  departmentId: integer('department_id'),
  semesterId: integer('semester_id'),
  classroomId: integer('classroom_id'),
  description: text('description'),
  cover: varchar('cover', { length: 500 }),
  /** Courses that do not count towards the report card (study hall, homeroom). */
  isGraded: boolean('is_graded').notNull().default(true),
  /**
   * Weight of this course in the term's overall average — a weekly lesson count
   * or a credit value. Without it the overall average would treat a two-period
   * elective as equal to six periods of mathematics.
   */
  credits: integer('credits').notNull().default(1),
  ...audit
}, t => [
  index('sms_courses_subject_idx').on(t.subjectId),
  index('sms_courses_class_idx').on(t.classId),
  index('sms_courses_semester_idx').on(t.semesterId),
  index('sms_courses_department_idx').on(t.departmentId),
  foreignKey({ columns: [t.subjectId], foreignColumns: [subjects.id] }).onDelete('set null'),
  foreignKey({ columns: [t.classId], foreignColumns: [classes.id] }).onDelete('set null'),
  foreignKey({ columns: [t.departmentId], foreignColumns: [departments.id] }).onDelete('set null'),
  foreignKey({ columns: [t.semesterId], foreignColumns: [semesters.id] }).onDelete('set null'),
  foreignKey({ columns: [t.classroomId], foreignColumns: [classrooms.id] }).onDelete('set null')
])

/** 任课教师。`role` = `lead` | `assistant`; a course needs exactly one lead. */
export const courseTeachers = pgTable('sms_course_teachers', {
  courseId: integer('course_id').notNull(),
  teacherId: integer('teacher_id').notNull(),
  role: varchar('role', { length: 20 }).notNull().default('lead'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
}, t => [
  primaryKey({ columns: [t.courseId, t.teacherId] }),
  index('sms_course_teachers_teacher_idx').on(t.teacherId),
  foreignKey({ columns: [t.courseId], foreignColumns: [courses.id] }).onDelete('cascade'),
  foreignKey({ columns: [t.teacherId], foreignColumns: [teachers.id] }).onDelete('cascade')
])

/** 名单/选课 — the roster every gradebook, attendance sheet and report reads. */
export const courseStudents = pgTable('sms_course_students', {
  courseId: integer('course_id').notNull(),
  studentId: integer('student_id').notNull(),
  enrolledAt: date('enrolled_at', { mode: 'string' }),
  isActive: boolean('is_active').notNull().default(true)
}, t => [
  primaryKey({ columns: [t.courseId, t.studentId] }),
  index('sms_course_students_student_idx').on(t.studentId),
  foreignKey({ columns: [t.courseId], foreignColumns: [courses.id] }).onDelete('cascade'),
  foreignKey({ columns: [t.studentId], foreignColumns: [students.id] }).onDelete('cascade')
])

// =========================================================== timetable =======

/** 节次 — the bell schedule a placement points at. */
export const periods = pgTable('sms_periods', {
  id: serial('id').primaryKey(),
  name: varchar('name', { length: 60 }).notNull(),
  /** 1-based position within the day; also the ordering key. */
  index: integer('index').notNull(),
  startTime: varchar('start_time', { length: 5 }),
  endTime: varchar('end_time', { length: 5 }),
  /** `class` | `break` — breaks occupy a slot but are not scheduled into. */
  kind: varchar('kind', { length: 20 }).notNull().default('class'),
  ...audit
}, t => [
  index('sms_periods_index_idx').on(t.index)
])

/**
 * 排课 — "this course, that weekday, that period, that room".
 *
 * Deliberately one row per weekly lesson (not one row per calendar week): a
 * semester's timetable is a repeating pattern, and exceptions belong in an
 * attendance/absence record rather than in a hundred copied rows.
 */
export const timetableEntries = pgTable('sms_timetable_entries', {
  id: serial('id').primaryKey(),
  semesterId: integer('semester_id'),
  courseId: integer('course_id').notNull(),
  periodId: integer('period_id').notNull(),
  /** ISO weekday: 1 = Monday … 7 = Sunday. */
  weekday: integer('weekday').notNull(),
  classroomId: integer('classroom_id'),
  note: varchar('note', { length: 300 }),
  ...audit
}, t => [
  index('sms_timetable_course_idx').on(t.courseId),
  index('sms_timetable_slot_idx').on(t.semesterId, t.weekday, t.periodId),
  foreignKey({ columns: [t.semesterId], foreignColumns: [semesters.id] }).onDelete('cascade'),
  foreignKey({ columns: [t.courseId], foreignColumns: [courses.id] }).onDelete('cascade'),
  foreignKey({ columns: [t.periodId], foreignColumns: [periods.id] }).onDelete('cascade'),
  foreignKey({ columns: [t.classroomId], foreignColumns: [classrooms.id] }).onDelete('set null')
])

// ========================================================== attendance =======

/**
 * 考勤 — one row per student per date (and per period, when it is period-level).
 *
 * The unique index uses `coalesce(period_id, 0)` because Postgres treats NULLs as
 * distinct, so a plain index would happily allow twenty "whole day" rows for the
 * same student on the same date.
 */
export const attendanceRecords = pgTable('sms_attendance_records', {
  id: serial('id').primaryKey(),
  courseId: integer('course_id').notNull(),
  studentId: integer('student_id').notNull(),
  date: date('date', { mode: 'string' }).notNull(),
  /** Null = the whole day/session; otherwise the specific period. */
  periodId: integer('period_id'),
  /** `present` | `late` | `absent` | `leave` | `excused` */
  status: varchar('status', { length: 20 }).notNull().default('present'),
  minutesLate: integer('minutes_late'),
  note: varchar('note', { length: 300 }),
  recordedBy: integer('recorded_by'),
  submissionId: integer('submission_id'),
  ...audit
}, t => [
  uniqueIndex('sms_attendance_slot_idx').on(t.studentId, t.courseId, t.date, sql`coalesce(${t.periodId}, 0)`),
  index('sms_attendance_course_date_idx').on(t.courseId, t.date),
  index('sms_attendance_student_idx').on(t.studentId),
  foreignKey({ columns: [t.courseId], foreignColumns: [courses.id] }).onDelete('cascade'),
  foreignKey({ columns: [t.studentId], foreignColumns: [students.id] }).onDelete('cascade'),
  foreignKey({ columns: [t.periodId], foreignColumns: [periods.id] }).onDelete('set null')
])

// ========================================================== assessment =======

/**
 * 考核项 — anything a mark can be earned on.
 *
 * `weight` is a percentage of the final grade, so a course's assessments must add
 * up to 100 (`grading.ts` checks). `maxScore` allows a 20-mark quiz to sit next to
 * a 150-mark paper.
 */
export const assessments = pgTable('sms_assessments', {
  id: serial('id').primaryKey(),
  courseId: integer('course_id').notNull(),
  semesterId: integer('semester_id'),
  name: varchar('name', { length: 200 }).notNull(),
  /** `usual` | `homework` | `quiz` | `midterm` | `final` | `project` | `other` */
  kind: varchar('kind', { length: 20 }).notNull().default('other'),
  weight: integer('weight').notNull().default(0),
  maxScore: doublePrecision('max_score').notNull().default(100),
  dueAt: timestamp('due_at', { withTimezone: true }),
  description: text('description'),
  sortOrder: integer('sort_order').notNull().default(0),
  ...audit
}, t => [
  index('sms_assessments_course_idx').on(t.courseId),
  index('sms_assessments_semester_idx').on(t.semesterId),
  foreignKey({ columns: [t.courseId], foreignColumns: [courses.id] }).onDelete('cascade'),
  foreignKey({ columns: [t.semesterId], foreignColumns: [semesters.id] }).onDelete('set null')
])

/** 成绩 — one mark per student per assessment. */
export const scores = pgTable('sms_scores', {
  id: serial('id').primaryKey(),
  assessmentId: integer('assessment_id').notNull(),
  studentId: integer('student_id').notNull(),
  /** Null means "not marked yet", which is not the same as zero. */
  score: doublePrecision('score'),
  comment: varchar('comment', { length: 300 }),
  gradedBy: integer('graded_by'),
  gradedAt: timestamp('graded_at', { withTimezone: true }),
  submissionId: integer('submission_id'),
  ...audit
}, t => [
  uniqueIndex('sms_scores_pair_idx').on(t.assessmentId, t.studentId),
  index('sms_scores_student_idx').on(t.studentId),
  foreignKey({ columns: [t.assessmentId], foreignColumns: [assessments.id] }).onDelete('cascade'),
  foreignKey({ columns: [t.studentId], foreignColumns: [students.id] }).onDelete('cascade')
])

// =========================================================== workflow =======

/**
 * 提交审批 — a batch of teacher-entered records awaiting review.
 *
 * One row per batch, not per record: "approve the mid-term scores for Class 3
 * Maths" is one decision, and a record cannot then disagree with its batch about
 * whether it has been approved.
 */
export const submissions = pgTable('sms_submissions', {
  id: serial('id').primaryKey(),
  /** `scores` | `attendance` | `conduct` */
  kind: varchar('kind', { length: 20 }).notNull(),
  title: varchar('title', { length: 200 }),
  courseId: integer('course_id'),
  semesterId: integer('semester_id'),
  /** Submitter is a host user, because a reviewer may not be a teacher record. */
  submittedBy: integer('submitted_by'),
  submittedAt: timestamp('submitted_at', { withTimezone: true }).notNull().defaultNow(),
  /** `pending` | `approved` | `rejected` | `withdrawn` */
  status: varchar('status', { length: 20 }).notNull().default('pending'),
  reviewedBy: integer('reviewed_by'),
  reviewedAt: timestamp('reviewed_at', { withTimezone: true }),
  reviewNote: text('review_note'),
  ...audit
}, t => [
  index('sms_submissions_status_idx').on(t.status),
  index('sms_submissions_kind_idx').on(t.kind),
  index('sms_submissions_course_idx').on(t.courseId),
  foreignKey({ columns: [t.courseId], foreignColumns: [courses.id] }).onDelete('set null'),
  foreignKey({ columns: [t.semesterId], foreignColumns: [semesters.id] }).onDelete('set null')
])

// ============================================================ conduct ========

/** 奖惩类别（章节） */
export const conductCategories = pgTable('sms_conduct_categories', {
  id: serial('id').primaryKey(),
  name: varchar('name', { length: 200 }).notNull(),
  /** `merit` | `demerit` — a category is one or the other, so its rules are too. */
  kind: varchar('kind', { length: 20 }).notNull().default('demerit'),
  description: text('description'),
  sortOrder: integer('sort_order').notNull().default(0),
  ...audit
}, t => [
  index('sms_conduct_categories_kind_idx').on(t.kind)
])

/** 奖惩条款 */
export const conductRules = pgTable('sms_conduct_rules', {
  id: serial('id').primaryKey(),
  categoryId: integer('category_id'),
  name: varchar('name', { length: 200 }).notNull(),
  description: text('description'),
  /** Always positive; the category's `kind` decides the direction. */
  points: integer('points').notNull().default(0),
  sortOrder: integer('sort_order').notNull().default(0),
  ...audit
}, t => [
  index('sms_conduct_rules_category_idx').on(t.categoryId),
  foreignKey({ columns: [t.categoryId], foreignColumns: [conductCategories.id] }).onDelete('set null')
])

/**
 * 奖惩记录.
 *
 * `points` and `kind` are copied onto the record: a rule is a living document
 * that gets reworded and re-weighted, and last year's records must still say what
 * they said.
 */
export const conductRecords = pgTable('sms_conduct_records', {
  id: serial('id').primaryKey(),
  studentId: integer('student_id').notNull(),
  ruleId: integer('rule_id'),
  kind: varchar('kind', { length: 20 }).notNull().default('demerit'),
  points: integer('points').notNull().default(0),
  courseId: integer('course_id'),
  semesterId: integer('semester_id'),
  date: date('date', { mode: 'string' }).notNull(),
  description: varchar('description', { length: 300 }),
  recordedBy: integer('recorded_by'),
  submissionId: integer('submission_id'),
  ...audit
}, t => [
  index('sms_conduct_records_student_idx').on(t.studentId),
  index('sms_conduct_records_semester_idx').on(t.semesterId),
  foreignKey({ columns: [t.studentId], foreignColumns: [students.id] }).onDelete('cascade'),
  foreignKey({ columns: [t.ruleId], foreignColumns: [conductRules.id] }).onDelete('set null'),
  foreignKey({ columns: [t.courseId], foreignColumns: [courses.id] }).onDelete('set null'),
  foreignKey({ columns: [t.semesterId], foreignColumns: [semesters.id] }).onDelete('set null')
])

// ============================================================ content ========

/** 公告 — short, time-boxed, targeted at an audience. */
export const notices = pgTable('sms_notices', {
  id: serial('id').primaryKey(),
  title: varchar('title', { length: 300 }).notNull(),
  body: text('body'),
  /** `all` | `teachers` | `students` | `guardians` */
  audience: varchar('audience', { length: 20 }).notNull().default('all'),
  isPinned: boolean('is_pinned').notNull().default(false),
  publishedAt: timestamp('published_at', { withTimezone: true }),
  expiresAt: timestamp('expires_at', { withTimezone: true }),
  authorId: integer('author_id'),
  ...audit
}, t => [
  index('sms_notices_published_idx').on(t.publishedAt),
  index('sms_notices_audience_idx').on(t.audience)
])

/** 文章 — longer-lived school content, with a stable slug for public URLs. */
export const articles = pgTable('sms_articles', {
  id: serial('id').primaryKey(),
  title: varchar('title', { length: 300 }).notNull(),
  slug: varchar('slug', { length: 320 }).notNull(),
  summary: varchar('summary', { length: 500 }),
  body: text('body'),
  cover: varchar('cover', { length: 500 }),
  publishedAt: timestamp('published_at', { withTimezone: true }),
  readCount: integer('read_count').notNull().default(0),
  authorId: integer('author_id'),
  ...audit
}, t => [
  uniqueIndex('sms_articles_slug_idx').on(t.slug),
  index('sms_articles_published_idx').on(t.publishedAt)
])

/** 活动 — has a place and a window, so it can appear on a calendar. */
export const activities = pgTable('sms_activities', {
  id: serial('id').primaryKey(),
  name: varchar('name', { length: 300 }).notNull(),
  description: text('description'),
  location: varchar('location', { length: 200 }),
  startAt: timestamp('start_at', { withTimezone: true }),
  endAt: timestamp('end_at', { withTimezone: true }),
  semesterId: integer('semester_id'),
  cover: varchar('cover', { length: 500 }),
  publishedAt: timestamp('published_at', { withTimezone: true }),
  authorId: integer('author_id'),
  ...audit
}, t => [
  index('sms_activities_start_idx').on(t.startAt),
  foreignKey({ columns: [t.semesterId], foreignColumns: [semesters.id] }).onDelete('set null')
])

/** 反馈 — a signed-in user's bug report or suggestion, with a reply. */
export const feedback = pgTable('sms_feedback', {
  id: serial('id').primaryKey(),
  userId: integer('user_id'),
  /** `bug` | `suggestion` | `other` */
  kind: varchar('kind', { length: 20 }).notNull().default('bug'),
  title: varchar('title', { length: 300 }).notNull(),
  body: text('body'),
  /** `open` | `in_progress` | `closed` */
  status: varchar('status', { length: 20 }).notNull().default('open'),
  handledBy: integer('handled_by'),
  handledAt: timestamp('handled_at', { withTimezone: true }),
  reply: text('reply'),
  ...audit
}, t => [
  index('sms_feedback_status_idx').on(t.status),
  index('sms_feedback_user_idx').on(t.userId)
])

// ------------------------------------------------------------ settings ------

/** `configs` key holding the semester a new record defaults to. */
export const SMS_CURRENT_SEMESTER_KEY = 'sms.currentSemesterId'
/** `configs` key holding the school's display name (used by the public home). */
export const SMS_SCHOOL_NAME_KEY = 'sms.schoolName'
/** `configs` key holding the passing percentage used for letter grades. */
export const SMS_PASS_MARK_KEY = 'sms.passMark'
