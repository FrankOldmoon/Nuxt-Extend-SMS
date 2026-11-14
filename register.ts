import type {
  FieldMeta,
  ModuleApiDefinition,
  ModuleApiRouter,
  TableFeatures,
  TableMeta,
  ToolRegistry,
  UiDefinition,
  UiRegistry
} from '../../server/sdk'
import {
  db,
  registerCapabilities,
  registerChatPrompt,
  registerDashboardTable,
  registerDataScopeResolver,
  registerTableValidator
} from '../../server/sdk'
import { setResponseHeader } from 'h3'
import { and, eq, inArray } from 'drizzle-orm'
import { canUseSms, type SmsActor } from './server/context'
import { smsCapabilities } from './server/capabilities'
import { buildSmsChatPrompt } from './server/chatPrompt'
import { generatedChatComponents } from './server/chatComponents.generated'
import {
  assertClassInContext,
  assignedClassIds,
  createStudent,
  searchStudents,
  type CreateStudentInput
} from './server/students'
import { batchMarkAttendance, listAttendanceRoster } from './server/attendance'
import {
  applyLeave,
  cancelLeave,
  canApproveLeave,
  decideLeave,
  listLeaveRequests
} from './server/leave'
import {
  canGenerateReportCard,
  canPublishScores,
  createExam,
  generateReportCard,
  getScoreSheet,
  listExams,
  listScores,
  publishExam,
  saveScores
} from './server/exams'
import {
  canConvertApplications,
  canReviewApplications,
  convertApplication,
  createAdmissionCycle,
  createApplication,
  listAdmissionCycles,
  listApplications,
  reviewApplication
} from './server/admissions'
import {
  canPublishTimetable,
  createTimetableEntry,
  listTimetable,
  publishTimetable
} from './server/timetable'
import {
  approveRefund,
  canApproveRefund,
  createFeeItem,
  createInvoice,
  listFeeItems,
  listInvoices,
  listRefunds,
  recordPayment,
  requestRefund
} from './server/finance'
import { createAsset, listAssets, transferAsset } from './server/assets'
import { borrowBook, createBook, listBooks, listLoans, returnBook } from './server/library'
import {
  attendanceReport,
  canExportReports,
  exportReport,
  financeReport,
  scoreReport
} from './server/reports'
import {
  canSendNotification,
  getNotificationPreferences,
  listNotifications,
  markAllNotificationsRead,
  markNotificationRead,
  sendNotification,
  unreadNotificationCount,
  updateNotificationPreferences
} from './server/notifications'
import { createKnowledgeArticle, searchKnowledge, updateKnowledgeArticle } from './server/knowledge'
import { buildWorkbench } from './server/workbench'
import { importScoresCsv, importStudentsCsv } from './server/imports'
import { listDailyReport } from './server/reportDaily'
import { advanceAgentTask, createAgentTask, listAgentTaskEvents, listAgentTasks } from './server/agentTasks'
import { listEvaluationMetrics, recordEvaluationMetric } from './server/evaluation'
import { buildSmsMetrics, formatPrometheusMetrics, queryAuditLogs } from './server/observability'
import { listApprovalInbox, reassignApprovalTask } from './server/approvals'
import { decideApprovalBatch } from './server/approvalActions'
import { searchSms } from './server/search'
import { createStudentMovement, listStudentMovements } from './server/movements'
import {
  createAssignment,
  gradeSubmission,
  listAssignments,
  listElections,
  setCourseElection,
  submitAssignment
} from './server/teaching'
import { classInContext, assertAcademicYearInContext, assertGradeInContext, assertSubjectInContext, assertTermInContext, listClasses, listSubjects } from './server/academics'
import { assertStudentInContext } from './server/enrollment'
import { assertGuardianInContext, guardianStudentIds } from './server/guardians'
import {
  smsAcademicYears,
  smsClasses,
  smsEnrollments,
  smsGrades,
  smsGuardians,
  smsStudentGuardians,
  smsStudents,
  smsSubjects,
  smsTeachers,
  smsTerms
} from './server/database/schema'

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function field(partial: Partial<FieldMeta> & Pick<FieldMeta, 'key' | 'label' | 'type'>): FieldMeta {
  return {
    nullable: true,
    showInForm: true,
    showInTable: true,
    showInDetail: true,
    editable: true,
    ...partial
  }
}

function permissionsFor(resource: string) {
  return {
    read: `sms.${resource}.read`,
    create: `sms.${resource}.create`,
    update: `sms.${resource}.update`,
    delete: `sms.${resource}.delete`
  }
}

/** Common organization/tenant ownership features. */
function scopedFeatures(extra: Partial<TableFeatures> = {}): TableFeatures {
  return {
    softDelete: false,
    search: [],
    organizationScoped: true,
    tenantScoped: true,
    dataScope: { scope: 'organization', organizationColumn: 'organizationId' },
    contextColumns: { organization: 'organizationId', tenant: 'tenantId' },
    ...extra
  }
}

// ---------------------------------------------------------------------------
// Field metadata
// ---------------------------------------------------------------------------

const studentFields: FieldMeta[] = [
  field({ key: 'id', label: 'ID', type: 'number', nullable: false, editable: false, showInForm: false }),
  field({ key: 'name', label: 'Name', type: 'text', nullable: false, validation: { required: true } }),
  field({ key: 'studentNo', label: 'Student No', type: 'text', nullable: false, validation: { required: true } }),
  field({ key: 'classId', label: 'Class', type: 'relation', nullable: true, relation: { table: 'classes', labelKey: 'name', valueKey: 'id' } }),
  field({ key: 'userId', label: 'User ID', type: 'number', nullable: true, showInTable: false }),
  field({ key: 'deletedAt', label: 'Deleted', type: 'datetime', nullable: true, editable: false, showInForm: false, showInTable: false }),
  field({ key: 'createdAt', label: 'Created', type: 'datetime', nullable: false, editable: false, showInForm: false })
]

const classFields: FieldMeta[] = [
  field({ key: 'id', label: 'ID', type: 'number', nullable: false, editable: false, showInForm: false }),
  field({ key: 'name', label: 'Name', type: 'text', nullable: false, validation: { required: true } }),
  field({ key: 'academicYearId', label: 'Academic Year', type: 'relation', nullable: true, relation: { table: 'academicYears', labelKey: 'name', valueKey: 'id' } }),
  field({ key: 'gradeId', label: 'Grade', type: 'relation', nullable: true, relation: { table: 'grades', labelKey: 'name', valueKey: 'id' } }),
  field({ key: 'grade', label: 'Grade (legacy)', type: 'text', nullable: true, showInTable: false }),
  field({ key: 'deletedAt', label: 'Deleted', type: 'datetime', nullable: true, editable: false, showInForm: false, showInTable: false }),
  field({ key: 'createdAt', label: 'Created', type: 'datetime', nullable: false, editable: false, showInForm: false })
]

const academicYearFields: FieldMeta[] = [
  field({ key: 'id', label: 'ID', type: 'number', nullable: false, editable: false, showInForm: false }),
  field({ key: 'name', label: 'Name', type: 'text', nullable: false, validation: { required: true } }),
  field({ key: 'startDate', label: 'Start date', type: 'date', nullable: false }),
  field({ key: 'endDate', label: 'End date', type: 'date', nullable: false }),
  field({ key: 'isCurrent', label: 'Current', type: 'boolean', nullable: false }),
  field({ key: 'deletedAt', label: 'Deleted', type: 'datetime', nullable: true, editable: false, showInForm: false, showInTable: false }),
  field({ key: 'createdAt', label: 'Created', type: 'datetime', nullable: false, editable: false, showInForm: false })
]

const termFields: FieldMeta[] = [
  field({ key: 'id', label: 'ID', type: 'number', nullable: false, editable: false, showInForm: false }),
  field({ key: 'academicYearId', label: 'Academic Year', type: 'relation', nullable: false, relation: { table: 'academicYears', labelKey: 'name', valueKey: 'id' } }),
  field({ key: 'name', label: 'Name', type: 'text', nullable: false, validation: { required: true } }),
  field({ key: 'startDate', label: 'Start date', type: 'date', nullable: false }),
  field({ key: 'endDate', label: 'End date', type: 'date', nullable: false }),
  field({ key: 'createdAt', label: 'Created', type: 'datetime', nullable: false, editable: false, showInForm: false })
]

