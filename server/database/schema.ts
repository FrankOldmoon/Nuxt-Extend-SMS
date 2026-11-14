import { sql } from 'drizzle-orm'
import {
  boolean,
  date,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  serial,
  text,
  timestamp,
  uniqueIndex,
  varchar
} from 'drizzle-orm/pg-core'

export const smsAcademicYears = pgTable(
  'sms_academic_years',
  {
    id: serial('id').primaryKey(),
    organizationId: integer('organization_id').notNull(),
    tenantId: integer('tenant_id'),
    name: varchar('name', { length: 80 }).notNull(),
    startDate: date('start_date').notNull(),
    endDate: date('end_date').notNull(),
    isCurrent: boolean('is_current').notNull().default(false),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull()
  },
  table => ({
    organizationNameIdx: uniqueIndex('sms_academic_years_org_name_idx').on(table.organizationId, table.name),
    tenantIdx: index('sms_academic_years_tenant_idx').on(table.tenantId)
  })
)

export const smsTerms = pgTable(
  'sms_terms',
  {
    id: serial('id').primaryKey(),
    organizationId: integer('organization_id').notNull(),
    tenantId: integer('tenant_id'),
    academicYearId: integer('academic_year_id').notNull(),
    name: varchar('name', { length: 80 }).notNull(),
    startDate: date('start_date').notNull(),
    endDate: date('end_date').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull()
  },
  table => ({
    yearNameIdx: uniqueIndex('sms_terms_year_name_idx').on(table.academicYearId, table.name),
    organizationIdx: index('sms_terms_organization_idx').on(table.organizationId)
  })
)

export const smsGrades = pgTable(
  'sms_grades',
  {
    id: serial('id').primaryKey(),
    organizationId: integer('organization_id').notNull(),
    tenantId: integer('tenant_id'),
    name: varchar('name', { length: 80 }).notNull(),
    level: integer('level'),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull()
  },
  table => ({
    organizationNameIdx: uniqueIndex('sms_grades_org_name_idx').on(table.organizationId, table.name)
  })
)

export const smsSubjects = pgTable(
  'sms_subjects',
  {
    id: serial('id').primaryKey(),
    organizationId: integer('organization_id').notNull(),
    tenantId: integer('tenant_id'),
    code: varchar('code', { length: 40 }).notNull(),
    name: varchar('name', { length: 120 }).notNull(),
    /** 选课容量；为空表示不限制。 */
    capacity: integer('capacity'),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull()
  },
  table => ({
    organizationCodeIdx: uniqueIndex('sms_subjects_org_code_idx').on(table.organizationId, table.code)
  })
)

export const smsTeachers = pgTable(
  'sms_teachers',
  {
    id: serial('id').primaryKey(),
    organizationId: integer('organization_id').notNull(),
    tenantId: integer('tenant_id'),
    userId: integer('user_id').notNull(),
    name: varchar('name', { length: 120 }),
    employeeNo: varchar('employee_no', { length: 40 }),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull()
  },
  table => ({
    organizationUserIdx: uniqueIndex('sms_teachers_org_user_idx').on(table.organizationId, table.userId)
  })
)

export const smsClasses = pgTable(
  'sms_classes',
  {
    id: serial('id').primaryKey(),
    organizationId: integer('organization_id').notNull(),
    tenantId: integer('tenant_id'),
    academicYearId: integer('academic_year_id'),
    gradeId: integer('grade_id'),
    /** Legacy free-text grade; relational ownership now lives in `gradeId`. */
    grade: varchar('grade', { length: 40 }),
    name: varchar('name', { length: 120 }).notNull(),
    /** Homeroom teacher (platform user id); drives `homeroomClass` data scope. */
    homeroomUserId: integer('homeroom_user_id'),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull()
  },
  table => ({
    organizationNameIdx: uniqueIndex('sms_classes_org_name_idx').on(table.organizationId, table.name),
    organizationYearIdx: index('sms_classes_org_year_idx').on(table.organizationId, table.academicYearId),
    tenantIdx: index('sms_classes_tenant_idx').on(table.tenantId)
  })
)

export const smsStudents = pgTable(
  'sms_students',
  {
    id: serial('id').primaryKey(),
    organizationId: integer('organization_id').notNull(),
    tenantId: integer('tenant_id'),
    classId: integer('class_id'),
    /** Optional link to the platform user for student self-service access. */
    userId: integer('user_id'),
    name: varchar('name', { length: 120 }).notNull(),
    studentNo: varchar('student_no', { length: 40 }).notNull(),
    /** active | suspended | transferred | graduated */
    status: varchar('status', { length: 20 }).notNull().default('active'),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull()
  },
  table => ({
    organizationStudentNoIdx: uniqueIndex('sms_students_org_student_no_idx').on(table.organizationId, table.studentNo),
    organizationClassIdx: index('sms_students_org_class_idx').on(table.organizationId, table.classId),
    organizationUserIdx: uniqueIndex('sms_students_org_user_idx').on(table.organizationId, table.userId),
    tenantIdx: index('sms_students_tenant_idx').on(table.tenantId),
    organizationStatusIdx: index('sms_students_org_status_idx').on(table.organizationId, table.status)
  })
)

/** 学籍异动流水：每次状态变更都追加一行，不覆盖历史。 */
export const smsStudentMovements = pgTable(
  'sms_student_movements',
  {
    id: serial('id').primaryKey(),
    organizationId: integer('organization_id').notNull(),
    tenantId: integer('tenant_id'),
    studentId: integer('student_id').notNull(),
    /** transfer_in | transfer_out | suspend | resume | graduate */
    type: varchar('type', { length: 20 }).notNull(),
    fromClassId: integer('from_class_id'),
    toClassId: integer('to_class_id'),
    effectiveDate: date('effective_date').notNull(),
    reason: varchar('reason', { length: 500 }),
    createdBy: integer('created_by').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull()
  },
  table => ({
    studentIdx: index('sms_student_movements_student_idx')
      .on(table.organizationId, table.studentId, table.effectiveDate),
    typeIdx: index('sms_student_movements_type_idx')
      .on(table.organizationId, table.type, table.effectiveDate)
  })
)

