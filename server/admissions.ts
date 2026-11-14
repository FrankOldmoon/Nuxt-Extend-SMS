/**
 * Admissions (Slice C): cycles → applications → review → convert to student.
 *
 * Office workflows are permission-gated but organization-wide (no class scope).
 * Conversion is high risk: it creates a student *and* an enrollment snapshot in
 * one transaction and records an immutable event plus an audit entry.
 */
import { and, desc, eq, ilike, isNull, or } from 'drizzle-orm'
import { createError } from 'h3'
import { db, writeAudit } from '../../../server/sdk'
import {
  smsAcademicYears,
  smsAdmissionApplications,
  smsAdmissionCycles,
  smsAdmissionEvents,
  smsClasses,
  smsEnrollments,
  smsStudents
} from './database/schema'
import { canUseSms, isSmsAdmin, requireSmsOrganization, type SmsActor } from './context'
import { classInContext } from './academics'

export const ADMISSION_STATUSES = ['submitted', 'reviewing', 'accepted', 'rejected', 'converted'] as const
export type AdmissionStatus = typeof ADMISSION_STATUSES[number]

export const ADMISSION_CYCLE_STATUSES = ['open', 'closed'] as const
export type AdmissionCycleStatus = typeof ADMISSION_CYCLE_STATUSES[number]

/**
 * Allowed status transitions. Rejected applications may be re-opened for
 * review; converted is terminal.
 */
const TRANSITIONS: Record<AdmissionStatus, AdmissionStatus[]> = {
  submitted: ['reviewing', 'accepted', 'rejected'],
  reviewing: ['accepted', 'rejected'],
  accepted: ['converted', 'rejected'],
  rejected: ['reviewing'],
  converted: []
}

export function allowedAdmissionTransition(from: AdmissionStatus, to: AdmissionStatus): boolean {
  return TRANSITIONS[from].includes(to)
}

export function normalizeAdmissionStatus(value: unknown): AdmissionStatus {
  if (typeof value === 'string' && (ADMISSION_STATUSES as readonly string[]).includes(value)) {
    return value as AdmissionStatus
  }
  throw createError({ statusCode: 400, message: `status must be one of ${ADMISSION_STATUSES.join(', ')}` })
}

export function normalizeCycleStatus(value: unknown): AdmissionCycleStatus {
  if (value === undefined || value === null || value === '') return 'open'
  if (typeof value === 'string' && (ADMISSION_CYCLE_STATUSES as readonly string[]).includes(value)) {
    return value as AdmissionCycleStatus
  }
  throw createError({ statusCode: 400, message: `cycle status must be one of ${ADMISSION_CYCLE_STATUSES.join(', ')}` })
}

export function normalizeAdmissionDate(value: unknown, field: string): string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw createError({ statusCode: 400, message: `${field} must be YYYY-MM-DD` })
  }
  const parsed = new Date(`${value}T00:00:00Z`)
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) {
    throw createError({ statusCode: 400, message: `${field} is not a valid calendar day` })
  }
  return value
}

/** Deterministic fallback student number for converted applications. */
export function buildStudentNo(applicationId: number, year: number): string {
  return `A${year}${String(applicationId).padStart(5, '0')}`
}

function positiveId(value: unknown, field: string): number {
  const id = Number(value)
  if (!Number.isSafeInteger(id) || id <= 0) {
    throw createError({ statusCode: 400, message: `${field} must be a positive integer` })
  }
  return id
}

function optionalId(value: unknown): number | null {
  if (value === undefined || value === null || value === '') return null
  const id = Number(value)
  return Number.isSafeInteger(id) && id > 0 ? id : null
}

function requireAdmission(actor: SmsActor, action: 'read' | 'create'): number {
  const organizationId = requireSmsOrganization(actor)
  if (!canUseSms(actor, action, 'applications')) {
    throw createError({ statusCode: 403, statusMessage: 'Forbidden', message: `No permission to ${action} applications` })
  }
  return organizationId
}