const gradeFields: FieldMeta[] = [
  field({ key: 'id', label: 'ID', type: 'number', nullable: false, editable: false, showInForm: false }),
  field({ key: 'name', label: 'Name', type: 'text', nullable: false, validation: { required: true } }),
  field({ key: 'level', label: 'Level', type: 'number', nullable: true }),
  field({ key: 'deletedAt', label: 'Deleted', type: 'datetime', nullable: true, editable: false, showInForm: false, showInTable: false }),
  field({ key: 'createdAt', label: 'Created', type: 'datetime', nullable: false, editable: false, showInForm: false })
]

const subjectFields: FieldMeta[] = [
  field({ key: 'id', label: 'ID', type: 'number', nullable: false, editable: false, showInForm: false }),
  field({ key: 'code', label: 'Code', type: 'text', nullable: false, validation: { required: true } }),
  field({ key: 'name', label: 'Name', type: 'text', nullable: false, validation: { required: true } }),
  field({ key: 'deletedAt', label: 'Deleted', type: 'datetime', nullable: true, editable: false, showInForm: false, showInTable: false }),
  field({ key: 'createdAt', label: 'Created', type: 'datetime', nullable: false, editable: false, showInForm: false })
]

const teacherFields: FieldMeta[] = [
  field({ key: 'id', label: 'ID', type: 'number', nullable: false, editable: false, showInForm: false }),
  field({ key: 'userId', label: 'User ID', type: 'number', nullable: false, validation: { required: true } }),
  field({ key: 'name', label: 'Name', type: 'text', nullable: true }),
  field({ key: 'employeeNo', label: 'Employee No', type: 'text', nullable: true }),
  field({ key: 'deletedAt', label: 'Deleted', type: 'datetime', nullable: true, editable: false, showInForm: false, showInTable: false }),
  field({ key: 'createdAt', label: 'Created', type: 'datetime', nullable: false, editable: false, showInForm: false })
]

const enrollmentFields: FieldMeta[] = [
  field({ key: 'id', label: 'ID', type: 'number', nullable: false, editable: false, showInForm: false }),
  field({ key: 'studentId', label: 'Student', type: 'relation', nullable: false, relation: { table: 'students', labelKey: 'name', valueKey: 'id' } }),
  field({ key: 'classId', label: 'Class', type: 'relation', nullable: false, relation: { table: 'classes', labelKey: 'name', valueKey: 'id' } }),
  field({ key: 'academicYearId', label: 'Academic Year', type: 'relation', nullable: false, relation: { table: 'academicYears', labelKey: 'name', valueKey: 'id' } }),
  field({ key: 'termId', label: 'Term', type: 'relation', nullable: true, relation: { table: 'terms', labelKey: 'name', valueKey: 'id' } }),
  field({
    key: 'status',
    label: 'Status',
    type: 'select',
    nullable: false,
    editable: false,
    options: [
      { label: 'active', value: 'active' },
      { label: 'completed', value: 'completed' },
      { label: 'withdrawn', value: 'withdrawn' }
    ]
  }),
  field({ key: 'enrolledAt', label: 'Enrolled at', type: 'datetime', nullable: false, editable: false, showInForm: false }),
  field({ key: 'endedAt', label: 'Ended at', type: 'datetime', nullable: true, editable: false, showInForm: false }),
  field({ key: 'createdAt', label: 'Created', type: 'datetime', nullable: false, editable: false, showInForm: false })
]

const guardianFields: FieldMeta[] = [
  field({ key: 'id', label: 'ID', type: 'number', nullable: false, editable: false, showInForm: false }),
  field({ key: 'userId', label: 'User ID', type: 'number', nullable: false, validation: { required: true } }),
  field({ key: 'name', label: 'Name', type: 'text', nullable: true }),
  field({ key: 'phone', label: 'Phone', type: 'text', nullable: true }),
  field({ key: 'deletedAt', label: 'Deleted', type: 'datetime', nullable: true, editable: false, showInForm: false, showInTable: false }),
  field({ key: 'createdAt', label: 'Created', type: 'datetime', nullable: false, editable: false, showInForm: false })
]

const studentGuardianFields: FieldMeta[] = [
  field({ key: 'id', label: 'ID', type: 'number', nullable: false, editable: false, showInForm: false }),
  field({ key: 'studentId', label: 'Student', type: 'relation', nullable: false, relation: { table: 'students', labelKey: 'name', valueKey: 'id' } }),
  field({ key: 'guardianId', label: 'Guardian', type: 'relation', nullable: false, relation: { table: 'guardians', labelKey: 'name', valueKey: 'id' } }),
  field({ key: 'relation', label: 'Relation', type: 'text', nullable: true }),
  field({ key: 'isPrimary', label: 'Primary', type: 'boolean', nullable: false }),
  field({ key: 'createdAt', label: 'Created', type: 'datetime', nullable: false, editable: false, showInForm: false })
]

// ---------------------------------------------------------------------------
// Table metadata
// ---------------------------------------------------------------------------

const studentsMeta: TableMeta = {
  table: 'students',
  moduleId: 'sms',
  resource: 'students',
  permissions: permissionsFor('students'),
  exposure: 'generic-crud',
  label: 'Students',
  icon: 'i-lucide-graduation-cap',
  fields: studentFields,
  features: scopedFeatures({
    softDelete: true,
    search: ['name', 'studentNo'],
    defaultSort: { field: 'name', order: 'asc' },
    // Role-aware: admin → global, teacher → assigned classes,
    // student → own row, guardian → explicitly linked students.
    dataScope: { resolver: 'sms.teacherAssignedClasses' }
  }),
  custom: false
}

const classesMeta: TableMeta = {
  table: 'classes',
  moduleId: 'sms',
  resource: 'classes',
  permissions: permissionsFor('classes'),
  exposure: 'generic-crud',
  label: 'Classes',
  icon: 'i-lucide-school',
  fields: classFields,
  features: scopedFeatures({
    softDelete: true,
    search: ['name', 'grade'],
    defaultSort: { field: 'name', order: 'asc' },
    dataScope: { resolver: 'sms.classes' }
  }),
  custom: false
}

const academicYearsMeta: TableMeta = {
  table: 'academicYears',
  moduleId: 'sms',
  resource: 'academic-years',
  permissions: permissionsFor('academic-years'),
  exposure: 'generic-crud',
  label: 'Academic Years',
  icon: 'i-lucide-calendar-range',
  fields: academicYearFields,
  features: scopedFeatures({
    softDelete: true,
    search: ['name'],
    defaultSort: { field: 'name', order: 'desc' }
  }),
  custom: false
}

const termsMeta: TableMeta = {
  table: 'terms',
  moduleId: 'sms',
  resource: 'terms',
  permissions: permissionsFor('terms'),
  exposure: 'generic-crud',
  label: 'Terms',
  icon: 'i-lucide-calendar-days',
  fields: termFields,
  features: scopedFeatures({
    search: ['name'],
    defaultSort: { field: 'name', order: 'asc' }
  }),
  custom: false
}

const gradesMeta: TableMeta = {
  table: 'grades',
  moduleId: 'sms',
  resource: 'grades',
  permissions: permissionsFor('grades'),
  exposure: 'generic-crud',
  label: 'Grades',
  icon: 'i-lucide-layers',
  fields: gradeFields,
  features: scopedFeatures({
    softDelete: true,
    search: ['name'],
    defaultSort: { field: 'level', order: 'asc' }
  }),
  custom: false
}

const subjectsMeta: TableMeta = {
  table: 'subjects',
  moduleId: 'sms',
  resource: 'subjects',
  permissions: permissionsFor('subjects'),
  exposure: 'generic-crud',
  label: 'Subjects',
  icon: 'i-lucide-book-open',
  fields: subjectFields,
  features: scopedFeatures({
    softDelete: true,
    search: ['code', 'name'],
    defaultSort: { field: 'name', order: 'asc' }
  }),
  custom: false
}

