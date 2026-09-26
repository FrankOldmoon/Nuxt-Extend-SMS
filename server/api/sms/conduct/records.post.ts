/**
 * Conduct records — record one merit or demerit.
 *
 * Staff-level, not course-level, and that is a deliberate policy (see
 * `access.ts`): any teacher who saw something happen should be able to write it
 * down, whether or not they teach the student.
 *
 * When a rule is given its `points` and `kind` are copied onto the record. The
 * copy is the point — a rule is a living document that gets reworded and
 * re-weighted, and last year's records must still say what they said. A rule's
 * direction lives on its category, so the kind is read from there.
 */
import { and, eq, isNull } from 'drizzle-orm'
import { db } from '../../../../../../server/database'
import * as sms from '../../../database/schema'
import { assertStaff, getCurrentSemesterId, getSmsViewer } from '../../../utils/access'
import { conductRecordQuery, conductRecordToDTO } from '../../../utils/dto'
import { dateParam, intParam, textParam } from '../../../utils/http'

function parsePoints(value: unknown): number {
  if (value == null || value === '') return 0
  const parsed = Number(value)
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw createError({ statusCode: 400, statusMessage: 'points must be a non-negative integer' })
  }
  return parsed
}

export default defineEventHandler(async (event) => {
  const viewer = await getSmsViewer(event)
  assertStaff(viewer)

  const body = await readBody<Record<string, unknown>>(event).catch(() => ({}) as Record<string, unknown>)

  const studentId = intParam(body.studentId)
  if (!studentId) throw createError({ statusCode: 400, statusMessage: 'studentId is required' })

  const [student] = await db
    .select({ id: sms.students.id })
    .from(sms.students)
    .where(and(eq(sms.students.id, studentId), isNull(sms.students.deletedAt)))
    .limit(1)
  if (!student) throw createError({ statusCode: 404, statusMessage: 'Student not found' })

  const date = dateParam(body.date)
  if (!date) throw createError({ statusCode: 400, statusMessage: 'A valid date is required' })

  const ruleId = intParam(body.ruleId)
  let kind: string
  let points: number

  if (ruleId) {
    const [rule] = await db
      .select({ points: sms.conductRules.points, categoryKind: sms.conductCategories.kind })
      .from(sms.conductRules)
      .leftJoin(sms.conductCategories, eq(sms.conductRules.categoryId, sms.conductCategories.id))
      .where(and(eq(sms.conductRules.id, ruleId), isNull(sms.conductRules.deletedAt)))
      .limit(1)
    if (!rule) throw createError({ statusCode: 404, statusMessage: 'Rule not found' })
    kind = rule.categoryKind ?? (body.kind === 'merit' ? 'merit' : 'demerit')
    points = rule.points
  } else {
    kind = textParam(body.kind, 20) ?? 'demerit'
    if (kind !== 'merit' && kind !== 'demerit') {
      throw createError({ statusCode: 400, statusMessage: 'kind must be "merit" or "demerit"' })
    }
    points = parsePoints(body.points)
  }

  const courseId = intParam(body.courseId)
  let semesterId = await getCurrentSemesterId()
  if (courseId) {
    const [course] = await db
      .select({ semesterId: sms.courses.semesterId })
      .from(sms.courses)
      .where(and(eq(sms.courses.id, courseId), isNull(sms.courses.deletedAt)))
      .limit(1)
    if (course?.semesterId) semesterId = course.semesterId
  }

  const [inserted] = await db
    .insert(sms.conductRecords)
    .values({
      studentId,
      ruleId,
      kind,
      points,
      courseId,
      semesterId,
      date,
      description: textParam(body.description, 300),
      recordedBy: viewer.teacher?.id ?? null
    })
    .returning({ id: sms.conductRecords.id })

  const [row] = await conductRecordQuery().where(eq(sms.conductRecords.id, inserted!.id)).limit(1)

  return { record: row ? conductRecordToDTO(row) : null }
})
