/**
 * School management system — Nitro plugin.
 *
 * Runs once at server startup:
 *   1. declares the module's editable settings in the shared `configs` table;
 *   2. creates/upgrades the `sms_` tables (idempotent, safe on every boot);
 *   3. hands the Drizzle schema to the host dashboard, so every table is reachable
 *      through the existing generic CRUD instead of needing its own API;
 *   4. opts the tables that deserve a place into the admin sidebar, with an icon;
 *   5. seeds one usable school (current semester, bell schedule, a few subjects)
 *      so the portal has something to show on a fresh install;
 *   6. publishes the module's sections into the host header navigation while the
 *      module owns the site root.
 *
 * Field metadata is deliberately *not* written by hand: `autoDiscoverTable` reads
 * it off the Drizzle table (types, nullability, foreign keys, and the
 * many-to-many virtual columns it can infer from the pivot tables), which is both
 * less code and more accurate than a second hand-maintained copy. What the
 * dashboard cannot infer is presentation — the icon and the order — and that is
 * all `ADMIN_MENU` carries.
 */
import { db } from '../../../../server/database'
import { configs as configsTable } from '../../../../server/database/schema'
import { getConfigValue, upsertConfig } from '../../../../server/utils/configs'
import {
  autoDiscoverTable,
  registerDashboardTable,
  registerDrizzleSchema
} from '../../../../server/utils/dashboard/tables'
import * as sms from '../database/schema'
import { runSmsMigrations } from '../database/migrate'

const SMS_ENABLED_KEY = 'sms.enabled'
const SITE_NAV_KEY = 'site.navigation'
const LIBRARY_CLEAR_NAV_KEY = 'library.clearSiteNavigation'

/**
 * The sections published to the host header, in order.
 *
 * Labels come from this module's locale files (passed through the public runtime
 * config by `index.ts`) because the host renders `site.navigation` entries
 * verbatim — they are admin-authored content with no per-locale lookup.
 */
const SECTIONS: Array<{ key: string, url: string, icon: string }> = [
  { key: 'home', url: '/', icon: 'i-lucide-school' },
  { key: 'notices', url: '/sms/notices', icon: 'i-lucide-megaphone' },
  { key: 'articles', url: '/sms/articles', icon: 'i-lucide-newspaper' },
  { key: 'activities', url: '/sms/activities', icon: 'i-lucide-calendar-heart' },
  { key: 'portal', url: '/sms/dashboard', icon: 'i-lucide-layout-dashboard' },
  { key: 'timetable', url: '/sms/timetable', icon: 'i-lucide-calendar-clock' },
  { key: 'courses', url: '/sms/courses', icon: 'i-lucide-book-open' },
  { key: 'classes', url: '/sms/classes', icon: 'i-lucide-users-round' }
]

/**
 * Which tables get a place in the admin sidebar, in order.
 *
 * Everything else is still reachable at `/dashboard/<table>`; leaving the noisy
 * join tables out of the menu keeps the sidebar about the school rather than
 * about the database.
 */
const ADMIN_MENU: Array<{ table: string, icon: string, order: number }> = [
  { table: 'departments', icon: 'i-lucide-building-2', order: 200 },
  { table: 'grades', icon: 'i-lucide-layers', order: 201 },
  { table: 'classes', icon: 'i-lucide-users-round', order: 202 },
  { table: 'subjects', icon: 'i-lucide-book-open', order: 203 },
  { table: 'semesters', icon: 'i-lucide-calendar-range', order: 204 },
  { table: 'classrooms', icon: 'i-lucide-door-open', order: 205 },
  { table: 'periods', icon: 'i-lucide-clock', order: 206 },
  { table: 'teachers', icon: 'i-lucide-user-check', order: 207 },
  { table: 'students', icon: 'i-lucide-graduation-cap', order: 208 },
  { table: 'guardians', icon: 'i-lucide-user-round', order: 209 },
  { table: 'courses', icon: 'i-lucide-presentation', order: 210 },
  { table: 'timetableEntries', icon: 'i-lucide-calendar-clock', order: 211 },
  { table: 'assessments', icon: 'i-lucide-clipboard-list', order: 212 },
  { table: 'scores', icon: 'i-lucide-pen-line', order: 213 },
  { table: 'attendanceRecords', icon: 'i-lucide-clipboard-check', order: 214 },
  { table: 'submissions', icon: 'i-lucide-inbox', order: 215 },
  { table: 'conductCategories', icon: 'i-lucide-scale', order: 216 },
  { table: 'conductRules', icon: 'i-lucide-list-checks', order: 217 },
  { table: 'conductRecords', icon: 'i-lucide-alert-triangle', order: 218 },
  { table: 'notices', icon: 'i-lucide-megaphone', order: 219 },
  { table: 'articles', icon: 'i-lucide-newspaper', order: 220 },
  { table: 'activities', icon: 'i-lucide-calendar-heart', order: 221 },
  { table: 'feedback', icon: 'i-lucide-message-square-warning', order: 222 }
]

