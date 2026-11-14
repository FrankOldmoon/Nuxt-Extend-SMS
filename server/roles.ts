/**
 * SMS role presets — one permission bundle per business role from the plan
 * (`docs/architecture/SCHOOL_MANAGEMENT_PHASE0.md` §3.2).
 *
 * Roles are data, not code: nothing in the request path may branch on a role
 * name. The presets below only decide *what* a role may do; *which rows* it can
 * see is resolved by the data-scope helpers (`sms.*.all` flags and class scope).
 *
 * `ensureSmsRoles()` is idempotent and additive: missing roles are created and
 * existing roles only ever gain permissions, so an administrator's manual
 * adjustments are never overwritten.
 */
import { pool } from '../../../server/sdk'

export interface SmsRolePreset {
  /** Role name in the global `roles` table; always namespaced. */
  code: string
  description: string
  permissions: readonly string[]
}

/** Resource reads shared by most staff roles. */
const STAFF_READ = [
  'sms.students.read',
  'sms.classes.read',
  'sms.teachers.read',
  'sms.enrollments.read',
  'sms.guardians.read',
  'sms.academic-years.read',
  'sms.attendance.read',
  'sms.leave.read',
  'sms.scores.read',
  'sms.timetable.read',
  'sms.notifications.read',
  'sms.knowledge.read',
  'sms.agent-tasks.read',
  'sms.agent-tasks.create',
  'sms.assignments.read',
  'sms.elections.read'
] as const

/** Every read permission the SMS module declares (for leadership roles). */
const ALL_READ = [
  ...STAFF_READ,
  'sms.approvals.read',
  'sms.applications.read',
  'sms.finance.read',
  'sms.assets.read',
  'sms.library.read',
  'sms.reports.read'
] as const

/** Whole-school data-scope flags (never grants publish/write by themselves). */
const SCOPE_ALL = [
  'sms.attendance.all',
  'sms.leave.all',
  'sms.scores.all',
  'sms.timetable.all'
] as const