const teachersMeta: TableMeta = {
  table: 'teachers',
  moduleId: 'sms',
  resource: 'teachers',
  permissions: permissionsFor('teachers'),
  exposure: 'generic-crud',
  label: 'Teachers',
  icon: 'i-lucide-user-round-check',
  fields: teacherFields,
  features: scopedFeatures({
    softDelete: true,
    search: ['name', 'employeeNo'],
    defaultSort: { field: 'name', order: 'asc' },
    dataScope: { resolver: 'sms.teachers' }
  }),
  custom: false
}

const enrollmentsMeta: TableMeta = {
  table: 'enrollments',
  moduleId: 'sms',
  resource: 'enrollments',
  permissions: permissionsFor('enrollments'),
  exposure: 'generic-crud',
  label: 'Enrollments',
  icon: 'i-lucide-clipboard-list',
  fields: enrollmentFields,
  features: scopedFeatures({
    search: [],
    defaultSort: { field: 'enrolledAt', order: 'desc' },
    dataScope: { resolver: 'sms.enrollments' }
  }),
  custom: false
}

const guardiansMeta: TableMeta = {
  table: 'guardians',
  moduleId: 'sms',
  resource: 'guardians',
  permissions: permissionsFor('guardians'),
  exposure: 'generic-crud',
  label: 'Guardians',
  icon: 'i-lucide-users-round',
  fields: guardianFields,
  features: scopedFeatures({
    softDelete: true,
    search: ['name', 'phone'],
    defaultSort: { field: 'name', order: 'asc' }
  }),
  custom: false
}

const studentGuardiansMeta: TableMeta = {
  table: 'studentGuardians',
  moduleId: 'sms',
  resource: 'student-guardians',
  permissions: permissionsFor('student-guardians'),
  exposure: 'generic-crud',
  label: 'Student Guardians',
  icon: 'i-lucide-link',
  fields: studentGuardianFields,
  features: scopedFeatures({
    search: [],
    defaultSort: { field: 'id', order: 'desc' }
  }),
  custom: false
}

function smsActorFrom(actor: unknown): SmsActor {
  return actor as SmsActor
}

let dashboardRegistered = false

/** Register the SMS tables into generic CRUD, scopes and validators. */
export function registerSmsDashboardTables(): void {
  if (dashboardRegistered) return
  dashboardRegistered = true

  registerDataScopeResolver('sms.teacherAssignedClasses', async ({ actor }) => {
    if (!actor.organizationId) return { allowed: false, reason: 'missing-context' }
    if (actor.roleName === 'admin' && actor.permissions?.includes('*')) {
      return { allowed: true, scope: 'global' }
    }
    if (actor.roleName === 'student') {
      return { allowed: true, scope: 'own', column: 'userId', value: actor.userId }
    }
    if (actor.roleName === 'guardian') {
      const studentIds = await guardianStudentIds(actor as SmsActor)
      return { allowed: true, scope: 'assigned', column: 'id', value: studentIds[0] ?? 0, values: studentIds }
    }
    const classIds = await assignedClassIds(actor as SmsActor)
    return {
      allowed: true,
      scope: 'assigned',
      column: 'classId',
      value: classIds[0] ?? 0,
      values: classIds
    }
  })

  registerDataScopeResolver('sms.classes', async ({ actor }) => {
    if (!actor.organizationId) return { allowed: false, reason: 'missing-context' }
    if (actor.roleName === 'admin' && actor.permissions?.includes('*')) {
      return { allowed: true, scope: 'global' }
    }
    if (actor.roleName === 'student') {
      const [row] = await db.select({ classId: smsStudents.classId })
        .from(smsStudents)
        .where(and(
          eq(smsStudents.organizationId, actor.organizationId),
          eq(smsStudents.userId, actor.userId)
        ))
        .limit(1)
      return {
        allowed: true,
        scope: 'assigned',
        column: 'id',
        value: row?.classId ?? 0,
        values: row?.classId ? [row.classId] : []
      }
    }
    if (actor.roleName === 'guardian') {
      const studentIds = await guardianStudentIds(actor as SmsActor)
      const rows = studentIds.length
        ? await db.select({ classId: smsStudents.classId })
            .from(smsStudents)
            .where(inArray(smsStudents.id, studentIds))
        : []
      const classIds = rows.map(row => row.classId).filter((id): id is number => id !== null)
      return { allowed: true, scope: 'assigned', column: 'id', value: classIds[0] ?? 0, values: classIds }
    }
    const classIds = await assignedClassIds(actor as SmsActor)
    return { allowed: true, scope: 'assigned', column: 'id', value: classIds[0] ?? 0, values: classIds }
  })

  registerDataScopeResolver('sms.teachers', async ({ actor }) => {
    if (!actor.organizationId) return { allowed: false, reason: 'missing-context' }
    if (actor.roleName === 'admin' && actor.permissions?.includes('*')) {
      return { allowed: true, scope: 'global' }
    }
    return { allowed: true, scope: 'own', column: 'userId', value: actor.userId }
  })

  registerDataScopeResolver('sms.enrollments', async ({ actor }) => {
    if (!actor.organizationId) return { allowed: false, reason: 'missing-context' }
    if (actor.roleName === 'admin' && actor.permissions?.includes('*')) {
      return { allowed: true, scope: 'global' }
    }
    if (actor.roleName === 'student') {
      const [row] = await db.select({ id: smsStudents.id })
        .from(smsStudents)
        .where(and(
          eq(smsStudents.organizationId, actor.organizationId),
          eq(smsStudents.userId, actor.userId)
        ))
        .limit(1)
      return { allowed: true, scope: 'own', column: 'studentId', value: row?.id ?? 0 }
    }
    if (actor.roleName === 'guardian') {
      const studentIds = await guardianStudentIds(actor as SmsActor)
      return { allowed: true, scope: 'assigned', column: 'studentId', value: studentIds[0] ?? 0, values: studentIds }
    }
    if (actor.roleName === 'teacher') {
      const classIds = await assignedClassIds(actor as SmsActor)
      return { allowed: true, scope: 'assigned', column: 'classId', value: classIds[0] ?? 0, values: classIds }
    }
    return { allowed: true, scope: 'organization', column: 'organizationId', value: actor.organizationId }
  })

  registerDashboardTable(
    { meta: studentsMeta, getTable: () => smsStudents },
    { menuOrder: 90, exposure: 'generic-crud' }
  )
  registerDashboardTable(
    { meta: classesMeta, getTable: () => smsClasses },
    { menuOrder: 91, exposure: 'generic-crud' }
  )
  registerDashboardTable(
    { meta: academicYearsMeta, getTable: () => smsAcademicYears },
    { menuOrder: 92, exposure: 'generic-crud' }
  )
  registerDashboardTable(
    { meta: termsMeta, getTable: () => smsTerms },
    { menuOrder: 93, exposure: 'generic-crud' }
  )
  registerDashboardTable(
    { meta: gradesMeta, getTable: () => smsGrades },
    { menuOrder: 94, exposure: 'generic-crud' }
  )
  registerDashboardTable(
    { meta: subjectsMeta, getTable: () => smsSubjects },
    { menuOrder: 95, exposure: 'generic-crud' }
  )
  registerDashboardTable(
    { meta: teachersMeta, getTable: () => smsTeachers },
    { menuOrder: 96, exposure: 'generic-crud' }
  )
  registerDashboardTable(
    { meta: enrollmentsMeta, getTable: () => smsEnrollments },
    { menuOrder: 97, exposure: 'generic-crud' }
  )
  registerDashboardTable(
    { meta: guardiansMeta, getTable: () => smsGuardians },
    { menuOrder: 98, exposure: 'generic-crud' }
  )
  registerDashboardTable(
    { meta: studentGuardiansMeta, getTable: () => smsStudentGuardians },
    { menuOrder: 99, exposure: 'generic-crud' }
  )

  // Cross-organization foreign keys are rejected before any insert/update.
  registerTableValidator('students', async (payload, context) => {
    const classId = payload.classId
    if (classId === undefined || classId === null) return
    if (!context.actor?.organizationId) {
      throw new Error('An active organization is required')
    }
    await assertClassInContext(smsActorFrom(context.actor), Number(classId))
  })

  registerTableValidator('classes', async (payload, context) => {
    const actor = smsActorFrom(context.actor)
    if (payload.academicYearId !== undefined && payload.academicYearId !== null && payload.academicYearId !== '') {
      await assertAcademicYearInContext(actor, Number(payload.academicYearId))
    }
    if (payload.gradeId !== undefined && payload.gradeId !== null && payload.gradeId !== '') {
      await assertGradeInContext(actor, Number(payload.gradeId))
    }
  })

  registerTableValidator('terms', async (payload, context) => {
    if (payload.academicYearId === undefined || payload.academicYearId === null || payload.academicYearId === '') return
    await assertAcademicYearInContext(smsActorFrom(context.actor), Number(payload.academicYearId))
  })

  registerTableValidator('enrollments', async (payload, context) => {
    if (context.operation === 'update' && 'status' in payload) {
      throw new Error('Enrollment status changes must go through the SMS enrollment service')
    }
    const actor = smsActorFrom(context.actor)
    const studentId = payload.studentId === undefined || payload.studentId === null ? null : Number(payload.studentId)
    const classId = payload.classId === undefined || payload.classId === null ? null : Number(payload.classId)
    const yearId = payload.academicYearId === undefined || payload.academicYearId === null ? null : Number(payload.academicYearId)
    if (studentId !== null) await assertStudentInContext(actor, studentId)
    if (classId !== null) await classInContext(actor, classId)
    if (yearId !== null) await assertAcademicYearInContext(actor, yearId)
    if (payload.termId !== undefined && payload.termId !== null && payload.termId !== '') {
      await assertTermInContext(actor, Number(payload.termId), yearId ?? undefined)
    }
  })

  registerTableValidator('teacherAssignments', async (payload, context) => {
    const actor = smsActorFrom(context.actor)
    if (payload.classId !== undefined && payload.classId !== null && payload.classId !== '') {
      await classInContext(actor, Number(payload.classId))
    }
    if (payload.subjectId !== undefined && payload.subjectId !== null && payload.subjectId !== '') {
      await assertSubjectInContext(actor, Number(payload.subjectId))
    }
    if (payload.termId !== undefined && payload.termId !== null && payload.termId !== '') {
      await assertTermInContext(actor, Number(payload.termId))
    }
    if (payload.academicYearId !== undefined && payload.academicYearId !== null && payload.academicYearId !== '') {
      await assertAcademicYearInContext(actor, Number(payload.academicYearId))
    }
  })

  registerTableValidator('studentGuardians', async (payload, context) => {
    const actor = smsActorFrom(context.actor)
    if (payload.studentId !== undefined && payload.studentId !== null && payload.studentId !== '') {
      await assertStudentInContext(actor, Number(payload.studentId))
    }
    if (payload.guardianId !== undefined && payload.guardianId !== null && payload.guardianId !== '') {
      await assertGuardianInContext(actor, Number(payload.guardianId))
    }
  })
}

