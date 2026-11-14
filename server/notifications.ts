/**
 * SMS notification center (P0).
 *
 * Notifications are organization-scoped, per-recipient rows written inside the
 * same transaction as the business event (attendance alert, leave decision,
 * refund approval) so a rollback never leaves a phantom message.
 *
 * Recipients are always resolved server-side: callers pass a student/class id,
 * never a list of user ids they merely "claim" to own.
 */
import { and, desc, eq, inArray, isNull } from 'drizzle-orm'
import { createError } from 'h3'
import { db, pool, writeAudit } from '../../../server/sdk'
import {
  smsClasses,
  smsGuardians,
  smsNotificationPreferences,
  smsNotifications,
  smsStudentGuardians
} from './database/schema'
import { canUseSms, isSmsAdmin, requireSmsOrganization, type SmsActor } from './context'

export const NOTIFICATION_CATEGORIES = [
  'attendance',
  'leave',
  'finance',
  'approval',
  'academic',
  'system'
] as const
export type NotificationCategory = typeof NOTIFICATION_CATEGORIES[number]

export const NOTIFICATION_STATUSES = ['unread', 'read'] as const
export type NotificationStatus = typeof NOTIFICATION_STATUSES[number]

export interface NotificationInput {
  organizationId: number
  tenantId: number | null
  recipientUserIds: readonly number[]
  category: NotificationCategory
  title: string
  body?: string | null
  link?: string | null
  entityType?: string | null
  entityId?: number | null
}

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0]

export function normalizeNotificationCategory(value: unknown): NotificationCategory {
  if (value === undefined || value === null || value === '') return 'system'
  if (typeof value === 'string' && (NOTIFICATION_CATEGORIES as readonly string[]).includes(value)) {
    return value as NotificationCategory
  }
  throw createError({ statusCode: 400, message: `category must be one of ${NOTIFICATION_CATEGORIES.join(', ')}` })
}

export function normalizeNotificationStatus(value: unknown): NotificationStatus {
  if (value === undefined || value === null || value === '') return 'unread'
  if (value === 'unread' || value === 'read') return value
  throw createError({ statusCode: 400, message: 'status must be unread or read' })
}

function cleanText(value: unknown, max: number): string | null {
  if (typeof value !== 'string') return null
  const text = value.trim()
  return text ? text.slice(0, max) : null
}

/** Only in-app routes are allowed, so the model can never inject an external link. */
function cleanLink(value: unknown): string | null {
  const text = cleanText(value, 255)
  if (!text || !text.startsWith('/') || text.startsWith('//')) return null
  return text
}

/**
 * Insert one row per unique recipient. Returns the number of rows written.
 * Safe to call from inside a business transaction.
 */
export async function createNotifications(
  tx: Tx,
  input: NotificationInput
): Promise<number> {
  const requested = [...new Set(input.recipientUserIds)]
    .filter(id => Number.isSafeInteger(id) && id > 0)
  if (requested.length === 0) return 0
  const title = cleanText(input.title, 160)
  if (!title) return 0
  const body = cleanText(input.body, 1000)
  const link = cleanLink(input.link)
  const entityType = cleanText(input.entityType, 40)
  const entityId = Number.isSafeInteger(input.entityId) && Number(input.entityId) > 0
    ? Number(input.entityId)
    : null

  // 免打扰：同一分类被该用户静音时不写站内信，避免事后过滤导致未读数抖动。
  const muted = await tx.select({ userId: smsNotificationPreferences.userId })
    .from(smsNotificationPreferences)
    .where(and(
      eq(smsNotificationPreferences.organizationId, input.organizationId),
      eq(smsNotificationPreferences.category, input.category),
      eq(smsNotificationPreferences.muted, true),
      inArray(smsNotificationPreferences.userId, requested)
    ))
  const mutedUsers = new Set(muted.map(row => row.userId))
  const recipients = requested.filter(id => !mutedUsers.has(id))
  if (recipients.length === 0) return 0

  await tx.insert(smsNotifications).values(recipients.map(recipientUserId => ({
    organizationId: input.organizationId,
    tenantId: input.tenantId,
    recipientUserId,
    category: input.category,
    title,
    body,
    link,
    entityType,
    entityId,
    status: 'unread' as const
  })))

  // 站内信先落库，外部渠道异步投递且失败不影响业务事务。
  void dispatchExternalNotification({
    recipients,
    category: input.category,
    title,
    body,
    link
  })
  return recipients.length
}