function hasPermission(actor: SmsActor, permission: string): boolean {
  if (isSmsAdmin(actor)) return true
  return (actor.permissions ?? []).includes(permission)
}

export function canReviewApplications(actor: SmsActor): boolean {
  return hasPermission(actor, 'sms.applications.review')
}

export function canConvertApplications(actor: SmsActor): boolean {
  return hasPermission(actor, 'sms.applications.convert')
}

// ---------------------------------------------------------------------------
// Cycles
// ---------------------------------------------------------------------------

export async function listAdmissionCycles(actor: SmsActor, options: { status?: unknown, limit?: unknown } = {}) {
  const organizationId = requireAdmission(actor, 'read')
  const conditions = [eq(smsAdmissionCycles.organizationId, organizationId)]
  if (options.status !== undefined && options.status !== null && options.status !== '') {
    conditions.push(eq(smsAdmissionCycles.status, normalizeCycleStatus(options.status)))
  }
  const limit = Math.min(Math.max(Math.floor(Number(options.limit ?? 50) || 50), 1), 200)
  const rows = await db.select({
    id: smsAdmissionCycles.id,
    name: smsAdmissionCycles.name,
    academicYearId: smsAdmissionCycles.academicYearId,
    academicYearName: smsAcademicYears.name,
    startDate: smsAdmissionCycles.startDate,
    endDate: smsAdmissionCycles.endDate,
    status: smsAdmissionCycles.status,
    createdAt: smsAdmissionCycles.createdAt
  }).from(smsAdmissionCycles)
    .leftJoin(smsAcademicYears, eq(smsAcademicYears.id, smsAdmissionCycles.academicYearId))
    .where(and(...conditions))
    .orderBy(desc(smsAdmissionCycles.startDate))
    .limit(limit)
  return rows
}

export interface CreateCycleInput {
  name?: unknown
  academicYearId?: unknown
  startDate?: unknown
  endDate?: unknown
}

export async function createAdmissionCycle(actor: SmsActor, input: CreateCycleInput) {
  const organizationId = requireSmsOrganization(actor)
  if (!hasPermission(actor, 'sms.admission-cycles.create')) {
    throw createError({ statusCode: 403, statusMessage: 'Forbidden', message: 'No permission to create admission cycles' })
  }
  const name = typeof input.name === 'string' ? input.name.trim() : ''
  if (!name || name.length > 120) throw createError({ statusCode: 400, message: 'name must be 1-120 characters' })
  const academicYearId = positiveId(input.academicYearId, 'academicYearId')
  const startDate = normalizeAdmissionDate(input.startDate, 'startDate')
  const endDate = normalizeAdmissionDate(input.endDate, 'endDate')
  if (startDate > endDate) throw createError({ statusCode: 400, message: 'endDate must not be before startDate' })

  const [year] = await db.select({ id: smsAcademicYears.id }).from(smsAcademicYears)
    .where(and(
      eq(smsAcademicYears.id, academicYearId),
      eq(smsAcademicYears.organizationId, organizationId),
      isNull(smsAcademicYears.deletedAt)
    ))
    .limit(1)
  if (!year) throw createError({ statusCode: 400, message: 'academicYearId does not belong to the organization' })

  return await db.transaction(async (tx) => {
    const [row] = await tx.insert(smsAdmissionCycles).values({
      organizationId,
      tenantId: actor.tenantId ?? null,
      academicYearId,
      name,
      startDate,
      endDate,
      status: 'open'
    }).returning()
    if (!row) throw createError({ statusCode: 500, message: 'Failed to create admission cycle' })
    await writeAudit(tx, {
      actorUserId: actor.userId,
      tenantId: actor.tenantId ?? undefined,
      organizationId,
      moduleId: 'sms',
      action: 'admission-cycle.create',
      resource: 'admission-cycles',
      recordId: row.id,
      after: row,
      source: 'sms-service'
    })
    return row
  })
}

// ---------------------------------------------------------------------------
// Applications
// ---------------------------------------------------------------------------

