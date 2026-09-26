/**
 * Conduct rules — the individual clauses.
 *
 * Public like the categories (the rule book is meant to be readable). `?kind`
 * filters through the rule's category, because a rule has no direction of its
 * own: the category decides whether its points are a merit or a demerit.
 */
import { and, asc, eq, isNull } from 'drizzle-orm'
import * as sms from '../../../database/schema'
import { conductRuleQuery } from '../../../utils/dto'
import { textParam } from '../../../utils/http'

export default defineEventHandler(async (event) => {
  const query = getQuery(event) as Record<string, unknown>

  const conditions: Array<ReturnType<typeof and>> = [isNull(sms.conductRules.deletedAt)]
  const kind = textParam(query.kind, 20)
  if (kind) conditions.push(eq(sms.conductCategories.kind, kind))

  const items = await conductRuleQuery()
    .where(and(...conditions))
    .orderBy(asc(sms.conductRules.sortOrder), asc(sms.conductRules.name))

  return { items }
})