export const SMS_ROLE_PRESETS: readonly SmsRolePreset[] = [
  {
    code: 'sms.platform_admin',
    description: '平台运维：平台级全部权限（业务数据仍受组织隔离）',
    permissions: ['*']
  },
  {
    code: 'sms.school_leader',
    description: '校长/副校长/督导：全校只读 + 审批 + 报表导出，无财务写',
    permissions: [
      ...ALL_READ,
      'sms.leave.approve',
      'sms.reports.export',
      'sms.notifications.send',
      'sms.knowledge.create',
      ...SCOPE_ALL
    ]
  },
  {
    code: 'sms.academic_director',
    description: '教务主任：教学域读写、课表与成绩发布、审批',
    permissions: [
      ...STAFF_READ,
      'sms.approvals.read',
      'sms.applications.read',
      'sms.students.update',
      'sms.enrollments.create',
      'sms.attendance.update',
      'sms.leave.approve',
      'sms.exams.create',
      'sms.scores.update',
      'sms.scores.publish',
      'sms.report-cards.generate',
      'sms.applications.review',
      'sms.applications.convert',
      'sms.timetable.update',
      'sms.timetable.publish',
      'sms.assignments.update',
      'sms.notifications.send',
      'sms.knowledge.create',
      ...SCOPE_ALL
    ]
  },
  {
    code: 'sms.academic_staff',
    description: '教务员：学籍/排课/考务读写，不含发布',
    permissions: [
      ...STAFF_READ,
      'sms.approvals.read',
      'sms.applications.read',
      'sms.reports.read',
      'sms.knowledge.create',
      'sms.students.create',
      'sms.students.update',
      'sms.students.delete',
      'sms.enrollments.create',
      'sms.guardians.create',
      'sms.student-guardians.create',
      'sms.teacher-assignments.create',
      'sms.academic-years.create',
      'sms.attendance.update',
      'sms.exams.create',
      'sms.scores.update',
      'sms.report-cards.generate',
      'sms.applications.review',
      'sms.timetable.update',
      'sms.assignments.update',
      ...SCOPE_ALL
    ]
  },
  {
    code: 'sms.grade_leader',
    description: '年级组长：本年级教学域读写 + 审批（数据范围收窄）',
    permissions: [
      ...STAFF_READ,
      'sms.approvals.read',
      'sms.students.update',
      'sms.attendance.update',
      'sms.leave.approve',
      'sms.exams.create',
      'sms.scores.update',
      'sms.report-cards.generate',
      'sms.assignments.update'
    ]
  },
  {
    code: 'sms.subject_leader',
    description: '教研组长：本学科考试与成绩读写',
    permissions: [
      'sms.students.read',
      'sms.classes.read',
      'sms.teachers.read',
      'sms.academic-years.read',
      'sms.attendance.read',
      'sms.leave.read',
      'sms.scores.read',
      'sms.scores.update',
      'sms.timetable.read',
      'sms.notifications.read',
      'sms.knowledge.read',
      'sms.assignments.read',
      'sms.assignments.update',
      'sms.elections.read',
      'sms.exams.create',
      'sms.report-cards.generate'
    ]
  },
  {
    code: 'sms.homeroom_teacher',
    description: '班主任：本班学生、考勤、请假审批、成绩只读',
    permissions: [
      'sms.students.read',
      'sms.students.update',
      'sms.classes.read',
      'sms.teachers.read',
      'sms.enrollments.read',
      'sms.guardians.read',
      'sms.academic-years.read',
      'sms.attendance.read',
      'sms.attendance.update',
      'sms.leave.read',
      'sms.leave.approve',
      'sms.approvals.read',
      'sms.scores.read',
      'sms.report-cards.generate',
      'sms.timetable.read',
      'sms.assignments.read',
      'sms.assignments.update',
      'sms.elections.read'
    ]
  },
  {
    code: 'sms.teacher',
    description: '任课教师：所授班级考勤与成绩录入，学生信息只读',
    permissions: [
      'sms.students.read',
      'sms.classes.read',
      'sms.teachers.read',
      'sms.enrollments.read',
      'sms.guardians.read',
      'sms.academic-years.read',
      'sms.attendance.read',
      'sms.attendance.update',
      'sms.leave.read',
      'sms.leave.create',
      'sms.exams.create',
      'sms.scores.read',
      'sms.scores.update',
      'sms.timetable.read',
      'sms.assignments.read',
      'sms.assignments.update',
      'sms.elections.read'
    ]
  },
  {
    code: 'sms.student',
    description: '学生：自己的课表、成绩、考勤与请假申请',
    permissions: [
      'sms.classes.read',
      'sms.academic-years.read',
      'sms.attendance.read',
      'sms.leave.read',
      'sms.leave.create',
      'sms.scores.read',
      'sms.timetable.read',
      'sms.notifications.read',
      'sms.knowledge.read',
      'sms.assignments.read',
      'sms.assignments.submit',
      'sms.elections.read',
      'sms.elections.create'
    ]
  },
  {
    code: 'sms.guardian',
    description: '家长：子女的考勤、成绩、请假与缴费',
    permissions: [
      'sms.students.read',
      'sms.classes.read',
      'sms.academic-years.read',
      'sms.attendance.read',
      'sms.leave.read',
      'sms.leave.create',
      'sms.scores.read',
      'sms.timetable.read',
      'sms.finance.read',
      'sms.notifications.read',
      'sms.knowledge.read',
      'sms.assignments.read',
      'sms.elections.read'
    ]
  },
  {
    code: 'sms.admissions',
    description: '招生办：报名、录取、分班与学籍转入',
    permissions: [
      'sms.students.read',
      'sms.students.create',
      'sms.students.update',
      'sms.classes.read',
      'sms.teachers.read',
      'sms.enrollments.read',
      'sms.enrollments.create',
      'sms.guardians.read',
      'sms.guardians.create',
      'sms.student-guardians.create',
      'sms.academic-years.read',
      'sms.applications.read',
      'sms.applications.create',
      'sms.applications.review',
      'sms.applications.convert',
      'sms.admission-cycles.create',
      'sms.reports.read',
      'sms.notifications.read',
      'sms.knowledge.read'
    ]
  },
  {
    code: 'sms.finance',
    description: '财务：收费项、账单、收款、退费审批',
    permissions: [
      'sms.students.read',
      'sms.classes.read',
      'sms.enrollments.read',
      'sms.finance.read',
      'sms.finance.update',
      'sms.finance.refund-approve',
      'sms.reports.read',
      'sms.reports.export',
      'sms.notifications.read',
      'sms.knowledge.read'
    ]
  },
  {
    code: 'sms.hr',
    description: '人事/行政：教职工档案',
    permissions: [
      'sms.teachers.read',
      'sms.teachers.update',
      'sms.classes.read',
      'sms.academic-years.read',
      'sms.notifications.read',
      'sms.knowledge.read'
    ]
  },
  {
    code: 'sms.logistics',
    description: '后勤：资产与报修',
    permissions: [
      'sms.assets.read',
      'sms.assets.update',
      'sms.teachers.read',
      'sms.reports.read',
      'sms.notifications.read',
      'sms.knowledge.read'
    ]
  },
  {
    code: 'sms.librarian',
    description: '图书管理员：书目与借还',
    permissions: [
      'sms.library.read',
      'sms.library.update',
      'sms.students.read',
      'sms.classes.read',
      'sms.notifications.read',
      'sms.knowledge.read'
    ]
  },
  {
    code: 'sms.counselor',
    description: '心理/德育：学生与考勤、请假只读',
    permissions: [
      'sms.students.read',
      'sms.guardians.read',
      'sms.attendance.read',
      'sms.leave.read',
      'sms.approvals.read',
      'sms.notifications.read',
      'sms.knowledge.read'
    ]
  }
]

