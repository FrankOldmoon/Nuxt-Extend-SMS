import { and, eq } from 'drizzle-orm'
import { createError } from 'h3'
import { db } from '../../../server/database'
import { writeAudit } from '../../../server/sdk'
import {
  smsAcademicYears,
  smsClasses,
  smsGrades,
  smsSubjects,
  smsTerms
} from './database/schema'
import { canUseSms, requireSmsOrganization, type SmsActor } from './context'

function requireManage(actor: SmsActor, resource: string): number {
  const organizationId = requireSmsOrganization(actor)
  if (!canUseSms(actor, 'create', resource)) {
    throw createError({ statusCode: 403, statusMessage: 'Forbidden', message: `No permission to manage ${resource}` })
  }
  return organizationId
}

function text(value: unknown, field: string): string {
  const result = typeof value === 'string' ? value.trim() : ''
  if (!result) throw createError({ statusCode: 400, statusMessage: 'Bad Request', message: `${field} is required` })
  return result
}

function dateValue(value: unknown, field: string): string {
  const raw = typeof value === 'string' ? value.trim() : ''
  if (!raw || Number.isNaN(Date.parse(raw))) {
    throw createError({ statusCode: 400, statusMessage: 'Bad Request', message: `${field} must be a valid date` })
  }
  return raw.slice(0, 10)
}

function positiveId(value: unknown, field: string): number {
  const id = Number(value)
  if (!Number.isSafeInteger(id) || id <= 0) {
    throw createError({ statusCode: 400, statusMessage: 'Bad Request', message: `${field} must be a positive integer` })
  }
  return id
}

/** Ensure an academic year belongs to the actor's organization. */
export async function assertAcademicYearInContext(actor: SmsActor, academicYearId: number): Promise<number> {
  const organizationId = requireSmsOrganization(actor)
  const [row] = await db.select({ organizationId: smsAcademicYears.organizationId })
    .from(smsAcademicYears)
    .where(eq(smsAcademicYears.id, academicYearId))
    .limit(1)
  if (!row || row.organizationId !== organizationId) {
    throw createError({ statusCode: 400, statusMessage: 'Bad Request', message: 'academicYearId does not belong to the current organization' })
  }
  return academicYearId
}

export async function assertTermInContext(actor: SmsActor, termId: number, academicYearId?: number): Promise<void> {
  const organizationId = requireSmsOrganization(actor)
  const [row] = await db.select({
    organizationId: smsTerms.organizationId,
    academicYearId: smsTerms.academicYearId
  }).from(smsTerms).where(eq(smsTerms.id, termId)).limit(1)
  if (!row || row.organizationId !== organizationId) {
    throw createError({ statusCode: 400, statusMessage: 'Bad Request', message: 'termId does not belong to the current organization' })
  }
  if (academicYearId !== undefined && row.academicYearId !== academicYearId) {
    throw createError({ statusCode: 400, statusMessage: 'Bad Request', message: 'termId does not belong to the requested academic year' })
  }
}

export async function assertGradeInContext(actor: SmsActor, gradeId: number): Promise<void> {
  const organizationId = requireSmsOrganization(actor)
  const [row] = await db.select({ organizationId: smsGrades.organizationId })
    .from(smsGrades).where(eq(smsGrades.id, gradeId)).limit(1)
  if (!row || row.organizationId !== organizationId) {
    throw createError({ statusCode: 400, statusMessage: 'Bad Request', message: 'gradeId does not belong to the current organization' })
  }
}

export async function assertSubjectInContext(actor: SmsActor, subjectId: number): Promise<void> {
  const organizationId = requireSmsOrganization(actor)
  const [row] = await db.select({ organizationId: smsSubjects.organizationId })
    .from(smsSubjects).where(eq(smsSubjects.id, subjectId)).limit(1)
  if (!row || row.organizationId !== organizationId) {
    throw createError({ statusCode: 400, statusMessage: 'Bad Request', message: 'subjectId does not belong to the current organization' })
  }
}

export interface CreateAcademicYearInput {
  name?: unknown
  startDate?: unknown
  endDate?: unknown
  isCurrent?: unknown
}

export async function createAcademicYear(actor: SmsActor, input: CreateAcademicYearInput) {
  const organizationId = requireManage(actor, 'academic-years')
  const name = text(input.name, 'name')
  const startDate = dateValue(input.startDate, 'startDate')
  const endDate = dateValue(input.endDate, 'endDate')
  if (endDate < startDate) {
    throw createError({ statusCode: 400, statusMessage: 'Bad Request', message: 'endDate must be after startDate' })
  }
  return await db.transaction(async (tx) => {
    const [row] = await tx.insert(smsAcademicYears).values({
      organizationId,
      tenantId: actor.tenantId ?? null,
      name,
      startDate,
      endDate,
      isCurrent: input.isCurrent === true || input.isCurrent === 'true'
    }).returning()
    if (!row) throw createError({ statusCode: 500, message: 'Failed to create academic year' })
    await writeAudit(tx, {
      actorUserId: actor.userId,
      tenantId: actor.tenantId ?? undefined,
      organizationId,
      moduleId: 'sms',
      action: 'academic-year.create',
      resource: 'academic-years',
      recordId: row.id,
      after: row,
      source: 'sms-service'
    })
    return row
  })
}