export const smsTeacherAssignments = pgTable(
  'sms_teacher_assignments',
  {
    id: serial('id').primaryKey(),
    organizationId: integer('organization_id').notNull(),
    tenantId: integer('tenant_id'),
    teacherId: integer('teacher_id'),
    teacherUserId: integer('teacher_user_id').notNull(),
    classId: integer('class_id').notNull(),
    subjectId: integer('subject_id'),
    termId: integer('term_id'),
    academicYearId: integer('academic_year_id'),
    /** `subject` (teaching) or `homeroom` (class owner). */
    role: varchar('role', { length: 20 }).notNull().default('subject'),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull()
  },
  table => ({
    teacherClassRoleIdx: uniqueIndex('sms_teacher_assignments_scope_idx')
      .on(table.teacherUserId, table.classId, table.role, sql`COALESCE(${table.subjectId}, 0)`),
    classIdx: index('sms_teacher_assignments_class_idx').on(table.classId),
    organizationIdx: index('sms_teacher_assignments_organization_idx').on(table.organizationId)
  })
)

export const smsEnrollments = pgTable(
  'sms_enrollments',
  {
    id: serial('id').primaryKey(),
    organizationId: integer('organization_id').notNull(),
    tenantId: integer('tenant_id'),
    studentId: integer('student_id').notNull(),
    classId: integer('class_id').notNull(),
    academicYearId: integer('academic_year_id').notNull(),
    termId: integer('term_id'),
    /** active | completed | withdrawn */
    status: varchar('status', { length: 20 }).notNull().default('active'),
    enrolledAt: timestamp('enrolled_at', { withTimezone: true }).defaultNow().notNull(),
    endedAt: timestamp('ended_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull()
  },
  table => ({
    organizationIdx: index('sms_enrollments_organization_idx').on(table.organizationId),
    studentStatusIdx: index('sms_enrollments_student_status_idx').on(table.studentId, table.status),
    classStatusIdx: index('sms_enrollments_class_status_idx').on(table.classId, table.status),
    activeYearIdx: uniqueIndex('sms_enrollments_active_year_idx')
      .on(table.studentId, table.academicYearId)
      .where(sql`${table.status} = 'active'`)
  })
)

export const smsGuardians = pgTable(
  'sms_guardians',
  {
    id: serial('id').primaryKey(),
    organizationId: integer('organization_id').notNull(),
    tenantId: integer('tenant_id'),
    userId: integer('user_id').notNull(),
    name: varchar('name', { length: 120 }),
    phone: varchar('phone', { length: 40 }),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull()
  },
  table => ({
    organizationUserIdx: uniqueIndex('sms_guardians_org_user_idx').on(table.organizationId, table.userId)
  })
)

export const smsStudentGuardians = pgTable(
  'sms_student_guardians',
  {
    id: serial('id').primaryKey(),
    organizationId: integer('organization_id').notNull(),
    tenantId: integer('tenant_id'),
    studentId: integer('student_id').notNull(),
    guardianId: integer('guardian_id').notNull(),
    relation: varchar('relation', { length: 40 }),
    isPrimary: boolean('is_primary').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull()
  },
  table => ({
    studentGuardianIdx: uniqueIndex('sms_student_guardians_pair_idx').on(table.studentId, table.guardianId),
    guardianIdx: index('sms_student_guardians_guardian_idx').on(table.guardianId)
  })
)

/**
 * Daily attendance. One row per student × date × session (and period, for
 * `session = 'period'`). Corrections update the row; nothing is deleted.
 */
export const smsAttendanceRecords = pgTable(
  'sms_attendance_records',
  {
    id: serial('id').primaryKey(),
    organizationId: integer('organization_id').notNull(),
    tenantId: integer('tenant_id'),
    termId: integer('term_id'),
    classId: integer('class_id').notNull(),
    studentId: integer('student_id').notNull(),
    attendanceDate: date('attendance_date').notNull(),
    /** full_day | morning | afternoon | period */
    session: varchar('session', { length: 20 }).notNull().default('full_day'),
    periodNo: integer('period_no'),
    /** present | late | absent | excused | leave */
    status: varchar('status', { length: 20 }).notNull(),
    leaveRequestId: integer('leave_request_id'),
    remark: varchar('remark', { length: 255 }),
    recordedBy: integer('recorded_by').notNull(),
    recordedAt: timestamp('recorded_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull()
  },
  table => ({
    uniqueIdx: uniqueIndex('sms_attendance_unique_idx')
      .on(table.organizationId, table.studentId, table.attendanceDate, table.session, sql`COALESCE(${table.periodNo}, 0)`),
    classDateIdx: index('sms_attendance_class_date_idx').on(table.organizationId, table.classId, table.attendanceDate),
    studentDateIdx: index('sms_attendance_student_date_idx').on(table.organizationId, table.studentId, table.attendanceDate)
  })
)

/**
 * Leave requests (students or staff). Approved student leave is the only way
 * attendance rows become `leave`; cancelling an approved request rolls the
 * affected days back to `absent` (records are never deleted).
 */
export const smsLeaveRequests = pgTable(
  'sms_leave_requests',
  {
    id: serial('id').primaryKey(),
    organizationId: integer('organization_id').notNull(),
    tenantId: integer('tenant_id'),
    /** student | staff */
    subjectType: varchar('subject_type', { length: 20 }).notNull().default('student'),
    studentId: integer('student_id'),
    staffUserId: integer('staff_user_id'),
    /** Applicant (student self, guardian, or staff member). */
    applicantUserId: integer('applicant_user_id').notNull(),
    /** sick | personal | other */
    type: varchar('type', { length: 20 }).notNull(),
    startAt: timestamp('start_at', { withTimezone: true }).notNull(),
    endAt: timestamp('end_at', { withTimezone: true }).notNull(),
    reason: varchar('reason', { length: 500 }),
    attachmentFileId: integer('attachment_file_id'),
    /** pending | approved | rejected | cancelled */
    status: varchar('status', { length: 20 }).notNull().default('pending'),
    decidedBy: integer('decided_by'),
    decidedAt: timestamp('decided_at', { withTimezone: true }),
    decisionNote: varchar('decision_note', { length: 255 }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull()
  },
  table => ({
    studentIdx: index('sms_leave_student_idx').on(table.organizationId, table.studentId, table.startAt),
    statusIdx: index('sms_leave_status_idx').on(table.organizationId, table.status, table.createdAt),
    applicantIdx: index('sms_leave_applicant_idx').on(table.organizationId, table.applicantUserId, table.createdAt)
  })
)

/**
 * Business approval tasks (separate from `agent_approvals`, which guards tool
 * calls). One row per step; escalated leave has step 1 = homeroom and step 2 =
 * grade leader / school admin.
 */
export const smsApprovalTasks = pgTable(
  'sms_approval_tasks',
  {
    id: serial('id').primaryKey(),
    organizationId: integer('organization_id').notNull(),
    tenantId: integer('tenant_id'),
    /** Business type, e.g. `leave`. */
    subjectType: varchar('subject_type', { length: 40 }).notNull(),
    subjectId: integer('subject_id').notNull(),
    step: integer('step').notNull().default(1),
    assigneeUserId: integer('assignee_user_id'),
    /** homeroom | grade_leader | school_admin */
    assigneeRole: varchar('assignee_role', { length: 80 }),
    /** pending | approved | rejected | cancelled */
    status: varchar('status', { length: 20 }).notNull().default('pending'),
    comment: varchar('comment', { length: 500 }),
    decidedBy: integer('decided_by'),
    decidedAt: timestamp('decided_at', { withTimezone: true }),
    /** SLA deadline for this step; overdue tasks are escalated by the scan job. */
    dueAt: timestamp('due_at', { withTimezone: true }),
    /** Set when the escalation job moved the task to a higher approver. */
    escalatedAt: timestamp('escalated_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull()
  },
  table => ({
    subjectStepIdx: uniqueIndex('sms_approval_tasks_unique_idx')
      .on(table.organizationId, table.subjectType, table.subjectId, table.step),
    assigneeIdx: index('sms_approval_tasks_assignee_idx')
      .on(table.organizationId, table.assigneeUserId, table.status),
    dueIdx: index('sms_approval_tasks_due_idx')
      .on(table.organizationId, table.status, table.dueAt)
  })
)

/** Alerts raised by attendance rules (consecutive absence / monthly rate). */
export const smsAttendanceAlerts = pgTable(
  'sms_attendance_alerts',
  {
    id: serial('id').primaryKey(),
    organizationId: integer('organization_id').notNull(),
    tenantId: integer('tenant_id'),
    studentId: integer('student_id').notNull(),
    /** consecutive_absent | monthly_rate */
    rule: varchar('rule', { length: 40 }).notNull(),
    windowStart: date('window_start').notNull(),
    windowEnd: date('window_end').notNull(),
    metric: numeric('metric', { precision: 6, scale: 2 }).notNull(),
    threshold: numeric('threshold', { precision: 6, scale: 2 }).notNull(),
    /** open | acknowledged | resolved */
    status: varchar('status', { length: 20 }).notNull().default('open'),
    acknowledgedBy: integer('acknowledged_by'),
    acknowledgedAt: timestamp('acknowledged_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull()
  },
  table => ({
    uniqueIdx: uniqueIndex('sms_attendance_alerts_unique_idx')
      .on(table.organizationId, table.studentId, table.rule, table.windowStart),
    statusIdx: index('sms_attendance_alerts_status_idx').on(table.organizationId, table.status)
  })
)

/**
 * Exams (Slice B). Scores are only meaningful for `draft` exams; publishing is
 * a high-risk, second-person action and freezes further score edits.
 */
export const smsExams = pgTable(
  'sms_exams',
  {
    id: serial('id').primaryKey(),
    organizationId: integer('organization_id').notNull(),
    tenantId: integer('tenant_id'),
    termId: integer('term_id'),
    subjectId: integer('subject_id'),
    classId: integer('class_id').notNull(),
    name: varchar('name', { length: 120 }).notNull(),
    /** regular | midterm | final | quiz | other */
    examType: varchar('exam_type', { length: 40 }).notNull().default('regular'),
    examDate: date('exam_date').notNull(),
    fullScore: numeric('full_score', { precision: 5, scale: 2 }).notNull().default('100'),
    /** draft | published | closed */
    status: varchar('status', { length: 20 }).notNull().default('draft'),
    createdBy: integer('created_by').notNull(),
    publishedBy: integer('published_by'),
    publishedAt: timestamp('published_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull()
  },
  table => ({
    classDateIdx: index('sms_exams_class_date_idx').on(table.organizationId, table.classId, table.examDate),
    statusIdx: index('sms_exams_status_idx').on(table.organizationId, table.status),
    nameIdx: uniqueIndex('sms_exams_org_class_name_idx').on(table.organizationId, table.classId, table.name)
  })
)

/** One score row per exam × student; corrections keep a revision trail. */
export const smsExamScores = pgTable(
  'sms_exam_scores',
  {
    id: serial('id').primaryKey(),
    organizationId: integer('organization_id').notNull(),
    tenantId: integer('tenant_id'),
    examId: integer('exam_id').notNull(),
    studentId: integer('student_id').notNull(),
    score: numeric('score', { precision: 5, scale: 2 }),
    absent: boolean('absent').notNull().default(false),
    remark: varchar('remark', { length: 255 }),
    recordedBy: integer('recorded_by').notNull(),
    recordedAt: timestamp('recorded_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull()
  },
  table => ({
    examStudentIdx: uniqueIndex('sms_exam_scores_exam_student_idx').on(table.organizationId, table.examId, table.studentId),
    studentIdx: index('sms_exam_scores_student_idx').on(table.organizationId, table.studentId)
  })
)

/** Immutable score revision log (who changed what, and why). */
export const smsScoreRevisions = pgTable(
  'sms_score_revisions',
  {
    id: serial('id').primaryKey(),
    organizationId: integer('organization_id').notNull(),
    tenantId: integer('tenant_id'),
    examId: integer('exam_id').notNull(),
    scoreId: integer('score_id').notNull(),
    studentId: integer('student_id').notNull(),
    beforeScore: numeric('before_score', { precision: 5, scale: 2 }),
    afterScore: numeric('after_score', { precision: 5, scale: 2 }),
    beforeAbsent: boolean('before_absent'),
    afterAbsent: boolean('after_absent'),
    reason: varchar('reason', { length: 255 }),
    revisedBy: integer('revised_by').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull()
  },
  table => ({
    examIdx: index('sms_score_revisions_exam_idx').on(table.organizationId, table.examId, table.createdAt)
  })
)

/** Immutable report-card snapshot generated for a student/term. */
export const smsReportCards = pgTable(
  'sms_report_cards',
  {
    id: serial('id').primaryKey(),
    organizationId: integer('organization_id').notNull(),
    tenantId: integer('tenant_id'),
    studentId: integer('student_id').notNull(),
    termId: integer('term_id'),
    payload: jsonb('payload').$type<Record<string, unknown>>().notNull(),
    generatedBy: integer('generated_by').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull()
  },
  table => ({
    studentIdx: index('sms_report_cards_student_idx').on(table.organizationId, table.studentId, table.createdAt)
  })
)

/** Admission cycle (Slice C): applications are accepted, then converted to students. */
export const smsAdmissionCycles = pgTable(
  'sms_admission_cycles',
  {
    id: serial('id').primaryKey(),
    organizationId: integer('organization_id').notNull(),
    tenantId: integer('tenant_id'),
    academicYearId: integer('academic_year_id').notNull(),
    name: varchar('name', { length: 120 }).notNull(),
    startDate: date('start_date').notNull(),
    endDate: date('end_date').notNull(),
    /** open | closed */
    status: varchar('status', { length: 20 }).notNull().default('open'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull()
  },
  table => ({
    orgNameIdx: uniqueIndex('sms_admission_cycles_org_name_idx').on(table.organizationId, table.name),
    statusIdx: index('sms_admission_cycles_status_idx').on(table.organizationId, table.status)
  })
)

/** One application per applicant within a cycle. */
export const smsAdmissionApplications = pgTable(
  'sms_admission_applications',
  {
    id: serial('id').primaryKey(),
    organizationId: integer('organization_id').notNull(),
    tenantId: integer('tenant_id'),
    cycleId: integer('cycle_id').notNull(),
    applicantName: varchar('applicant_name', { length: 120 }).notNull(),
    gender: varchar('gender', { length: 20 }),
    birthDate: date('birth_date'),
    guardianName: varchar('guardian_name', { length: 120 }),
    guardianPhone: varchar('guardian_phone', { length: 40 }),
    previousSchool: varchar('previous_school', { length: 160 }),
    /** submitted | reviewing | accepted | rejected | converted */
    status: varchar('status', { length: 20 }).notNull().default('submitted'),
    studentNo: varchar('student_no', { length: 40 }),
    notes: varchar('notes', { length: 500 }),
    reviewedBy: integer('reviewed_by'),
    reviewedAt: timestamp('reviewed_at', { withTimezone: true }),
    convertedStudentId: integer('converted_student_id'),
    createdBy: integer('created_by').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull()
  },
  table => ({
    cycleStatusIdx: index('sms_admission_applications_cycle_status_idx')
      .on(table.organizationId, table.cycleId, table.status),
    phoneIdx: index('sms_admission_applications_phone_idx')
      .on(table.organizationId, table.guardianPhone)
  })
)

/** Immutable application status trail (who changed what, when). */
export const smsAdmissionEvents = pgTable(
  'sms_admission_events',
  {
    id: serial('id').primaryKey(),
    organizationId: integer('organization_id').notNull(),
    tenantId: integer('tenant_id'),
    applicationId: integer('application_id').notNull(),
    action: varchar('action', { length: 40 }).notNull(),
    fromStatus: varchar('from_status', { length: 20 }),
    toStatus: varchar('to_status', { length: 20 }),
    note: varchar('note', { length: 500 }),
    actorUserId: integer('actor_user_id').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull()
  },
  table => ({
    applicationIdx: index('sms_admission_events_application_idx')
      .on(table.organizationId, table.applicationId, table.createdAt)
  })
)

/** Weekly timetable entry; unique per class × weekday × period. */
export const smsTimetableEntries = pgTable(
  'sms_timetable_entries',
  {
    id: serial('id').primaryKey(),
    organizationId: integer('organization_id').notNull(),
    tenantId: integer('tenant_id'),
    termId: integer('term_id'),
    classId: integer('class_id').notNull(),
    subjectId: integer('subject_id'),
    teacherUserId: integer('teacher_user_id'),
    /** 1 = Monday … 7 = Sunday */
    weekday: integer('weekday').notNull(),
    periodNo: integer('period_no').notNull(),
    room: varchar('room', { length: 40 }),
    /** draft | published */
    status: varchar('status', { length: 20 }).notNull().default('draft'),
    createdBy: integer('created_by').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull()
  },
  table => ({
    classSlotIdx: uniqueIndex('sms_timetable_entries_class_slot_idx')
      .on(table.organizationId, table.classId, table.weekday, table.periodNo, sql`COALESCE(${table.termId}, 0)`),
    teacherSlotIdx: index('sms_timetable_entries_teacher_slot_idx')
      .on(table.organizationId, table.teacherUserId, table.weekday, table.periodNo),
    statusIdx: index('sms_timetable_entries_status_idx').on(table.organizationId, table.status)
  })
)

/**
 * 调课 / 代课登记：按具体日期覆盖某一节课的任课教师或教室。
 * 课表本身仍按周维护，这里只记录某一天的实际调整，保留操作人便于追溯。
 */
export const smsTimetableSubstitutions = pgTable(
  'sms_timetable_substitutions',
  {
    id: serial('id').primaryKey(),
    organizationId: integer('organization_id').notNull(),
    tenantId: integer('tenant_id'),
    entryId: integer('entry_id').notNull(),
    /** 生效日期（YYYY-MM-DD） */
    date: date('date').notNull(),
    /** substitute 代课 | reschedule 调课 */
    type: varchar('type', { length: 20 }).notNull().default('substitute'),
    originalTeacherUserId: integer('original_teacher_user_id'),
    /** 代课教师；调课时可为空 */
    substituteUserId: integer('substitute_user_id'),
    /** 调整后的教室；为空表示沿用课表教室 */
    room: varchar('room', { length: 40 }),
    reason: varchar('reason', { length: 200 }),
    createdBy: integer('created_by').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull()
  },
  table => ({
    entryDateIdx: uniqueIndex('sms_timetable_substitutions_entry_date_idx')
      .on(table.organizationId, table.entryId, table.date),
    dateIdx: index('sms_timetable_substitutions_date_idx')
      .on(table.organizationId, table.date),
    substituteIdx: index('sms_timetable_substitutions_substitute_idx')
      .on(table.organizationId, table.substituteUserId, table.date)
  })
)

/**
 * Finance (Slice D): fee catalogue → invoices → payments → refunds.
 * Money is `numeric(12,2)`; refunds need a second approver. Nothing is
 * deleted — void/cancel statuses are used instead.
 */
export const smsFeeItems = pgTable(
  'sms_fee_items',
  {
    id: serial('id').primaryKey(),
    organizationId: integer('organization_id').notNull(),
    tenantId: integer('tenant_id'),
    name: varchar('name', { length: 120 }).notNull(),
    amount: numeric('amount', { precision: 12, scale: 2 }).notNull(),
    termId: integer('term_id'),
    gradeId: integer('grade_id'),
    dueDate: date('due_date'),
    /** active | archived */
    status: varchar('status', { length: 20 }).notNull().default('active'),
    createdBy: integer('created_by').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull()
  },
  table => ({
    nameIdx: index('sms_fee_items_name_idx').on(table.organizationId, table.name),
    statusIdx: index('sms_fee_items_status_idx').on(table.organizationId, table.status)
  })
)

export const smsInvoices = pgTable(
  'sms_invoices',
  {
    id: serial('id').primaryKey(),
    organizationId: integer('organization_id').notNull(),
    tenantId: integer('tenant_id'),
    studentId: integer('student_id').notNull(),
    feeItemId: integer('fee_item_id').notNull(),
    amount: numeric('amount', { precision: 12, scale: 2 }).notNull(),
    discount: numeric('discount', { precision: 12, scale: 2 }).notNull().default('0'),
    payable: numeric('payable', { precision: 12, scale: 2 }).notNull(),
    paid: numeric('paid', { precision: 12, scale: 2 }).notNull().default('0'),
    /** unpaid | partial | paid | void */
    status: varchar('status', { length: 20 }).notNull().default('unpaid'),
    dueDate: date('due_date'),
    createdBy: integer('created_by').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull()
  },
  table => ({
    studentItemIdx: uniqueIndex('sms_invoices_student_item_idx')
      .on(table.organizationId, table.studentId, table.feeItemId),
    statusIdx: index('sms_invoices_status_idx').on(table.organizationId, table.status)
  })
)

export const smsPayments = pgTable(
  'sms_payments',
  {
    id: serial('id').primaryKey(),
    organizationId: integer('organization_id').notNull(),
    tenantId: integer('tenant_id'),
    invoiceId: integer('invoice_id').notNull(),
    amount: numeric('amount', { precision: 12, scale: 2 }).notNull(),
    /** cash | transfer | wechat | alipay | other */
    method: varchar('method', { length: 20 }).notNull().default('cash'),
    reference: varchar('reference', { length: 80 }),
    paidAt: timestamp('paid_at', { withTimezone: true }).defaultNow().notNull(),
    receivedBy: integer('received_by').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull()
  },
  table => ({
    invoiceIdx: index('sms_payments_invoice_idx').on(table.organizationId, table.invoiceId, table.createdAt)
  })
)

export const smsRefunds = pgTable(
  'sms_refunds',
  {
    id: serial('id').primaryKey(),
    organizationId: integer('organization_id').notNull(),
    tenantId: integer('tenant_id'),
    paymentId: integer('payment_id').notNull(),
    invoiceId: integer('invoice_id').notNull(),
    amount: numeric('amount', { precision: 12, scale: 2 }).notNull(),
    reason: varchar('reason', { length: 255 }),
    /** pending | approved | rejected */
    status: varchar('status', { length: 20 }).notNull().default('pending'),
    requestedBy: integer('requested_by').notNull(),
    approvedBy: integer('approved_by'),
    approvedAt: timestamp('approved_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull()
  },
  table => ({
    paymentIdx: index('sms_refunds_payment_idx').on(table.organizationId, table.paymentId, table.status),
    statusIdx: index('sms_refunds_status_idx').on(table.organizationId, table.status)
  })
)

/** Fixed assets with an immutable movement trail. */
export const smsAssets = pgTable(
  'sms_assets',
  {
    id: serial('id').primaryKey(),
    organizationId: integer('organization_id').notNull(),
    tenantId: integer('tenant_id'),
    assetNo: varchar('asset_no', { length: 40 }).notNull(),
    name: varchar('name', { length: 120 }).notNull(),
    category: varchar('category', { length: 60 }),
    /** in_use | idle | maintenance | disposed */
    status: varchar('status', { length: 20 }).notNull().default('idle'),
    assignedUserId: integer('assigned_user_id'),
    location: varchar('location', { length: 120 }),
    purchasedAt: date('purchased_at'),
    value: numeric('value', { precision: 12, scale: 2 }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull()
  },
  table => ({
    assetNoIdx: uniqueIndex('sms_assets_org_no_idx').on(table.organizationId, table.assetNo),
    statusIdx: index('sms_assets_status_idx').on(table.organizationId, table.status)
  })
)

export const smsAssetEvents = pgTable(
  'sms_asset_events',
  {
    id: serial('id').primaryKey(),
    organizationId: integer('organization_id').notNull(),
    tenantId: integer('tenant_id'),
    assetId: integer('asset_id').notNull(),
    action: varchar('action', { length: 40 }).notNull(),
    fromStatus: varchar('from_status', { length: 20 }),
    toStatus: varchar('to_status', { length: 20 }),
    note: varchar('note', { length: 255 }),
    actorUserId: integer('actor_user_id').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull()
  },
  table => ({
    assetIdx: index('sms_asset_events_asset_idx').on(table.organizationId, table.assetId, table.createdAt)
  })
)

/** Library catalogue and loans. */
export const smsBooks = pgTable(
  'sms_books',
  {
    id: serial('id').primaryKey(),
    organizationId: integer('organization_id').notNull(),
    tenantId: integer('tenant_id'),
    title: varchar('title', { length: 160 }).notNull(),
    author: varchar('author', { length: 120 }),
    isbn: varchar('isbn', { length: 20 }),
    category: varchar('category', { length: 60 }),
    totalCopies: integer('total_copies').notNull().default(1),
    availableCopies: integer('available_copies').notNull().default(1),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull()
  },
  table => ({
    isbnIdx: index('sms_books_isbn_idx').on(table.organizationId, table.isbn),
    titleIdx: index('sms_books_title_idx').on(table.organizationId, table.title)
  })
)

export const smsBookLoans = pgTable(
  'sms_book_loans',
  {
    id: serial('id').primaryKey(),
    organizationId: integer('organization_id').notNull(),
    tenantId: integer('tenant_id'),
    bookId: integer('book_id').notNull(),
    studentId: integer('student_id').notNull(),
    borrowedAt: timestamp('borrowed_at', { withTimezone: true }).defaultNow().notNull(),
    dueAt: timestamp('due_at', { withTimezone: true }).notNull(),
    returnedAt: timestamp('returned_at', { withTimezone: true }),
    /** borrowed | returned | overdue */
    status: varchar('status', { length: 20 }).notNull().default('borrowed'),
    createdBy: integer('created_by').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull()
  },
  table => ({
    studentIdx: index('sms_book_loans_student_idx').on(table.organizationId, table.studentId, table.status),
    bookIdx: index('sms_book_loans_book_idx').on(table.organizationId, table.bookId, table.status)
  })
)

export const smsReportRuns = pgTable(
  'sms_report_runs',
  {
    id: serial('id').primaryKey(),
    organizationId: integer('organization_id').notNull(),
    tenantId: integer('tenant_id'),
    /** weekly | attendance_scan */
    kind: varchar('kind', { length: 40 }).notNull(),
    periodStart: date('period_start').notNull(),
    periodEnd: date('period_end').notNull(),
    /** succeeded | failed */
    status: varchar('status', { length: 20 }).notNull().default('succeeded'),
    payload: jsonb('payload').$type<Record<string, unknown>>(),
    error: varchar('error', { length: 500 }),
    generatedAt: timestamp('generated_at', { withTimezone: true }).defaultNow().notNull()
  },
  table => ({
    periodIdx: index('sms_report_runs_period_idx')
      .on(table.organizationId, table.kind, table.periodStart)
  })
)

/**
 * In-app notification center (P0). Rows are per recipient and organization so
 * attendance / leave / finance events can reach the right people without
 * touching the core notification table.
 */
export const smsNotifications = pgTable(
  'sms_notifications',
  {
    id: serial('id').primaryKey(),
    organizationId: integer('organization_id').notNull(),
    tenantId: integer('tenant_id'),
    recipientUserId: integer('recipient_user_id').notNull(),
    /** attendance | leave | finance | approval | academic | system */
    category: varchar('category', { length: 40 }).notNull().default('system'),
    title: varchar('title', { length: 160 }).notNull(),
    body: varchar('body', { length: 1000 }),
    /** In-app route the recipient can open (never an external URL). */
    link: varchar('link', { length: 255 }),
    entityType: varchar('entity_type', { length: 40 }),
    entityId: integer('entity_id'),
    /** unread | read | acknowledged */
    status: varchar('status', { length: 20 }).notNull().default('unread'),
    /** 需要收件人确认签收的通知。 */
    requiresAck: boolean('requires_ack').notNull().default(false),
    readAt: timestamp('read_at', { withTimezone: true }),
    acknowledgedAt: timestamp('acknowledged_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull()
  },
  table => ({
    recipientIdx: index('sms_notifications_recipient_idx')
      .on(table.organizationId, table.recipientUserId, table.status, table.createdAt),
    orgCreatedIdx: index('sms_notifications_org_created_idx')
      .on(table.organizationId, table.createdAt)
  })
)

/**
 * School-rule knowledge base (P1). Articles are keyword-searchable and filtered
 * by audience so students/guardians never see staff-only policies.
 */
export const smsKnowledgeArticles = pgTable(
  'sms_knowledge_articles',
  {
    id: serial('id').primaryKey(),
    organizationId: integer('organization_id').notNull(),
    tenantId: integer('tenant_id'),
    title: varchar('title', { length: 200 }).notNull(),
    content: text('content').notNull(),
    tags: varchar('tags', { length: 255 }),
    /** all | staff | student | guardian */
    audience: varchar('audience', { length: 20 }).notNull().default('all'),
    /** published | draft */
    status: varchar('status', { length: 20 }).notNull().default('published'),
    /** 可选语义向量；未配置 embedding 服务时为空，检索回退关键词。 */
    embedding: jsonb('embedding').$type<number[]>(),
    createdBy: integer('created_by').notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull()
  },
  table => ({
    orgStatusIdx: index('sms_knowledge_articles_org_status_idx')
      .on(table.organizationId, table.status, table.updatedAt),
    titleIdx: index('sms_knowledge_articles_title_idx').on(table.organizationId, table.title)
  })
)

/**
 * Pre-aggregated daily attendance (P1). One row per organization/class/day so
 * dashboards never scan the raw attendance table.
 */
export const smsReportDaily = pgTable(
  'sms_report_daily',
  {
    id: serial('id').primaryKey(),
    organizationId: integer('organization_id').notNull(),
    tenantId: integer('tenant_id'),
    reportDate: date('report_date').notNull(),
    /** 0 = whole-school aggregate; otherwise the class id. */
    classId: integer('class_id').notNull().default(0),
    present: integer('present').notNull().default(0),
    late: integer('late').notNull().default(0),
    absent: integer('absent').notNull().default(0),
    leave: integer('leave').notNull().default(0),
    total: integer('total').notNull().default(0),
    generatedAt: timestamp('generated_at', { withTimezone: true }).defaultNow().notNull()
  },
  table => ({
    dailyIdx: uniqueIndex('sms_report_daily_unique_idx')
      .on(table.organizationId, table.reportDate, table.classId)
  })
)

/**
 * Durable task-agent runs (P2). The chat layer creates a task, then advances it
 * through an explicit state machine so long-running work survives a restart.
 */
export const smsAgentTasks = pgTable(
  'sms_agent_tasks',
  {
    id: serial('id').primaryKey(),
    organizationId: integer('organization_id').notNull(),
    tenantId: integer('tenant_id'),
    ownerUserId: integer('owner_user_id').notNull(),
    title: varchar('title', { length: 200 }).notNull(),
    goal: varchar('goal', { length: 2000 }),
    /** pending | running | waiting_approval | done | failed | cancelled */
    status: varchar('status', { length: 30 }).notNull().default('pending'),
    step: integer('step').notNull().default(0),
    maxSteps: integer('max_steps').notNull().default(8),
    payload: jsonb('payload').$type<Record<string, unknown>>(),
    result: jsonb('result').$type<Record<string, unknown>>(),
    lastError: varchar('last_error', { length: 500 }),
    /** 创建方提供的幂等键，重复创建返回既有任务。 */
    idempotencyKey: varchar('idempotency_key', { length: 80 }),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull()
  },
  table => ({
    ownerIdx: index('sms_agent_tasks_owner_idx')
      .on(table.organizationId, table.ownerUserId, table.status, table.updatedAt),
    idempotencyIdx: uniqueIndex('sms_agent_tasks_idempotency_idx')
      .on(table.organizationId, table.idempotencyKey)
  })
)

/** Teaching domain: assignments, submissions and course elections (P2). */
export const smsAssignments = pgTable(
  'sms_assignments',
  {
    id: serial('id').primaryKey(),
    organizationId: integer('organization_id').notNull(),
    tenantId: integer('tenant_id'),
    classId: integer('class_id').notNull(),
    subjectId: integer('subject_id').notNull(),
    title: varchar('title', { length: 200 }).notNull(),
    description: text('description'),
    dueAt: timestamp('due_at', { withTimezone: true }),
    /** draft | published | closed */
    status: varchar('status', { length: 20 }).notNull().default('draft'),
    /** 评分标准：{ criteria: [{ name, weight }] }。 */
    rubric: jsonb('rubric').$type<Record<string, unknown>>(),
    createdBy: integer('created_by').notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull()
  },
  table => ({
    classIdx: index('sms_assignments_class_idx')
      .on(table.organizationId, table.classId, table.status, table.dueAt)
  })
)

export const smsAssignmentSubmissions = pgTable(
  'sms_assignment_submissions',
  {
    id: serial('id').primaryKey(),
    organizationId: integer('organization_id').notNull(),
    tenantId: integer('tenant_id'),
    assignmentId: integer('assignment_id').notNull(),
    studentId: integer('student_id').notNull(),
    content: text('content'),
    /** 站内路径或 http(s) 附件地址。 */
    attachmentUrl: varchar('attachment_url', { length: 500 }),
    /** 平台文件 ID；引用前已校验同组织归属。 */
    attachmentFileId: integer('attachment_file_id'),
    /** submitted | graded */
    status: varchar('status', { length: 20 }).notNull().default('submitted'),
    score: numeric('score', { precision: 6, scale: 2 }),
    feedback: varchar('feedback', { length: 500 }),
    submittedAt: timestamp('submitted_at', { withTimezone: true }).defaultNow().notNull(),
    gradedBy: integer('graded_by'),
    gradedAt: timestamp('graded_at', { withTimezone: true })
  },
  table => ({
    assignmentStudentIdx: uniqueIndex('sms_assignment_submissions_unique_idx')
      .on(table.organizationId, table.assignmentId, table.studentId)
  })
)

export const smsCourseElections = pgTable(
  'sms_course_elections',
  {
    id: serial('id').primaryKey(),
    organizationId: integer('organization_id').notNull(),
    tenantId: integer('tenant_id'),
    studentId: integer('student_id').notNull(),
    subjectId: integer('subject_id').notNull(),
    termId: integer('term_id').notNull(),
    /** selected | dropped */
    status: varchar('status', { length: 20 }).notNull().default('selected'),
    electedAt: timestamp('elected_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull()
  },
  table => ({
    electionIdx: uniqueIndex('sms_course_elections_unique_idx')
      .on(table.organizationId, table.studentId, table.subjectId, table.termId)
  })
)

/** 通知偏好：按用户 + 分类静音，缺失行视为开启。 */
export const smsNotificationPreferences = pgTable(
  'sms_notification_preferences',
  {
    id: serial('id').primaryKey(),
    organizationId: integer('organization_id').notNull(),
    userId: integer('user_id').notNull(),
    category: varchar('category', { length: 40 }).notNull(),
    muted: boolean('muted').notNull().default(false),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull()
  },
  table => ({
    userCategoryIdx: uniqueIndex('sms_notification_preferences_unique_idx')
      .on(table.organizationId, table.userId, table.category)
  })
)

/** Agent 任务事件流：每次状态推进都留痕，便于排障与回放。 */
export const smsAgentTaskEvents = pgTable(
  'sms_agent_task_events',
  {
    id: serial('id').primaryKey(),
    organizationId: integer('organization_id').notNull(),
    taskId: integer('task_id').notNull(),
    event: varchar('event', { length: 40 }).notNull(),
    fromStatus: varchar('from_status', { length: 30 }),
    toStatus: varchar('to_status', { length: 30 }),
    note: varchar('note', { length: 500 }),
    actorUserId: integer('actor_user_id'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull()
  },
  table => ({
    taskIdx: index('sms_agent_task_events_task_idx')
      .on(table.organizationId, table.taskId, table.createdAt)
  })
)

/** 在线评估指标：golden set 命中率、工具失败率等时序数据。 */
export const smsEvaluationMetrics = pgTable(
  'sms_evaluation_metrics',
  {
    id: serial('id').primaryKey(),
    organizationId: integer('organization_id').notNull(),
    metric: varchar('metric', { length: 80 }).notNull(),
    value: numeric('value', { precision: 12, scale: 4 }).notNull(),
    labels: jsonb('labels').$type<Record<string, unknown>>(),
    recordedAt: timestamp('recorded_at', { withTimezone: true }).defaultNow().notNull()
  },
  table => ({
    metricIdx: index('sms_evaluation_metrics_metric_idx')
      .on(table.organizationId, table.metric, table.recordedAt)
  })
)

/**
 * 外部通知发件箱（P1）。
 *
 * 站内信落库后只写一行 outbox，由定时任务负责 Webhook 投递与重试；
 * 业务事务不会因为第三方网关抖动而失败或阻塞。
 */
export const smsNotificationOutbox = pgTable(
  'sms_notification_outbox',
  {
    id: serial('id').primaryKey(),
    organizationId: integer('organization_id'),
    tenantId: integer('tenant_id'),
    /** webhook | email */
    channel: varchar('channel', { length: 20 }).notNull().default('webhook'),
    payload: jsonb('payload').$type<Record<string, unknown>>().notNull(),
    /** pending | delivered | failed */
    status: varchar('status', { length: 20 }).notNull().default('pending'),
    attempts: integer('attempts').notNull().default(0),
    maxAttempts: integer('max_attempts').notNull().default(5),
    nextAttemptAt: timestamp('next_attempt_at', { withTimezone: true }).defaultNow().notNull(),
    lastError: varchar('last_error', { length: 500 }),
    deliveredAt: timestamp('delivered_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull()
  },
  table => ({
    dueIdx: index('sms_notification_outbox_due_idx')
      .on(table.status, table.nextAttemptAt)
  })
)

/**
 * 通用后台任务队列（P2）。
 *
 * 导入、日报等重任务可以入队由 worker 执行，HTTP 请求只负责返回 jobId，
 * 避免长事务占用请求线程。
 */
export const smsBackgroundJobs = pgTable(
  'sms_background_jobs',
  {
    id: serial('id').primaryKey(),
    organizationId: integer('organization_id'),
    kind: varchar('kind', { length: 40 }).notNull(),
    payload: jsonb('payload').$type<Record<string, unknown>>().notNull(),
    /** pending | running | succeeded | failed */
    status: varchar('status', { length: 20 }).notNull().default('pending'),
    attempts: integer('attempts').notNull().default(0),
    maxAttempts: integer('max_attempts').notNull().default(3),
    nextAttemptAt: timestamp('next_attempt_at', { withTimezone: true }).defaultNow().notNull(),
    lastError: varchar('last_error', { length: 500 }),
    result: jsonb('result').$type<Record<string, unknown>>(),
    finishedAt: timestamp('finished_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull()
  },
  table => ({
    dueIdx: index('sms_background_jobs_due_idx').on(table.status, table.nextAttemptAt),
    kindIdx: index('sms_background_jobs_kind_idx').on(table.kind, table.status)
  })
)
