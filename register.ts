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
import { classInContext, assertAcademicYearInContext, assertGradeInContext, assertSubjectInContext, assertTermInContext } from './server/academics'
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
      const query = isRecord(input)
        ? (typeof input.q === 'string' ? input.q : typeof input.query === 'string' ? input.query : undefined)
        : undefined
      return searchStudents(actor, { query })
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

const smsUi: UiDefinition<SmsChatTableProps, Record<string, unknown>>[] = [
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
    render: props => ({ component: 'sms.student-table', props })
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
    render: props => ({ component: 'sms.teacher-table', props })
  },
  ...generatedChatComponents
]

export interface SmsRegistries {
  api: ModuleApiRouter<SmsActor>
  tools: ToolRegistry<SmsActor>
  ui: UiRegistry<unknown, unknown>
}

export function registerSmsModule(registries: SmsRegistries): void {
  registerSmsDashboardTables()
  for (const api of smsApis) registries.api.register(api)
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
      render: props => ui.render(props as SmsChatTableProps)
    })
  }
}