/** Resolve the section labels for the site's default locale. */
function resolveSections(): Array<{ label: string, url: string, icon: string, order: number }> {
  const runtime = useRuntimeConfig()
  const publicConfig = runtime.public as Record<string, unknown>
  const locale = String(publicConfig.smsNavLocale ?? 'en')
  const labels = (publicConfig.smsNavLabels ?? {}) as Record<string, Record<string, string>>
  const dictionary = labels[locale] ?? labels.en ?? {}

  return SECTIONS.map((section, index) => ({
    // Falls back to the key so a missing translation degrades to something
    // readable ("notices") instead of an empty menu entry.
    label: dictionary[section.key] ?? section.key,
    url: section.url,
    icon: section.icon,
    order: index
  }))
}

/** URLs this module (or a sibling extension module) is allowed to replace. */
const CLAIMABLE_PREFIXES = ['/music', '/library', '/photo', '/sms']

function isClaimable(url: unknown): boolean {
  const value = String(url ?? '')
  if (value === '/' || value === '') return true
  return CLAIMABLE_PREFIXES.some(prefix => value.startsWith(prefix))
}

/**
 * Publish the school's sections into the host header navigation.
 *
 * Same order-independent policy the other modules use: stand the library's
 * clear-policy down, and only write when the current navigation is empty or
 * entirely claimable by the extension modules — an admin's own navigation is
 * never clobbered.
 */
async function applyNavigationPolicy(): Promise<void> {
  try {
    const enabled = await getConfigValue<boolean>('sms.siteNavigation', true).catch(() => true)
    if (!enabled) return

    await upsertConfig({
      key: LIBRARY_CLEAR_NAV_KEY,
      value: 'false',
      type: 'boolean',
      description: 'Clear the host site.navigation while the library owns the home page'
    })

    const current = await getConfigValue<string>(SITE_NAV_KEY, '').catch(() => '')
    const empty = !current || current === '[]' || current === '""'
    if (!empty) {
      let parsed: unknown
      try {
        parsed = JSON.parse(current)
      } catch {
        parsed = null
      }
      const items = Array.isArray(parsed) ? parsed : null
      if (!items || !items.every(item => isClaimable((item as { url?: unknown })?.url))) {
        console.log(`[sms] ${SITE_NAV_KEY} looks hand-authored — leaving it alone`)
        return
      }
    }

    const items = resolveSections()
    await upsertConfig({
      key: SITE_NAV_KEY,
      value: JSON.stringify(items),
      type: 'json',
      description: 'Home page header navigation config (label/url/order/hidden)'
    })
    console.log(`[sms] ${SITE_NAV_KEY} filled with ${items.length} school sections`)
  } catch (error) {
    console.warn('[sms] navigation policy failed (ignored):', error)
  }
}

export default defineNitroPlugin(async () => {
  const enabled = await getConfigValue(SMS_ENABLED_KEY, true).catch(() => true)
  if (!enabled) {
    console.log('[sms] disabled via config (sms.enabled=false) — skipping setup')
    return
  }

  console.log('[sms] initializing school management module')
  await ensureConfigs()

  // Make every `sms_` table reachable through the host's generic CRUD.
  registerDrizzleSchema(sms)

  await runSmsMigrations()
  registerAdminMenu()
  await seedSchool()

  // Only manage the header navigation while this module owns the site root.
  if (process.env.SMS_TAKE_SITE_ROOT !== 'false') {
    await applyNavigationPolicy()
  }
})

/** Opt the school's tables into the admin sidebar, with an icon and an order. */
function registerAdminMenu(): void {
  for (const entry of ADMIN_MENU) {
    const discovered = autoDiscoverTable(entry.table)
    if (!discovered) {
      console.warn(`[sms] could not find the table "${entry.table}" to register in the admin menu`)
      continue
    }
    registerDashboardTable(
      { ...discovered, meta: { ...discovered.meta, icon: entry.icon } },
      { menuOrder: entry.order }
    )
  }
  console.log(`[sms] ${ADMIN_MENU.length} tables exposed in the back office`)
}

/** Declare the module's settings (idempotent — an admin's edits win). */
async function ensureConfigs(): Promise<void> {
  try {
    await db
      .insert(configsTable)
      .values([
        { key: SMS_ENABLED_KEY, value: 'true', type: 'boolean', description: 'Enable the school management module' },
        { key: 'sms.schoolName', value: 'Springfield School', type: 'string', description: 'School name shown on the public home page' },
        { key: 'sms.passMark', value: '60', type: 'number', description: 'Percentage at or above which a subject is passed' },
        {
          key: 'sms.siteNavigation',
          value: 'true',
          type: 'boolean',
          description: 'Publish the school sections into the host header navigation while sms owns the home page'
        }
      ])
      .onConflictDoNothing({ target: configsTable.key })
  } catch (error) {
    console.warn('[sms] config ensure failed (ignored):', error)
  }
}