export interface ExternalNotificationPayload {
  recipients: readonly number[]
  category: NotificationCategory
  title: string
  body: string | null
  link: string | null
}

/**
 * 邮件/Webhook 适配器：未配置环境变量时完全 no-op；配置后失败只记录日志。
 * 这样部署方无需改代码即可接入企业微信/邮件网关。
 */
export async function dispatchExternalNotification(payload: ExternalNotificationPayload): Promise<void> {
  const webhook = process.env.SMS_NOTIFICATION_WEBHOOK_URL
  const emailMode = process.env.SMS_NOTIFICATION_EMAIL_MODE
  try {
    if (webhook) {
      await fetch(webhook, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload)
      })
    }
    if (emailMode === 'log') {
      console.info('[sms:notification:email]', payload)
    }
  } catch (error) {
    console.warn('[sms:notification] external delivery failed', error instanceof Error ? error.message : error)
  }
}

// ---------------------------------------------------------------------------
// Recipient resolution (core tables via the SDK pool; no cross-module schema)
// ---------------------------------------------------------------------------

/** Users in the organization whose effective role carries `permission`. */
export async function resolvePermissionRecipients(
  organizationId: number,
  permission: string
): Promise<number[]> {
  const { rows } = await pool.query<{ id: number }>(
    `SELECT DISTINCT u.id
       FROM users u
       JOIN organization_memberships m
         ON m.user_id = u.id AND m.organization_id = $1 AND m.status = 'active'
       JOIN roles r ON r.id = COALESCE(m.role_id, u.role_id)
      WHERE u.deleted_at IS NULL AND u.is_active = true
        AND r.deleted_at IS NULL
        AND (r.permissions @> '["*"]'::jsonb OR r.permissions @> $2::jsonb)`,
    [organizationId, JSON.stringify([permission])]
  )
  return rows.map(row => row.id)
}

/** Users in the organization whose role name is one of `roleNames`. */
export async function resolveRoleRecipients(
  organizationId: number,
  roleNames: readonly string[]
): Promise<number[]> {
  if (roleNames.length === 0) return []
  const { rows } = await pool.query<{ id: number }>(
    `SELECT DISTINCT u.id
       FROM users u
       JOIN organization_memberships m
         ON m.user_id = u.id AND m.organization_id = $1 AND m.status = 'active'
       JOIN roles r ON r.id = COALESCE(m.role_id, u.role_id)
      WHERE u.deleted_at IS NULL AND u.is_active = true
        AND r.deleted_at IS NULL
        AND r.name = ANY($2::text[])`,
    [organizationId, [...roleNames]]
  )
  return rows.map(row => row.id)
}

/** Linked guardian users for a student. */
export async function studentGuardianRecipients(
  organizationId: number,
  studentId: number
): Promise<number[]> {
  const rows = await db.selectDistinct({ userId: smsGuardians.userId })
    .from(smsStudentGuardians)
    .innerJoin(smsGuardians, and(
      eq(smsGuardians.id, smsStudentGuardians.guardianId),
      eq(smsGuardians.organizationId, organizationId),
      isNull(smsGuardians.deletedAt)
    ))
    .where(and(
      eq(smsStudentGuardians.organizationId, organizationId),
      eq(smsStudentGuardians.studentId, studentId)
    ))
  return rows.map(row => row.userId)
}

/** Homeroom teacher of a class, when set. */
export async function classHomeroomRecipient(
  organizationId: number,
  classId: number
): Promise<number | null> {
  const [row] = await db.select({ homeroomUserId: smsClasses.homeroomUserId })
    .from(smsClasses)
    .where(and(
      eq(smsClasses.id, classId),
      eq(smsClasses.organizationId, organizationId),
      isNull(smsClasses.deletedAt)
    ))
    .limit(1)
  return row?.homeroomUserId ?? null
}

/** Homeroom teacher + linked guardians, deduplicated. */
export async function studentNotificationRecipients(
  organizationId: number,
  studentId: number,
  classId: number | null
): Promise<number[]> {
  const [guardians, homeroom] = await Promise.all([
    studentGuardianRecipients(organizationId, studentId),
    classId ? classHomeroomRecipient(organizationId, classId) : Promise.resolve(null)
  ])
  return [...new Set([...guardians, ...(homeroom ? [homeroom] : [])])]
}

