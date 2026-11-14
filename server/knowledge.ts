/**
 * School-rule knowledge base (P1).
 *
 * This is a keyword RAG layer rather than an embedding store: retrieval is
 * deterministic, auditable and does not depend on an external model. Results are
 * filtered by audience so student/guardian-facing chat cannot quote staff-only
 * policies.
 */
import { and, desc, eq, ilike, inArray, or } from 'drizzle-orm'
import { createError } from 'h3'
import { db, writeAudit } from '../../../server/sdk'
import { smsKnowledgeArticles } from './database/schema'
import { canUseSms, isSmsAdmin, requireSmsOrganization, type SmsActor } from './context'

export const KNOWLEDGE_AUDIENCES = ['all', 'staff', 'student', 'guardian'] as const
export type KnowledgeAudience = typeof KNOWLEDGE_AUDIENCES[number]

export const KNOWLEDGE_STATUSES = ['published', 'draft', 'archived'] as const
export type KnowledgeStatus = typeof KNOWLEDGE_STATUSES[number]

export function normalizeKnowledgeAudience(value: unknown): KnowledgeAudience {
  if (value === undefined || value === null || value === '') return 'all'
  if (typeof value === 'string' && (KNOWLEDGE_AUDIENCES as readonly string[]).includes(value)) {
    return value as KnowledgeAudience
  }
  throw createError({ statusCode: 400, message: `audience must be one of ${KNOWLEDGE_AUDIENCES.join(', ')}` })
}

export function normalizeKnowledgeStatus(value: unknown): KnowledgeStatus {
  if (value === undefined || value === null || value === '') return 'published'
  if (typeof value === 'string' && (KNOWLEDGE_STATUSES as readonly string[]).includes(value)) {
    return value as KnowledgeStatus
  }
  throw createError({ statusCode: 400, message: `status must be one of ${KNOWLEDGE_STATUSES.join(', ')}` })
}

/** Audience filter for the viewer's role. */
export function knowledgeAudiencesFor(roleName: string | null | undefined): KnowledgeAudience[] {
  if (roleName === 'student') return ['all', 'student']
  if (roleName === 'guardian') return ['all', 'guardian']
  return ['all', 'staff']
}

function requireKnowledgeRead(actor: SmsActor): number {
  const organizationId = requireSmsOrganization(actor)
  if (!canUseSms(actor, 'read', 'knowledge')) {
    throw createError({ statusCode: 403, statusMessage: 'Forbidden', message: 'No permission to read the knowledge base' })
  }
  return organizationId
}

function requireKnowledgeWrite(actor: SmsActor): number {
  const organizationId = requireSmsOrganization(actor)
  if (!isSmsAdmin(actor) && !(actor.permissions ?? []).includes('sms.knowledge.create')) {
    throw createError({ statusCode: 403, statusMessage: 'Forbidden', message: 'No permission to edit the knowledge base' })
  }
  return organizationId
}

export interface KnowledgeQuery {
  query?: unknown
  tags?: unknown
  limit?: unknown
}

export async function searchKnowledge(actor: SmsActor, options: KnowledgeQuery = {}) {
  const organizationId = requireKnowledgeRead(actor)
  const conditions = [
    eq(smsKnowledgeArticles.organizationId, organizationId),
    eq(smsKnowledgeArticles.status, 'published'),
    inArray(smsKnowledgeArticles.audience, knowledgeAudiencesFor(actor.roleName))
  ]
  if (typeof options.query === 'string' && options.query.trim()) {
    const pattern = `%${options.query.trim().slice(0, 80)}%`
    const keyword = or(
      ilike(smsKnowledgeArticles.title, pattern),
      ilike(smsKnowledgeArticles.content, pattern),
      ilike(smsKnowledgeArticles.tags, pattern)
    )
    if (keyword) conditions.push(keyword)
  }
  if (typeof options.tags === 'string' && options.tags.trim()) {
    const tags = `%${options.tags.trim().slice(0, 80)}%`
    const tagFilter = ilike(smsKnowledgeArticles.tags, tags)
    if (tagFilter) conditions.push(tagFilter)
  }

  const limit = Math.min(Math.max(Math.floor(Number(options.limit ?? 10) || 10), 1), 50)
  const rows = await db.select({
    id: smsKnowledgeArticles.id,
    title: smsKnowledgeArticles.title,
    content: smsKnowledgeArticles.content,
    tags: smsKnowledgeArticles.tags,
    audience: smsKnowledgeArticles.audience,
    updatedAt: smsKnowledgeArticles.updatedAt
  }).from(smsKnowledgeArticles)
    .where(and(...conditions))
    .orderBy(desc(smsKnowledgeArticles.updatedAt))
    .limit(limit)

  return rows.map(row => ({
    id: row.id,
    title: row.title,
    snippet: row.content.slice(0, 240),
    tags: row.tags,
    audience: row.audience,
    updatedAt: row.updatedAt,
    // 引用信息随结果返回，聊天回答可以注明“出自哪篇文章、何时更新”。
    citation: { id: row.id, title: row.title, updatedAt: row.updatedAt }
  }))
}