export interface ApplicationListQuery {
  cycleId?: unknown
  status?: unknown
  query?: unknown
  limit?: unknown
}

export async function listApplications(actor: SmsActor, options: ApplicationListQuery = {}) {
  const organizationId = requireAdmission(actor, 'read')
  const conditions = [eq(smsAdmissionApplications.organizationId, organizationId)]
  const cycleId = optionalId(options.cycleId)
  if (cycleId) conditions.push(eq(smsAdmissionApplications.cycleId, cycleId))
  if (options.status !== undefined && options.status !== null && options.status !== '') {
    conditions.push(eq(smsAdmissionApplications.status, normalizeAdmissionStatus(options.status)))
  }
  const query = typeof options.query === 'string' ? options.query.trim() : ''
  if (query) {
    const clause = or(
      ilike(smsAdmissionApplications.applicantName, `%${query}%`),
      ilike(smsAdmissionApplications.guardianPhone, `%${query}%`),
      ilike(smsAdmissionApplications.guardianName, `%${query}%`)
    )
    if (clause) conditions.push(clause)
  }
  const limit = Math.min(Math.max(Math.floor(Number(options.limit ?? 50) || 50), 1), 200)
  return await db.select({
    id: smsAdmissionApplications.id,
    cycleId: smsAdmissionApplications.cycleId,
    cycleName: smsAdmissionCycles.name,
    applicantName: smsAdmissionApplications.applicantName,
    gender: smsAdmissionApplications.gender,
    birthDate: smsAdmissionApplications.birthDate,
    guardianName: smsAdmissionApplications.guardianName,
    guardianPhone: smsAdmissionApplications.guardianPhone,
    previousSchool: smsAdmissionApplications.previousSchool,
    status: smsAdmissionApplications.status,
    studentNo: smsAdmissionApplications.studentNo,
    notes: smsAdmissionApplications.notes,
    convertedStudentId: smsAdmissionApplications.convertedStudentId,
    createdAt: smsAdmissionApplications.createdAt
  }).from(smsAdmissionApplications)
    .leftJoin(smsAdmissionCycles, eq(smsAdmissionCycles.id, smsAdmissionApplications.cycleId))
    .where(and(...conditions))
    .orderBy(desc(smsAdmissionApplications.createdAt))
    .limit(limit)
}

export async function getApplication(actor: SmsActor, applicationId: number) {
  const organizationId = requireAdmission(actor, 'read')
  const [row] = await db.select({
    id: smsAdmissionApplications.id,
    cycleId: smsAdmissionApplications.cycleId,
    cycleName: smsAdmissionCycles.name,
    academicYearId: smsAdmissionCycles.academicYearId,
    applicantName: smsAdmissionApplications.applicantName,
    gender: smsAdmissionApplications.gender,
    birthDate: smsAdmissionApplications.birthDate,
    guardianName: smsAdmissionApplications.guardianName,
    guardianPhone: smsAdmissionApplications.guardianPhone,
    previousSchool: smsAdmissionApplications.previousSchool,
    status: smsAdmissionApplications.status,
    studentNo: smsAdmissionApplications.studentNo,
    notes: smsAdmissionApplications.notes,
    convertedStudentId: smsAdmissionApplications.convertedStudentId
  }).from(smsAdmissionApplications)
    .innerJoin(smsAdmissionCycles, eq(smsAdmissionCycles.id, smsAdmissionApplications.cycleId))
    .where(and(
      eq(smsAdmissionApplications.id, applicationId),
      eq(smsAdmissionApplications.organizationId, organizationId)
    ))
    .limit(1)
  if (!row) throw createError({ statusCode: 404, message: 'Application not found' })
  return row
}

export interface CreateApplicationInput {
  cycleId?: unknown
  applicantName?: unknown
  gender?: unknown
  birthDate?: unknown
  guardianName?: unknown
  guardianPhone?: unknown
  previousSchool?: unknown
  notes?: unknown
}

