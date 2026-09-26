/**
 * School management system — database migrations.
 *
 * Self-contained idempotent DDL against the shared host connection, mirroring the
 * library / music / photo modules. Every statement is guarded with
 * `IF NOT EXISTS`, so this runs on every boot as an upgrade path.
 *
 * The tables are created in dependency order (a table is only created after
 * everything it references), which keeps the foreign keys valid on a fresh
 * database without needing `DEFERRABLE` constraints.
 *
 * The `pool` comes from the host project — this module reuses the host
 * connection, it never opens its own.
 */
import { pool } from '../../../../server/database'

const DDL = `
-- ===================================================== organisation ========
CREATE TABLE IF NOT EXISTS sms_departments (
  id          serial PRIMARY KEY,
  name        varchar(200) NOT NULL,
  code        varchar(40),
  description text,
  sort_order  integer      NOT NULL DEFAULT 0,
  created_at  timestamptz  NOT NULL DEFAULT now(),
  updated_at  timestamptz  NOT NULL DEFAULT now(),
  deleted_at  timestamptz
);
CREATE UNIQUE INDEX IF NOT EXISTS sms_departments_code_idx  ON sms_departments (code);
CREATE INDEX IF NOT EXISTS        sms_departments_order_idx ON sms_departments (sort_order);

CREATE TABLE IF NOT EXISTS sms_grades (
  id            serial PRIMARY KEY,
  name          varchar(200) NOT NULL,
  code          varchar(40),
  department_id integer REFERENCES sms_departments(id) ON DELETE SET NULL,
  sort_order    integer      NOT NULL DEFAULT 0,
  created_at    timestamptz  NOT NULL DEFAULT now(),
  updated_at    timestamptz  NOT NULL DEFAULT now(),
  deleted_at    timestamptz
);
CREATE INDEX IF NOT EXISTS sms_grades_department_idx ON sms_grades (department_id);

CREATE TABLE IF NOT EXISTS sms_classrooms (
  id         serial PRIMARY KEY,
  name       varchar(200) NOT NULL,
  code       varchar(40),
  building   varchar(120),
  seats      integer,
  kind       varchar(20) NOT NULL DEFAULT 'normal',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);
CREATE UNIQUE INDEX IF NOT EXISTS sms_classrooms_code_idx ON sms_classrooms (code);

CREATE TABLE IF NOT EXISTS sms_subjects (
  id          serial PRIMARY KEY,
  name        varchar(200) NOT NULL,
  code        varchar(40),
  description text,
  sort_order  integer      NOT NULL DEFAULT 0,
  created_at  timestamptz  NOT NULL DEFAULT now(),
  updated_at  timestamptz  NOT NULL DEFAULT now(),
  deleted_at  timestamptz
);
CREATE UNIQUE INDEX IF NOT EXISTS sms_subjects_code_idx  ON sms_subjects (code);
CREATE INDEX IF NOT EXISTS        sms_subjects_order_idx ON sms_subjects (sort_order);

CREATE TABLE IF NOT EXISTS sms_semesters (
  id         serial PRIMARY KEY,
  name       varchar(200) NOT NULL,
  code       varchar(40),
  start_date date,
  end_date   date,
  is_current boolean      NOT NULL DEFAULT false,
  sort_order integer      NOT NULL DEFAULT 0,
  created_at timestamptz  NOT NULL DEFAULT now(),
  updated_at timestamptz  NOT NULL DEFAULT now(),
  deleted_at timestamptz
);
CREATE UNIQUE INDEX IF NOT EXISTS sms_semesters_code_idx    ON sms_semesters (code);
CREATE INDEX IF NOT EXISTS        sms_semesters_current_idx ON sms_semesters (is_current);

CREATE TABLE IF NOT EXISTS sms_periods (
  id         serial PRIMARY KEY,
  name       varchar(60) NOT NULL,
  "index"    integer     NOT NULL,
  start_time varchar(5),
  end_time   varchar(5),
  kind       varchar(20) NOT NULL DEFAULT 'class',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);
CREATE INDEX IF NOT EXISTS sms_periods_index_idx ON sms_periods ("index");

-- ============================================================== people =====
CREATE TABLE IF NOT EXISTS sms_teachers (
  id            serial PRIMARY KEY,
  user_id       integer NOT NULL,
  employee_no   varchar(60),
  department_id integer REFERENCES sms_departments(id) ON DELETE SET NULL,
  title         varchar(120),
  is_foreign    boolean     NOT NULL DEFAULT false,
  hired_at      date,
  note          text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  deleted_at    timestamptz
);
CREATE UNIQUE INDEX IF NOT EXISTS sms_teachers_user_idx       ON sms_teachers (user_id);
CREATE INDEX IF NOT EXISTS        sms_teachers_department_idx ON sms_teachers (department_id);

CREATE TABLE IF NOT EXISTS sms_classes (
  id              serial PRIMARY KEY,
  name            varchar(200) NOT NULL,
  code            varchar(40),
  grade_id        integer REFERENCES sms_grades(id) ON DELETE SET NULL,
  department_id   integer REFERENCES sms_departments(id) ON DELETE SET NULL,
  head_teacher_id integer,
  classroom_id    integer,
  capacity        integer,
  is_graduated    boolean     NOT NULL DEFAULT false,
  sort_order      integer     NOT NULL DEFAULT 0,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  deleted_at      timestamptz
);
CREATE INDEX IF NOT EXISTS sms_classes_grade_idx      ON sms_classes (grade_id);
CREATE INDEX IF NOT EXISTS sms_classes_department_idx ON sms_classes (department_id);

CREATE TABLE IF NOT EXISTS sms_students (
  id              serial PRIMARY KEY,
  user_id         integer NOT NULL,
  class_id        integer REFERENCES sms_classes(id) ON DELETE SET NULL,
  roll_id         varchar(60) NOT NULL,
  status          varchar(20) NOT NULL DEFAULT 'enrolled',
  gender          varchar(10),
  birthday        date,
  enrolled_at     date,
  id_number       varchar(60),
  passport_name   varchar(200),
  passport_number varchar(60),
  photo           varchar(500),
  address         varchar(300),
  note            text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  deleted_at      timestamptz
);
CREATE UNIQUE INDEX IF NOT EXISTS sms_students_user_idx   ON sms_students (user_id);
CREATE UNIQUE INDEX IF NOT EXISTS sms_students_roll_idx   ON sms_students (roll_id);
CREATE INDEX IF NOT EXISTS        sms_students_class_idx  ON sms_students (class_id);
CREATE INDEX IF NOT EXISTS        sms_students_status_idx ON sms_students (status);

CREATE TABLE IF NOT EXISTS sms_guardians (
  id         serial PRIMARY KEY,
  user_id    integer,
  name       varchar(200) NOT NULL,
  relation   varchar(20),
  phone      varchar(60),
  email      varchar(200),
  occupation varchar(120),
  company    varchar(200),
  address    varchar(300),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);
CREATE INDEX IF NOT EXISTS sms_guardians_user_idx ON sms_guardians (user_id);
CREATE INDEX IF NOT EXISTS sms_guardians_name_idx ON sms_guardians (name);

CREATE TABLE IF NOT EXISTS sms_student_guardians (
  student_id  integer NOT NULL REFERENCES sms_students(id) ON DELETE CASCADE,
  guardian_id integer NOT NULL REFERENCES sms_guardians(id) ON DELETE CASCADE,
  is_primary  boolean NOT NULL DEFAULT false,
  created_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (student_id, guardian_id)
);
CREATE INDEX IF NOT EXISTS sms_student_guardians_guardian_idx ON sms_student_guardians (guardian_id);

-- ============================================================ teaching =====
CREATE TABLE IF NOT EXISTS sms_courses (
  id            serial PRIMARY KEY,
  name          varchar(200) NOT NULL,
  code          varchar(60),
  subject_id    integer REFERENCES sms_subjects(id) ON DELETE SET NULL,
  class_id      integer REFERENCES sms_classes(id) ON DELETE SET NULL,
  department_id integer REFERENCES sms_departments(id) ON DELETE SET NULL,
  semester_id   integer REFERENCES sms_semesters(id) ON DELETE SET NULL,
  classroom_id  integer REFERENCES sms_classrooms(id) ON DELETE SET NULL,
  description   text,
  cover         varchar(500),
  is_graded     boolean     NOT NULL DEFAULT true,
  credits       integer     NOT NULL DEFAULT 1,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  deleted_at    timestamptz
);
CREATE INDEX IF NOT EXISTS sms_courses_subject_idx    ON sms_courses (subject_id);
CREATE INDEX IF NOT EXISTS sms_courses_class_idx      ON sms_courses (class_id);
CREATE INDEX IF NOT EXISTS sms_courses_semester_idx   ON sms_courses (semester_id);
CREATE INDEX IF NOT EXISTS sms_courses_department_idx ON sms_courses (department_id);

CREATE TABLE IF NOT EXISTS sms_course_teachers (
  course_id  integer NOT NULL REFERENCES sms_courses(id) ON DELETE CASCADE,
  teacher_id integer NOT NULL REFERENCES sms_teachers(id) ON DELETE CASCADE,
  role       varchar(20) NOT NULL DEFAULT 'lead',
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (course_id, teacher_id)
);
CREATE INDEX IF NOT EXISTS sms_course_teachers_teacher_idx ON sms_course_teachers (teacher_id);

CREATE TABLE IF NOT EXISTS sms_course_students (
  course_id   integer NOT NULL REFERENCES sms_courses(id) ON DELETE CASCADE,
  student_id  integer NOT NULL REFERENCES sms_students(id) ON DELETE CASCADE,
  enrolled_at date,
  is_active   boolean NOT NULL DEFAULT true,
  PRIMARY KEY (course_id, student_id)
);
CREATE INDEX IF NOT EXISTS sms_course_students_student_idx ON sms_course_students (student_id);

-- =========================================================== timetable =====
CREATE TABLE IF NOT EXISTS sms_timetable_entries (
  id           serial PRIMARY KEY,
  semester_id  integer REFERENCES sms_semesters(id) ON DELETE CASCADE,
  course_id    integer NOT NULL REFERENCES sms_courses(id) ON DELETE CASCADE,
  period_id    integer NOT NULL REFERENCES sms_periods(id) ON DELETE CASCADE,
  weekday      integer NOT NULL,
  classroom_id integer REFERENCES sms_classrooms(id) ON DELETE SET NULL,
  note         varchar(300),
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  deleted_at   timestamptz
);
CREATE INDEX IF NOT EXISTS sms_timetable_course_idx ON sms_timetable_entries (course_id);
CREATE INDEX IF NOT EXISTS sms_timetable_slot_idx   ON sms_timetable_entries (semester_id, weekday, period_id);

-- ========================================================== attendance =====
CREATE TABLE IF NOT EXISTS sms_attendance_records (
  id            serial PRIMARY KEY,
  course_id     integer NOT NULL REFERENCES sms_courses(id) ON DELETE CASCADE,
  student_id    integer NOT NULL REFERENCES sms_students(id) ON DELETE CASCADE,
  "date"        date NOT NULL,
  period_id     integer REFERENCES sms_periods(id) ON DELETE SET NULL,
  status        varchar(20) NOT NULL DEFAULT 'present',
  minutes_late  integer,
  note          varchar(300),
  recorded_by   integer,
  submission_id integer,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  deleted_at    timestamptz
);
-- One row per student, per course, per date, per slot. coalesce is needed because
-- NULLs are distinct in Postgres, so a plain index would allow duplicates of the
-- whole-day rows.
CREATE UNIQUE INDEX IF NOT EXISTS sms_attendance_slot_idx ON sms_attendance_records
  (student_id, course_id, "date", coalesce(period_id, 0));
CREATE INDEX IF NOT EXISTS sms_attendance_course_date_idx ON sms_attendance_records (course_id, "date");
CREATE INDEX IF NOT EXISTS sms_attendance_student_idx     ON sms_attendance_records (student_id);

-- ========================================================== assessment =====
CREATE TABLE IF NOT EXISTS sms_assessments (
  id          serial PRIMARY KEY,
  course_id   integer NOT NULL REFERENCES sms_courses(id) ON DELETE CASCADE,
  semester_id integer REFERENCES sms_semesters(id) ON DELETE SET NULL,
  name        varchar(200) NOT NULL,
  kind        varchar(20) NOT NULL DEFAULT 'other',
  weight      integer NOT NULL DEFAULT 0,
  max_score   double precision NOT NULL DEFAULT 100,
  due_at      timestamptz,
  description text,
  sort_order  integer NOT NULL DEFAULT 0,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  deleted_at  timestamptz
);
CREATE INDEX IF NOT EXISTS sms_assessments_course_idx   ON sms_assessments (course_id);
CREATE INDEX IF NOT EXISTS sms_assessments_semester_idx ON sms_assessments (semester_id);

CREATE TABLE IF NOT EXISTS sms_scores (
  id            serial PRIMARY KEY,
  assessment_id integer NOT NULL REFERENCES sms_assessments(id) ON DELETE CASCADE,
  student_id    integer NOT NULL REFERENCES sms_students(id) ON DELETE CASCADE,
  score         double precision,
  comment       varchar(300),
  graded_by     integer,
  graded_at     timestamptz,
  submission_id integer,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  deleted_at    timestamptz
);
CREATE UNIQUE INDEX IF NOT EXISTS sms_scores_pair_idx    ON sms_scores (assessment_id, student_id);
CREATE INDEX IF NOT EXISTS        sms_scores_student_idx ON sms_scores (student_id);

-- ============================================================ workflow =====
CREATE TABLE IF NOT EXISTS sms_submissions (
  id           serial PRIMARY KEY,
  kind         varchar(20) NOT NULL,
  title        varchar(200),
  course_id    integer REFERENCES sms_courses(id) ON DELETE SET NULL,
  semester_id  integer REFERENCES sms_semesters(id) ON DELETE SET NULL,
  submitted_by integer,
  submitted_at timestamptz NOT NULL DEFAULT now(),
  status       varchar(20) NOT NULL DEFAULT 'pending',
  reviewed_by  integer,
  reviewed_at  timestamptz,
  review_note  text,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  deleted_at   timestamptz
);
CREATE INDEX IF NOT EXISTS sms_submissions_status_idx ON sms_submissions (status);
CREATE INDEX IF NOT EXISTS sms_submissions_kind_idx   ON sms_submissions (kind);
CREATE INDEX IF NOT EXISTS sms_submissions_course_idx ON sms_submissions (course_id);

-- ============================================================= conduct =====
CREATE TABLE IF NOT EXISTS sms_conduct_categories (
  id          serial PRIMARY KEY,
  name        varchar(200) NOT NULL,
  kind        varchar(20) NOT NULL DEFAULT 'demerit',
  description text,
  sort_order  integer NOT NULL DEFAULT 0,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  deleted_at  timestamptz
);
CREATE INDEX IF NOT EXISTS sms_conduct_categories_kind_idx ON sms_conduct_categories (kind);

CREATE TABLE IF NOT EXISTS sms_conduct_rules (
  id          serial PRIMARY KEY,
  category_id integer REFERENCES sms_conduct_categories(id) ON DELETE SET NULL,
  name        varchar(200) NOT NULL,
  description text,
  points      integer NOT NULL DEFAULT 0,
  sort_order  integer NOT NULL DEFAULT 0,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  deleted_at  timestamptz
);
CREATE INDEX IF NOT EXISTS sms_conduct_rules_category_idx ON sms_conduct_rules (category_id);

CREATE TABLE IF NOT EXISTS sms_conduct_records (
  id            serial PRIMARY KEY,
  student_id    integer NOT NULL REFERENCES sms_students(id) ON DELETE CASCADE,
  rule_id       integer REFERENCES sms_conduct_rules(id) ON DELETE SET NULL,
  kind          varchar(20) NOT NULL DEFAULT 'demerit',
  points        integer NOT NULL DEFAULT 0,
  course_id     integer REFERENCES sms_courses(id) ON DELETE SET NULL,
  semester_id   integer REFERENCES sms_semesters(id) ON DELETE SET NULL,
  "date"        date NOT NULL,
  description   varchar(300),
  recorded_by   integer,
  submission_id integer,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  deleted_at    timestamptz
);
CREATE INDEX IF NOT EXISTS sms_conduct_records_student_idx  ON sms_conduct_records (student_id);
CREATE INDEX IF NOT EXISTS sms_conduct_records_semester_idx ON sms_conduct_records (semester_id);

-- ============================================================= content =====
CREATE TABLE IF NOT EXISTS sms_notices (
  id           serial PRIMARY KEY,
  title        varchar(300) NOT NULL,
  body         text,
  audience     varchar(20) NOT NULL DEFAULT 'all',
  is_pinned    boolean NOT NULL DEFAULT false,
  published_at timestamptz,
  expires_at   timestamptz,
  author_id    integer,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  deleted_at   timestamptz
);
CREATE INDEX IF NOT EXISTS sms_notices_published_idx ON sms_notices (published_at);
CREATE INDEX IF NOT EXISTS sms_notices_audience_idx  ON sms_notices (audience);

CREATE TABLE IF NOT EXISTS sms_articles (
  id           serial PRIMARY KEY,
  title        varchar(300) NOT NULL,
  slug         varchar(320) NOT NULL,
  summary      varchar(500),
  body         text,
  cover        varchar(500),
  published_at timestamptz,
  read_count   integer NOT NULL DEFAULT 0,
  author_id    integer,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  deleted_at   timestamptz
);
CREATE UNIQUE INDEX IF NOT EXISTS sms_articles_slug_idx      ON sms_articles (slug);
CREATE INDEX IF NOT EXISTS        sms_articles_published_idx ON sms_articles (published_at);

CREATE TABLE IF NOT EXISTS sms_activities (
  id           serial PRIMARY KEY,
  name         varchar(300) NOT NULL,
  description  text,
  location     varchar(200),
  start_at     timestamptz,
  end_at       timestamptz,
  semester_id  integer REFERENCES sms_semesters(id) ON DELETE SET NULL,
  cover        varchar(500),
  published_at timestamptz,
  author_id    integer,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  deleted_at   timestamptz
);
CREATE INDEX IF NOT EXISTS sms_activities_start_idx ON sms_activities (start_at);

CREATE TABLE IF NOT EXISTS sms_feedback (
  id         serial PRIMARY KEY,
  user_id    integer,
  kind       varchar(20) NOT NULL DEFAULT 'bug',
  title      varchar(300) NOT NULL,
  body       text,
  status     varchar(20) NOT NULL DEFAULT 'open',
  handled_by integer,
  handled_at timestamptz,
  reply      text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);
CREATE INDEX IF NOT EXISTS sms_feedback_status_idx ON sms_feedback (status);
CREATE INDEX IF NOT EXISTS sms_feedback_user_idx   ON sms_feedback (user_id);
`

/**
 * Additive upgrades for tables that already exist in a running installation.
 * Every statement is idempotent, so this is safe on each boot.
 */
const UPGRADES = `
ALTER TABLE sms_courses ADD COLUMN IF NOT EXISTS credits integer NOT NULL DEFAULT 1;
`

/**
 * Apply the school schema (idempotent). Safe to call on every server boot.
 */
export async function runSmsMigrations(): Promise<void> {
  await pool.query(DDL)
  await pool.query(UPGRADES)
}
