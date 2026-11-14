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

// ---------------------------------------------------------------------------
// 可选语义检索（不依赖 pgvector）
// ---------------------------------------------------------------------------

/**
 * 调用外部 embedding 服务。未配置 `SMS_KB_EMBEDDING_ENDPOINT` 时返回 null，
 * 检索自动回退到 pg_trgm / ILIKE 关键词模式。
 */
export async function embedKnowledgeText(text: string): Promise<number[] | null> {
  const endpoint = process.env.SMS_KB_EMBEDDING_ENDPOINT
  if (!endpoint) return null
  const headers: Record<string, string> = { 'content-type': 'application/json' }
  const token = process.env.SMS_KB_EMBEDDING_TOKEN
  if (token) headers.authorization = `Bearer ${token}`
  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers,
      body: JSON.stringify({ input: text.slice(0, 4000) }),
      signal: AbortSignal.timeout(5000)
    })
    if (!response.ok) return null
    const data = await response.json() as unknown
    const vector = Array.isArray(data)
      ? data
      : (data as { embedding?: unknown }).embedding
        ?? (data as { data?: Array<{ embedding?: unknown }> }).data?.[0]?.embedding
    if (!Array.isArray(vector) || vector.length === 0) return null
    return vector.every(value => typeof value === 'number') ? vector as number[] : null
  } catch {
    // 外部服务不可用时静默降级，不能让检索整体失败。
    return null
  }
}

/** 余弦相似度；维度不一致或零向量返回 0。 */
export function cosineSimilarity(a: readonly number[], b: readonly number[]): number {
  if (a.length === 0 || a.length !== b.length) return 0
  let dot = 0
  let normA = 0
  let normB = 0
  for (let index = 0; index < a.length; index++) {
    const x = a[index] ?? 0
    const y = b[index] ?? 0
    dot += x * y
    normA += x * x
    normB += y * y
  }
  if (normA === 0 || normB === 0) return 0
  return dot / (Math.sqrt(normA) * Math.sqrt(normB))
}

/** 写入文章向量；配置缺失或调用失败时保持原值不变。 */
async function refreshArticleEmbedding(articleId: number, title: string, content: string): Promise<void> {
  try {
    const vector = await embedKnowledgeText(`${title}\n${content}`)
    if (!vector) return
    await db.update(smsKnowledgeArticles)
      .set({ embedding: vector })
      .where(eq(smsKnowledgeArticles.id, articleId))
  } catch {
    // 向量写入失败不影响文章本身，检索会退回关键词模式。
  }
}

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
  /** 管理端按状态筛选（published/draft/archived）；普通读者固定只读已发布。 */
  status?: unknown
}

export async function searchKnowledge(actor: SmsActor, options: KnowledgeQuery = {}) {
  const organizationId = requireKnowledgeRead(actor)
  const canManage = isSmsAdmin(actor) || (actor.permissions ?? []).includes('sms.knowledge.create')
  const statusFilter = canManage && typeof options.status === 'string' && options.status.trim()
    ? normalizeKnowledgeStatus(options.status)
    : 'published'
  const conditions = [
    eq(smsKnowledgeArticles.organizationId, organizationId),
    eq(smsKnowledgeArticles.status, statusFilter),
    inArray(smsKnowledgeArticles.audience, knowledgeAudiencesFor(actor.roleName))
  ]
  const queryText = typeof options.query === 'string' ? options.query.trim().slice(0, 200) : ''
  // 配置了 embedding 时走“候选集 + JS 余弦重排”；否则保留关键词过滤兜底。
  const semantic = Boolean(process.env.SMS_KB_EMBEDDING_ENDPOINT) && Boolean(queryText)
  if (queryText && !semantic) {
    const pattern = `%${queryText.slice(0, 80)}%`
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
    updatedAt: smsKnowledgeArticles.updatedAt,
    embedding: smsKnowledgeArticles.embedding
  }).from(smsKnowledgeArticles)
    .where(and(...conditions))
    .orderBy(desc(smsKnowledgeArticles.updatedAt))
    .limit(semantic ? 200 : limit)

  let ranked = rows
  if (semantic) {
    const queryVector = await embedKnowledgeText(queryText)
    if (queryVector) {
      ranked = rows
        .map(row => ({
          row,
          score: row.embedding ? cosineSimilarity(queryVector, row.embedding) : -1
        }))
        .sort((a, b) => b.score - a.score)
        .slice(0, limit)
        .map(item => item.row)
    } else {
      ranked = rows.slice(0, limit)
    }
  }

  return ranked.map(row => ({
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

  const created = await db.transaction(async (tx) => {
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
  await refreshArticleEmbedding(created.id, created.title, created.content)
  return created
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

  const updated = await db.transaction(async (tx) => {
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
  if (updated && (input.title !== undefined || input.content !== undefined)) {
    await refreshArticleEmbedding(updated.id, updated.title, updated.content)
  }
  return updated
}