export async function createApplication(actor: SmsActor, input: CreateApplicationInput) {
  const organizationId = requireAdmission(actor, 'create')
  const cycleId = positiveId(input.cycleId, 'cycleId')
  const applicantName = typeof input.applicantName === 'string' ? input.applicantName.trim() : ''
  if (!applicantName || applicantName.length > 120) {
    throw createError({ statusCode: 400, message: 'applicantName must be 1-120 characters' })
  }
  const [cycle] = await db.select({
    id: smsAdmissionCycles.id,
    status: smsAdmissionCycles.status
  }).from(smsAdmissionCycles)
    .where(and(
      eq(smsAdmissionCycles.id, cycleId),
      eq(smsAdmissionCycles.organizationId, organizationId)
    ))
    .limit(1)
  if (!cycle) throw createError({ statusCode: 404, message: 'Admission cycle not found' })
  if (cycle.status !== 'open') throw createError({ statusCode: 409, message: 'Admission cycle is closed' })

  const birthDate = input.birthDate === undefined || input.birthDate === null || input.birthDate === ''
    ? null
    : normalizeAdmissionDate(input.birthDate, 'birthDate')
  const text = (value: unknown, max: number) =>
    typeof value === 'string' && value.trim() ? value.trim().slice(0, max) : null

  return await db.transaction(async (tx) => {
    const [row] = await tx.insert(smsAdmissionApplications).values({
      organizationId,
      tenantId: actor.tenantId ?? null,
      cycleId,
      applicantName,
      gender: text(input.gender, 20),
      birthDate,
      guardianName: text(input.guardianName, 120),
      guardianPhone: text(input.guardianPhone, 40),
      previousSchool: text(input.previousSchool, 160),
      notes: text(input.notes, 500),
      status: 'submitted',
      createdBy: actor.userId
    }).returning()
    if (!row) throw createError({ statusCode: 500, message: 'Failed to create application' })
    await tx.insert(smsAdmissionEvents).values({
      organizationId,
      tenantId: actor.tenantId ?? null,
      applicationId: row.id,
      action: 'submit',
      fromStatus: null,
      toStatus: 'submitted',
      actorUserId: actor.userId
    })
    await writeAudit(tx, {
      actorUserId: actor.userId,
      tenantId: actor.tenantId ?? undefined,
      organizationId,
      moduleId: 'sms',
      action: 'application.create',
      resource: 'applications',
      recordId: row.id,
      after: row,
      source: 'sms-service'
    })
    return row
  })
}

export interface ReviewApplicationInput {
  applicationId?: unknown
  status?: unknown
  note?: unknown
}

export async function reviewApplication(actor: SmsActor, input: ReviewApplicationInput) {
  const organizationId = requireSmsOrganization(actor)
  if (!canReviewApplications(actor)) {
    throw createError({ statusCode: 403, statusMessage: 'Forbidden', message: 'No permission to review applications' })
  }
  const applicationId = positiveId(input.applicationId, 'applicationId')
  const nextStatus = normalizeAdmissionStatus(input.status)
  if (nextStatus === 'converted') {
    throw createError({ statusCode: 400, message: 'Use the convert capability to create a student' })
  }
  const application = await getApplication(actor, applicationId)
  if (!allowedAdmissionTransition(application.status as AdmissionStatus, nextStatus)) {
    throw createError({ statusCode: 409, message: `Cannot move application from ${application.status} to ${nextStatus}` })
  }
  const note = typeof input.note === 'string' && input.note.trim() ? input.note.trim().slice(0, 500) : null

  return await db.transaction(async (tx) => {
    const [row] = await tx.update(smsAdmissionApplications)
      .set({
        status: nextStatus,
        reviewedBy: actor.userId,
        reviewedAt: new Date(),
        notes: note ?? application.notes,
        updatedAt: new Date()
      })
      .where(eq(smsAdmissionApplications.id, applicationId))
      .returning()
    await tx.insert(smsAdmissionEvents).values({
      organizationId,
      tenantId: actor.tenantId ?? null,
      applicationId,
      action: 'review',
      fromStatus: application.status,
      toStatus: nextStatus,
      note,
      actorUserId: actor.userId
    })
    await writeAudit(tx, {
      actorUserId: actor.userId,
      tenantId: actor.tenantId ?? undefined,
      organizationId,
      moduleId: 'sms',
      action: 'application.review',
      resource: 'applications',
      recordId: applicationId,
      before: { status: application.status },
      after: { status: nextStatus, note },
      source: 'sms-service'
    })
    return { ...row, previousStatus: application.status }
  })
}