// ---------------------------------------------------------------------------
// Reads / personal actions
// ---------------------------------------------------------------------------

function requireNotificationRead(actor: SmsActor): number {
  const organizationId = requireSmsOrganization(actor)
  if (!canUseSms(actor, 'read', 'notifications')) {
    throw createError({ statusCode: 403, statusMessage: 'Forbidden', message: 'No permission to read notifications' })
  }
  return organizationId
}

export function canSendNotification(actor: SmsActor): boolean {
  if (isSmsAdmin(actor)) return true
  return (actor.permissions ?? []).includes('sms.notifications.send')
}

function requireNotificationSend(actor: SmsActor): number {
  const organizationId = requireSmsOrganization(actor)
  if (!canSendNotification(actor)) {
    throw createError({ statusCode: 403, statusMessage: 'Forbidden', message: 'No permission to send notifications' })
  }
  return organizationId
}

export interface NotificationListQuery {
  status?: unknown
  category?: unknown
  limit?: unknown
}

export async function listNotifications(actor: SmsActor, options: NotificationListQuery = {}) {
  const organizationId = requireNotificationRead(actor)
  const conditions = [
    eq(smsNotifications.organizationId, organizationId),
    eq(smsNotifications.recipientUserId, actor.userId)
  ]
  if (options.status !== undefined && options.status !== null && options.status !== ''
    && options.status !== 'all') {
    conditions.push(eq(smsNotifications.status, normalizeNotificationStatus(options.status)))
  }
  if (options.category !== undefined && options.category !== null && options.category !== '') {
    conditions.push(eq(smsNotifications.category, normalizeNotificationCategory(options.category)))
  }
  const limit = Math.min(Math.max(Math.floor(Number(options.limit ?? 50) || 50), 1), 200)
  return await db.select({
    id: smsNotifications.id,
    category: smsNotifications.category,
    title: smsNotifications.title,
    body: smsNotifications.body,
    link: smsNotifications.link,
    entityType: smsNotifications.entityType,
    entityId: smsNotifications.entityId,
    status: smsNotifications.status,
    createdAt: smsNotifications.createdAt,
    readAt: smsNotifications.readAt
  }).from(smsNotifications)
    .where(and(...conditions))
    .orderBy(desc(smsNotifications.createdAt))
    .limit(limit)
}

export async function unreadNotificationCount(actor: SmsActor): Promise<number> {
  const organizationId = requireNotificationRead(actor)
  const rows = await db.select({ id: smsNotifications.id })
    .from(smsNotifications)
    .where(and(
      eq(smsNotifications.organizationId, organizationId),
      eq(smsNotifications.recipientUserId, actor.userId),
      eq(smsNotifications.status, 'unread')
    ))
  return rows.length
}

/** Only the recipient may mark a notification read (others get a 404). */
export async function markNotificationRead(actor: SmsActor, notificationId: number) {
  const organizationId = requireNotificationRead(actor)
  const [row] = await db.select({ id: smsNotifications.id })
    .from(smsNotifications)
    .where(and(
      eq(smsNotifications.id, notificationId),
      eq(smsNotifications.organizationId, organizationId),
      eq(smsNotifications.recipientUserId, actor.userId)
    ))
    .limit(1)
  if (!row) throw createError({ statusCode: 404, message: 'Notification not found' })

  await db.update(smsNotifications)
    .set({ status: 'read', readAt: new Date() })
    .where(eq(smsNotifications.id, notificationId))
  return { id: notificationId, status: 'read' as const }
}

export async function markAllNotificationsRead(actor: SmsActor) {
  const organizationId = requireNotificationRead(actor)
  const rows = await db.update(smsNotifications)
    .set({ status: 'read', readAt: new Date() })
    .where(and(
      eq(smsNotifications.organizationId, organizationId),
      eq(smsNotifications.recipientUserId, actor.userId),
      eq(smsNotifications.status, 'unread')
    ))
    .returning({ id: smsNotifications.id })
  return { updated: rows.length }
}

// ---------------------------------------------------------------------------
// Sending
// ---------------------------------------------------------------------------

export interface SendNotificationInput {
  title?: unknown
  body?: unknown
  category?: unknown
  recipientUserIds?: unknown
  roleNames?: unknown
  link?: unknown
}