export interface CreateKnowledgeInput {
  title?: unknown
  content?: unknown
  tags?: unknown
  audience?: unknown
  status?: unknown
}

export async function createKnowledgeArticle(actor: SmsActor, input: CreateKnowledgeInput) {
  const organizationId = requireKnowledgeWrite(actor)
  const title = typeof input.title === 'string' ? input.title.trim().slice(0, 200) : ''
  const content = typeof input.content === 'string' ? input.content.trim().slice(0, 20_000) : ''
  if (!title) throw createError({ statusCode: 400, message: 'title 不能为空' })
  if (!content) throw createError({ statusCode: 400, message: 'content 不能为空' })
  const tags = typeof input.tags === 'string' ? input.tags.trim().slice(0, 255) : null
  const audience = normalizeKnowledgeAudience(input.audience)
  const status = normalizeKnowledgeStatus(input.status)

  return await db.transaction(async (tx) => {
    const [row] = await tx.insert(smsKnowledgeArticles).values({
      organizationId,
      tenantId: actor.tenantId ?? null,
      title,
      content,
      tags,
      audience,
      status,
      createdBy: actor.userId
    }).returning()
    if (!row) throw createError({ statusCode: 500, message: 'Failed to create knowledge article' })
    await writeAudit(tx, {
      actorUserId: actor.userId,
      tenantId: actor.tenantId ?? undefined,
      organizationId,
      moduleId: 'sms',
      action: 'knowledge.create',
      resource: 'knowledge',
      recordId: row.id,
      after: { title, audience, status },
      source: 'sms-service'
    })
    return row
  })
}

export interface UpdateKnowledgeInput {
  articleId?: unknown
  title?: unknown
  content?: unknown
  tags?: unknown
  audience?: unknown
  status?: unknown
  /** archive = 下架（保留文章与引用记录，不再对检索可见）。 */
  action?: unknown
}

/** 编辑或下架文章；下架只改状态，不物理删除，保证引用可追溯。 */
export async function updateKnowledgeArticle(actor: SmsActor, input: UpdateKnowledgeInput) {
  const organizationId = requireKnowledgeWrite(actor)
  const articleId = Number(input.articleId)
  if (!Number.isSafeInteger(articleId) || articleId <= 0) {
    throw createError({ statusCode: 400, message: 'articleId 必须是正整数' })
  }
  const [current] = await db.select().from(smsKnowledgeArticles)
    .where(and(
      eq(smsKnowledgeArticles.id, articleId),
      eq(smsKnowledgeArticles.organizationId, organizationId)
    ))
    .limit(1)
  if (!current) throw createError({ statusCode: 404, message: 'Knowledge article not found' })

  const patch: Record<string, unknown> = { updatedAt: new Date() }
  if (input.title !== undefined) {
    const title = typeof input.title === 'string' ? input.title.trim().slice(0, 200) : ''
    if (!title) throw createError({ statusCode: 400, message: 'title 不能为空' })
    patch.title = title
  }
  if (input.content !== undefined) {
    const content = typeof input.content === 'string' ? input.content.trim().slice(0, 20_000) : ''
    if (!content) throw createError({ statusCode: 400, message: 'content 不能为空' })
    patch.content = content
  }
  if (input.tags !== undefined) {
    patch.tags = typeof input.tags === 'string' ? input.tags.trim().slice(0, 255) : null
  }
  if (input.audience !== undefined) patch.audience = normalizeKnowledgeAudience(input.audience)
  if (input.status !== undefined) patch.status = normalizeKnowledgeStatus(input.status)

  const archive = input.action === 'archive'
  if (archive) patch.status = 'archived'
  if (Object.keys(patch).length === 1) {
    throw createError({ statusCode: 400, message: '没有需要更新的字段' })
  }

  return await db.transaction(async (tx) => {
    const [row] = await tx.update(smsKnowledgeArticles)
      .set(patch)
      .where(and(
        eq(smsKnowledgeArticles.id, articleId),
        eq(smsKnowledgeArticles.organizationId, organizationId)
      ))
      .returning()
    await writeAudit(tx, {
      actorUserId: actor.userId,
      tenantId: actor.tenantId ?? undefined,
      organizationId,
      moduleId: 'sms',
      action: archive ? 'knowledge.archive' : 'knowledge.update',
      resource: 'knowledge',
      recordId: articleId,
      before: { title: current.title, status: current.status, audience: current.audience },
      after: { title: row?.title, status: row?.status, audience: row?.audience },
      source: 'sms-service'
    })
    return row ?? null
  })
}
