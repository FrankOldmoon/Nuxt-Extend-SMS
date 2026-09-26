/**
 * Conduct record — retract one.
 *
 * Soft-deleted: a conduct record is part of a student's file, and a teacher who
 * removes one should leave a traceable gap rather than an invisible edit. Staff
 * only, matching the write rule for conduct.
 */
import { and, eq, isNull } from 'drizzle-orm'
import { db } from '../../../../../../../server/database'
import * as sms from '../../../../database/schema'
import { assertStaff, getSmsViewer } from '../../../../utils/access'
import { intParam } from '../../../../utils/http'

export default defineEventHandler(async (event) => {
  const id = intParam(getRouterParam(event, 'id'))
  if (!id) throw createError({ statusCode: 400, statusMessage: 'Invalid record id' })

  const viewer = await getSmsViewer(event)
  assertStaff(viewer)

  const [record] = await db
    .select({ id: sms.conductRecords.id })
    .from(sms.conductRecords)
    .where(and(eq(sms.conductRecords.id, id), isNull(sms.conductRecords.deletedAt)))
    .limit(1)
  if (!record) throw createError({ statusCode: 404, statusMessage: 'Conduct record not found' })

  const now = new Date()
  await db
    .update(sms.conductRecords)
    .set({ deletedAt: now, updatedAt: now })
    .where(eq(sms.conductRecords.id, id))

  return { ok: true }
})