function normalizeIdList(value: unknown): number[] {
  if (value === undefined || value === null) return []
  if (!Array.isArray(value)) throw createError({ statusCode: 400, message: 'recipientUserIds must be an array' })
  return value
    .map(Number)
    .filter(id => Number.isSafeInteger(id) && id > 0)
}

function normalizeRoleList(value: unknown): string[] {
  if (value === undefined || value === null) return []
  if (!Array.isArray(value)) throw createError({ statusCode: 400, message: 'roleNames must be an array' })
  return value
    .filter((role): role is string => typeof role === 'string' && role.trim().length > 0)
    .map(role => role.trim().slice(0, 50))
}

async function filterOrganizationMembers(organizationId: number, userIds: readonly number[]): Promise<number[]> {
  if (userIds.length === 0) return []
  const { rows } = await pool.query<{ user_id: number }>(
    `SELECT user_id FROM organization_memberships
      WHERE organization_id = $1 AND status = 'active' AND user_id = ANY($2::int[])`,
    [organizationId, [...userIds]]
  )
  return rows.map(row => row.user_id)
}

export async function sendNotification(actor: SmsActor, input: SendNotificationInput) {
  const organizationId = requireNotificationSend(actor)
  const title = cleanText(input.title, 160)
  if (!title) throw createError({ statusCode: 400, message: 'title 不能为空' })
  const body = cleanText(input.body, 1000)
  const category = normalizeNotificationCategory(input.category)
  const link = cleanLink(input.link)

  const explicit = normalizeIdList(input.recipientUserIds)
  const roles = normalizeRoleList(input.roleNames)
  const [allowedExplicit, roleRecipients] = await Promise.all([
    filterOrganizationMembers(organizationId, explicit),
    resolveRoleRecipients(organizationId, roles)
  ])
  const recipients = [...new Set([...allowedExplicit, ...roleRecipients])]
  if (recipients.length === 0) {
    throw createError({ statusCode: 400, message: '没有可发送的收件人' })
  }

  return await db.transaction(async (tx) => {
    const written = await createNotifications(tx, {
      organizationId,
      tenantId: actor.tenantId ?? null,
      recipientUserIds: recipients,
      category,
      title,
      body,
      link,
      entityType: 'manual',
      entityId: null
    })
    await writeAudit(tx, {
      actorUserId: actor.userId,
      tenantId: actor.tenantId ?? undefined,
      organizationId,
      moduleId: 'sms',
      action: 'notification.send',
      resource: 'notifications',
      recordId: 0,
      after: { title, category, recipients: written, link },
      source: 'sms-service'
    })
    return { sent: written, recipients }
  })
}

// ---------------------------------------------------------------------------
// Business-event helpers (called inside existing transactions)
// ---------------------------------------------------------------------------

export async function notifyLeaveSubmitted(
  tx: Tx,
  input: {
    organizationId: number
    tenantId: number | null
    leaveId: number
    applicantUserId: number
    assigneeUserId: number | null
    days: number
  }
): Promise<number> {
  const recipients = input.assigneeUserId
    ? [input.assigneeUserId]
    : await resolvePermissionRecipients(input.organizationId, 'sms.leave.approve')
  return await createNotifications(tx, {
    organizationId: input.organizationId,
    tenantId: input.tenantId,
    recipientUserIds: recipients,
    category: 'leave',
    title: `新的请假申请（${input.days} 天）`,
    body: '有新的请假申请待审批，请及时处理。',
    link: '/sms',
    entityType: 'leave',
    entityId: input.leaveId
  })
}

export async function notifyLeaveDecided(
  tx: Tx,
  input: {
    organizationId: number
    tenantId: number | null
    leaveId: number
    applicantUserId: number
    status: 'approved' | 'rejected' | 'pending'
    comment?: string | null
  }
): Promise<number> {
  const title = input.status === 'approved'
    ? '请假已通过'
    : input.status === 'rejected'
      ? '请假未通过'
      : '请假进入下一步审批'
  return await createNotifications(tx, {
    organizationId: input.organizationId,
    tenantId: input.tenantId,
    recipientUserIds: [input.applicantUserId],
    category: 'leave',
    title,
    body: input.comment ?? null,
    link: '/sms',
    entityType: 'leave',
    entityId: input.leaveId
  })
}

