/**
 * School — who am I?
 *
 * The client shell asks this once to decide which portal it is rendering, so the
 * endpoint must answer for a signed-out visitor too (with `role: 'anonymous'`)
 * rather than raising 401. The role ladder and the mapping from the access-layer
 * viewer are deliberately identical to `home.get.ts` / `portal.get.ts`; see the
 * header there for why the mapping is not factored into a util.
 */
import { eq } from 'drizzle-orm'
import { db } from '../../../../../server/database'
import { users } from '../../../../../server/database/schema'
import type { SmsViewer } from '../../utils/access'
import { getSmsViewer } from '../../utils/access'

type ClientRole = 'admin' | 'teacher' | 'student' | 'guardian' | 'anonymous'

export default defineEventHandler(async (event) => {
  const viewer: SmsViewer = await getSmsViewer(event)

  let name: string | null = null
  if (viewer.userId != null) {
    const [row] = await db
      .select({ name: users.name, username: users.username })
      .from(users)
      .where(eq(users.id, viewer.userId))
      .limit(1)
    if (row) name = (row.name ?? '').trim() || row.username
  }

  const role: ClientRole = viewer.admin
    ? 'admin'
    : viewer.teacher
      ? 'teacher'
      : viewer.student
        ? 'student'
        : viewer.guardianIds.length > 0
          ? 'guardian'
          : 'anonymous'

  return {
    viewer: {
      signedIn: viewer.userId != null,
      admin: viewer.admin,
      role,
      userId: viewer.userId,
      name,
      teacherId: viewer.teacher?.id ?? null,
      studentId: viewer.student?.id ?? null,
      classId: viewer.student?.classId ?? null,
      guardianIds: viewer.guardianIds,
      wardIds: viewer.wardIds,
      isStaff: viewer.admin || viewer.teacher != null,
      linked: viewer.admin || viewer.teacher != null || viewer.student != null || viewer.guardianIds.length > 0
    }
  }
})
