/**
 * School — one article, by slug.
 *
 * The slug is the public URL, so this is the route a search engine crawls.
 * Published articles are public; a draft is staff-only and answers 404 for
 * everyone else, matching `notices/[id].get.ts`. The read counter is bumped on a
 * best-effort basis: a failed increment must not cost the reader the article, so
 * the update is fired and forgotten rather than awaited.
 */
import { and, eq, isNull, sql } from 'drizzle-orm'
import { db } from '../../../../../../server/database'
import * as sms from '../../../database/schema'
import { getSmsViewer, isStaff } from '../../../utils/access'
import { articleQuery, articleToDTO } from '../../../utils/dto'

export default defineEventHandler(async (event) => {
  const slug = String(getRouterParam(event, 'slug') ?? '').trim()
  if (!slug) throw createError({ statusCode: 404, statusMessage: 'Article not found' })

  const [row] = await articleQuery()
    .where(and(eq(sms.articles.slug, slug), isNull(sms.articles.deletedAt)))
    .limit(1)

  const article = row ? articleToDTO(row) : null
  const published = article?.publishedAt != null && new Date(article.publishedAt) <= new Date()
  if (!article || (!published && !isStaff(await getSmsViewer(event)))) {
    throw createError({ statusCode: 404, statusMessage: 'Article not found' })
  }

  void db
    .update(sms.articles)
    .set({ readCount: sql`${sms.articles.readCount} + 1` })
    .where(eq(sms.articles.id, article.id))
    .catch(() => {})

  return { article }
})
