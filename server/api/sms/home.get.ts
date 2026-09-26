/**
 * School — the public home page aggregate.
 *
 * One request fills everything the landing page shows: the counters, the notice
 * board, the latest articles, the next (or most recent) activities, the current
 * semester and the viewer. A single round trip matters because the home page is
 * the busiest route and — unlike the portal — it has to render for a visitor who
 * has no session at all, so `getSmsViewer` is called and never asserted against.
 *
 * The mapping from the access-layer viewer to the client's `SmsViewer` is
 * repeated in `portal.get.ts` and `me.get.ts` rather than shared through a new
 * util: the module's util surface is frozen, and these three callers are the only
 * ones that need the client shape.
 */
import { and, asc, desc, eq, gte, inArray, isNotNull, isNull, lt, lte, sql } from 'drizzle-orm'
import { db } from '../../../../../server/database'
import { users } from '../../../../../server/database/schema'
import * as sms from '../../database/schema'
import type { SmsViewer } from '../../utils/access'
import { getCurrentSemesterId, getSchoolSettings, getSmsViewer } from '../../utils/access'
import {
  activityQuery,
  activityToDTO,
  articleQuery,
  articleToDTO,
  noticeQuery,
  noticeToDTO,
  semesterQuery
} from '../../utils/dto'

type ClientRole = 'admin' | 'teacher' | 'student' | 'guardian' | 'anonymous'

/** The display name for a host user, or null when there is nobody to name. */
async function viewerName(userId: number | null): Promise<string | null> {
  if (userId == null) return null
  const [row] = await db
    .select({ name: users.name, username: users.username })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1)
  if (!row) return null
  const name = (row.name ?? '').trim()
  return name || row.username
}

/**
 * The access-layer viewer, as the client consumes it.
 *
 * `admin` short-circuits the role ladder, and a signed-in user with no
 * teacher/student/guardian record falls through to `anonymous` — which is exactly
 * what `linked: false` is telling the client to act on.
 */
function clientViewer(viewer: SmsViewer, name: string | null) {
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

/**
 * The notice audiences a viewer may see.
 *
 * An administrator reads everything (the access table gives them the whole
 * school); everyone else gets the school-wide board plus the one written for
 * their role. An anonymous visitor only ever sees `all`.
 */
function noticeAudiences(viewer: SmsViewer): string[] {
  if (viewer.admin) return ['all', 'teachers', 'students', 'guardians']
  if (viewer.teacher) return ['all', 'teachers']
  if (viewer.student) return ['all', 'students']
  if (viewer.guardianIds.length > 0) return ['all', 'guardians']
  return ['all']
}

export default defineEventHandler(async (event) => {
  const viewer = await getSmsViewer(event)
  const now = new Date()

  const [[studentRow], [teacherRow], [classRow], [courseRow], currentSemesterId, name, school] = await Promise.all([
    db.select({ n: sql<number>`count(*)::int` }).from(sms.students)
      .where(and(eq(sms.students.status, 'enrolled'), isNull(sms.students.deletedAt))),
    db.select({ n: sql<number>`count(*)::int` }).from(sms.teachers)
      .where(isNull(sms.teachers.deletedAt)),
    db.select({ n: sql<number>`count(*)::int` }).from(sms.classes)
      .where(isNull(sms.classes.deletedAt)),
    db.select({ n: sql<number>`count(*)::int` }).from(sms.courses)
      .where(isNull(sms.courses.deletedAt)),
    getCurrentSemesterId(),
    viewerName(viewer.userId),
    getSchoolSettings()
  ])

  const semester = currentSemesterId == null
    ? null
    : (await semesterQuery()
        .where(and(eq(sms.semesters.id, currentSemesterId), isNull(sms.semesters.deletedAt)))
        .limit(1))[0] ?? null

  const [notices, articles, upcoming] = await Promise.all([
    noticeQuery()
      .where(and(
        isNull(sms.notices.deletedAt),
        isNotNull(sms.notices.publishedAt),
        lte(sms.notices.publishedAt, now),
        inArray(sms.notices.audience, noticeAudiences(viewer))
      ))
      .orderBy(desc(sms.notices.isPinned), desc(sms.notices.publishedAt))
      .limit(5),
    articleQuery()
      .where(and(
        isNull(sms.articles.deletedAt),
        isNotNull(sms.articles.publishedAt),
        lte(sms.articles.publishedAt, now)
      ))
      .orderBy(desc(sms.articles.publishedAt))
      .limit(4),
    // Upcoming first, in date order; when nothing is upcoming the most recent
    // past activity is a better answer than an empty strip.
    activityQuery()
      .where(and(
        isNull(sms.activities.deletedAt),
        isNotNull(sms.activities.startAt),
        gte(sms.activities.startAt, now)
      ))
      .orderBy(asc(sms.activities.startAt))
      .limit(4)
  ])

  const activities = upcoming.length
    ? upcoming
    : await activityQuery()
        .where(and(
          isNull(sms.activities.deletedAt),
          isNotNull(sms.activities.startAt),
          lt(sms.activities.startAt, now)
        ))
        .orderBy(desc(sms.activities.startAt))
        .limit(4)

  return {
    viewer: clientViewer(viewer, name),
    schoolName: school.schoolName,
    stats: {
      students: studentRow?.n ?? 0,
      teachers: teacherRow?.n ?? 0,
      classes: classRow?.n ?? 0,
      courses: courseRow?.n ?? 0
    },
    notices: notices.map(noticeToDTO),
    articles: articles.map(articleToDTO),
    activities: activities.map(activityToDTO),
    semester
  }
})
