import type {
  FieldMeta,
  ModuleApiDefinition,
  ModuleApiRouter,
  TableFeatures,
  TableMeta,
  ToolDefinition,
  ToolRegistry,
  UiDefinition,
  UiRegistry
} from '../../server/sdk'
import { registerDashboardTable, registerDataScopeResolver, registerTableValidator } from '../../server/sdk'
import { and, eq, inArray } from 'drizzle-orm'
import { db } from '../../server/database'
import { canUseSis, type SisActor } from './server/context'
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
  sisAcademicYears,
  sisClasses,
  sisEnrollments,
  sisGrades,
  sisGuardians,
  sisStudentGuardians,
  sisStudents,
  sisSubjects,
  sisTeachers,
  sisTerms
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
    read: `sis.${resource}.read`,
    create: `sis.${resource}.create`,
    update: `sis.${resource}.update`,
    delete: `sis.${resource}.delete`
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
  moduleId: 'sis',
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
    dataScope: { resolver: 'sis.teacherAssignedClasses' }
  }),
  custom: false
}

const classesMeta: TableMeta = {
  table: 'classes',
  moduleId: 'sis',
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
    dataScope: { resolver: 'sis.classes' }
  }),
  custom: false
}

const academicYearsMeta: TableMeta = {
  table: 'academicYears',
  moduleId: 'sis',
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
  moduleId: 'sis',
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
  moduleId: 'sis',
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
  moduleId: 'sis',
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
  moduleId: 'sis',
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
    dataScope: { resolver: 'sis.teachers' }
  }),
  custom: false
}

const enrollmentsMeta: TableMeta = {
  table: 'enrollments',
  moduleId: 'sis',
  resource: 'enrollments',
  permissions: permissionsFor('enrollments'),
  exposure: 'generic-crud',
  label: 'Enrollments',
  icon: 'i-lucide-clipboard-list',
  fields: enrollmentFields,
  features: scopedFeatures({
    search: [],
    defaultSort: { field: 'enrolledAt', order: 'desc' },
    dataScope: { resolver: 'sis.enrollments' }
  }),
  custom: false
}

