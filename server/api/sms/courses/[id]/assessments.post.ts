/**
 * Course assessments — create or edit one.
 *
 * Assessment and score are one model (see the schema header), so "add a quiz"
 * and "re-weight the final" are the same operation. Editing is by `id` in the
 * body rather than a separate PUT because the UI edits a row in place and does
 * not care whether it exists yet.
 *
 * Weights are percentages and are validated here rather than trusted: the
 * gradebook reports its own weight sum, but a nonsense weight (negative, >100,
 * fractional) is a 400 at the door.
 */
import { and, eq, isNull } from 'drizzle-orm'
import { db } from '../../../../../../../server/database'
import * as sms from '../../../../database/schema'
import { assertMayWriteCourse, getSmsViewer } from '../../../../utils/access'
import { assessmentQuery, assessmentToDTO } from '../../../../utils/dto'
import { intParam, textParam } from '../../../../utils/http'

function parseWeight(value: unknown, fallback: number): number {
  if (value == null || value === '') return fallback
  const parsed = Number(value)
  if (!Number.isInteger(parsed) || parsed < 0 || parsed > 100) {
    throw createError({ statusCode: 400, statusMessage: 'weight must be an integer between 0 and 100' })
  }
  return parsed
}

function parseMaxScore(value: unknown, fallback: number): number {
  if (value == null || value === '') return fallback
  const parsed = Number(value)
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw createError({ statusCode: 400, statusMessage: 'maxScore must be greater than zero' })
  }
  return parsed
}

function parseSortOrder(value: unknown, fallback: number): number {
  if (value == null || value === '') return fallback
  const parsed = Number(value)
  if (!Number.isInteger(parsed)) {
    throw createError({ statusCode: 400, statusMessage: 'sortOrder must be an integer' })
  }
  return parsed
}

function parseInstant(value: unknown): Date | null {
  if (value == null || value === '') return null
  const date = new Date(String(value))
  if (Number.isNaN(date.getTime())) {
    throw createError({ statusCode: 400, statusMessage: 'dueAt is not a valid timestamp' })
  }
  return date
}

export default defineEventHandler(async (event) => {
  const courseId = intParam(getRouterParam(event, 'id'))
  if (!courseId) throw createError({ statusCode: 400, statusMessage: 'Invalid course id' })

  const viewer = await getSmsViewer(event)
  await assertMayWriteCourse(viewer, courseId)

  const [course] = await db
    .select({ id: sms.courses.id, semesterId: sms.courses.semesterId })
    .from(sms.courses)
    .where(and(eq(sms.courses.id, courseId), isNull(sms.courses.deletedAt)))
    .limit(1)
  if (!course) throw createError({ statusCode: 404, statusMessage: 'Course not found' })

  const body = await readBody<Record<string, unknown>>(event).catch(() => ({}) as Record<string, unknown>)

  const name = textParam(body.name, 200)
  if (!name) throw createError({ statusCode: 400, statusMessage: 'name is required' })

  const assessmentId = intParam(body.id)
  const existing = assessmentId
    ? (await db
        .select()
        .from(sms.assessments)
        .where(and(
          eq(sms.assessments.id, assessmentId),
          eq(sms.assessments.courseId, courseId),
          isNull(sms.assessments.deletedAt)
        ))
        .limit(1))[0]
    : undefined
  if (assessmentId && !existing) {
    throw createError({ statusCode: 404, statusMessage: 'Assessment not found' })
  }

  const values = {
    name,
    kind: body.kind === undefined ? existing?.kind ?? 'other' : textParam(body.kind, 20) ?? existing?.kind ?? 'other',
    weight: parseWeight(body.weight, existing?.weight ?? 0),
    maxScore: parseMaxScore(body.maxScore, existing?.maxScore ?? 100),
    dueAt: body.dueAt === undefined ? existing?.dueAt ?? null : parseInstant(body.dueAt),
    description: body.description === undefined ? existing?.description ?? null : textParam(body.description, 4000),
    sortOrder: parseSortOrder(body.sortOrder, existing?.sortOrder ?? 0)
  }

  const now = new Date()
  const id = existing
    ? (await db
        .update(sms.assessments)
        .set({ ...values, updatedAt: now })
        .where(eq(sms.assessments.id, existing.id))
        .returning({ id: sms.assessments.id }))[0]!.id
    : (await db
        .insert(sms.assessments)
        .values({ ...values, courseId, semesterId: course.semesterId })
        .returning({ id: sms.assessments.id }))[0]!.id

  const [row] = await assessmentQuery().where(eq(sms.assessments.id, id)).limit(1)

  return { assessment: row ? assessmentToDTO(row) : null }
})
