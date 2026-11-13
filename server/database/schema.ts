import { sql } from 'drizzle-orm'
import {
  boolean,
  date,
  index,
  integer,
  pgTable,
  serial,
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
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull()
  },
  table => ({
    organizationStudentNoIdx: uniqueIndex('sms_students_org_student_no_idx').on(table.organizationId, table.studentNo),
    organizationClassIdx: index('sms_students_org_class_idx').on(table.organizationId, table.classId),
    organizationUserIdx: uniqueIndex('sms_students_org_user_idx').on(table.organizationId, table.userId),
    tenantIdx: index('sms_students_tenant_idx').on(table.tenantId)
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
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull()
  },
  table => ({
    teacherClassIdx: uniqueIndex('sms_teacher_assignments_teacher_class_idx').on(table.teacherUserId, table.classId),
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