const smsApis: ModuleApiDefinition<SmsActor>[] = [
  {
    id: 'sms.students.search',
    moduleId: 'sms',
    method: 'GET',
    path: 'sms/students',
    schema: isRecord,
    authorize: actor => canUseSms(actor, 'read'),
    handler: (_event, actor, input) => {
      const args = isRecord(input) ? input : {}
      const query = typeof args.q === 'string'
        ? args.q
        : typeof args.query === 'string' ? args.query : undefined
      const limit = Number(args.limit)
      const cursor = Number(args.cursor)
      const classId = Number(args.classId)
      const studentId = Number(args.studentId)
      return searchStudents(actor, {
        query,
        classId: Number.isSafeInteger(classId) && classId > 0 ? classId : undefined,
        studentId: Number.isSafeInteger(studentId) && studentId > 0 ? studentId : undefined,
        limit: Number.isSafeInteger(limit) ? limit : undefined,
        cursor: Number.isSafeInteger(cursor) ? cursor : undefined
      })
    }
  },
  {
    id: 'sms.students.create',
    moduleId: 'sms',
    method: 'POST',
    path: 'sms/students',
    schema: isRecord,
    authorize: actor => canUseSms(actor, 'create'),
    handler: (_event, actor, input) => createStudent(actor, input as CreateStudentInput)
  },
  {
    id: 'sms.students.movements.list',
    moduleId: 'sms',
    method: 'GET',
    path: 'sms/students/movements',
    schema: isRecord,
    authorize: actor => canUseSms(actor, 'read', 'students'),
    handler: (_event, actor, input) => listStudentMovements(actor, isRecord(input) ? input : {})
  },
  {
    id: 'sms.students.movements.create',
    moduleId: 'sms',
    method: 'POST',
    path: 'sms/students/movements',
    schema: isRecord,
    rateLimit: { max: 60, windowMs: 60_000 },
    authorize: actor => canUseSms(actor, 'update', 'students'),
    handler: (_event, actor, input) => createStudentMovement(actor, isRecord(input) ? input : {})
  },
  {
    id: 'sms.classes.list',
    moduleId: 'sms',
    method: 'GET',
    path: 'sms/classes',
    schema: isRecord,
    authorize: actor => canUseSms(actor, 'read', 'classes'),
    handler: (_event, actor, input) => {
      const args = isRecord(input) ? input : {}
      const limit = Number(args.limit)
      return listClasses(actor, {
        query: typeof args.q === 'string' ? args.q : typeof args.query === 'string' ? args.query : undefined,
        limit: Number.isSafeInteger(limit) ? limit : undefined
      })
    }
  },
  {
    id: 'sms.subjects.list',
    moduleId: 'sms',
    method: 'GET',
    path: 'sms/subjects',
    schema: isRecord,
    authorize: actor => canUseSms(actor, 'read', 'subjects'),
    handler: (_event, actor, input) => {
      const args = isRecord(input) ? input : {}
      const limit = Number(args.limit)
      return listSubjects(
        actor,
        typeof args.q === 'string' ? args.q : typeof args.query === 'string' ? args.query : undefined,
        Number.isSafeInteger(limit) ? limit : undefined
      )
    }
  },
  {
    id: 'sms.leave.list',
    moduleId: 'sms',
    method: 'GET',
    path: 'sms/leave',
    schema: isRecord,
    authorize: actor => canUseSms(actor, 'read', 'leave'),
    handler: (_event, actor, input) => listLeaveRequests(actor, isRecord(input) ? input : {})
  },
  {
    id: 'sms.leave.apply',
    moduleId: 'sms',
    method: 'POST',
    path: 'sms/leave',
    schema: isRecord,
    authorize: actor => canUseSms(actor, 'create', 'leave'),
    handler: (_event, actor, input) => applyLeave(actor, input as Record<string, unknown>)
  },
  {
    id: 'sms.leave.decide',
    moduleId: 'sms',
    method: 'POST',
    path: 'sms/leave/decide',
    schema: isRecord,
    authorize: actor => canApproveLeave(actor),
    handler: (_event, actor, input) => decideLeave(actor, input as Record<string, unknown>)
  },
  {
    id: 'sms.leave.cancel',
    moduleId: 'sms',
    method: 'POST',
    path: 'sms/leave/cancel',
    schema: isRecord,
    authorize: actor => canUseSms(actor, 'create', 'leave'),
    handler: (_event, actor, input) => cancelLeave(actor, Number((input as Record<string, unknown>).leaveId))
  },
  {
    id: 'sms.attendance.roster',
    moduleId: 'sms',
    method: 'GET',
    path: 'sms/attendance/roster',
    schema: isRecord,
    authorize: actor => canUseSms(actor, 'read', 'attendance'),
    handler: (_event, actor, input) => listAttendanceRoster(actor, isRecord(input) ? input : {})
  },
  {
    id: 'sms.attendance.batch-mark',
    moduleId: 'sms',
    method: 'POST',
    path: 'sms/attendance/batch',
    schema: isRecord,
    authorize: actor => canUseSms(actor, 'update', 'attendance'),
    handler: (_event, actor, input) => batchMarkAttendance(actor, input as Record<string, unknown>)
  },
  {
    id: 'sms.exams.list',
    moduleId: 'sms',
    method: 'GET',
    path: 'sms/exams',
    schema: isRecord,
    authorize: actor => canUseSms(actor, 'read', 'scores'),
    handler: (_event, actor, input) => listExams(actor, isRecord(input) ? input : {})
  },
  {
    id: 'sms.exams.create',
    moduleId: 'sms',
    method: 'POST',
    path: 'sms/exams',
    schema: isRecord,
    authorize: actor => canUseSms(actor, 'create', 'exams'),
    handler: (_event, actor, input) => createExam(actor, input as Record<string, unknown>)
  },
  {
    id: 'sms.scores.sheet',
    moduleId: 'sms',
    method: 'GET',
    path: 'sms/scores/sheet',
    schema: isRecord,
    authorize: actor => canUseSms(actor, 'read', 'scores'),
    handler: (_event, actor, input) => getScoreSheet(actor, isRecord(input) ? input : {})
  },
  {
    id: 'sms.scores.save',
    moduleId: 'sms',
    method: 'POST',
    path: 'sms/scores',
    schema: isRecord,
    authorize: actor => canUseSms(actor, 'update', 'scores'),
    handler: (_event, actor, input) => saveScores(actor, input as Record<string, unknown>)
  },
  {
    id: 'sms.scores.publish',
    moduleId: 'sms',
    method: 'POST',
    path: 'sms/scores/publish',
    schema: isRecord,
    rateLimit: { max: 10, windowMs: 60_000 },
    authorize: actor => canPublishScores(actor),
    handler: (_event, actor, input) => publishExam(actor, Number((input as Record<string, unknown>).examId))
  },
  {
    id: 'sms.scores.import',
    moduleId: 'sms',
    method: 'POST',
    path: 'sms/scores/import',
    schema: isRecord,
    rateLimit: { max: 5, windowMs: 60_000 },
    authorize: actor => canUseSms(actor, 'update', 'scores'),
    handler: (_event, actor, input) => importScoresCsv(actor, isRecord(input) ? input : {})
  },
  {
    id: 'sms.scores.query',
    moduleId: 'sms',
    method: 'GET',
    path: 'sms/scores',
    schema: isRecord,
    authorize: actor => canUseSms(actor, 'read', 'scores'),
    handler: (_event, actor, input) => listScores(actor, isRecord(input) ? input : {})
  },
  {
    id: 'sms.report-cards.generate',
    moduleId: 'sms',
    method: 'POST',
    path: 'sms/report-cards',
    schema: isRecord,
    authorize: actor => canGenerateReportCard(actor),
    handler: (_event, actor, input) => generateReportCard(actor, input as Record<string, unknown>)
  },
  {
    id: 'sms.admission-cycles.list',
    moduleId: 'sms',
    method: 'GET',
    path: 'sms/admission-cycles',
    schema: isRecord,
    authorize: actor => canUseSms(actor, 'read', 'applications'),
    handler: (_event, actor, input) => listAdmissionCycles(actor, isRecord(input) ? input : {})
  },
  {
    id: 'sms.admission-cycles.create',
    moduleId: 'sms',
    method: 'POST',
    path: 'sms/admission-cycles',
    schema: isRecord,
    authorize: actor => actor.roleName === 'admin' || actor.permissions?.includes('sms.admission-cycles.create') === true,
    handler: (_event, actor, input) => createAdmissionCycle(actor, input as Record<string, unknown>)
  },
  {
    id: 'sms.applications.list',
    moduleId: 'sms',
    method: 'GET',
    path: 'sms/applications',
    schema: isRecord,
    authorize: actor => canUseSms(actor, 'read', 'applications'),
    handler: (_event, actor, input) => listApplications(actor, isRecord(input) ? input : {})
  },
  {
    id: 'sms.applications.create',
    moduleId: 'sms',
    method: 'POST',
    path: 'sms/applications',
    schema: isRecord,
    authorize: actor => canUseSms(actor, 'create', 'applications'),
    handler: (_event, actor, input) => createApplication(actor, input as Record<string, unknown>)
  },
  {
    id: 'sms.applications.review',
    moduleId: 'sms',
    method: 'POST',
    path: 'sms/applications/review',
    schema: isRecord,
    authorize: actor => canReviewApplications(actor),
    handler: (_event, actor, input) => reviewApplication(actor, input as Record<string, unknown>)
  },
  {
    id: 'sms.applications.convert',
    moduleId: 'sms',
    method: 'POST',
    path: 'sms/applications/convert',
    schema: isRecord,
    authorize: actor => canConvertApplications(actor),
    handler: (_event, actor, input) => convertApplication(actor, input as Record<string, unknown>)
  },
  {
    id: 'sms.timetable.list',
    moduleId: 'sms',
    method: 'GET',
    path: 'sms/timetable',
    schema: isRecord,
    authorize: actor => canUseSms(actor, 'read', 'timetable'),
    handler: (_event, actor, input) => listTimetable(actor, isRecord(input) ? input : {})
  },
  {
    id: 'sms.timetable.create',
    moduleId: 'sms',
    method: 'POST',
    path: 'sms/timetable',
    schema: isRecord,
    authorize: actor => canUseSms(actor, 'update', 'timetable'),
    handler: (_event, actor, input) => createTimetableEntry(actor, input as Record<string, unknown>)
  },
  {
    id: 'sms.timetable.publish',
    moduleId: 'sms',
    method: 'POST',
    path: 'sms/timetable/publish',
    schema: isRecord,
    authorize: actor => canPublishTimetable(actor),
    handler: (_event, actor, input) => publishTimetable(actor, isRecord(input) ? input : {})
  },
  {
    id: 'sms.fees.list',
    moduleId: 'sms',
    method: 'GET',
    path: 'sms/fees',
    schema: isRecord,
    authorize: actor => canUseSms(actor, 'read', 'finance'),
    handler: (_event, actor, input) => listFeeItems(actor, isRecord(input) ? input : {})
  },
  {
    id: 'sms.fees.create',
    moduleId: 'sms',
    method: 'POST',
    path: 'sms/fees',
    schema: isRecord,
    authorize: actor => canUseSms(actor, 'update', 'finance'),
    handler: (_event, actor, input) => createFeeItem(actor, input as Record<string, unknown>)
  },
  {
    id: 'sms.invoices.list',
    moduleId: 'sms',
    method: 'GET',
    path: 'sms/invoices',
    schema: isRecord,
    authorize: actor => canUseSms(actor, 'read', 'finance'),
    handler: (_event, actor, input) => listInvoices(actor, isRecord(input) ? input : {})
  },
  {
    id: 'sms.invoices.create',
    moduleId: 'sms',
    method: 'POST',
    path: 'sms/invoices',
    schema: isRecord,
    authorize: actor => canUseSms(actor, 'update', 'finance'),
    handler: (_event, actor, input) => createInvoice(actor, input as Record<string, unknown>)
  },
  {
    id: 'sms.payments.create',
    moduleId: 'sms',
    method: 'POST',
    path: 'sms/payments',
    schema: isRecord,
    authorize: actor => canUseSms(actor, 'update', 'finance'),
    handler: (_event, actor, input) => recordPayment(actor, input as Record<string, unknown>)
  },
  {
    id: 'sms.refunds.list',
    moduleId: 'sms',
    method: 'GET',
    path: 'sms/refunds',
    schema: isRecord,
    authorize: actor => canUseSms(actor, 'read', 'finance'),
    handler: (_event, actor, input) => listRefunds(actor, isRecord(input) ? input : {})
  },
  {
    id: 'sms.refunds.request',
    moduleId: 'sms',
    method: 'POST',
    path: 'sms/refunds',
    schema: isRecord,
    authorize: actor => canUseSms(actor, 'update', 'finance'),
    handler: (_event, actor, input) => requestRefund(actor, input as Record<string, unknown>)
  },
  {
    id: 'sms.refunds.approve',
    moduleId: 'sms',
    method: 'POST',
    path: 'sms/refunds/approve',
    schema: isRecord,
    rateLimit: { max: 10, windowMs: 60_000 },
    authorize: actor => canApproveRefund(actor),
    handler: (_event, actor, input) => approveRefund(actor, input as Record<string, unknown>)
  },
  {
    id: 'sms.assets.list',
    moduleId: 'sms',
    method: 'GET',
    path: 'sms/assets',
    schema: isRecord,
    authorize: actor => canUseSms(actor, 'read', 'assets'),
    handler: (_event, actor, input) => listAssets(actor, isRecord(input) ? input : {})
  },
  {
    id: 'sms.assets.create',
    moduleId: 'sms',
    method: 'POST',
    path: 'sms/assets',
    schema: isRecord,
    authorize: actor => canUseSms(actor, 'update', 'assets'),
    handler: (_event, actor, input) => createAsset(actor, input as Record<string, unknown>)
  },
  {
    id: 'sms.assets.transfer',
    moduleId: 'sms',
    method: 'POST',
    path: 'sms/assets/transfer',
    schema: isRecord,
    authorize: actor => canUseSms(actor, 'update', 'assets'),
    handler: (_event, actor, input) => transferAsset(actor, input as Record<string, unknown>)
  },
  {
    id: 'sms.books.list',
    moduleId: 'sms',
    method: 'GET',
    path: 'sms/books',
    schema: isRecord,
    authorize: actor => canUseSms(actor, 'read', 'library'),
    handler: (_event, actor, input) => listBooks(actor, isRecord(input) ? input : {})
  },
  {
    id: 'sms.books.create',
    moduleId: 'sms',
    method: 'POST',
    path: 'sms/books',
    schema: isRecord,
    authorize: actor => canUseSms(actor, 'update', 'library'),
    handler: (_event, actor, input) => createBook(actor, input as Record<string, unknown>)
  },
  {
    id: 'sms.loans.list',
    moduleId: 'sms',
    method: 'GET',
    path: 'sms/loans',
    schema: isRecord,
    authorize: actor => canUseSms(actor, 'read', 'library'),
    handler: (_event, actor, input) => listLoans(actor, isRecord(input) ? input : {})
  },
  {
    id: 'sms.loans.borrow',
    moduleId: 'sms',
    method: 'POST',
    path: 'sms/loans/borrow',
    schema: isRecord,
    authorize: actor => canUseSms(actor, 'update', 'library'),
    handler: (_event, actor, input) => borrowBook(actor, input as Record<string, unknown>)
  },
  {
    id: 'sms.loans.return',
    moduleId: 'sms',
    method: 'POST',
    path: 'sms/loans/return',
    schema: isRecord,
    authorize: actor => canUseSms(actor, 'update', 'library'),
    handler: (_event, actor, input) => returnBook(actor, Number((input as Record<string, unknown>).loanId))
  },
  {
    id: 'sms.reports.attendance',
    moduleId: 'sms',
    method: 'GET',
    path: 'sms/reports/attendance',
    schema: isRecord,
    authorize: actor => canUseSms(actor, 'read', 'reports'),
    handler: (_event, actor, input) => attendanceReport(actor, isRecord(input) ? input : {})
  },
  {
    id: 'sms.reports.scores',
    moduleId: 'sms',
    method: 'GET',
    path: 'sms/reports/scores',
    schema: isRecord,
    authorize: actor => canUseSms(actor, 'read', 'reports'),
    handler: (_event, actor, input) => scoreReport(actor, isRecord(input) ? input : {})
  },
  {
    id: 'sms.reports.finance',
    moduleId: 'sms',
    method: 'GET',
    path: 'sms/reports/finance',
    schema: isRecord,
    authorize: actor => canUseSms(actor, 'read', 'reports') && canUseSms(actor, 'read', 'finance'),
    handler: (_event, actor, input) => financeReport(actor, isRecord(input) ? input : {})
  },
  {
    id: 'sms.reports.export',
    moduleId: 'sms',
    method: 'POST',
    path: 'sms/reports/export',
    schema: isRecord,
    authorize: actor => canExportReports(actor),
    handler: (_event, actor, input) => exportReport(actor, input as Record<string, unknown>)
  },
  {
    id: 'sms.notifications.list',
    moduleId: 'sms',
    method: 'GET',
    path: 'sms/notifications',
    schema: isRecord,
    authorize: actor => canUseSms(actor, 'read', 'notifications'),
    handler: async (_event, actor, input) => ({
      rows: await listNotifications(actor, isRecord(input) ? input : {}),
      unread: await unreadNotificationCount(actor)
    })
  },
  {
    id: 'sms.notifications.send',
    moduleId: 'sms',
    method: 'POST',
    path: 'sms/notifications',
    schema: isRecord,
    rateLimit: { max: 20, windowMs: 60_000 },
    authorize: actor => canSendNotification(actor),
    handler: (_event, actor, input) => sendNotification(actor, input as Record<string, unknown>)
  },
  {
    id: 'sms.notifications.read',
    moduleId: 'sms',
    method: 'POST',
    path: 'sms/notifications/read',
    schema: isRecord,
    authorize: actor => canUseSms(actor, 'read', 'notifications'),
    handler: (_event, actor, input) => {
      const notificationId = isRecord(input) ? Number(input.notificationId) : 0
      return Number.isSafeInteger(notificationId) && notificationId > 0
        ? markNotificationRead(actor, notificationId)
        : markAllNotificationsRead(actor)
    }
  },
  {
    id: 'sms.notifications.preferences.get',
    moduleId: 'sms',
    method: 'GET',
    path: 'sms/notifications/preferences',
    schema: isRecord,
    rateLimit: { max: 60, windowMs: 60_000 },
    authorize: actor => canUseSms(actor, 'read', 'notifications'),
    handler: (_event, actor) => getNotificationPreferences(actor)
  },
  {
    id: 'sms.notifications.preferences.update',
    moduleId: 'sms',
    method: 'PUT',
    path: 'sms/notifications/preferences',
    schema: isRecord,
    rateLimit: { max: 30, windowMs: 60_000 },
    authorize: actor => canUseSms(actor, 'read', 'notifications'),
    handler: (_event, actor, input) => updateNotificationPreferences(actor, isRecord(input) ? input : {})
  },
  {
    id: 'sms.knowledge.search',
    moduleId: 'sms',
    method: 'GET',
    path: 'sms/knowledge',
    schema: isRecord,
    authorize: actor => canUseSms(actor, 'read', 'knowledge'),
    handler: (_event, actor, input) => searchKnowledge(actor, isRecord(input) ? input : {})
  },
  {
    id: 'sms.knowledge.create',
    moduleId: 'sms',
    method: 'POST',
    path: 'sms/knowledge',
    schema: isRecord,
    authorize: actor => actor.roleName === 'admin' || actor.permissions?.includes('sms.knowledge.create') === true,
    handler: (_event, actor, input) => createKnowledgeArticle(actor, input as Record<string, unknown>)
  },
  {
    id: 'sms.knowledge.update',
    moduleId: 'sms',
    method: 'POST',
    path: 'sms/knowledge/update',
    schema: isRecord,
    rateLimit: { max: 20, windowMs: 60_000 },
    authorize: actor => actor.roleName === 'admin' || actor.permissions?.includes('sms.knowledge.create') === true,
    handler: (_event, actor, input) => updateKnowledgeArticle(actor, input as Record<string, unknown>)
  },
  {
    id: 'sms.workbench.summary',
    moduleId: 'sms',
    method: 'GET',
    path: 'sms/workbench',
    schema: isRecord,
    authorize: actor => Boolean(actor.organizationId),
    handler: (_event, actor) => buildWorkbench(actor)
  },
  {
    id: 'sms.search',
    moduleId: 'sms',
    method: 'GET',
    path: 'sms/search',
    schema: isRecord,
    rateLimit: { max: 120, windowMs: 60_000 },
    authorize: actor => Boolean(actor.organizationId),
    handler: (_event, actor, input) => searchSms(actor, isRecord(input) ? input : {})
  },
  {
    id: 'sms.approvals.inbox',
    moduleId: 'sms',
    method: 'GET',
    path: 'sms/approvals',
    schema: isRecord,
    rateLimit: { max: 120, windowMs: 60_000 },
    authorize: actor => canUseSms(actor, 'read', 'leave') || canUseSms(actor, 'read', 'approvals'),
    handler: (_event, actor, input) => listApprovalInbox(actor, isRecord(input) ? input : {})
  },
  {
    id: 'sms.approvals.reassign',
    moduleId: 'sms',
    method: 'POST',
    path: 'sms/approvals/reassign',
    schema: isRecord,
    rateLimit: { max: 30, windowMs: 60_000 },
    authorize: actor => canApproveLeave(actor) || canApproveRefund(actor),
    handler: (_event, actor, input) => reassignApprovalTask(actor, input as Record<string, unknown>)
  },
  {
    id: 'sms.approvals.decide',
    moduleId: 'sms',
    method: 'POST',
    path: 'sms/approvals/decide',
    schema: isRecord,
    rateLimit: { max: 20, windowMs: 60_000 },
    authorize: actor => canApproveLeave(actor) || canApproveRefund(actor),
    handler: (_event, actor, input) => decideApprovalBatch(actor, isRecord(input) ? input : {})
  },
  {
    id: 'sms.students.import',
    moduleId: 'sms',
    method: 'POST',
    path: 'sms/students/import',
    schema: isRecord,
    rateLimit: { max: 5, windowMs: 60_000 },
    authorize: actor => canUseSms(actor, 'create', 'students'),
    handler: (_event, actor, input) => importStudentsCsv(actor, isRecord(input) ? input : {})
  },
  {
    id: 'sms.reports.daily',
    moduleId: 'sms',
    method: 'GET',
    path: 'sms/reports/daily',
    schema: isRecord,
    authorize: actor => canUseSms(actor, 'read', 'reports'),
    handler: (_event, actor, input) => listDailyReport(actor, isRecord(input) ? input : {})
  },
  {
    id: 'sms.audit.query',
    moduleId: 'sms',
    method: 'GET',
    path: 'sms/audit',
    schema: isRecord,
    rateLimit: { max: 30, windowMs: 60_000 },
    authorize: actor => actor.roleName === 'admin' || actor.permissions?.includes('sms.audit.read') === true,
    handler: (_event, actor, input) => queryAuditLogs(actor, isRecord(input) ? input : {})
  },
  {
    id: 'sms.metrics.summary',
    moduleId: 'sms',
    method: 'GET',
    path: 'sms/metrics',
    schema: isRecord,
    rateLimit: { max: 60, windowMs: 60_000 },
    authorize: actor => canUseSms(actor, 'read', 'reports'),
    handler: (_event, actor) => buildSmsMetrics(actor)
  },
  {
    id: 'sms.metrics.prometheus',
    moduleId: 'sms',
    method: 'GET',
    path: 'sms/metrics/prometheus',
    schema: isRecord,
    rateLimit: { max: 60, windowMs: 60_000 },
    authorize: actor => canUseSms(actor, 'read', 'reports'),
    handler: async (event, actor) => {
      const metrics = await buildSmsMetrics(actor)
      setResponseHeader(event as Parameters<typeof setResponseHeader>[0], 'content-type', 'text/plain; version=0.0.4; charset=utf-8')
      return formatPrometheusMetrics(metrics, actor.organizationId)
    }
  },
  {
    id: 'sms.evaluation.metrics.list',
    moduleId: 'sms',
    method: 'GET',
    path: 'sms/evaluation/metrics',
    schema: isRecord,
    rateLimit: { max: 60, windowMs: 60_000 },
    authorize: actor => canUseSms(actor, 'read', 'reports'),
    handler: (_event, actor, input) => listEvaluationMetrics(actor, isRecord(input) ? input : {})
  },
  {
    id: 'sms.evaluation.metrics.record',
    moduleId: 'sms',
    method: 'POST',
    path: 'sms/evaluation/metrics',
    schema: isRecord,
    rateLimit: { max: 60, windowMs: 60_000 },
    authorize: actor => canUseSms(actor, 'read', 'reports'),
    handler: (_event, actor, input) => recordEvaluationMetric(actor, isRecord(input) ? input : {})
  },
  {
    id: 'sms.agent-tasks.list',
    moduleId: 'sms',
    method: 'GET',
    path: 'sms/agent-tasks',
    schema: isRecord,
    authorize: actor => canUseSms(actor, 'read', 'agent-tasks'),
    handler: (_event, actor, input) => listAgentTasks(actor, isRecord(input) ? input : {})
  },
  {
    id: 'sms.agent-tasks.create',
    moduleId: 'sms',
    method: 'POST',
    path: 'sms/agent-tasks',
    schema: isRecord,
    authorize: actor => actor.roleName === 'admin' || actor.permissions?.includes('sms.agent-tasks.create') === true,
    handler: (_event, actor, input) => createAgentTask(actor, input as Record<string, unknown>)
  },
  {
    id: 'sms.agent-tasks.advance',
    moduleId: 'sms',
    method: 'POST',
    path: 'sms/agent-tasks/advance',
    schema: isRecord,
    authorize: actor => canUseSms(actor, 'read', 'agent-tasks'),
    handler: (_event, actor, input) => advanceAgentTask(actor, input as Record<string, unknown>)
  },
  {
    id: 'sms.agent-tasks.events',
    moduleId: 'sms',
    method: 'GET',
    path: 'sms/agent-tasks/events',
    schema: isRecord,
    rateLimit: { max: 60, windowMs: 60_000 },
    authorize: actor => canUseSms(actor, 'read', 'agent-tasks'),
    handler: (_event, actor, input) => listAgentTaskEvents(actor, isRecord(input) ? input : {})
  },
  {
    id: 'sms.assignments.list',
    moduleId: 'sms',
    method: 'GET',
    path: 'sms/assignments',
    schema: isRecord,
    authorize: actor => canUseSms(actor, 'read', 'assignments'),
    handler: (_event, actor, input) => listAssignments(actor, isRecord(input) ? input : {})
  },
  {
    id: 'sms.assignments.create',
    moduleId: 'sms',
    method: 'POST',
    path: 'sms/assignments',
    schema: isRecord,
    authorize: actor => canUseSms(actor, 'update', 'assignments'),
    handler: (_event, actor, input) => createAssignment(actor, input as Record<string, unknown>)
  },
  {
    id: 'sms.assignments.submit',
    moduleId: 'sms',
    method: 'POST',
    path: 'sms/assignments/submit',
    schema: isRecord,
    authorize: actor => canUseSms(actor, 'create', 'assignments'),
    handler: (_event, actor, input) => submitAssignment(actor, input as Record<string, unknown>)
  },
  {
    id: 'sms.assignments.grade',
    moduleId: 'sms',
    method: 'POST',
    path: 'sms/assignments/grade',
    schema: isRecord,
    authorize: actor => canUseSms(actor, 'update', 'assignments'),
    handler: (_event, actor, input) => gradeSubmission(actor, input as Record<string, unknown>)
  },
  {
    id: 'sms.elections.list',
    moduleId: 'sms',
    method: 'GET',
    path: 'sms/elections',
    schema: isRecord,
    authorize: actor => canUseSms(actor, 'read', 'elections'),
    handler: (_event, actor, input) => listElections(actor, isRecord(input) ? input : {})
  },
  {
    id: 'sms.elections.update',
    moduleId: 'sms',
    method: 'POST',
    path: 'sms/elections',
    schema: isRecord,
    authorize: actor => canUseSms(actor, 'create', 'elections'),
    handler: (_event, actor, input) => setCourseElection(actor, input as Record<string, unknown>)
  }
]

