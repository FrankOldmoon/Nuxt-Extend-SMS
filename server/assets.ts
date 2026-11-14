/**
 * Assets (Slice D): fixed-asset registry with an immutable movement trail.
 * Assets are never deleted; disposal is a status change.
 */
import { and, desc, eq } from 'drizzle-orm'
import { createError } from 'h3'
import { db, writeAudit } from '../../../server/sdk'
import { smsAssetEvents, smsAssets } from './database/schema'
import { canUseSms, requireSmsOrganization, type SmsActor } from './context'

export const ASSET_STATUSES = ['in_use', 'idle', 'maintenance', 'disposed'] as const
export type AssetStatus = typeof ASSET_STATUSES[number]

export function normalizeAssetStatus(value: unknown, fallback: AssetStatus = 'idle'): AssetStatus {
  if (value === undefined || value === null || value === '') return fallback
  if (typeof value === 'string' && (ASSET_STATUSES as readonly string[]).includes(value)) {
    return value as AssetStatus
  }
  throw createError({ statusCode: 400, message: `status must be one of ${ASSET_STATUSES.join(', ')}` })
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

function optionalDate(value: unknown): string | null {
  if (value === undefined || value === null || value === '') return null
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw createError({ statusCode: 400, message: 'purchasedAt must be YYYY-MM-DD' })
  }
  return value
}

function text(value: unknown, max: number): string | null {
  return typeof value === 'string' && value.trim() ? value.trim().slice(0, max) : null
}

function requireAssetRead(actor: SmsActor): number {
  const organizationId = requireSmsOrganization(actor)
  if (!canUseSms(actor, 'read', 'assets')) {
    throw createError({ statusCode: 403, statusMessage: 'Forbidden', message: 'No permission to read assets' })
  }
  return organizationId
}

function requireAssetWrite(actor: SmsActor): number {
  const organizationId = requireSmsOrganization(actor)
  if (!canUseSms(actor, 'update', 'assets')) {
    throw createError({ statusCode: 403, statusMessage: 'Forbidden', message: 'No permission to update assets' })
  }
  return organizationId
}

export async function listAssets(actor: SmsActor, options: { status?: unknown, category?: unknown, limit?: unknown } = {}) {
  const organizationId = requireAssetRead(actor)
  const conditions = [eq(smsAssets.organizationId, organizationId)]
  if (options.status !== undefined && options.status !== null && options.status !== '') {
    conditions.push(eq(smsAssets.status, normalizeAssetStatus(options.status)))
  }
  const category = text(options.category, 60)
  if (category) conditions.push(eq(smsAssets.category, category))
  const limit = Math.min(Math.max(Math.floor(Number(options.limit ?? 50) || 50), 1), 200)
  const rows = await db.select().from(smsAssets)
    .where(and(...conditions))
    .orderBy(desc(smsAssets.createdAt))
    .limit(limit)
  return rows.map(row => ({ ...row, value: row.value === null ? null : Number(row.value) }))
}

export interface CreateAssetInput {
  assetNo?: unknown
  name?: unknown
  category?: unknown
  location?: unknown
  purchasedAt?: unknown
  value?: unknown
  assignedUserId?: unknown
}

