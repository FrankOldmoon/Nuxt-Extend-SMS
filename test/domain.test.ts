// Phase 4 acceptance: SMS academic domain (years, terms, grades, subjects,
// teachers, classes, enrollments, guardians) with organization isolation,
// role-aware access and audit history.
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { pool } from '../../../server/database'
import { applyModuleMigrations } from '../../../server/database/moduleMigrations'
import { smsModule } from '../module'
import { getRegisteredTable } from '../../../server/utils/dashboard/tables'
import { listTableData, type DataScopeActor } from '../../../server/utils/dashboard/crudService'
import { ModuleApiRouter, ToolRegistry, UiRegistry } from '../../../server/core/moduleSdk'
import { registerSmsModule } from '../register'
import { createStudent } from '../server/students'
import {
  createAcademicYear,
  createClass,
  createGrade,
  createSubject,
  createTerm
} from '../server/academics'
import { assignTeacher, createTeacher } from '../server/teachers'
import { enrollStudent, withdrawEnrollment } from '../server/enrollment'
import { createGuardian, linkGuardian } from '../server/guardians'
import type { SmsActor } from '../server/context'

describe('SMS academic domain (database)', () => {
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  let tenantId = 0
  let organizationId = 0
  let otherOrganizationId = 0
  let academicYearId = 0
  let termId = 0
  let gradeId = 0
  let subjectId = 0
  let classId = 0
  let foreignClassId = 0
  let foreignGradeId = 0
  let foreignSubjectId = 0
  let teacherId = 0
  let studentId = 0
  let enrollmentId = 0

  const admin: SmsActor = { userId: 1, roleName: 'admin', permissions: ['*'], organizationId: 0, tenantId: 0 }
  const teacherActor: SmsActor = { userId: 5001, roleName: 'teacher', permissions: ['sms:read', 'sms:create'], organizationId: 0, tenantId: 0 }
  const studentActor: SmsActor = { userId: 6001, roleName: 'student', permissions: ['sms:read'], organizationId: 0, tenantId: 0 }
  const guardianActor: SmsActor = { userId: 7001, roleName: 'guardian', permissions: ['sms:read'], organizationId: 0, tenantId: 0 }

  beforeAll(async () => {
    await applyModuleMigrations(pool, [smsModule])
    registerSmsModule({
      api: new ModuleApiRouter<SmsActor>(),
      tools: new ToolRegistry<SmsActor>(),
      ui: new UiRegistry<unknown, unknown>()
    })

    const tenant = await pool.query(
      `INSERT INTO tenants (name, slug) VALUES ($1, $2) RETURNING id`,
      ['sms-domain', `sms-domain-${suffix}`]
    )
    tenantId = tenant.rows[0].id
    const org = await pool.query(
      `INSERT INTO organizations (tenant_id, name, slug) VALUES ($1, 'Domain Org', $2) RETURNING id`,
      [tenantId, `sms-domain-org-${suffix}`]
    )
    organizationId = org.rows[0].id
    const otherOrg = await pool.query(
      `INSERT INTO organizations (tenant_id, name, slug) VALUES ($1, 'Other Domain Org', $2) RETURNING id`,
      [tenantId, `sms-domain-other-${suffix}`]
    )
    otherOrganizationId = otherOrg.rows[0].id

    for (const actor of [admin, teacherActor, studentActor, guardianActor]) {
      actor.organizationId = organizationId
      actor.tenantId = tenantId
    }

    const year = await createAcademicYear(admin, {
      name: `2026-2027-${suffix}`,
      startDate: '2026-09-01',
      endDate: '2027-06-30',
      isCurrent: true
    })
    academicYearId = year.id

    const term = await createTerm(admin, {
      academicYearId,
      name: 'Term 1',
      startDate: '2026-09-01',
      endDate: '2026-12-20'
    })
    termId = term.id

    const grade = await createGrade(admin, { name: 'Grade 7', level: 7 })
    gradeId = grade.id

    const subject = await createSubject(admin, { code: 'MATH', name: 'Mathematics' })
    subjectId = subject.id

    const cls = await createClass(admin, { name: 'Class 7A', academicYearId, gradeId })
    classId = cls.id

    const foreignClass = await pool.query(
      `INSERT INTO sms_classes (organization_id, tenant_id, name) VALUES ($1, $2, $3) RETURNING id`,
      [otherOrganizationId, tenantId, 'Foreign Class']
    )
    foreignClassId = foreignClass.rows[0].id
    const foreignGrade = await pool.query(
      `INSERT INTO sms_grades (organization_id, tenant_id, name) VALUES ($1, $2, 'Foreign Grade') RETURNING id`,
      [otherOrganizationId, tenantId]
    )
    foreignGradeId = foreignGrade.rows[0].id
    const foreignSubject = await pool.query(
      `INSERT INTO sms_subjects (organization_id, tenant_id, code, name) VALUES ($1, $2, 'FOR', 'Foreign Subject') RETURNING id`,
      [otherOrganizationId, tenantId]
    )
    foreignSubjectId = foreignSubject.rows[0].id

    const teacher = await createTeacher(admin, { userId: 5001, name: 'Ms. Teacher', employeeNo: 'T-001' })
    teacherId = teacher.id
    await assignTeacher(admin, { teacherId, classId, subjectId, termId, academicYearId })

    const student = await createStudent(admin, {
      name: 'Alice Domain',
      studentNo: `D-${suffix}`,
      classId,
      userId: 6001
    })
    studentId = student.id

    const enrollment = await enrollStudent(admin, { studentId, classId, academicYearId, termId })
    enrollmentId = enrollment.id

    const guardian = await createGuardian(admin, { userId: 7001, name: 'Parent Domain', phone: '555-0100' })
    await linkGuardian(admin, { studentId, guardianId: guardian.id, relation: 'parent', isPrimary: true })
  }, 60000)

  afterAll(async () => {
    if (organizationId) {
      await pool.query('DELETE FROM sms_student_guardians WHERE organization_id = $1', [organizationId])
      await pool.query('DELETE FROM sms_guardians WHERE organization_id = $1', [organizationId])
      await pool.query('DELETE FROM sms_enrollments WHERE organization_id = $1', [organizationId])
      await pool.query('DELETE FROM sms_teacher_assignments WHERE organization_id = $1', [organizationId])
      await pool.query('DELETE FROM sms_students WHERE organization_id = $1', [organizationId])
      await pool.query('DELETE FROM sms_teachers WHERE organization_id = $1', [organizationId])
      await pool.query('DELETE FROM sms_classes WHERE organization_id = $1', [organizationId])
      await pool.query('DELETE FROM sms_terms WHERE organization_id = $1', [organizationId])
      await pool.query('DELETE FROM sms_academic_years WHERE organization_id = $1', [organizationId])
      await pool.query('DELETE FROM sms_grades WHERE organization_id = $1', [organizationId])
      await pool.query('DELETE FROM sms_subjects WHERE organization_id = $1', [organizationId])
      await pool.query('DELETE FROM audit_logs WHERE organization_id = $1', [organizationId])
      await pool.query('DELETE FROM organizations WHERE id = $1', [organizationId])
    }
    if (otherOrganizationId) {
      await pool.query('DELETE FROM sms_subjects WHERE organization_id = $1', [otherOrganizationId])
      await pool.query('DELETE FROM sms_grades WHERE organization_id = $1', [otherOrganizationId])
      await pool.query('DELETE FROM sms_classes WHERE organization_id = $1', [otherOrganizationId])
      await pool.query('DELETE FROM organizations WHERE id = $1', [otherOrganizationId])
    }
    if (tenantId) await pool.query('DELETE FROM tenants WHERE id = $1', [tenantId])
    await pool.end()
  })

  it('builds a relational academic structure', async () => {
    const cls = await pool.query(
      `SELECT organization_id, academic_year_id, grade_id FROM sms_classes WHERE id = $1`,
      [classId]
    )
    expect(cls.rows[0]).toEqual({
      organization_id: organizationId,
      academic_year_id: academicYearId,
      grade_id: gradeId
    })
    const term = await pool.query(
      `SELECT academic_year_id FROM sms_terms WHERE id = $1`,
      [termId]
    )
    expect(term.rows[0].academic_year_id).toBe(academicYearId)
  })

  it('rejects cross-organization academic references', async () => {
    await expect(createClass(admin, { name: 'Bad Class', academicYearId, gradeId: foreignGradeId }))
      .rejects.toMatchObject({ statusCode: 400 })
    await expect(enrollStudent(admin, { studentId, classId: foreignClassId, academicYearId }))
      .rejects.toMatchObject({ statusCode: 400 })
    await expect(assignTeacher(admin, { teacherId, classId, subjectId: foreignSubjectId }))
      .rejects.toMatchObject({ statusCode: 400 })
    await expect(createTerm(admin, {
      academicYearId,
      name: 'Bad Term',
      startDate: '2027-09-01',
      endDate: '2027-09-02'
    })).resolves.toBeTruthy()
  })

  it('enrolls students, keeps history and prevents duplicate active enrollments', async () => {
    const enrollment = await pool.query(
      `SELECT student_id, class_id, academic_year_id, term_id, status FROM sms_enrollments WHERE id = $1`,
      [enrollmentId]
    )
    expect(enrollment.rows[0]).toEqual({
      student_id: studentId,
      class_id: classId,
      academic_year_id: academicYearId,
      term_id: termId,
      status: 'active'
    })

    await expect(enrollStudent(admin, { studentId, classId, academicYearId }))
      .rejects.toMatchObject({ statusCode: 409 })

    await withdrawEnrollment(admin, enrollmentId)
    const withdrawn = await pool.query(
      `SELECT status, ended_at FROM sms_enrollments WHERE id = $1`,
      [enrollmentId]
    )
    expect(withdrawn.rows[0].status).toBe('withdrawn')
    expect(withdrawn.rows[0].ended_at).toBeTruthy()

    // A new enrollment in the same academic year is allowed after withdrawal.
    const again = await enrollStudent(admin, { studentId, classId, academicYearId })
    expect(again.status).toBe('active')
  })

  it('records audit history for sensitive SMS changes', async () => {
    const audit = await pool.query(
      `SELECT action, resource, module_id FROM audit_logs WHERE organization_id = $1 AND module_id = 'sms'`,
      [organizationId]
    )
    for (const expected of [
      { action: 'academic-year.create', resource: 'academic-years' },
      { action: 'class.create', resource: 'classes' },
      { action: 'teacher.create', resource: 'teachers' },
      { action: 'teacher-assignment.create', resource: 'teacher-assignments' },
      { action: 'enrollment.create', resource: 'enrollments' },
      { action: 'guardian.create', resource: 'guardians' }
    ]) {
      expect(audit.rows).toContainEqual({ ...expected, module_id: 'sms' })
    }
  })

  it('applies role-aware row scopes for teacher, student and guardian', async () => {
    const studentsMeta = getRegisteredTable('students')!.meta
    const enrollmentsMeta = getRegisteredTable('enrollments')!.meta
    const asActor = (actor: SmsActor): DataScopeActor => ({
      userId: actor.userId,
      roleName: actor.roleName ?? '',
      dataScope: 'all',
      permissions: [...(actor.permissions ?? [])],
      organizationId: actor.organizationId ?? undefined,
      tenantId: actor.tenantId ?? undefined
    })
    const query = { offset: 0, limit: 50 }

    const teacherStudents = await listTableData(studentsMeta, query, asActor(teacherActor))
    expect(teacherStudents.rows.map(row => row.id)).toContain(studentId)

    const ownStudents = await listTableData(studentsMeta, query, asActor(studentActor))
    expect(ownStudents.rows.map(row => row.id)).toEqual([studentId])

    const guardianStudents = await listTableData(studentsMeta, query, asActor(guardianActor))
    expect(guardianStudents.rows.map(row => row.id)).toEqual([studentId])

    const ownEnrollments = await listTableData(enrollmentsMeta, query, asActor(studentActor))
    expect(ownEnrollments.rows.every(row => row.studentId === studentId)).toBe(true)

    const guardianEnrollments = await listTableData(enrollmentsMeta, query, asActor(guardianActor))
    expect(guardianEnrollments.rows.every(row => row.studentId === studentId)).toBe(true)
  })
})