const guardiansMeta: TableMeta = {
  table: 'guardians',
  moduleId: 'sis',
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
  moduleId: 'sis',
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

function sisActorFrom(actor: unknown): SisActor {
  return actor as SisActor
}

let dashboardRegistered = false

/** Register the SIS tables into generic CRUD, scopes and validators. */
export function registerSisDashboardTables(): void {
  if (dashboardRegistered) return
  dashboardRegistered = true

  registerDataScopeResolver('sis.teacherAssignedClasses', async ({ actor }) => {
    if (!actor.organizationId) return { allowed: false, reason: 'missing-context' }
    if (actor.roleName === 'admin' && actor.permissions?.includes('*')) {
      return { allowed: true, scope: 'global' }
    }
    if (actor.roleName === 'student') {
      return { allowed: true, scope: 'own', column: 'userId', value: actor.userId }
    }
    if (actor.roleName === 'guardian') {
      const studentIds = await guardianStudentIds(actor as SisActor)
      return { allowed: true, scope: 'assigned', column: 'id', value: studentIds[0] ?? 0, values: studentIds }
    }
    const classIds = await assignedClassIds(actor as SisActor)
    return {
      allowed: true,
      scope: 'assigned',
      column: 'classId',
      value: classIds[0] ?? 0,
      values: classIds
    }
  })

  registerDataScopeResolver('sis.classes', async ({ actor }) => {
    if (!actor.organizationId) return { allowed: false, reason: 'missing-context' }
    if (actor.roleName === 'admin' && actor.permissions?.includes('*')) {
      return { allowed: true, scope: 'global' }
    }
    if (actor.roleName === 'student') {
      const [row] = await db.select({ classId: sisStudents.classId })
        .from(sisStudents)
        .where(and(
          eq(sisStudents.organizationId, actor.organizationId),
          eq(sisStudents.userId, actor.userId)
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
      const studentIds = await guardianStudentIds(actor as SisActor)
      const rows = studentIds.length
        ? await db.select({ classId: sisStudents.classId })
            .from(sisStudents)
            .where(inArray(sisStudents.id, studentIds))
        : []
      const classIds = rows.map(row => row.classId).filter((id): id is number => id !== null)
      return { allowed: true, scope: 'assigned', column: 'id', value: classIds[0] ?? 0, values: classIds }
    }
    const classIds = await assignedClassIds(actor as SisActor)
    return { allowed: true, scope: 'assigned', column: 'id', value: classIds[0] ?? 0, values: classIds }
  })

  registerDataScopeResolver('sis.teachers', async ({ actor }) => {
    if (!actor.organizationId) return { allowed: false, reason: 'missing-context' }
    if (actor.roleName === 'admin' && actor.permissions?.includes('*')) {
      return { allowed: true, scope: 'global' }
    }
    return { allowed: true, scope: 'own', column: 'userId', value: actor.userId }
  })

  registerDataScopeResolver('sis.enrollments', async ({ actor }) => {
    if (!actor.organizationId) return { allowed: false, reason: 'missing-context' }
    if (actor.roleName === 'admin' && actor.permissions?.includes('*')) {
      return { allowed: true, scope: 'global' }
    }
    if (actor.roleName === 'student') {
      const [row] = await db.select({ id: sisStudents.id })
        .from(sisStudents)
        .where(and(
          eq(sisStudents.organizationId, actor.organizationId),
          eq(sisStudents.userId, actor.userId)
        ))
        .limit(1)
      return { allowed: true, scope: 'own', column: 'studentId', value: row?.id ?? 0 }
    }
    if (actor.roleName === 'guardian') {
      const studentIds = await guardianStudentIds(actor as SisActor)
      return { allowed: true, scope: 'assigned', column: 'studentId', value: studentIds[0] ?? 0, values: studentIds }
    }
    if (actor.roleName === 'teacher') {
      const classIds = await assignedClassIds(actor as SisActor)
      return { allowed: true, scope: 'assigned', column: 'classId', value: classIds[0] ?? 0, values: classIds }
    }
    return { allowed: true, scope: 'organization', column: 'organizationId', value: actor.organizationId }
  })

  registerDashboardTable(
    { meta: studentsMeta, getTable: () => sisStudents },
    { menuOrder: 90, exposure: 'generic-crud' }
  )
  registerDashboardTable(
    { meta: classesMeta, getTable: () => sisClasses },
    { menuOrder: 91, exposure: 'generic-crud' }
  )
  registerDashboardTable(
    { meta: academicYearsMeta, getTable: () => sisAcademicYears },
    { menuOrder: 92, exposure: 'generic-crud' }
  )
  registerDashboardTable(
    { meta: termsMeta, getTable: () => sisTerms },
    { menuOrder: 93, exposure: 'generic-crud' }
  )
  registerDashboardTable(
    { meta: gradesMeta, getTable: () => sisGrades },
    { menuOrder: 94, exposure: 'generic-crud' }
  )
  registerDashboardTable(
    { meta: subjectsMeta, getTable: () => sisSubjects },
    { menuOrder: 95, exposure: 'generic-crud' }
  )
  registerDashboardTable(
    { meta: teachersMeta, getTable: () => sisTeachers },
    { menuOrder: 96, exposure: 'generic-crud' }
  )
  registerDashboardTable(
    { meta: enrollmentsMeta, getTable: () => sisEnrollments },
    { menuOrder: 97, exposure: 'generic-crud' }
  )
  registerDashboardTable(
    { meta: guardiansMeta, getTable: () => sisGuardians },
    { menuOrder: 98, exposure: 'generic-crud' }
  )
  registerDashboardTable(
    { meta: studentGuardiansMeta, getTable: () => sisStudentGuardians },
    { menuOrder: 99, exposure: 'generic-crud' }
  )

  // Cross-organization foreign keys are rejected before any insert/update.
  registerTableValidator('students', async (payload, context) => {
    const classId = payload.classId
    if (classId === undefined || classId === null) return
    if (!context.actor?.organizationId) {
      throw new Error('An active organization is required')
    }
    await assertClassInContext(sisActorFrom(context.actor), Number(classId))
  })

  registerTableValidator('classes', async (payload, context) => {
    const actor = sisActorFrom(context.actor)
    if (payload.academicYearId !== undefined && payload.academicYearId !== null && payload.academicYearId !== '') {
      await assertAcademicYearInContext(actor, Number(payload.academicYearId))
    }
    if (payload.gradeId !== undefined && payload.gradeId !== null && payload.gradeId !== '') {
      await assertGradeInContext(actor, Number(payload.gradeId))
    }
  })

  registerTableValidator('terms', async (payload, context) => {
    if (payload.academicYearId === undefined || payload.academicYearId === null || payload.academicYearId === '') return
    await assertAcademicYearInContext(sisActorFrom(context.actor), Number(payload.academicYearId))
  })

  registerTableValidator('enrollments', async (payload, context) => {
    if (context.operation === 'update' && 'status' in payload) {
      throw new Error('Enrollment status changes must go through the SIS enrollment service')
    }
    const actor = sisActorFrom(context.actor)
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
    const actor = sisActorFrom(context.actor)
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
    const actor = sisActorFrom(context.actor)
    if (payload.studentId !== undefined && payload.studentId !== null && payload.studentId !== '') {
      await assertStudentInContext(actor, Number(payload.studentId))
    }
    if (payload.guardianId !== undefined && payload.guardianId !== null && payload.guardianId !== '') {
      await assertGuardianInContext(actor, Number(payload.guardianId))
    }
  })
}

const sisApis: ModuleApiDefinition<SisActor>[] = [
  {
    id: 'sis.students.search',
    moduleId: 'sis-demo',
    method: 'GET',
    path: 'sis-demo/students',
    schema: isRecord,
    authorize: actor => canUseSis(actor, 'read'),
    handler: (_event, actor, input) => {
      const query = isRecord(input)
        ? (typeof input.q === 'string' ? input.q : typeof input.query === 'string' ? input.query : undefined)
        : undefined
      return searchStudents(actor, { query })
    }
  },
  {
    id: 'sis.students.create',
    moduleId: 'sis-demo',
    method: 'POST',
    path: 'sis-demo/students',
    schema: isRecord,
    authorize: actor => canUseSis(actor, 'create'),
    handler: (_event, actor, input) => createStudent(actor, input as CreateStudentInput)
  }
]

const sisTools: ToolDefinition<SisActor>[] = [
  {
    id: 'sis.students.search',
    moduleId: 'sis-demo',
    description: 'Search students visible to the current teacher or organization admin',
    schema: isRecord,
    inputJsonSchema: {
      type: 'object',
      properties: { query: { type: 'string', description: 'Name or student number fragment' } },
      additionalProperties: false
    },
    operation: 'query',
    permission: 'sis:read',
    approval: 'none',
    authorize: actor => canUseSis(actor, 'read'),
    execute: (input, actor) => searchStudents(actor, {
      query: isRecord(input) && typeof input.query === 'string' ? input.query : undefined
    })
  }
]

const sisUi: UiDefinition<{ rows?: unknown[], query?: string }, Record<string, unknown>> = {
  id: 'sis.student-table',
  moduleId: 'sis-demo',
  label: 'Student table',
  version: '1.0',
  schema: value => isRecord(value) && (Array.isArray(value.rows) || typeof value.query === 'string'),
  render: props => ({ component: 'sis.student-table', props })
}

export interface SisRegistries {
  api: ModuleApiRouter<SisActor>
  tools: ToolRegistry<SisActor>
  ui: UiRegistry<unknown, unknown>
}

export function registerSisModule(registries: SisRegistries): void {
  registerSisDashboardTables()
  for (const api of sisApis) registries.api.register(api)
  for (const tool of sisTools) registries.tools.register(tool)
  registries.ui.register({
    id: sisUi.id,
    version: sisUi.version,
    schema: sisUi.schema,
    render: props => sisUi.render(props as { rows?: unknown[], query?: string })
  })
}
