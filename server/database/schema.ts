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

export const sisAcademicYears = pgTable(
  'sis_academic_years',
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
    organizationNameIdx: uniqueIndex('sis_academic_years_org_name_idx').on(table.organizationId, table.name),
    tenantIdx: index('sis_academic_years_tenant_idx').on(table.tenantId)
  })
)

export const sisTerms = pgTable(
  'sis_terms',
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
    yearNameIdx: uniqueIndex('sis_terms_year_name_idx').on(table.academicYearId, table.name),
    organizationIdx: index('sis_terms_organization_idx').on(table.organizationId)
  })
)

export const sisGrades = pgTable(
  'sis_grades',
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
    organizationNameIdx: uniqueIndex('sis_grades_org_name_idx').on(table.organizationId, table.name)
  })
)

export const sisSubjects = pgTable(
  'sis_subjects',
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
    organizationCodeIdx: uniqueIndex('sis_subjects_org_code_idx').on(table.organizationId, table.code)
  })
)

export const sisTeachers = pgTable(
  'sis_teachers',
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
    organizationUserIdx: uniqueIndex('sis_teachers_org_user_idx').on(table.organizationId, table.userId)
  })
)

export const sisClasses = pgTable(
  'sis_classes',
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
    organizationNameIdx: uniqueIndex('sis_classes_org_name_idx').on(table.organizationId, table.name),
    organizationYearIdx: index('sis_classes_org_year_idx').on(table.organizationId, table.academicYearId),
    tenantIdx: index('sis_classes_tenant_idx').on(table.tenantId)
  })
)

export const sisStudents = pgTable(
  'sis_students',
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
    organizationStudentNoIdx: uniqueIndex('sis_students_org_student_no_idx').on(table.organizationId, table.studentNo),
    organizationClassIdx: index('sis_students_org_class_idx').on(table.organizationId, table.classId),
    organizationUserIdx: uniqueIndex('sis_students_org_user_idx').on(table.organizationId, table.userId),
    tenantIdx: index('sis_students_tenant_idx').on(table.tenantId)
  })
)

export const sisTeacherAssignments = pgTable(
  'sis_teacher_assignments',
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
    teacherClassIdx: uniqueIndex('sis_teacher_assignments_teacher_class_idx').on(table.teacherUserId, table.classId),
    classIdx: index('sis_teacher_assignments_class_idx').on(table.classId),
    organizationIdx: index('sis_teacher_assignments_organization_idx').on(table.organizationId)
  })
)

export const sisEnrollments = pgTable(
  'sis_enrollments',
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
    organizationIdx: index('sis_enrollments_organization_idx').on(table.organizationId),
    studentStatusIdx: index('sis_enrollments_student_status_idx').on(table.studentId, table.status),
    classStatusIdx: index('sis_enrollments_class_status_idx').on(table.classId, table.status),
    activeYearIdx: uniqueIndex('sis_enrollments_active_year_idx')
      .on(table.studentId, table.academicYearId)
      .where(sql`${table.status} = 'active'`)
  })
)

export const sisGuardians = pgTable(
  'sis_guardians',
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
    organizationUserIdx: uniqueIndex('sis_guardians_org_user_idx').on(table.organizationId, table.userId)
  })
)

export const sisStudentGuardians = pgTable(
  'sis_student_guardians',
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
    studentGuardianIdx: uniqueIndex('sis_student_guardians_pair_idx').on(table.studentId, table.guardianId),
    guardianIdx: index('sis_student_guardians_guardian_idx').on(table.guardianId)
  })
)
