/**
 * School — create or update an article.
 *
 * Staff-only, and one route for both because the editor posts the same fields
 * either way; the presence of `id` decides. The slug is derived from the title
 * rather than accepted from the client: a public URL should not be something a
 * form can set to `../../etc`. Uniqueness is resolved with a numeric suffix so a
 * second article called "Sports Day" gets `sports-day-2` instead of a 500 from
 * the unique index.
 */
import { and, eq, isNull } from 'drizzle-orm'
import { db } from '../../../../../../server/database'
import * as sms from '../../../database/schema'
import { assertStaff, getSmsViewer } from '../../../utils/access'
import { articleQuery, articleToDTO } from '../../../utils/dto'
import { intParam, textParam } from '../../../utils/http'

/** Lowercase, drop anything that is not a letter or a digit, join with dashes. */
function slugify(value: string): string {
  const slug = value
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 300)
  return slug || 'article'
}

/** A slug nobody else holds; `excludeId` lets an update keep its own. */
async function uniqueSlug(base: string, excludeId: number | null): Promise<string> {
  let candidate = base
  for (let suffix = 2; suffix < 500; suffix++) {
    const [existing] = await db
      .select({ id: sms.articles.id })
      .from(sms.articles)
      .where(eq(sms.articles.slug, candidate))
      .limit(1)
    if (!existing || existing.id === excludeId) return candidate
    candidate = `${base}-${suffix}`
  }
  return `${base}-${Date.now()}`
}

export default defineEventHandler(async (event) => {
  const viewer = await getSmsViewer(event)
  assertStaff(viewer)

  const payload = (await readBody<Record<string, unknown>>(event)) ?? {}
  const title = textParam(payload.title, 300)
  if (!title) throw createError({ statusCode: 400, statusMessage: 'title is required' })

  const id = intParam(payload.id)
  const summary = textParam(payload.summary, 500)
  const body = textParam(payload.body, 50000)
  const cover = textParam(payload.cover, 500)
  const slug = await uniqueSlug(slugify(title), id)

  if (id != null) {
    const [existing] = await db
      .select({ id: sms.articles.id })
      .from(sms.articles)
      .where(and(eq(sms.articles.id, id), isNull(sms.articles.deletedAt)))
      .limit(1)
    if (!existing) throw createError({ statusCode: 404, statusMessage: 'Article not found' })

    await db
      .update(sms.articles)
      .set({ title, slug, summary, body, cover, updatedAt: new Date() })
      .where(eq(sms.articles.id, id))

    const [row] = await articleQuery().where(eq(sms.articles.id, id)).limit(1)
    return { article: articleToDTO(row!) }
  }

  const [inserted] = await db
    .insert(sms.articles)
    .values({
      title,
      slug,
      summary,
      body,
      cover,
      // Creating an article publishes it; a draft is what the back office is for.
      publishedAt: new Date(),
      authorId: viewer.userId
    })
    .returning({ id: sms.articles.id })

  const [row] = await articleQuery().where(eq(sms.articles.id, inserted!.id)).limit(1)
  return { article: articleToDTO(row!) }
})
