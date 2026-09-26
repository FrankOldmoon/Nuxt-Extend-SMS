/**
 * Submission — approve, reject or withdraw a batch.
 *
 * Approving and rejecting are an administrator's decision and only make sense on
 * a `pending` batch: a batch cannot be re-reviewed once it has been settled.
 * Withdrawing is the submitter taking their own batch back (or an admin doing it
 * for them) — it detaches nothing, the records simply stop being locked, which
 * is what re-opens the course's marks for editing.
 */
import { eq } from 'drizzle-orm'
import { db } from '../../../../../../server/database'
import * as sms from '../../../database/schema'
import { assertAdmin, getSmsViewer } from '../../../utils/access'
import { submissionQuery, submissionToDTO } from '../../../utils/dto'
import { intParam, textParam } from '../../../utils/http'

export default defineEventHandler(async (event) => {
  const id = intParam(getRouterParam(event, 'id'))
  if (!id) throw createError({ statusCode: 400, statusMessage: 'Invalid submission id' })

  const viewer = await getSmsViewer(event)

  const [submission] = await db
    .select({
      id: sms.submissions.id,
      status: sms.submissions.status,
      submittedBy: sms.submissions.submittedBy
    })
    .from(sms.submissions)
    .where(eq(sms.submissions.id, id))
    .limit(1)
  if (!submission) throw createError({ statusCode: 404, statusMessage: 'Submission not found' })

  const body = await readBody<{ action?: unknown, note?: unknown }>(event).catch(() => ({}) as Record<string, unknown>)
  const action = textParam(body.action, 20)
  const now = new Date()

  if (action === 'approve' || action === 'reject') {
    assertAdmin(viewer)
    if (submission.status !== 'pending') {
      throw createError({ statusCode: 409, statusMessage: 'Only a pending submission can be reviewed' })
    }
    const note = textParam(body.note, 2000)
    await db
      .update(sms.submissions)
      .set({
        status: action === 'approve' ? 'approved' : 'rejected',
        reviewedBy: viewer.userId,
        reviewedAt: now,
        ...(note != null ? { reviewNote: note } : {}),
        updatedAt: now
      })
      .where(eq(sms.submissions.id, id))
  } else if (action === 'withdraw') {
    if (!viewer.admin && submission.submittedBy !== viewer.userId) {
      throw createError({ statusCode: 403, statusMessage: 'Only the submitter or an administrator may withdraw' })
    }
    await db
      .update(sms.submissions)
      .set({ status: 'withdrawn', updatedAt: now })
      .where(eq(sms.submissions.id, id))
  } else {
    throw createError({ statusCode: 400, statusMessage: 'action must be "approve", "reject" or "withdraw"' })
  }

  const [row] = await submissionQuery().where(eq(sms.submissions.id, id)).limit(1)

  return { submission: row ? submissionToDTO(row) : null }
})
