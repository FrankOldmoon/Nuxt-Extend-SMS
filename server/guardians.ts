import { and, eq } from 'drizzle-orm'
import { createError } from 'h3'
import { db } from '../../../server/database'
import { writeAudit } from '../../../server/sdk'
import { sisGuardians, sisStudentGuardians } from './database/schema'
import { canUseSis, requireSisOrganization, type SisActor } from './context'
import { assertStudentInContext } from './enrollment'

function requireManage(actor: SisActor, resource: string): number {
  const organizationId = requireSisOrganization(actor)
  if (!canUseSis(actor, 'create', resource)) {
    throw createError({ statusCode: 403, statusMessage: 'Forbidden', message: `No permission to manage ${resource}` })
  }
  return organizationId
}

function positiveId(value: unknown, field: string): number {
  const id = Number(value)
  if (!Number.isSafeInteger(id) || id <= 0) {
    throw createError({ statusCode: 400, statusMessage: 'Bad Request', message: `${field} must be a positive integer` })
  }
  return id
}

export async function assertGuardianInContext(actor: SisActor, guardianId: number): Promise<void> {
  const organizationId = requireSisOrganization(actor)
  const [row] = await db.select({ organizationId: sisGuardians.organizationId })
    .from(sisGuardians).where(eq(sisGuardians.id, guardianId)).limit(1)
  if (!row || row.organizationId !== organizationId) {
    throw createError({ statusCode: 400, statusMessage: 'Bad Request', message: 'guardianId does not belong to the current organization' })
  }
}

export interface CreateGuardianInput {
  userId?: unknown
  name?: unknown
  phone?: unknown
}

export async function createGuardian(actor: SisActor, input: CreateGuardianInput) {
  const organizationId = requireManage(actor, 'guardians')
  const userId = positiveId(input.userId, 'userId')
  const name = typeof input.name === 'string' && input.name.trim() ? input.name.trim() : null
  const phone = typeof input.phone === 'string' && input.phone.trim() ? input.phone.trim() : null

  return await db.transaction(async (tx) => {
    const [row] = await tx.insert(sisGuardians).values({
      organizationId,
      tenantId: actor.tenantId ?? null,
      userId,
      name,
      phone
    }).returning()
    if (!row) throw createError({ statusCode: 500, message: 'Failed to create guardian' })
    await writeAudit(tx, {
      actorUserId: actor.userId,
      tenantId: actor.tenantId ?? undefined,
      organizationId,
      moduleId: 'sis',
      action: 'guardian.create',
      resource: 'guardians',
      recordId: row.id,
      after: row,
      source: 'sis-service'
    })
    return row
  })
}

export interface LinkGuardianInput {
  studentId?: unknown
  guardianId?: unknown
  relation?: unknown
  isPrimary?: unknown
}

/** Link a guardian to a student; both must belong to the same organization. */
export async function linkGuardian(actor: SisActor, input: LinkGuardianInput) {
  const organizationId = requireManage(actor, 'student-guardians')
  const studentId = positiveId(input.studentId, 'studentId')
  const guardianId = positiveId(input.guardianId, 'guardianId')
  await assertStudentInContext(actor, studentId)
  await assertGuardianInContext(actor, guardianId)
  const relation = typeof input.relation === 'string' && input.relation.trim() ? input.relation.trim() : null
  const isPrimary = input.isPrimary === true || input.isPrimary === 'true'

  return await db.transaction(async (tx) => {
    const [row] = await tx.insert(sisStudentGuardians).values({
      organizationId,
      tenantId: actor.tenantId ?? null,
      studentId,
      guardianId,
      relation,
      isPrimary
    }).returning()
    if (!row) throw createError({ statusCode: 500, message: 'Failed to link guardian' })
    await writeAudit(tx, {
      actorUserId: actor.userId,
      tenantId: actor.tenantId ?? undefined,
      organizationId,
      moduleId: 'sis',
      action: 'student-guardian.create',
      resource: 'student-guardians',
      recordId: row.id,
      after: row,
      source: 'sis-service'
    })
    return row
  })
}

/** Students explicitly linked to a guardian user in the current organization. */
export async function guardianStudentIds(actor: SisActor): Promise<number[]> {
  const organizationId = requireSisOrganization(actor)
  const rows = await db.select({ studentId: sisStudentGuardians.studentId })
    .from(sisStudentGuardians)
    .innerJoin(sisGuardians, eq(sisStudentGuardians.guardianId, sisGuardians.id))
    .where(and(
      eq(sisStudentGuardians.organizationId, organizationId),
      eq(sisGuardians.userId, actor.userId)
    ))
  return rows.map(row => row.studentId)
}