/**
 * Chat table components (`sms.student-table`, `sms.teacher-table`).
 *
 * Props are intentionally limited to a search query and a row limit: the
 * components load rows themselves under the viewer's permissions, so the model
 * can never inject or fabricate business data.
 */
export type SmsChatTableProps = { query?: string, limit?: number }

export function isSmsChatTableProps(value: unknown): value is SmsChatTableProps {
  if (!isRecord(value)) return false
  if ('rows' in value || 'students' in value || 'teachers' in value) return false
  if (value.query !== undefined && typeof value.query !== 'string') return false
  if (value.limit !== undefined) {
    if (typeof value.limit !== 'number' || !Number.isSafeInteger(value.limit)) return false
    if (value.limit < 1 || value.limit > 200) return false
  }
  return true
}

export type SmsLeaveTableProps = {
  status?: 'pending' | 'approved' | 'rejected' | 'cancelled'
  limit?: number
}

const LEAVE_STATUS_VALUES = ['pending', 'approved', 'rejected', 'cancelled']

export function isSmsLeaveTableProps(value: unknown): value is SmsLeaveTableProps {
  if (!isRecord(value)) return false
  if ('rows' in value || 'leaves' in value || 'requests' in value) return false
  if (value.status !== undefined && !LEAVE_STATUS_VALUES.includes(String(value.status))) return false
  if (value.limit !== undefined) {
    if (typeof value.limit !== 'number' || !Number.isSafeInteger(value.limit)) return false
    if (value.limit < 1 || value.limit > 200) return false
  }
  return true
}