export interface CreateTermInput {
  academicYearId?: unknown
  name?: unknown
  startDate?: unknown
  endDate?: unknown
}

export async function createTerm(actor: SmsActor, input: CreateTermInput) {
  const organizationId = requireManage(actor, 'terms')
  const academicYearId = positiveId(input.academicYearId, 'academicYearId')
  await assertAcademicYearInContext(actor, academicYearId)
  const name = text(input.name, 'name')
  const startDate = dateValue(input.startDate, 'startDate')
  const endDate = dateValue(input.endDate, 'endDate')
  if (endDate < startDate) {
    throw createError({ statusCode: 400, statusMessage: 'Bad Request', message: 'endDate must be after startDate' })
  }
  return await db.transaction(async (tx) => {
    const [row] = await tx.insert(smsTerms).values({
      organizationId,
      tenantId: actor.tenantId ?? null,
      academicYearId,
      name,
      startDate,
      endDate
    }).returning()
    if (!row) throw createError({ statusCode: 500, message: 'Failed to create term' })
    await writeAudit(tx, {
      actorUserId: actor.userId,
      tenantId: actor.tenantId ?? undefined,
      organizationId,
      moduleId: 'sms',
      action: 'term.create',
      resource: 'terms',
      recordId: row.id,
      after: row,
      source: 'sms-service'
    })
    return row
  })
}

export interface CreateGradeInput {
  name?: unknown
  level?: unknown
}

export async function createGrade(actor: SmsActor, input: CreateGradeInput) {
  const organizationId = requireManage(actor, 'grades')
  const name = text(input.name, 'name')
  const level = input.level === undefined || input.level === null || input.level === ''
    ? null
    : Number(input.level)
  if (level !== null && !Number.isSafeInteger(level)) {
    throw createError({ statusCode: 400, statusMessage: 'Bad Request', message: 'level must be an integer' })
  }
  return await db.transaction(async (tx) => {
    const [row] = await tx.insert(smsGrades).values({
      organizationId,
      tenantId: actor.tenantId ?? null,
      name,
      level
    }).returning()
    if (!row) throw createError({ statusCode: 500, message: 'Failed to create grade' })
    await writeAudit(tx, {
      actorUserId: actor.userId,
      tenantId: actor.tenantId ?? undefined,
      organizationId,
      moduleId: 'sms',
      action: 'grade.create',
      resource: 'grades',
      recordId: row.id,
      after: row,
      source: 'sms-service'
    })
    return row
  })
}

export interface CreateSubjectInput {
  code?: unknown
  name?: unknown
}

export async function createSubject(actor: SmsActor, input: CreateSubjectInput) {
  const organizationId = requireManage(actor, 'subjects')
  const code = text(input.code, 'code')
  const name = text(input.name, 'name')
  return await db.transaction(async (tx) => {
    const [row] = await tx.insert(smsSubjects).values({
      organizationId,
      tenantId: actor.tenantId ?? null,
      code,
      name
    }).returning()
    if (!row) throw createError({ statusCode: 500, message: 'Failed to create subject' })
    await writeAudit(tx, {
      actorUserId: actor.userId,
      tenantId: actor.tenantId ?? undefined,
      organizationId,
      moduleId: 'sms',
      action: 'subject.create',
      resource: 'subjects',
      recordId: row.id,
      after: row,
      source: 'sms-service'
    })
    return row
  })
}

export interface CreateClassInput {
  name?: unknown
  academicYearId?: unknown
  gradeId?: unknown
}

/** Relational class creation: year and grade must belong to the organization. */
export async function createClass(actor: SmsActor, input: CreateClassInput) {
  const organizationId = requireManage(actor, 'classes')
  const name = text(input.name, 'name')
  const academicYearId = positiveId(input.academicYearId, 'academicYearId')
  const gradeId = positiveId(input.gradeId, 'gradeId')
  await assertAcademicYearInContext(actor, academicYearId)
  await assertGradeInContext(actor, gradeId)

  return await db.transaction(async (tx) => {
    const [row] = await tx.insert(smsClasses).values({
      organizationId,
      tenantId: actor.tenantId ?? null,
      name,
      academicYearId,
      gradeId
    }).returning()
    if (!row) throw createError({ statusCode: 500, message: 'Failed to create class' })
    await writeAudit(tx, {
      actorUserId: actor.userId,
      tenantId: actor.tenantId ?? undefined,
      organizationId,
      moduleId: 'sms',
      action: 'class.create',
      resource: 'classes',
      recordId: row.id,
      after: row,
      source: 'sms-service'
    })
    return row
  })
}

/** Validate a class belongs to the organization and return its academic year. */
export async function classInContext(actor: SmsActor, classId: number): Promise<{
  id: number
  academicYearId: number | null
  gradeId: number | null
}> {
  const organizationId = requireSmsOrganization(actor)
  const [row] = await db.select({
    id: smsClasses.id,
    academicYearId: smsClasses.academicYearId,
    gradeId: smsClasses.gradeId
  }).from(smsClasses).where(and(
    eq(smsClasses.id, classId),
    eq(smsClasses.organizationId, organizationId)
  )).limit(1)
  if (!row) {
    throw createError({ statusCode: 400, statusMessage: 'Bad Request', message: 'classId does not belong to the current organization' })
  }
  return row
}