export async function createAsset(actor: SmsActor, input: CreateAssetInput) {
  const organizationId = requireAssetWrite(actor)
  const assetNo = typeof input.assetNo === 'string' ? input.assetNo.trim() : ''
  if (!assetNo || assetNo.length > 40) throw createError({ statusCode: 400, message: 'assetNo must be 1-40 characters' })
  const name = typeof input.name === 'string' ? input.name.trim() : ''
  if (!name || name.length > 120) throw createError({ statusCode: 400, message: 'name must be 1-120 characters' })
  const assignedUserId = optionalId(input.assignedUserId)
  const value = input.value === undefined || input.value === null || input.value === ''
    ? null
    : Number(input.value)
  if (value !== null && (!Number.isFinite(value) || value < 0)) {
    throw createError({ statusCode: 400, message: 'value must be a non-negative number' })
  }

  const [duplicate] = await db.select({ id: smsAssets.id }).from(smsAssets)
    .where(and(eq(smsAssets.organizationId, organizationId), eq(smsAssets.assetNo, assetNo)))
    .limit(1)
  if (duplicate) throw createError({ statusCode: 409, message: `Asset number ${assetNo} already exists` })

  return await db.transaction(async (tx) => {
    const [row] = await tx.insert(smsAssets).values({
      organizationId,
      tenantId: actor.tenantId ?? null,
      assetNo,
      name,
      category: text(input.category, 60),
      status: assignedUserId ? 'in_use' : 'idle',
      assignedUserId,
      location: text(input.location, 120),
      purchasedAt: optionalDate(input.purchasedAt),
      value: value === null ? null : value.toFixed(2)
    }).returning()
    if (!row) throw createError({ statusCode: 500, message: 'Failed to create asset' })
    await tx.insert(smsAssetEvents).values({
      organizationId,
      tenantId: actor.tenantId ?? null,
      assetId: row.id,
      action: 'create',
      fromStatus: null,
      toStatus: row.status,
      actorUserId: actor.userId
    })
    await writeAudit(tx, {
      actorUserId: actor.userId,
      tenantId: actor.tenantId ?? undefined,
      organizationId,
      moduleId: 'sms',
      action: 'asset.create',
      resource: 'assets',
      recordId: row.id,
      after: row,
      source: 'sms-service'
    })
    return { ...row, value: row.value === null ? null : Number(row.value) }
  })
}

export interface TransferAssetInput {
  assetId?: unknown
  status?: unknown
  assignedUserId?: unknown
  location?: unknown
  note?: unknown
}

export async function transferAsset(actor: SmsActor, input: TransferAssetInput) {
  const organizationId = requireAssetWrite(actor)
  const assetId = positiveId(input.assetId, 'assetId')
  const [asset] = await db.select().from(smsAssets)
    .where(and(eq(smsAssets.id, assetId), eq(smsAssets.organizationId, organizationId)))
    .limit(1)
  if (!asset) throw createError({ statusCode: 404, message: 'Asset not found' })

  const nextStatus = input.status === undefined || input.status === null || input.status === ''
    ? asset.status as AssetStatus
    : normalizeAssetStatus(input.status)
  const nextAssignee = input.assignedUserId === undefined
    ? asset.assignedUserId
    : optionalId(input.assignedUserId)
  const nextLocation = input.location === undefined ? asset.location : text(input.location, 120)
  const note = text(input.note, 255)

  if (nextStatus === asset.status && nextAssignee === asset.assignedUserId && nextLocation === asset.location) {
    throw createError({ statusCode: 400, message: 'Nothing to update' })
  }
  if (asset.status === 'disposed') {
    throw createError({ statusCode: 409, message: 'Disposed assets cannot be moved' })
  }

  return await db.transaction(async (tx) => {
    const [row] = await tx.update(smsAssets)
      .set({
        status: nextStatus,
        assignedUserId: nextAssignee,
        location: nextLocation,
        updatedAt: new Date()
      })
      .where(eq(smsAssets.id, assetId))
      .returning()
    await tx.insert(smsAssetEvents).values({
      organizationId,
      tenantId: actor.tenantId ?? null,
      assetId,
      action: nextStatus === 'disposed' ? 'dispose' : 'transfer',
      fromStatus: asset.status,
      toStatus: nextStatus,
      note,
      actorUserId: actor.userId
    })
    await writeAudit(tx, {
      actorUserId: actor.userId,
      tenantId: actor.tenantId ?? undefined,
      organizationId,
      moduleId: 'sms',
      action: 'asset.transfer',
      resource: 'assets',
      recordId: assetId,
      before: { status: asset.status, assignedUserId: asset.assignedUserId, location: asset.location },
      after: { status: nextStatus, assignedUserId: nextAssignee, location: nextLocation, note },
      source: 'sms-service'
    })
    return row
  })
}