export interface ConvertApplicationInput {
  applicationId?: unknown
  classId?: unknown
  studentNo?: unknown
}

export async function convertApplication(actor: SmsActor, input: ConvertApplicationInput) {
  const organizationId = requireSmsOrganization(actor)
  if (!canConvertApplications(actor)) {
    throw createError({ statusCode: 403, statusMessage: 'Forbidden', message: 'No permission to convert applications' })
  }
  const applicationId = positiveId(input.applicationId, 'applicationId')
  const application = await getApplication(actor, applicationId)
  if (application.status !== 'accepted') {
    throw createError({ statusCode: 409, message: 'Only accepted applications can be converted' })
  }
  const classId = optionalId(input.classId)
  if (classId) await classInContext(actor, classId)

  const year = new Date().getFullYear()
  const requestedNo = typeof input.studentNo === 'string' ? input.studentNo.trim() : ''
  const studentNo = requestedNo || buildStudentNo(applicationId, year)

  const [duplicate] = await db.select({ id: smsStudents.id }).from(smsStudents)
    .where(and(
      eq(smsStudents.organizationId, organizationId),
      eq(smsStudents.studentNo, studentNo)
    ))
    .limit(1)
  if (duplicate) throw createError({ statusCode: 409, message: `Student number ${studentNo} already exists` })

  return await db.transaction(async (tx) => {
    const [student] = await tx.insert(smsStudents).values({
      organizationId,
      tenantId: actor.tenantId ?? null,
      classId,
      name: application.applicantName,
      studentNo
    }).returning()
    if (!student) throw createError({ statusCode: 500, message: 'Failed to create student' })

    // Placement is optional at conversion time; without a class the student is
    // created but no active enrollment is written.
    const [enrollment] = classId
      ? await tx.insert(smsEnrollments).values({
          organizationId,
          tenantId: actor.tenantId ?? null,
          studentId: student.id,
          classId,
          academicYearId: application.academicYearId,
          status: 'active'
        }).returning()
      : []

    await tx.update(smsAdmissionApplications)
      .set({
        status: 'converted',
        convertedStudentId: student.id,
        studentNo,
        reviewedBy: actor.userId,
        reviewedAt: new Date(),
        updatedAt: new Date()
      })
      .where(eq(smsAdmissionApplications.id, applicationId))

    await tx.insert(smsAdmissionEvents).values({
      organizationId,
      tenantId: actor.tenantId ?? null,
      applicationId,
      action: 'convert',
      fromStatus: application.status,
      toStatus: 'converted',
      note: `student #${student.id}`,
      actorUserId: actor.userId
    })

    await writeAudit(tx, {
      actorUserId: actor.userId,
      tenantId: actor.tenantId ?? undefined,
      organizationId,
      moduleId: 'sms',
      action: 'application.convert',
      resource: 'applications',
      recordId: applicationId,
      before: { status: application.status },
      after: { status: 'converted', studentId: student.id, studentNo, classId, enrollmentId: enrollment?.id },
      source: 'sms-service'
    })

    return {
      applicationId,
      status: 'converted',
      studentId: student.id,
      studentName: student.name,
      studentNo,
      classId,
      className: classId
        ? (await tx.select({ name: smsClasses.name }).from(smsClasses).where(eq(smsClasses.id, classId)).limit(1))[0]?.name ?? null
        : null,
      enrollmentId: enrollment?.id ?? null
    }
  })
}