export type SmsAttendanceRosterProps = {
  classId?: number
  date?: string
  session?: 'full_day' | 'morning' | 'afternoon' | 'period'
}

const ATTENDANCE_SESSION_VALUES = ['full_day', 'morning', 'afternoon', 'period']

export function isSmsAttendanceRosterProps(value: unknown): value is SmsAttendanceRosterProps {
  if (!isRecord(value)) return false
  if ('rows' in value || 'students' in value) return false
  if (value.classId !== undefined) {
    if (typeof value.classId !== 'number' || !Number.isSafeInteger(value.classId) || value.classId <= 0) return false
  }
  if (value.date !== undefined) {
    if (typeof value.date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value.date)) return false
  }
  if (value.session !== undefined && !ATTENDANCE_SESSION_VALUES.includes(String(value.session))) return false
  return true
}

export type SmsGradeEntrySheetProps = { examId: number }

export function isSmsGradeEntrySheetProps(value: unknown): value is SmsGradeEntrySheetProps {
  if (!isRecord(value)) return false
  if ('rows' in value || 'scores' in value || 'students' in value) return false
  return typeof value.examId === 'number' && Number.isSafeInteger(value.examId) && value.examId > 0
}

export type SmsTimetableGridProps = {
  classId?: number
  termId?: number
  status?: 'draft' | 'published'
}

