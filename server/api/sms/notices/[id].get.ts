/**
 * School — a single notice.
 *
 * Published notices are public; a draft (no `publishedAt`, or one scheduled for
 * the future) is only readable by staff. An unpublished notice answers 404 for
 * everyone else rather than 403, so an anonymous visitor cannot use this route to
 * enumerate which drafts exist.
 */
import { and, eq, isNull } from 'drizzle-orm'
import * as sms from '../../../database/schema'
import { getSmsViewer, isStaff } from '../../../utils/access'
import { noticeQuery, noticeToDTO } from '../../../utils/dto'
import { intParam } from '../../../utils/http'

export default defineEventHandler(async (event) => {
  const id = intParam(getRouterParam(event, 'id'))
  if (id == null) throw createError({ statusCode: 404, statusMessage: 'Notice not found' })

  const [row] = await noticeQuery()
    .where(and(eq(sms.notices.id, id), isNull(sms.notices.deletedAt)))
    .limit(1)

  const notice = row ? noticeToDTO(row) : null
  const published = notice?.publishedAt != null && new Date(notice.publishedAt) <= new Date()
  if (!notice || (!published && !isStaff(await getSmsViewer(event)))) {
    throw createError({ statusCode: 404, statusMessage: 'Notice not found' })
  }

  return { notice }
})