export async function notifyRefundRequested(
  tx: Tx,
  input: {
    organizationId: number
    tenantId: number | null
    refundId: number
    amount: string | number
  }
): Promise<number> {
  const recipients = await resolvePermissionRecipients(input.organizationId, 'sms.finance.refund-approve')
  return await createNotifications(tx, {
    organizationId: input.organizationId,
    tenantId: input.tenantId,
    recipientUserIds: recipients,
    category: 'finance',
    title: `新的退费申请（${Number(input.amount).toFixed(2)} 元）`,
    body: '退费申请需要第二位审批人确认。',
    link: '/sms',
    entityType: 'refund',
    entityId: input.refundId
  })
}

export async function notifyRefundDecided(
  tx: Tx,
  input: {
    organizationId: number
    tenantId: number | null
    refundId: number
    requesterUserId: number
    status: 'approved' | 'rejected'
  }
): Promise<number> {
  return await createNotifications(tx, {
    organizationId: input.organizationId,
    tenantId: input.tenantId,
    recipientUserIds: [input.requesterUserId],
    category: 'finance',
    title: input.status === 'approved' ? '退费已通过' : '退费被驳回',
    body: null,
    link: '/sms',
    entityType: 'refund',
    entityId: input.refundId
  })
}

export async function notifyAttendanceAlerts(
  tx: Tx,
  input: {
    organizationId: number
    tenantId: number | null
    studentId: number
    classId: number | null
    studentName?: string | null
    alertCount: number
  }
): Promise<number> {
  if (input.alertCount <= 0) return 0
  const recipients = await studentNotificationRecipients(
    input.organizationId,
    input.studentId,
    input.classId
  )
  return await createNotifications(tx, {
    organizationId: input.organizationId,
    tenantId: input.tenantId,
    recipientUserIds: recipients,
    category: 'attendance',
    title: `考勤预警：${input.studentName ?? `学生 #${input.studentId}`}`,
    body: `新增 ${input.alertCount} 条考勤预警，请查看并跟进。`,
    link: '/sms',
    entityType: 'attendance',
    entityId: input.studentId
  })
}

// ---------------------------------------------------------------------------
// Personal preferences (per-user, per-category mute)
// ---------------------------------------------------------------------------

export interface NotificationPreference {
  category: NotificationCategory
  muted: boolean
}

/** 返回全部分类（默认未静音），前端无需自行补齐缺失分类。 */
export async function getNotificationPreferences(actor: SmsActor): Promise<NotificationPreference[]> {
  const organizationId = requireNotificationRead(actor)
  const rows = await db.select({
    category: smsNotificationPreferences.category,
    muted: smsNotificationPreferences.muted
  }).from(smsNotificationPreferences)
    .where(and(
      eq(smsNotificationPreferences.organizationId, organizationId),
      eq(smsNotificationPreferences.userId, actor.userId)
    ))
  const stored = new Map(rows.map(row => [row.category, row.muted]))
  return NOTIFICATION_CATEGORIES.map(category => ({
    category,
    muted: stored.get(category) ?? false
  }))
}

export interface UpdateNotificationPreferencesInput {
  preferences?: unknown
}

export async function updateNotificationPreferences(
  actor: SmsActor,
  input: UpdateNotificationPreferencesInput
): Promise<NotificationPreference[]> {
  const organizationId = requireNotificationRead(actor)
  const entries = Array.isArray(input.preferences) ? input.preferences : []
  if (entries.length === 0) {
    throw createError({ statusCode: 400, message: 'preferences 必须是非空数组' })
  }
  const normalized = entries.map((entry) => {
    if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) {
      throw createError({ statusCode: 400, message: 'preferences 每项必须是对象' })
    }
    const row = entry as Record<string, unknown>
    return {
      category: normalizeNotificationCategory(row.category),
      muted: row.muted === true
    }
  })
  const unique = new Map(normalized.map(item => [item.category, item.muted]))

  for (const [category, muted] of unique) {
    await db.insert(smsNotificationPreferences).values({
      organizationId,
      userId: actor.userId,
      category,
      muted
    }).onConflictDoUpdate({
      target: [
        smsNotificationPreferences.organizationId,
        smsNotificationPreferences.userId,
        smsNotificationPreferences.category
      ],
      set: { muted, updatedAt: new Date() }
    })
  }
  return await getNotificationPreferences(actor)
}
