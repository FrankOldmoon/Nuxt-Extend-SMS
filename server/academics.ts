import { and, eq } from 'drizzle-orm'
import { createError } from 'h3'
import { db } from '../../../server/database'
import { writeAudit } from '../../../server/sdk'
import {
  sisAcademicYears,
  sisClasses,
  sisGrades,
  sisSubjects,
  sisTerms
} from './database/schema'
import { canUseSis, requireSisOrganization, type SisActor } from './context'

function requireManage(actor: SisActor, resource: string): number {
  const organizationId = requireSisOrganization(actor)
  if (!canUseSis(actor, 'create', resource)) {
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
export async function assertAcademicYearInContext(actor: SisActor, academicYearId: number): Promise<number> {
  const organizationId = requireSisOrganization(actor)
  const [row] = await db.select({ organizationId: sisAcademicYears.organizationId })
    .from(sisAcademicYears)
    .where(eq(sisAcademicYears.id, academicYearId))
    .limit(1)
  if (!row || row.organizationId !== organizationId) {
    throw createError({ statusCode: 400, statusMessage: 'Bad Request', message: 'academicYearId does not belong to the current organization' })
  }
  return academicYearId
}

export async function assertTermInContext(actor: SisActor, termId: number, academicYearId?: number): Promise<void> {
  const organizationId = requireSisOrganization(actor)
  const [row] = await db.select({
    organizationId: sisTerms.organizationId,
    academicYearId: sisTerms.academicYearId
  }).from(sisTerms).where(eq(sisTerms.id, termId)).limit(1)
  if (!row || row.organizationId !== organizationId) {
    throw createError({ statusCode: 400, statusMessage: 'Bad Request', message: 'termId does not belong to the current organization' })
  }
  if (academicYearId !== undefined && row.academicYearId !== academicYearId) {
    throw createError({ statusCode: 400, statusMessage: 'Bad Request', message: 'termId does not belong to the requested academic year' })
  }
}

export async function assertGradeInContext(actor: SisActor, gradeId: number): Promise<void> {
  const organizationId = requireSisOrganization(actor)
  const [row] = await db.select({ organizationId: sisGrades.organizationId })
    .from(sisGrades).where(eq(sisGrades.id, gradeId)).limit(1)
  if (!row || row.organizationId !== organizationId) {
    throw createError({ statusCode: 400, statusMessage: 'Bad Request', message: 'gradeId does not belong to the current organization' })
  }
}

export async function assertSubjectInContext(actor: SisActor, subjectId: number): Promise<void> {
  const organizationId = requireSisOrganization(actor)
  const [row] = await db.select({ organizationId: sisSubjects.organizationId })
    .from(sisSubjects).where(eq(sisSubjects.id, subjectId)).limit(1)
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

export async function createAcademicYear(actor: SisActor, input: CreateAcademicYearInput) {
  const organizationId = requireManage(actor, 'academic-years')
  const name = text(input.name, 'name')
  const startDate = dateValue(input.startDate, 'startDate')
  const endDate = dateValue(input.endDate, 'endDate')
  if (endDate < startDate) {
    throw createError({ statusCode: 400, statusMessage: 'Bad Request', message: 'endDate must be after startDate' })
  }
  return await db.transaction(async (tx) => {
    const [row] = await tx.insert(sisAcademicYears).values({
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
      moduleId: 'sis',
      action: 'academic-year.create',
      resource: 'academic-years',
      recordId: row.id,
      after: row,
      source: 'sis-service'
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

export async function createTerm(actor: SisActor, input: CreateTermInput) {
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
    const [row] = await tx.insert(sisTerms).values({
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
      moduleId: 'sis',
      action: 'term.create',
      resource: 'terms',
      recordId: row.id,
      after: row,
      source: 'sis-service'
    })
    return row
  })
}

export interface CreateGradeInput {
  name?: unknown
  level?: unknown
}

export async function createGrade(actor: SisActor, input: CreateGradeInput) {
  const organizationId = requireManage(actor, 'grades')
  const name = text(input.name, 'name')
  const level = input.level === undefined || input.level === null || input.level === ''
    ? null
    : Number(input.level)
  if (level !== null && !Number.isSafeInteger(level)) {
    throw createError({ statusCode: 400, statusMessage: 'Bad Request', message: 'level must be an integer' })
  }
  return await db.transaction(async (tx) => {
    const [row] = await tx.insert(sisGrades).values({
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
      moduleId: 'sis',
      action: 'grade.create',
      resource: 'grades',
      recordId: row.id,
      after: row,
      source: 'sis-service'
    })
    return row
  })
}

export interface CreateSubjectInput {
  code?: unknown
  name?: unknown
}

export async function createSubject(actor: SisActor, input: CreateSubjectInput) {
  const organizationId = requireManage(actor, 'subjects')
  const code = text(input.code, 'code')
  const name = text(input.name, 'name')
  return await db.transaction(async (tx) => {
    const [row] = await tx.insert(sisSubjects).values({
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
      moduleId: 'sis',
      action: 'subject.create',
      resource: 'subjects',
      recordId: row.id,
      after: row,
      source: 'sis-service'
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
export async function createClass(actor: SisActor, input: CreateClassInput) {
  const organizationId = requireManage(actor, 'classes')
  const name = text(input.name, 'name')
  const academicYearId = positiveId(input.academicYearId, 'academicYearId')
  const gradeId = positiveId(input.gradeId, 'gradeId')
  await assertAcademicYearInContext(actor, academicYearId)
  await assertGradeInContext(actor, gradeId)

  return await db.transaction(async (tx) => {
    const [row] = await tx.insert(sisClasses).values({
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
      moduleId: 'sis',
      action: 'class.create',
      resource: 'classes',
      recordId: row.id,
      after: row,
      source: 'sis-service'
    })
    return row
  })
}

/** Validate a class belongs to the organization and return its academic year. */
export async function classInContext(actor: SisActor, classId: number): Promise<{
  id: number
  academicYearId: number | null
  gradeId: number | null
}> {
  const organizationId = requireSisOrganization(actor)
  const [row] = await db.select({
    id: sisClasses.id,
    academicYearId: sisClasses.academicYearId,
    gradeId: sisClasses.gradeId
  }).from(sisClasses).where(and(
    eq(sisClasses.id, classId),
    eq(sisClasses.organizationId, organizationId)
  )).limit(1)
  if (!row) {
    throw createError({ statusCode: 400, statusMessage: 'Bad Request', message: 'classId does not belong to the current organization' })
  }
  return row
}