/**
 * Union of an existing role's permissions and a preset. Order is stable
 * (existing first, then new preset entries) so repeated boots produce the same
 * JSONB value.
 */
export function mergeRolePermissions(
  existing: readonly string[],
  preset: readonly string[]
): string[] {
  const merged: string[] = []
  const seen = new Set<string>()
  for (const permission of [...existing, ...preset]) {
    if (seen.has(permission)) continue
    seen.add(permission)
    merged.push(permission)
  }
  return merged
}

/**
 * Create missing SMS roles and additively merge permissions into existing ones.
 * Never touches `admin` / `user`; admin retains `['*']` via the database plugin.
 */
export async function ensureSmsRoles(): Promise<{ created: string[], updated: string[] }> {
  const created: string[] = []
  const updated: string[] = []

  for (const preset of SMS_ROLE_PRESETS) {
    const { rows } = await pool.query<{ id: number, permissions: string[] | null }>(
      'SELECT id, permissions FROM roles WHERE name = $1 LIMIT 1',
      [preset.code]
    )
    const current = rows[0]
    if (!current) {
      await pool.query(
        `INSERT INTO roles (name, description, permissions, data_scope, updated_at)
         VALUES ($1, $2, $3::jsonb, 'all', now())`,
        [preset.code, preset.description, JSON.stringify([...preset.permissions])]
      )
      created.push(preset.code)
      continue
    }

    const merged = mergeRolePermissions(current.permissions ?? [], preset.permissions)
    if (merged.length !== (current.permissions ?? []).length) {
      await pool.query(
        'UPDATE roles SET permissions = $2::jsonb, updated_at = now() WHERE id = $1',
        [current.id, JSON.stringify(merged)]
      )
      updated.push(preset.code)
    }
  }

  if (created.length > 0 || updated.length > 0) {
    console.log(
      `[sms] roles ensured (created: ${created.length}, updated: ${updated.length})`
    )
  }
  return { created, updated }
}