export function isSmsTimetableGridProps(value: unknown): value is SmsTimetableGridProps {
  if (!isRecord(value)) return false
  if ('rows' in value || 'entries' in value || 'lessons' in value) return false
  for (const key of ['classId', 'termId'] as const) {
    const id = value[key]
    if (id !== undefined && (typeof id !== 'number' || !Number.isSafeInteger(id) || id <= 0)) return false
  }
  if (value.status !== undefined && value.status !== 'draft' && value.status !== 'published') return false
  return true
}

const smsUi: UiDefinition<unknown, Record<string, unknown>>[] = [
  {
    id: 'sms.student-table',
    moduleId: 'sms',
    label: '学生表格',
    description: '学生名单，可打开详情；有更新权限时可编辑',
    propsHint: 'query?: string, limit?: number',
    version: '1.0',
    interactions: { detail: true, edit: { permission: 'sms.students.update' } },
    appsPath: '/dashboard/students',
    schema: isSmsChatTableProps,
    render: props => ({ component: 'sms.student-table', props: props as SmsChatTableProps })
  },
  {
    id: 'sms.teacher-table',
    moduleId: 'sms',
    label: '教师表格',
    description: '教师名单，可打开详情；有更新权限时可编辑',
    propsHint: 'query?: string, limit?: number',
    version: '1.0',
    interactions: { detail: true, edit: { permission: 'sms.teachers.update' } },
    appsPath: '/dashboard/teachers',
    schema: isSmsChatTableProps,
    render: props => ({ component: 'sms.teacher-table', props: props as SmsChatTableProps })
  },
  {
    id: 'sms.leave-table',
    moduleId: 'sms',
    label: '请假列表',
    description: '请假申请列表，可查看详情；有审批权限时可同意/驳回',
    propsHint: 'status?: "pending"|"approved"|"rejected"|"cancelled", limit?: number',
    version: '1.0',
    interactions: { detail: true, edit: { permission: 'sms.leave.approve' } },
    appsPath: '/sms',
    schema: isSmsLeaveTableProps,
    render: props => ({ component: 'sms.leave-table', props: props as SmsLeaveTableProps })
  },
  {
    id: 'sms.attendance-roster',
    moduleId: 'sms',
    label: '班级考勤名单',
    description: '按班级/日期查看考勤名单并批量标记；需考勤更新权限',
    propsHint: 'classId?: number, date?: "YYYY-MM-DD", session?: "full_day"|"morning"|"afternoon"|"period"',
    version: '1.0',
    interactions: { detail: true, edit: { permission: 'sms.attendance.update' } },
    appsPath: '/sms',
    schema: isSmsAttendanceRosterProps,
    render: props => ({ component: 'sms.attendance-roster', props: props as SmsAttendanceRosterProps })
  },
  {
    id: 'sms.grade-entry-sheet',
    moduleId: 'sms',
    label: '成绩录入表',
    description: '按考试批量录入/更正成绩；仅草稿考试可编辑',
    propsHint: 'examId: number',
    version: '1.0',
    interactions: { detail: true, edit: { permission: 'sms.scores.update' } },
    appsPath: '/sms',
    schema: isSmsGradeEntrySheetProps,
    render: props => ({ component: 'sms.grade-entry-sheet', props: props as SmsGradeEntrySheetProps })
  },
  {
    id: 'sms.timetable-grid',
    moduleId: 'sms',
    label: '课表网格',
    description: '按班级/学期查看课表；有更新权限时可新增课程',
    propsHint: 'classId?: number, termId?: number, status?: "draft"|"published"',
    version: '1.0',
    interactions: { detail: true, edit: { permission: 'sms.timetable.update' } },
    appsPath: '/sms',
    schema: isSmsTimetableGridProps,
    render: props => ({ component: 'sms.timetable-grid', props: props as SmsTimetableGridProps })
  },
  ...(generatedChatComponents as UiDefinition<unknown, Record<string, unknown>>[])
]

export interface SmsRegistries {
  api: ModuleApiRouter<SmsActor>
  tools: ToolRegistry<SmsActor>
  ui: UiRegistry<unknown, unknown>
}

export function registerSmsModule(registries: SmsRegistries): void {
  registerSmsDashboardTables()
  for (const api of smsApis) {
    // 默认限流与能力层保持同一量级：读 120/分、写 30/分；敏感接口单独收紧。
    registries.api.register({
      ...api,
      rateLimit: api.rateLimit ?? (api.method === 'GET'
        ? { max: 120, windowMs: 60_000 }
        : { max: 30, windowMs: 60_000 })
    })
  }
  // One capability set drives Chat, Apps and Agents (see server/capabilities.ts).
  registerCapabilities(registries.tools, 'sms', smsCapabilities)
  registerChatPrompt('sms', buildSmsChatPrompt)
  for (const ui of smsUi) {
    registries.ui.register({
      id: ui.id,
      version: ui.version,
      label: ui.label,
      description: ui.description,
      propsHint: ui.propsHint,
      interactions: ui.interactions,
      appsPath: ui.appsPath,
      schema: ui.schema,
      render: props => ui.render(props)
    })
  }
}
