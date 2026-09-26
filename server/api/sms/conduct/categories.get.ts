/**
 * Conduct categories — the published rule book's chapters.
 *
 * Anonymous is allowed on purpose: a school's code of conduct is public, and a
 * parent should be able to read the rules without an account. Only retired
 * categories are hidden; the chapter order is the school's `sort_order`.
 */
import { asc, isNull } from 'drizzle-orm'
import * as sms from '../../../database/schema'
import { conductCategoryQuery } from '../../../utils/dto'

export default defineEventHandler(async () => {
  const items = await conductCategoryQuery()
    .where(isNull(sms.conductCategories.deletedAt))
    .orderBy(asc(sms.conductCategories.sortOrder), asc(sms.conductCategories.name))

  return { items }
})
