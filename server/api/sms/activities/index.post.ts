/**
 * School — create or update an activity.
 *
 * Staff-only; one route for both, keyed on `id` as the article editor is. The
 * times are ISO instants rather than calendar dates: an activity happens at a
 * moment (and possibly across a timezone), so parsing them with `new Date` is
 * correct here in a way it is not for a birthday. An unparseable timestamp is
 * stored as null rather than rejected — a half-filled draft beats a lost one.
 */
import { and, eq, isNull } from 'drizzle-orm'
import { db } from '../../../../../../server/database'
import * as sms from '../../../database/schema'
import { assertStaff, getSmsViewer } from '../../../utils/access'
import { activityQuery, activityToDTO } from '../../../utils/dto'
import { intParam, textParam } from '../../../utils/http'

function timestampParam(value: unknown): Date | null {
  const raw = String(value ?? '').trim()
  if (!raw) return null
  const date = new Date(raw)
  return Number.isNaN(date.getTime()) ? null : date
}

export default defineEventHandler(async (event) => {
  const viewer = await getSmsViewer(event)
  assertStaff(viewer)

  const payload = (await readBody<Record<string, unknown>>(event)) ?? {}
  const name = textParam(payload.name, 300)
  if (!name) throw createError({ statusCode: 400, statusMessage: 'name is required' })

  const id = intParam(payload.id)
  const values = {
    name,
    description: textParam(payload.description, 20000),
    location: textParam(payload.location, 200),
    startAt: timestampParam(payload.startAt),
    endAt: timestampParam(payload.endAt),
    cover: textParam(payload.cover, 500)
  }

  if (id != null) {
    const [existing] = await db
      .select({ id: sms.activities.id })
      .from(sms.activities)
      .where(and(eq(sms.activities.id, id), isNull(sms.activities.deletedAt)))
      .limit(1)
    if (!existing) throw createError({ statusCode: 404, statusMessage: 'Activity not found' })

    await db
      .update(sms.activities)
      .set({ ...values, updatedAt: new Date() })
      .where(eq(sms.activities.id, id))

    const [row] = await activityQuery().where(eq(sms.activities.id, id)).limit(1)
    return { activity: activityToDTO(row!) }
  }

  const [inserted] = await db
    .insert(sms.activities)
    .values({ ...values, publishedAt: new Date(), authorId: viewer.userId })
    .returning({ id: sms.activities.id })

  const [row] = await activityQuery().where(eq(sms.activities.id, inserted!.id)).limit(1)
  return { activity: activityToDTO(row!) }
})