/**
 * Seed one usable school.
 *
 * Only runs when the corresponding table is empty, so it can never overwrite a
 * real school's data. The point is that a fresh install has a current semester
 * (every screen defaults to it), a bell schedule (the timetable grid needs
 * periods to draw) and a couple of subjects, instead of a set of blank pages
 * where nothing can be created until five other things exist.
 */
async function seedSchool(): Promise<void> {
  try {
    const [existingSemester] = await db.select({ id: sms.semesters.id }).from(sms.semesters).limit(1)
    let semesterId = existingSemester?.id ?? null
    if (!semesterId) {
      const year = new Date().getUTCFullYear()
      const [inserted] = await db
        .insert(sms.semesters)
        .values({
          name: `${year}–${year + 1} · Term 1`,
          code: `T1-${year}`,
          startDate: `${year}-09-01`,
          endDate: `${year + 1}-01-31`,
          isCurrent: true,
          sortOrder: 1
        })
        .returning({ id: sms.semesters.id })
      semesterId = inserted?.id ?? null
    }

    const [existingPeriod] = await db.select({ id: sms.periods.id }).from(sms.periods).limit(1)
    if (!existingPeriod) {
      // A plain eight-period day with two breaks: enough for the timetable to be
      // a real grid out of the box.
      const bells = [
        { name: 'Period 1', index: 1, startTime: '08:00', endTime: '08:45', kind: 'class' },
        { name: 'Period 2', index: 2, startTime: '08:55', endTime: '09:40', kind: 'class' },
        { name: 'Break', index: 3, startTime: '09:40', endTime: '10:00', kind: 'break' },
        { name: 'Period 3', index: 4, startTime: '10:00', endTime: '10:45', kind: 'class' },
        { name: 'Period 4', index: 5, startTime: '10:55', endTime: '11:40', kind: 'class' },
        { name: 'Lunch', index: 6, startTime: '11:40', endTime: '13:00', kind: 'break' },
        { name: 'Period 5', index: 7, startTime: '13:00', endTime: '13:45', kind: 'class' },
        { name: 'Period 6', index: 8, startTime: '13:55', endTime: '14:40', kind: 'class' }
      ]
      await db.insert(sms.periods).values(bells)
    }

    const [existingSubject] = await db.select({ id: sms.subjects.id }).from(sms.subjects).limit(1)
    if (!existingSubject) {
      await db.insert(sms.subjects).values([
        { name: 'Chinese', code: 'CHN', sortOrder: 1 },
        { name: 'Mathematics', code: 'MATH', sortOrder: 2 },
        { name: 'English', code: 'ENG', sortOrder: 3 },
        { name: 'Physics', code: 'PHY', sortOrder: 4 },
        { name: 'History', code: 'HIS', sortOrder: 5 }
      ])
    }

    const [existingCategory] = await db.select({ id: sms.conductCategories.id }).from(sms.conductCategories).limit(1)
    if (!existingCategory) {
      const [demerit] = await db
        .insert(sms.conductCategories)
        .values({ name: 'Discipline', kind: 'demerit', sortOrder: 1 })
        .returning({ id: sms.conductCategories.id })
      const [merit] = await db
        .insert(sms.conductCategories)
        .values({ name: 'Commendation', kind: 'merit', sortOrder: 2 })
        .returning({ id: sms.conductCategories.id })

      if (demerit) {
        await db.insert(sms.conductRules).values([
          { categoryId: demerit.id, name: 'Late to class', points: 1, sortOrder: 1 },
          { categoryId: demerit.id, name: 'Homework not handed in', points: 2, sortOrder: 2 },
          { categoryId: demerit.id, name: 'Disrupting a lesson', points: 3, sortOrder: 3 }
        ])
      }
      if (merit) {
        await db.insert(sms.conductRules).values([
          { categoryId: merit.id, name: 'Helping a classmate', points: 2, sortOrder: 1 },
          { categoryId: merit.id, name: 'Top of the class', points: 5, sortOrder: 2 }
        ])
      }
    }

    if (semesterId) {
      await upsertConfig({
        key: sms.SMS_CURRENT_SEMESTER_KEY,
        value: String(semesterId),
        type: 'number',
        description: 'Semester new courses and records default to'
      })
    }
    console.log('[sms] seed confirmed')
  } catch (error) {
    console.warn('[sms] seed failed (ignored):', error)
  }
}
