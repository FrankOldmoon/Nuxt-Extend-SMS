/**
 * SMS capabilities — the single capability set shared by Chat, Apps and Agents.
 *
 * Read capabilities execute directly; write capabilities expose a server-side
 * form + preview and are only executed after the user confirms the draft
 * (Phase 2/3 of the chat plan).
 */
import { createError } from 'h3'
import type { CapabilityDefinition, PreviewResult } from '../../../server/sdk'
import { canUseSms, isSmsAdmin, type SmsActor } from './context'
import {
  assertClassInContext,
  createStudent,
  getStudent,
  searchStudents,
  softDeleteStudent,
  updateStudent
} from './students'
import {
  assertAcademicYearInContext,
  assertSubjectInContext,
  assertTermInContext,
  classInContext,
  listAcademicYears,
  listClasses,
  listSubjects,
  listTerms
} from './academics'
import { assignTeacher, listTeachers } from './teachers'
import {
  enrollStudent,
  findEnrollment,
  listEnrollments,
  transferStudent,
  withdrawEnrollment
} from './enrollment'
import { assertGuardianInContext, linkGuardian, listGuardians } from './guardians'
import {
  ATTENDANCE_SESSIONS,
  ATTENDANCE_STATUSES,
  acknowledgeAttendanceAlert,
  listAttendanceAlerts,
  listAttendanceRecords,
  listAttendanceRoster,
  markAttendance,
  normalizeAttendanceDate,
  normalizeAttendanceSession,
  normalizeAttendanceStatus,
  summarizeAttendance
} from './attendance'
import {
  LEAVE_TYPES,
  applyLeave,
  cancelLeave,
  canApproveLeave,
  decideLeave,
  findLeaveRequest,
  listApprovalTasks,
  listLeaveRequests,
  normalizeLeaveWindow
} from './leave'
import {
  EXAM_TYPES,
  canGenerateReportCard,
  canPublishScores,
  createExam,
  generateReportCard,
  getExam,
  getScoreSheet,
  listExams,
  listScores,
  normalizeExamDate,
  normalizeFullScore,
  normalizeScoreValue,
  publishExam,
  saveScore
} from './exams'
import {
  allowedAdmissionTransition,
  canConvertApplications,
  canReviewApplications,
  convertApplication,
  createAdmissionCycle,
  createApplication,
  getApplication,
  listAdmissionCycles,
  listApplications,
  reviewApplication
} from './admissions'
import {
  canPublishTimetable,
  createTimetableEntry,
  listTimetable,
  normalizePeriodNo,
  normalizeWeekday,
  publishTimetable
} from './timetable'
import {
  PAYMENT_METHODS,
  approveRefund,
  canApproveRefund,
  computeInvoiceStatus,
  createFeeItem,
  createInvoice,
  listFeeItems,
  listInvoices,
  listRefunds,
  normalizeAmount,
  recordPayment,
  requestRefund
} from './finance'
import {
  ASSET_STATUSES,
  createAsset,
  listAssets,
  transferAsset
} from './assets'
import {
  borrowBook,
  createBook,
  listBooks,
  listLoans,
  returnBook
} from './library'
import {
  REPORT_TYPES,
  attendanceReport,
  canExportReports,
  exportReport,
  financeReport,
  normalizeReportType,
  scoreReport
} from './reports'
import {
  canSendNotification,
  listNotifications,
  sendNotification,
  unreadNotificationCount
} from './notifications'
import { createKnowledgeArticle, searchKnowledge } from './knowledge'
import { IMPORT_MAX_ROWS, importStudentsCsv, parseCsv } from './imports'
import { listDailyReport } from './reportDaily'
import {
  AGENT_TASK_EVENTS,
  advanceAgentTask,
  createAgentTask,
  listAgentTasks
} from './agentTasks'
import {
  createAssignment,
  gradeSubmission,
  listAssignments,
  listElections,
  setCourseElection,
  submitAssignment
} from './teaching'

type Args = Record<string, unknown>
type Capability = CapabilityDefinition<SmsActor, unknown>

const TIMEOUT_MS = 15_000

function isRecord(input: unknown): input is Args {
  return typeof input === 'object' && input !== null && !Array.isArray(input)
}

function text(value: unknown, field: string): string {
  const result = typeof value === 'string' ? value.trim() : ''
  if (!result) throw createError({ statusCode: 400, message: `${field} 不能为空` })
  return result
}

function positiveId(value: unknown, field: string): number {
  const id = Number(value)
  if (!Number.isSafeInteger(id) || id <= 0) {
    throw createError({ statusCode: 400, message: `${field} 必须是正整数` })
  }
  return id
}

function optionalId(value: unknown): number | null {
  if (value === undefined || value === null || value === '') return null
  const id = Number(value)
  return Number.isSafeInteger(id) && id > 0 ? id : null
}

function listSummary(label: string, rows: unknown): string {
  if (!Array.isArray(rows)) return ''
  if (rows.length === 0) return `没有找到${label}`
  const names = rows
    .slice(0, 5)
    .map((row) => {
      if (!isRecord(row)) return String(row)
      return String(row.name ?? row.studentName ?? row.className ?? row.id)
    })
    .filter(Boolean)
  const suffix = rows.length > 5 ? ` 等 ${rows.length} 条` : `，共 ${rows.length} 条`
  return `${label}：${names.join('、')}${suffix}`
}

async function classOptions(actor: SmsActor) {
  const classes = await listClasses(actor, { limit: 100 })
  return {
    classes,
    options: classes.map(row => ({ label: row.name, value: row.id }))
  }
}

const read = (actor: SmsActor, resource: string) => canUseSms(actor, 'read', resource)
const write = (actor: SmsActor, action: 'create' | 'update' | 'delete', resource: string) =>
  canUseSms(actor, action, resource)

// ---------------------------------------------------------------------------
// Read capabilities
// ---------------------------------------------------------------------------

const studentSearch: Capability = {
  id: 'sms.students.search',
  title: '查询学生',
  description: '按姓名或学号搜索当前用户可见的学生（受班级/监护人数据范围限制）',
  resource: 'students',
  moduleId: 'sms',
  operation: 'query',
  riskLevel: 'low',
  permission: 'sms.students.read',
  approval: 'none',
  timeoutMs: TIMEOUT_MS,
  rateLimit: { max: 60, windowMs: 60_000 },
  schema: isRecord,
  inputJsonSchema: {
    type: 'object',
    properties: {
      query: { type: 'string', description: '姓名或学号片段' },
      limit: { type: 'integer', minimum: 1, maximum: 200 }
    },
    additionalProperties: false
  },
  authorize: actor => read(actor, 'students'),
  execute: (input, actor) => {
    const args = isRecord(input) ? input : {}
    return searchStudents(actor, {
      query: typeof args.query === 'string' ? args.query : undefined,
      limit: typeof args.limit === 'number' ? args.limit : undefined
    })
  },
  summarize: rows => listSummary('学生', rows),
  resultView: {
    kind: 'table',
    columns: [
      { key: 'name', label: '姓名' },
      { key: 'studentNo', label: '学号' },
      { key: 'classId', label: '班级 ID', format: 'number' }
    ],
    component: { id: 'sms.student-table' }
  }
}

const studentGet: Capability = {
  id: 'sms.students.get',
  title: '查看学生',
  description: '读取单个学生的档案（姓名、学号、班级）',
  resource: 'students',
  moduleId: 'sms',
  operation: 'query',
  riskLevel: 'low',
  permission: 'sms.students.read',
  approval: 'none',
  timeoutMs: TIMEOUT_MS,
  rateLimit: { max: 60, windowMs: 60_000 },
  schema: isRecord,
  inputJsonSchema: {
    type: 'object',
    properties: { studentId: { type: 'integer', minimum: 1 } },
    required: ['studentId'],
    additionalProperties: false
  },
  authorize: actor => read(actor, 'students'),
  execute: (input, actor) => getStudent(actor, positiveId((input as Args).studentId, 'studentId')),
  summarize: (value) => {
    const row = isRecord(value) ? value : {}
    return `学生：${row.name ?? row.id}（学号 ${row.studentNo ?? '-'}）`
  },
  resultView: {
    kind: 'table',
    columns: [
      { key: 'name', label: '姓名' },
      { key: 'studentNo', label: '学号' },
      { key: 'classId', label: '班级 ID', format: 'number' }
    ]
  }
}

const classList: Capability = {
  id: 'sms.classes.list',
  title: '查询班级',
  description: '列出当前用户可见的班级',
  resource: 'classes',
  moduleId: 'sms',
  operation: 'query',
  riskLevel: 'low',
  permission: 'sms.classes.read',
  approval: 'none',
  timeoutMs: TIMEOUT_MS,
  rateLimit: { max: 60, windowMs: 60_000 },
  schema: isRecord,
  inputJsonSchema: {
    type: 'object',
    properties: { query: { type: 'string' }, limit: { type: 'integer', minimum: 1, maximum: 200 } },
    additionalProperties: false
  },
  authorize: actor => read(actor, 'classes'),
  execute: (input, actor) => {
    const args = isRecord(input) ? input : {}
    return listClasses(actor, {
      query: typeof args.query === 'string' ? args.query : undefined,
      limit: typeof args.limit === 'number' ? args.limit : undefined
    })
  },
  summarize: rows => listSummary('班级', rows),
  resultView: {
    kind: 'table',
    columns: [
      { key: 'name', label: '班级' },
      { key: 'academicYearId', label: '学年 ID', format: 'number' },
      { key: 'gradeId', label: '年级 ID', format: 'number' }
    ]
  }
}

const teacherList: Capability = {
  id: 'sms.teachers.list',
  title: '查询教师',
  description: '列出当前用户可见的教师',
  resource: 'teachers',
  moduleId: 'sms',
  operation: 'query',
  riskLevel: 'low',
  permission: 'sms.teachers.read',
  approval: 'none',
  timeoutMs: TIMEOUT_MS,
  rateLimit: { max: 60, windowMs: 60_000 },
  schema: isRecord,
  inputJsonSchema: {
    type: 'object',
    properties: { query: { type: 'string' }, limit: { type: 'integer', minimum: 1, maximum: 200 } },
    additionalProperties: false
  },
  authorize: actor => read(actor, 'teachers'),
  execute: (input, actor) => {
    const args = isRecord(input) ? input : {}
    return listTeachers(actor, {
      query: typeof args.query === 'string' ? args.query : undefined,
      limit: typeof args.limit === 'number' ? args.limit : undefined
    })
  },
  summarize: rows => listSummary('教师', rows),
  resultView: {
    kind: 'table',
    columns: [
      { key: 'name', label: '姓名' },
      { key: 'employeeNo', label: '工号' },
      { key: 'userId', label: '用户 ID', format: 'number' }
    ],
    component: { id: 'sms.teacher-table' }
  }
}

const enrollmentList: Capability = {
  id: 'sms.enrollments.list',
  title: '查询选课',
  description: '列出当前用户可见的选课记录，可按学生、班级或状态过滤',
  resource: 'enrollments',
  moduleId: 'sms',
  operation: 'query',
  riskLevel: 'low',
  permission: 'sms.enrollments.read',
  approval: 'none',
  timeoutMs: TIMEOUT_MS,
  rateLimit: { max: 60, windowMs: 60_000 },
  schema: isRecord,
  inputJsonSchema: {
    type: 'object',
    properties: {
      studentId: { type: 'integer', minimum: 1 },
      classId: { type: 'integer', minimum: 1 },
      status: { type: 'string', enum: ['active', 'completed', 'withdrawn'] }
    },
    additionalProperties: false
  },
  authorize: actor => read(actor, 'enrollments'),
  execute: (input, actor) => {
    const args = isRecord(input) ? input : {}
    const status = args.status === 'active' || args.status === 'completed' || args.status === 'withdrawn'
      ? args.status
      : null
    return listEnrollments(actor, {
      studentId: optionalId(args.studentId),
      classId: optionalId(args.classId),
      status
    })
  },
  summarize: rows => listSummary('选课记录', rows),
  resultView: {
    kind: 'table',
    columns: [
      { key: 'studentName', label: '学生' },
      { key: 'className', label: '班级' },
      { key: 'status', label: '状态' },
      { key: 'enrolledAt', label: '选课时间', format: 'datetime' }
    ]
  }
}

const guardianList: Capability = {
  id: 'sms.guardians.list',
  title: '查询监护人',
  description: '列出当前用户可见的监护人',
  resource: 'guardians',
  moduleId: 'sms',
  operation: 'query',
  riskLevel: 'low',
  permission: 'sms.guardians.read',
  approval: 'none',
  timeoutMs: TIMEOUT_MS,
  rateLimit: { max: 60, windowMs: 60_000 },
  schema: isRecord,
  inputJsonSchema: {
    type: 'object',
    properties: { query: { type: 'string' }, limit: { type: 'integer', minimum: 1, maximum: 200 } },
    additionalProperties: false
  },
  authorize: actor => read(actor, 'guardians'),
  execute: (input, actor) => {
    const args = isRecord(input) ? input : {}
    return listGuardians(actor, {
      query: typeof args.query === 'string' ? args.query : undefined,
      limit: typeof args.limit === 'number' ? args.limit : undefined
    })
  },
  summarize: rows => listSummary('监护人', rows),
  resultView: {
    kind: 'table',
    columns: [
      { key: 'name', label: '姓名' },
      { key: 'phone', label: '电话' },
      { key: 'userId', label: '用户 ID', format: 'number' }
    ]
  }
}

// ---------------------------------------------------------------------------
// Write capabilities (form + preview; executed only from a confirmed draft)
// ---------------------------------------------------------------------------

const studentCreate: Capability = {
  id: 'sms.students.create',
  title: '新增学生',
  description: '在指定班级创建一名学生（服务端生成组织归属并写入审计）',
  resource: 'students',
  moduleId: 'sms',
  operation: 'command',
  riskLevel: 'medium',
  permission: 'sms.students.create',
  approval: 'confirm',
  timeoutMs: TIMEOUT_MS,
  rateLimit: { max: 20, windowMs: 60_000 },
  schema: isRecord,
  inputJsonSchema: {
    type: 'object',
    properties: {
      name: { type: 'string', description: '学生姓名' },
      studentNo: { type: 'string', description: '学号' },
      classId: { type: 'integer', description: '班级 ID（可用 sms.classes.list 获取）' }
    },
    required: ['name', 'studentNo'],
    additionalProperties: false
  },
  form: {
    fields: [
      { key: 'name', label: '姓名', type: 'text', required: true, placeholder: '例如：张三' },
      { key: 'studentNo', label: '学号', type: 'text', required: true, placeholder: '例如：S2026001' },
      { key: 'classId', label: '班级', type: 'select', help: '留空表示暂不分班' }
    ],
    submitLabel: '创建学生',
    layout: 'two-column'
  },
  authorize: actor => write(actor, 'create', 'students'),
  preview: async (input, actor): Promise<PreviewResult> => {
    const args = isRecord(input) ? input : {}
    const name = text(args.name, '姓名')
    const studentNo = text(args.studentNo, '学号')
    const { options } = await classOptions(actor)
    const classId = optionalId(args.classId)
    let className = '未分班'
    if (classId) {
      await assertClassInContext(actor, classId)
      className = options.find(option => option.value === classId)?.label ?? `#${classId}`
    }
    return {
      summary: `将在「${className}」创建学生「${name}」（学号 ${studentNo}）。`,
      details: { name, studentNo, classId },
      fieldOptions: { classId: options }
    }
  },
  execute: (input, actor) => createStudent(actor, input as Record<string, unknown>),
  summarize: (value) => {
    const row = isRecord(value) ? value : {}
    return `学生「${row.name ?? ''}」已创建（学号 ${row.studentNo ?? '-'}）`
  }
}

const studentUpdate: Capability = {
  id: 'sms.students.update',
  title: '修改学生',
  description: '修改学生姓名、学号或所属班级',
  resource: 'students',
  moduleId: 'sms',
  operation: 'command',
  riskLevel: 'medium',
  permission: 'sms.students.update',
  approval: 'confirm',
  timeoutMs: TIMEOUT_MS,
  rateLimit: { max: 20, windowMs: 60_000 },
  schema: isRecord,
  inputJsonSchema: {
    type: 'object',
    properties: {
      studentId: { type: 'integer', minimum: 1 },
      name: { type: 'string' },
      studentNo: { type: 'string' },
      classId: { type: ['integer', 'null'] }
    },
    required: ['studentId'],
    additionalProperties: false
  },
  form: {
    fields: [
      { key: 'studentId', label: '学生', type: 'select', required: true },
      { key: 'name', label: '姓名', type: 'text' },
      { key: 'studentNo', label: '学号', type: 'text' },
      { key: 'classId', label: '班级', type: 'select' }
    ],
    submitLabel: '保存修改',
    layout: 'two-column'
  },
  authorize: actor => write(actor, 'update', 'students'),
  preview: async (input, actor): Promise<PreviewResult> => {
    const args = isRecord(input) ? input : {}
    const studentId = positiveId(args.studentId, 'studentId')
    const current = await getStudent(actor, studentId)
    const [classes, students] = await Promise.all([
      listClasses(actor, { limit: 100 }),
      searchStudents(actor, { limit: 100 })
    ])
    const classId = optionalId(args.classId)
    if (classId) await assertClassInContext(actor, classId)

    const changes: string[] = []
    if (typeof args.name === 'string' && args.name.trim() && args.name.trim() !== current.name) {
      changes.push(`姓名 ${current.name} → ${args.name.trim()}`)
    }
    if (typeof args.studentNo === 'string' && args.studentNo.trim() && args.studentNo.trim() !== current.studentNo) {
      changes.push(`学号 ${current.studentNo} → ${args.studentNo.trim()}`)
    }
    if (args.classId !== undefined && classId !== current.classId) {
      const target = classId ? classes.find(row => row.id === classId)?.name ?? `#${classId}` : '未分班'
      changes.push(`班级 → ${target}`)
    }
    if (changes.length === 0) {
      throw createError({ statusCode: 400, message: '没有检测到需要修改的字段' })
    }

    return {
      summary: `将修改学生「${current.name}」：${changes.join('；')}。`,
      details: { studentId, before: current, changes },
      fieldOptions: {
        studentId: students.map(row => ({ label: `${row.name}（${row.studentNo}）`, value: row.id })),
        classId: classes.map(row => ({ label: row.name, value: row.id }))
      }
    }
  },
  execute: (input, actor) => updateStudent(actor, input as Record<string, unknown>),
  summarize: (value) => {
    const row = isRecord(value) ? value : {}
    return `学生「${row.name ?? row.id}」已更新`
  }
}

const studentDelete: Capability = {
  id: 'sms.students.delete',
  title: '删除学生',
  description: '软删除学生档案（高风险，需人工审批）',
  resource: 'students',
  moduleId: 'sms',
  operation: 'command',
  riskLevel: 'high',
  permission: 'sms.students.delete',
  approval: 'confirm',
  requiresApproval: true,
  timeoutMs: TIMEOUT_MS,
  rateLimit: { max: 10, windowMs: 60_000 },
  schema: isRecord,
  inputJsonSchema: {
    type: 'object',
    properties: { studentId: { type: 'integer', minimum: 1 } },
    required: ['studentId'],
    additionalProperties: false
  },
  authorize: actor => write(actor, 'delete', 'students'),
  preview: async (input, actor): Promise<PreviewResult> => {
    const studentId = positiveId((input as Args).studentId, 'studentId')
    const current = await getStudent(actor, studentId)
    return {
      summary: `将删除学生「${current.name}」（学号 ${current.studentNo}）。`,
      details: { studentId, name: current.name, studentNo: current.studentNo },
      impact: 1,
      warnings: ['该操作会软删除学生档案，历史选课记录仍保留。']
    }
  },
  execute: (input, actor) => softDeleteStudent(actor, positiveId((input as Args).studentId, 'studentId')),
  summarize: (value) => {
    const row = isRecord(value) ? value : {}
    return `学生「${row.name ?? row.id}」已删除`
  }
}

const enrollmentCreate: Capability = {
  id: 'sms.enrollments.create',
  title: '新增选课',
  description: '把学生加入班级并保留选课历史',
  resource: 'enrollments',
  moduleId: 'sms',
  operation: 'command',
  riskLevel: 'medium',
  permission: 'sms.enrollments.create',
  approval: 'confirm',
  timeoutMs: TIMEOUT_MS,
  rateLimit: { max: 20, windowMs: 60_000 },
  schema: isRecord,
  inputJsonSchema: {
    type: 'object',
    properties: {
      studentId: { type: 'integer', minimum: 1 },
      classId: { type: 'integer', minimum: 1 },
      academicYearId: { type: 'integer', minimum: 1 },
      termId: { type: 'integer', minimum: 1 }
    },
    required: ['studentId', 'classId'],
    additionalProperties: false
  },
  form: {
    fields: [
      { key: 'studentId', label: '学生', type: 'select', required: true },
      { key: 'classId', label: '班级', type: 'select', required: true },
      { key: 'academicYearId', label: '学年', type: 'select', help: '默认使用班级所属学年' },
      { key: 'termId', label: '学期', type: 'select' }
    ],
    submitLabel: '确认选课',
    layout: 'two-column'
  },
  authorize: actor => write(actor, 'create', 'enrollments'),
  preview: async (input, actor): Promise<PreviewResult> => {
    const args = isRecord(input) ? input : {}
    const studentId = positiveId(args.studentId, 'studentId')
    const classId = positiveId(args.classId, 'classId')
    const student = await getStudent(actor, studentId)
    const classRow = await classInContext(actor, classId)
    const [students, classes, years, terms] = await Promise.all([
      searchStudents(actor, { limit: 100 }),
      listClasses(actor, { limit: 100 }),
      listAcademicYears(actor),
      listTerms(actor, classRow.academicYearId ?? undefined)
    ])
    const academicYearId = optionalId(args.academicYearId) ?? classRow.academicYearId
    if (academicYearId) await assertAcademicYearInContext(actor, academicYearId)
    const termId = optionalId(args.termId)
    if (termId) await assertTermInContext(actor, termId, academicYearId ?? undefined)
    const className = classes.find(row => row.id === classId)?.name ?? `#${classId}`

    return {
      summary: `将学生「${student.name}」加入「${className}」。`,
      details: { studentId, classId, academicYearId, termId },
      fieldOptions: {
        studentId: students.map(row => ({ label: `${row.name}（${row.studentNo}）`, value: row.id })),
        classId: classes.map(row => ({ label: row.name, value: row.id })),
        academicYearId: years.map(row => ({ label: row.name, value: row.id })),
        termId: terms.map(row => ({ label: row.name, value: row.id }))
      }
    }
  },
  execute: (input, actor) => enrollStudent(actor, input as Record<string, unknown>),
  summarize: (value) => {
    const row = isRecord(value) ? value : {}
    return `选课已创建（记录 #${row.id ?? '-'}，状态 ${row.status ?? 'active'}）`
  }
}

const enrollmentWithdraw: Capability = {
  id: 'sms.enrollments.withdraw',
  title: '退课',
  description: '退掉一条选课记录（保留历史，不删除数据）',
  resource: 'enrollments',
  moduleId: 'sms',
  operation: 'command',
  riskLevel: 'medium',
  permission: 'sms.enrollments.create',
  approval: 'confirm',
  timeoutMs: TIMEOUT_MS,
  rateLimit: { max: 20, windowMs: 60_000 },
  schema: isRecord,
  inputJsonSchema: {
    type: 'object',
    properties: { enrollmentId: { type: 'integer', minimum: 1 } },
    required: ['enrollmentId'],
    additionalProperties: false
  },
  form: {
    fields: [
      { key: 'enrollmentId', label: '选课记录', type: 'select', required: true }
    ],
    submitLabel: '确认退课',
    layout: 'single-column'
  },
  authorize: actor => write(actor, 'create', 'enrollments'),
  preview: async (input, actor): Promise<PreviewResult> => {
    const enrollmentId = positiveId((input as Args).enrollmentId, 'enrollmentId')
    const current = await findEnrollment(actor, enrollmentId)
    if (current.status !== 'active') {
      throw createError({ statusCode: 409, message: '只有进行中的选课可以退课' })
    }
    const active = await listEnrollments(actor, { status: 'active', limit: 100 })
    return {
      summary: `将为「${current.studentName ?? current.studentId}」退出「${current.className ?? current.classId}」（选课 #${enrollmentId}）。`,
      details: { enrollmentId, studentId: current.studentId, classId: current.classId },
      impact: 1,
      fieldOptions: {
        enrollmentId: active.map(row => ({
          label: `${row.studentName ?? row.studentId} · ${row.className ?? row.classId}`,
          value: row.id
        }))
      }
    }
  },
  execute: (input, actor) => withdrawEnrollment(actor, positiveId((input as Args).enrollmentId, 'enrollmentId')),
  summarize: (value) => {
    const row = isRecord(value) ? value : {}
    return `选课 #${row.id ?? ''} 已退课（状态 ${row.status ?? 'withdrawn'}）`
  }
}

const enrollmentTransfer: Capability = {
  id: 'sms.enrollments.transfer',
  title: '学生转班',
  description: '把学生的进行中选课转入目标班级，原选课记录保留为已退课',
  resource: 'enrollments',
  moduleId: 'sms',
  operation: 'command',
  riskLevel: 'medium',
  permission: 'sms.enrollments.create',
  approval: 'confirm',
  timeoutMs: TIMEOUT_MS,
  rateLimit: { max: 20, windowMs: 60_000 },
  schema: isRecord,
  inputJsonSchema: {
    type: 'object',
    properties: {
      studentId: { type: 'integer', minimum: 1 },
      toClassId: { type: 'integer', minimum: 1 },
      academicYearId: { type: 'integer', minimum: 1 },
      termId: { type: 'integer', minimum: 1 },
      reason: { type: 'string' }
    },
    required: ['studentId', 'toClassId'],
    additionalProperties: false
  },
  form: {
    fields: [
      { key: 'studentId', label: '学生', type: 'select', required: true },
      { key: 'toClassId', label: '转入班级', type: 'select', required: true },
      { key: 'academicYearId', label: '学年', type: 'select', help: '默认使用目标班级所属学年' },
      { key: 'termId', label: '学期', type: 'select' },
      { key: 'reason', label: '转班原因', type: 'textarea', placeholder: '可选，最多 200 字' }
    ],
    submitLabel: '确认转班',
    layout: 'two-column'
  },
  authorize: actor => write(actor, 'create', 'enrollments'),
  preview: async (input, actor): Promise<PreviewResult> => {
    const args = isRecord(input) ? input : {}
    const studentId = positiveId(args.studentId, 'studentId')
    const toClassId = positiveId(args.toClassId, 'toClassId')
    const student = await getStudent(actor, studentId)
    const targetClass = await classInContext(actor, toClassId)
    const [classes, students, active, years] = await Promise.all([
      listClasses(actor, { limit: 100 }),
      searchStudents(actor, { limit: 100 }),
      listEnrollments(actor, { studentId, status: 'active', limit: 20 }),
      listAcademicYears(actor)
    ])
    const academicYearId = optionalId(args.academicYearId) ?? targetClass.academicYearId
    if (academicYearId) await assertAcademicYearInContext(actor, academicYearId)
    const termId = optionalId(args.termId)
    if (termId) await assertTermInContext(actor, termId, academicYearId ?? undefined)
    const terms = academicYearId ? await listTerms(actor, academicYearId) : []
    const fromClassName = student.classId
      ? classes.find(row => row.id === student.classId)?.name ?? `#${student.classId}`
      : null
    const toClassName = classes.find(row => row.id === toClassId)?.name ?? `#${toClassId}`

    return {
      summary: `将学生「${student.name}」${fromClassName ? `从「${fromClassName}」` : ''}转入「${toClassName}」。`,
      details: { studentId, fromClassId: student.classId, toClassId, academicYearId, termId },
      impact: Math.max(active.length, 1),
      warnings: active.length === 0
        ? ['该学生当前没有进行中的选课，提交后将直接建立新选课。']
        : undefined,
      fieldOptions: {
        studentId: students.map(row => ({ label: `${row.name}（${row.studentNo}）`, value: row.id })),
        toClassId: classes.map(row => ({ label: row.name, value: row.id })),
        academicYearId: years.map(row => ({ label: row.name, value: row.id })),
        termId: terms.map(row => ({ label: row.name, value: row.id }))
      }
    }
  },
  execute: (input, actor) => transferStudent(actor, input as Record<string, unknown>),
  summarize: (value) => {
    const row = isRecord(value) ? value : {}
    const enrollment = isRecord(row.enrollment) ? row.enrollment : {}
    const withdrawn = typeof row.withdrawn === 'number' ? row.withdrawn : 0
    return `转班完成（新选课 #${enrollment.id ?? '-'}，原选课 ${withdrawn} 条转为已退课）`
  }
}

const teacherAssign: Capability = {
  id: 'sms.teachers.assign',
  title: '分配任课',
  description: '把教师分配到班级（可选科目、学年、学期）',
  resource: 'teacher-assignments',
  moduleId: 'sms',
  operation: 'command',
  riskLevel: 'medium',
  permission: 'sms.teacher-assignments.create',
  approval: 'confirm',
  timeoutMs: TIMEOUT_MS,
  rateLimit: { max: 20, windowMs: 60_000 },
  schema: isRecord,
  inputJsonSchema: {
    type: 'object',
    properties: {
      teacherUserId: { type: 'integer', minimum: 1 },
      classId: { type: 'integer', minimum: 1 },
      subjectId: { type: 'integer', minimum: 1 },
      academicYearId: { type: 'integer', minimum: 1 },
      termId: { type: 'integer', minimum: 1 }
    },
    required: ['teacherUserId', 'classId'],
    additionalProperties: false
  },
  form: {
    fields: [
      { key: 'teacherUserId', label: '教师', type: 'select', required: true },
      { key: 'classId', label: '班级', type: 'select', required: true },
      { key: 'subjectId', label: '科目', type: 'select' },
      { key: 'academicYearId', label: '学年', type: 'select', help: '默认使用班级所属学年' },
      { key: 'termId', label: '学期', type: 'select' }
    ],
    submitLabel: '确认分配',
    layout: 'two-column'
  },
  authorize: actor => write(actor, 'create', 'teacher-assignments'),
  preview: async (input, actor): Promise<PreviewResult> => {
    const args = isRecord(input) ? input : {}
    const teacherUserId = positiveId(args.teacherUserId, 'teacherUserId')
    const classId = positiveId(args.classId, 'classId')
    const classRow = await classInContext(actor, classId)
    const [teachers, classes, subjects, years] = await Promise.all([
      listTeachers(actor, { limit: 200 }),
      listClasses(actor, { limit: 100 }),
      listSubjects(actor),
      listAcademicYears(actor)
    ])
    const teacher = teachers.find(row => row.userId === teacherUserId)
      ?? { userId: teacherUserId, name: `用户 #${teacherUserId}` }
    const className = classes.find(row => row.id === classId)?.name ?? `#${classId}`
    const subjectId = optionalId(args.subjectId)
    if (subjectId) await assertSubjectInContext(actor, subjectId)
    const termId = optionalId(args.termId)
    if (termId) await assertTermInContext(actor, termId, classRow.academicYearId ?? undefined)
    const academicYearId = optionalId(args.academicYearId) ?? classRow.academicYearId
    if (academicYearId) await assertAcademicYearInContext(actor, academicYearId)
    const terms = await listTerms(actor, academicYearId ?? undefined)

    return {
      summary: `将教师「${teacher.name ?? teacher.userId}」分配到「${className}」${subjectId ? '（含科目）' : ''}。`,
      details: { teacherUserId, classId, subjectId, academicYearId, termId },
      fieldOptions: {
        teacherUserId: teachers.map(row => ({ label: row.name ?? `#${row.userId}`, value: row.userId })),
        classId: classes.map(row => ({ label: row.name, value: row.id })),
        subjectId: subjects.map(row => ({ label: `${row.name}（${row.code}）`, value: row.id })),
        academicYearId: years.map(row => ({ label: row.name, value: row.id })),
        termId: terms.map(row => ({ label: row.name, value: row.id }))
      }
    }
  },
  execute: (input, actor) => assignTeacher(actor, input as Record<string, unknown>),
  summarize: (value) => {
    const row = isRecord(value) ? value : {}
    return `任课分配已创建（记录 #${row.id ?? '-'}）`
  }
}

const guardianLink: Capability = {
  id: 'sms.guardians.link',
  title: '关联监护人',
  description: '把监护人与学生关联',
  resource: 'student-guardians',
  moduleId: 'sms',
  operation: 'command',
  riskLevel: 'medium',
  permission: 'sms.student-guardians.create',
  approval: 'confirm',
  timeoutMs: TIMEOUT_MS,
  rateLimit: { max: 20, windowMs: 60_000 },
  schema: isRecord,
  inputJsonSchema: {
    type: 'object',
    properties: {
      studentId: { type: 'integer', minimum: 1 },
      guardianId: { type: 'integer', minimum: 1 },
      relation: { type: 'string' },
      isPrimary: { type: 'boolean' }
    },
    required: ['studentId', 'guardianId'],
    additionalProperties: false
  },
  form: {
    fields: [
      { key: 'studentId', label: '学生', type: 'select', required: true },
      { key: 'guardianId', label: '监护人', type: 'select', required: true },
      { key: 'relation', label: '关系', type: 'text', placeholder: '例如：父亲、母亲' },
      { key: 'isPrimary', label: '主要联系人', type: 'boolean' }
    ],
    submitLabel: '确认关联',
    layout: 'two-column'
  },
  authorize: actor => write(actor, 'create', 'student-guardians'),
  preview: async (input, actor): Promise<PreviewResult> => {
    const args = isRecord(input) ? input : {}
    const studentId = positiveId(args.studentId, 'studentId')
    const guardianId = positiveId(args.guardianId, 'guardianId')
    const [student, students, guardians] = await Promise.all([
      getStudent(actor, studentId),
      searchStudents(actor, { limit: 100 }),
      listGuardians(actor, { limit: 100 })
    ])
    await assertGuardianInContext(actor, guardianId)
    const guardian = guardians.find(row => row.id === guardianId)
    const relation = typeof args.relation === 'string' && args.relation.trim() ? args.relation.trim() : null
    return {
      summary: `将监护人「${guardian?.name ?? `#${guardianId}`}」关联到学生「${student.name}」${relation ? `（关系：${relation}）` : ''}。`,
      details: { studentId, guardianId, relation, isPrimary: args.isPrimary === true },
      fieldOptions: {
        studentId: students.map(row => ({ label: `${row.name}（${row.studentNo}）`, value: row.id })),
        guardianId: guardians.map(row => ({ label: row.name ?? `#${row.id}`, value: row.id }))
      }
    }
  },
  execute: (input, actor) => linkGuardian(actor, input as Record<string, unknown>),
  summarize: (value) => {
    const row = isRecord(value) ? value : {}
    return `监护人关联已创建（记录 #${row.id ?? '-'}）`
  }
}

// ---------------------------------------------------------------------------
// Attendance (Phase 0 / Slice A)
// ---------------------------------------------------------------------------

const attendanceRoster: Capability = {
  id: 'sms.attendance.roster',
  title: '班级考勤名单',
  description: '查看指定班级某天（或某个时段）的学生名单与当前考勤状态',
  resource: 'attendance',
  moduleId: 'sms',
  operation: 'query',
  riskLevel: 'low',
  permission: 'sms.attendance.read',
  approval: 'none',
  timeoutMs: TIMEOUT_MS,
  rateLimit: { max: 60, windowMs: 60_000 },
  schema: isRecord,
  inputJsonSchema: {
    type: 'object',
    properties: {
      classId: { type: 'integer', minimum: 1 },
      date: { type: 'string', description: 'YYYY-MM-DD，默认今天' },
      session: { type: 'string', enum: ['full_day', 'morning', 'afternoon', 'period'] }
    },
    additionalProperties: false
  },
  authorize: actor => read(actor, 'attendance'),
  execute: async (input, actor) => {
    const args = isRecord(input) ? input : {}
    const roster = await listAttendanceRoster(actor, {
      classId: args.classId,
      date: args.date,
      session: args.session
    })
    return roster.rows.map(row => ({
      ...row,
      className: roster.className,
      date: roster.date,
      session: roster.session
    }))
  },
  summarize: (value) => {
    if (!Array.isArray(value)) return '考勤名单'
    const recorded = value.filter(row => isRecord(row) && row.status).length
    return `考勤名单：${value.length} 名学生，已记录 ${recorded} 人`
  },
  resultView: {
    kind: 'table',
    columns: [
      { key: 'studentName', label: '姓名' },
      { key: 'studentNo', label: '学号' },
      { key: 'status', label: '状态' },
      { key: 'remark', label: '备注' }
    ],
    component: { id: 'sms.attendance-roster' }
  }
}

const attendanceRecords: Capability = {
  id: 'sms.attendance.records.list',
  title: '查询考勤记录',
  description: '按班级、学生、日期范围或状态查询考勤记录（受班级数据范围限制）',
  resource: 'attendance',
  moduleId: 'sms',
  operation: 'query',
  riskLevel: 'low',
  permission: 'sms.attendance.read',
  approval: 'none',
  timeoutMs: TIMEOUT_MS,
  rateLimit: { max: 60, windowMs: 60_000 },
  schema: isRecord,
  inputJsonSchema: {
    type: 'object',
    properties: {
      classId: { type: 'integer', minimum: 1 },
      studentId: { type: 'integer', minimum: 1 },
      from: { type: 'string', description: 'YYYY-MM-DD' },
      to: { type: 'string', description: 'YYYY-MM-DD' },
      status: { type: 'string', enum: [...ATTENDANCE_STATUSES] },
      limit: { type: 'integer', minimum: 1, maximum: 200 }
    },
    additionalProperties: false
  },
  authorize: actor => read(actor, 'attendance'),
  execute: (input, actor) => listAttendanceRecords(actor, isRecord(input) ? input : {}),
  summarize: rows => listSummary('考勤记录', rows),
  resultView: {
    kind: 'table',
    columns: [
      { key: 'attendanceDate', label: '日期' },
      { key: 'studentName', label: '姓名' },
      { key: 'className', label: '班级' },
      { key: 'session', label: '时段' },
      { key: 'status', label: '状态' },
      { key: 'remark', label: '备注' }
    ]
  }
}

const attendanceSummary: Capability = {
  id: 'sms.attendance.summary',
  title: '考勤统计',
  description: '按班级汇总一段时间内的出勤、迟到、缺勤数量与缺勤率',
  resource: 'attendance',
  moduleId: 'sms',
  operation: 'query',
  riskLevel: 'low',
  permission: 'sms.attendance.read',
  approval: 'none',
  timeoutMs: TIMEOUT_MS,
  rateLimit: { max: 30, windowMs: 60_000 },
  schema: isRecord,
  inputJsonSchema: {
    type: 'object',
    properties: {
      classId: { type: 'integer', minimum: 1 },
      from: { type: 'string', description: 'YYYY-MM-DD，默认 30 天前' },
      to: { type: 'string', description: 'YYYY-MM-DD，默认今天' }
    },
    additionalProperties: false
  },
  authorize: actor => read(actor, 'attendance'),
  execute: (input, actor) => summarizeAttendance(actor, isRecord(input) ? input : {}),
  summarize: rows => listSummary('班级考勤统计', rows),
  resultView: {
    kind: 'table',
    columns: [
      { key: 'className', label: '班级' },
      { key: 'total', label: '记录数', format: 'number' },
      { key: 'present', label: '出勤', format: 'number' },
      { key: 'late', label: '迟到', format: 'number' },
      { key: 'absent', label: '缺勤', format: 'number' },
      { key: 'absenceRate', label: '缺勤率(%)', format: 'number' }
    ]
  }
}

const attendanceMark: Capability = {
  id: 'sms.attendance.mark',
  title: '记录考勤',
  description: '为一名学生登记考勤；同一天同一时段的重复登记视为更正',
  resource: 'attendance',
  moduleId: 'sms',
  operation: 'command',
  riskLevel: 'medium',
  permission: 'sms.attendance.update',
  approval: 'confirm',
  timeoutMs: TIMEOUT_MS,
  rateLimit: { max: 60, windowMs: 60_000 },
  schema: isRecord,
  inputJsonSchema: {
    type: 'object',
    properties: {
      classId: { type: 'integer', minimum: 1 },
      studentId: { type: 'integer', minimum: 1 },
      date: { type: 'string', description: 'YYYY-MM-DD，默认今天' },
      session: { type: 'string', enum: [...ATTENDANCE_SESSIONS] },
      periodNo: { type: 'integer', minimum: 1, maximum: 12 },
      status: { type: 'string', enum: [...ATTENDANCE_STATUSES] },
      remark: { type: 'string' }
    },
    required: ['studentId', 'status'],
    additionalProperties: false
  },
  form: {
    fields: [
      { key: 'classId', label: '班级', type: 'select', required: true },
      { key: 'studentId', label: '学生', type: 'select', required: true },
      { key: 'date', label: '日期', type: 'date', required: true },
      { key: 'session', label: '时段', type: 'select', required: true },
      { key: 'periodNo', label: '节次', type: 'number', help: '仅“按节次”时需要，1–12' },
      { key: 'status', label: '考勤状态', type: 'select', required: true },
      { key: 'remark', label: '备注', type: 'text' }
    ],
    submitLabel: '保存考勤',
    layout: 'two-column'
  },
  authorize: actor => write(actor, 'update', 'attendance'),
  preview: async (input, actor): Promise<PreviewResult> => {
    const args = isRecord(input) ? input : {}
    const studentId = positiveId(args.studentId, 'studentId')
    const classId = positiveId(args.classId, 'classId')
    const date = normalizeAttendanceDate(args.date)
    const session = normalizeAttendanceSession(args.session)
    const status = normalizeAttendanceStatus(args.status)

    const [classes, roster] = await Promise.all([
      listClasses(actor, { limit: 100 }),
      listAttendanceRoster(actor, { classId, date, session })
    ])
    const student = roster.rows.find(row => row.studentId === studentId)
    if (!student) {
      throw createError({ statusCode: 400, message: '该学生不在所选班级中' })
    }
    const current = student.status ?? '未记录'
    const className = classes.find(row => row.id === classId)?.name ?? roster.className
    const labels: Record<string, string> = {
      present: '出勤',
      late: '迟到',
      absent: '缺勤',
      excused: '请假（准假）',
      leave: '请假'
    }

    return {
      summary: `将把「${student.studentName}」${date}（${session}）的考勤从 ${current} 记为 ${labels[status] ?? status}。`,
      details: {
        classId,
        className,
        studentId,
        studentName: student.studentName,
        date,
        session,
        before: student.status,
        after: status
      },
      impact: 1,
      fieldOptions: {
        classId: classes.map(row => ({ label: row.name, value: row.id })),
        studentId: roster.rows.map(row => ({ label: `${row.studentName}（${row.studentNo}）`, value: row.studentId })),
        session: [
          { label: '全天', value: 'full_day' },
          { label: '上午', value: 'morning' },
          { label: '下午', value: 'afternoon' },
          { label: '按节次', value: 'period' }
        ],
        status: [
          { label: '出勤', value: 'present' },
          { label: '迟到', value: 'late' },
          { label: '缺勤', value: 'absent' },
          { label: '准假', value: 'excused' },
          { label: '请假', value: 'leave' }
        ]
      }
    }
  },
  execute: (input, actor) => markAttendance(actor, input as Record<string, unknown>),
  summarize: (value) => {
    const row = isRecord(value) ? value : {}
    return `${row.studentName ?? '学生'} ${row.date ?? ''} 考勤已记录为 ${row.status ?? '-'}${row.corrected ? '（更正）' : ''}`
  }
}

const attendanceAlerts: Capability = {
  id: 'sms.attendance.alerts.list',
  title: '考勤预警',
  description: '列出连续缺勤或月度缺勤率超阈值的预警',
  resource: 'attendance',
  moduleId: 'sms',
  operation: 'query',
  riskLevel: 'low',
  permission: 'sms.attendance.read',
  approval: 'none',
  timeoutMs: TIMEOUT_MS,
  rateLimit: { max: 60, windowMs: 60_000 },
  schema: isRecord,
  inputJsonSchema: {
    type: 'object',
    properties: {
      status: { type: 'string', enum: ['open', 'acknowledged', 'resolved'] },
      limit: { type: 'integer', minimum: 1, maximum: 200 }
    },
    additionalProperties: false
  },
  authorize: actor => read(actor, 'attendance'),
  execute: (input, actor) => listAttendanceAlerts(actor, isRecord(input) ? input : {}),
  summarize: rows => listSummary('考勤预警', rows),
  resultView: {
    kind: 'table',
    columns: [
      { key: 'studentName', label: '姓名' },
      { key: 'className', label: '班级' },
      { key: 'rule', label: '规则' },
      { key: 'windowStart', label: '开始' },
      { key: 'windowEnd', label: '结束' },
      { key: 'metric', label: '指标', format: 'number' },
      { key: 'status', label: '状态' }
    ]
  }
}

const attendanceAlertAck: Capability = {
  id: 'sms.attendance.alerts.ack',
  title: '确认考勤预警',
  description: '把一条考勤预警标记为已处理',
  resource: 'attendance',
  moduleId: 'sms',
  operation: 'command',
  riskLevel: 'low',
  permission: 'sms.attendance.update',
  approval: 'confirm',
  timeoutMs: TIMEOUT_MS,
  rateLimit: { max: 30, windowMs: 60_000 },
  schema: isRecord,
  inputJsonSchema: {
    type: 'object',
    properties: { alertId: { type: 'integer', minimum: 1 } },
    required: ['alertId'],
    additionalProperties: false
  },
  form: {
    fields: [
      { key: 'alertId', label: '预警', type: 'select', required: true }
    ],
    submitLabel: '标记已处理'
  },
  authorize: actor => write(actor, 'update', 'attendance'),
  preview: async (input, actor): Promise<PreviewResult> => {
    const alertId = positiveId((input as Args).alertId, 'alertId')
    const alerts = await listAttendanceAlerts(actor, { status: 'open', limit: 100 })
    const alert = alerts.find(row => row.id === alertId)
    if (!alert) {
      throw createError({ statusCode: 400, message: '预警不存在或已处理' })
    }
    return {
      summary: `将把「${alert.studentName ?? `#${alert.studentId}`}」的考勤预警（${alert.rule}）标记为已处理。`,
      details: { alertId, studentId: alert.studentId, rule: alert.rule, windowStart: alert.windowStart },
      impact: 1,
      fieldOptions: {
        alertId: alerts.map(row => ({
          label: `${row.studentName ?? `#${row.studentId}`} · ${row.rule}（${row.windowStart}）`,
          value: row.id
        }))
      }
    }
  },
  execute: (input, actor) => acknowledgeAttendanceAlert(actor, positiveId((input as Args).alertId, 'alertId')),
  summarize: () => '考勤预警已标记为已处理'
}

// ---------------------------------------------------------------------------
// Leave & approvals (Slice A)
// ---------------------------------------------------------------------------

const LEAVE_TYPE_LABELS: Record<string, string> = {
  sick: '病假',
  personal: '事假',
  other: '其他'
}

const LEAVE_STATUS_LABELS: Record<string, string> = {
  pending: '待审批',
  approved: '已通过',
  rejected: '已驳回',
  cancelled: '已撤销'
}

const leaveApply: Capability = {
  id: 'sms.leave.apply',
  title: '申请请假',
  description: '为学生提交请假申请；3 天及以上自动追加年级组长复核',
  resource: 'leave',
  moduleId: 'sms',
  operation: 'command',
  riskLevel: 'low',
  permission: 'sms.leave.create',
  approval: 'confirm',
  timeoutMs: TIMEOUT_MS,
  rateLimit: { max: 20, windowMs: 60_000 },
  schema: isRecord,
  inputJsonSchema: {
    type: 'object',
    properties: {
      studentId: { type: 'integer', minimum: 1 },
      type: { type: 'string', enum: [...LEAVE_TYPES] },
      startAt: { type: 'string', description: 'YYYY-MM-DD' },
      endAt: { type: 'string', description: 'YYYY-MM-DD' },
      reason: { type: 'string' }
    },
    required: ['studentId', 'type', 'startAt', 'endAt'],
    additionalProperties: false
  },
  form: {
    fields: [
      { key: 'studentId', label: '学生', type: 'select', required: true },
      {
        key: 'type',
        label: '请假类型',
        type: 'select',
        required: true,
        options: LEAVE_TYPES.map(type => ({ label: LEAVE_TYPE_LABELS[type] ?? type, value: type }))
      },
      { key: 'startAt', label: '开始日期', type: 'date', required: true },
      { key: 'endAt', label: '结束日期', type: 'date', required: true },
      { key: 'reason', label: '请假事由', type: 'textarea', placeholder: '可选，最多 500 字' }
    ],
    submitLabel: '提交申请',
    layout: 'two-column'
  },
  authorize: actor => write(actor, 'create', 'leave'),
  preview: async (input, actor): Promise<PreviewResult> => {
    const args = isRecord(input) ? input : {}
    const studentId = positiveId(args.studentId, 'studentId')
    const type = String(args.type ?? '')
    if (!(LEAVE_TYPES as readonly string[]).includes(type)) {
      throw createError({ statusCode: 400, message: `type must be one of ${LEAVE_TYPES.join(', ')}` })
    }
    const window = normalizeLeaveWindow(args.startAt, args.endAt)
    const student = await getStudent(actor, studentId)
    const students = await searchStudents(actor, { limit: 100 })
    const escalated = window.days >= 3

    return {
      summary: `将为「${student.name}」提交 ${window.startDate} 至 ${window.endDate} 的${LEAVE_TYPE_LABELS[type]}申请（共 ${window.days} 天）${escalated ? '，需年级组长复核' : ''}。`,
      details: {
        studentId,
        studentName: student.name,
        type,
        startAt: window.startDate,
        endAt: window.endDate,
        days: window.days,
        escalated
      },
      impact: 1,
      warnings: escalated ? ['请假达到 3 天，班主任通过后还需年级组长复核。'] : undefined,
      fieldOptions: {
        studentId: students.map(row => ({ label: `${row.name}（${row.studentNo}）`, value: row.id }))
      }
    }
  },
  execute: (input, actor) => applyLeave(actor, input as Record<string, unknown>),
  summarize: (value) => {
    const row = isRecord(value) ? value : {}
    return `请假申请 #${row.id ?? '-'} 已提交（${row.startAt ?? ''} 至 ${row.endAt ?? ''}${row.escalated ? '，待年级组长复核' : ''}）`
  }
}

const leaveList: Capability = {
  id: 'sms.leave.list',
  title: '请假列表',
  description: '查询请假申请（学生/家长只看自己或子女，教师看本人班级）',
  resource: 'leave',
  moduleId: 'sms',
  operation: 'query',
  riskLevel: 'low',
  permission: 'sms.leave.read',
  approval: 'none',
  timeoutMs: TIMEOUT_MS,
  rateLimit: { max: 60, windowMs: 60_000 },
  schema: isRecord,
  inputJsonSchema: {
    type: 'object',
    properties: {
      status: { type: 'string', enum: ['pending', 'approved', 'rejected', 'cancelled'] },
      type: { type: 'string', enum: [...LEAVE_TYPES] },
      studentId: { type: 'integer', minimum: 1 },
      limit: { type: 'integer', minimum: 1, maximum: 200 }
    },
    additionalProperties: false
  },
  authorize: actor => read(actor, 'leave'),
  execute: (input, actor) => listLeaveRequests(actor, isRecord(input) ? input : {}),
  summarize: rows => listSummary('请假申请', rows),
  resultView: {
    kind: 'table',
    columns: [
      { key: 'studentName', label: '学生' },
      { key: 'className', label: '班级' },
      { key: 'type', label: '类型' },
      { key: 'startAt', label: '开始', format: 'datetime' },
      { key: 'endAt', label: '结束', format: 'datetime' },
      { key: 'days', label: '天数', format: 'number' },
      { key: 'status', label: '状态' },
      { key: 'reason', label: '事由' }
    ],
    component: { id: 'sms.leave-table' }
  }
}

const approvalsList: Capability = {
  id: 'sms.approvals.list',
  title: '待办审批',
  description: '列出分配给当前用户的业务审批（默认待审批）',
  resource: 'approvals',
  moduleId: 'sms',
  operation: 'query',
  riskLevel: 'low',
  permission: 'sms.approvals.read',
  approval: 'none',
  timeoutMs: TIMEOUT_MS,
  rateLimit: { max: 60, windowMs: 60_000 },
  schema: isRecord,
  inputJsonSchema: {
    type: 'object',
    properties: {
      status: { type: 'string', enum: ['pending', 'approved', 'rejected', 'cancelled'] },
      limit: { type: 'integer', minimum: 1, maximum: 200 }
    },
    additionalProperties: false
  },
  authorize: actor => read(actor, 'leave') || read(actor, 'approvals'),
  execute: (input, actor) => listApprovalTasks(actor, isRecord(input) ? input : {}),
  summarize: rows => listSummary('待办审批', rows),
  resultView: {
    kind: 'table',
    columns: [
      { key: 'step', label: '步骤', format: 'number' },
      { key: 'studentName', label: '学生' },
      { key: 'className', label: '班级' },
      { key: 'type', label: '类型' },
      { key: 'startAt', label: '开始', format: 'datetime' },
      { key: 'endAt', label: '结束', format: 'datetime' },
      { key: 'days', label: '天数', format: 'number' },
      { key: 'leaveStatus', label: '请假状态' }
    ]
  }
}

const leaveApprove: Capability = {
  id: 'sms.leave.approve',
  title: '同意请假',
  description: '同意一条待审批的请假申请；通过后自动写入学生考勤',
  resource: 'leave',
  moduleId: 'sms',
  operation: 'command',
  riskLevel: 'medium',
  permission: 'sms.leave.approve',
  approval: 'confirm',
  timeoutMs: TIMEOUT_MS,
  rateLimit: { max: 30, windowMs: 60_000 },
  schema: isRecord,
  inputJsonSchema: {
    type: 'object',
    properties: {
      leaveId: { type: 'integer', minimum: 1 },
      comment: { type: 'string' }
    },
    required: ['leaveId'],
    additionalProperties: false
  },
  form: {
    fields: [
      { key: 'leaveId', label: '请假申请', type: 'select', required: true },
      { key: 'comment', label: '审批意见', type: 'text', placeholder: '可选' }
    ],
    submitLabel: '同意',
    layout: 'single-column'
  },
  authorize: actor => canApproveLeave(actor),
  preview: async (input, actor): Promise<PreviewResult> => {
    const leaveId = positiveId((input as Args).leaveId, 'leaveId')
    const [leave, pending] = await Promise.all([
      findLeaveRequest(actor, leaveId),
      listLeaveRequests(actor, { status: 'pending', limit: 100 })
    ])
    if (leave.status !== 'pending') {
      throw createError({ statusCode: 409, message: `请假当前状态为 ${LEAVE_STATUS_LABELS[leave.status] ?? leave.status}` })
    }
    return {
      summary: `将同意「${leave.studentName ?? `#${leave.studentId}`}」${leave.startAt.toISOString().slice(0, 10)} 至 ${leave.endAt.toISOString().slice(0, 10)} 的${LEAVE_TYPE_LABELS[leave.type] ?? leave.type}申请（${leave.days} 天）。`,
      details: { leaveId, studentId: leave.studentId, type: leave.type, days: leave.days },
      impact: 1,
      warnings: leave.days >= 3 ? ['该请假需多级审批；本次通过后若仍有下一步，申请保持待审批。'] : undefined,
      fieldOptions: {
        leaveId: pending.map(row => ({
          label: `${row.studentName ?? `#${row.studentId}`} · ${row.startAt.toISOString().slice(0, 10)}（${row.days} 天）`,
          value: row.id
        }))
      }
    }
  },
  execute: (input, actor) => decideLeave(actor, {
    leaveId: (input as Args).leaveId,
    decision: 'approve',
    comment: (input as Args).comment
  }),
  summarize: (value) => {
    const row = isRecord(value) ? value : {}
    return row.escalated ? '本步骤已通过，申请进入下一步审批' : '请假已通过，考勤已写入'
  }
}

const leaveReject: Capability = {
  id: 'sms.leave.reject',
  title: '驳回请假',
  description: '驳回一条待审批的请假申请（需填写原因）',
  resource: 'leave',
  moduleId: 'sms',
  operation: 'command',
  riskLevel: 'medium',
  permission: 'sms.leave.approve',
  approval: 'confirm',
  timeoutMs: TIMEOUT_MS,
  rateLimit: { max: 30, windowMs: 60_000 },
  schema: isRecord,
  inputJsonSchema: {
    type: 'object',
    properties: {
      leaveId: { type: 'integer', minimum: 1 },
      comment: { type: 'string' }
    },
    required: ['leaveId', 'comment'],
    additionalProperties: false
  },
  form: {
    fields: [
      { key: 'leaveId', label: '请假申请', type: 'select', required: true },
      { key: 'comment', label: '驳回原因', type: 'textarea', required: true, placeholder: '必填，最多 500 字' }
    ],
    submitLabel: '驳回',
    layout: 'single-column'
  },
  authorize: actor => canApproveLeave(actor),
  preview: async (input, actor): Promise<PreviewResult> => {
    const args = isRecord(input) ? input : {}
    const leaveId = positiveId(args.leaveId, 'leaveId')
    const comment = text(args.comment, '驳回原因')
    const [leave, pending] = await Promise.all([
      findLeaveRequest(actor, leaveId),
      listLeaveRequests(actor, { status: 'pending', limit: 100 })
    ])
    if (leave.status !== 'pending') {
      throw createError({ statusCode: 409, message: `请假当前状态为 ${LEAVE_STATUS_LABELS[leave.status] ?? leave.status}` })
    }
    return {
      summary: `将驳回「${leave.studentName ?? `#${leave.studentId}`}」的${LEAVE_TYPE_LABELS[leave.type] ?? leave.type}申请，原因：${comment}。`,
      details: { leaveId, studentId: leave.studentId, comment },
      impact: 1,
      fieldOptions: {
        leaveId: pending.map(row => ({
          label: `${row.studentName ?? `#${row.studentId}`} · ${row.startAt.toISOString().slice(0, 10)}（${row.days} 天）`,
          value: row.id
        }))
      }
    }
  },
  execute: (input, actor) => decideLeave(actor, {
    leaveId: (input as Args).leaveId,
    decision: 'reject',
    comment: (input as Args).comment
  }),
  summarize: () => '请假已驳回'
}

const leaveCancel: Capability = {
  id: 'sms.leave.cancel',
  title: '撤销请假',
  description: '撤销本人（或管理范围内）的请假；已通过的请假会回滚对应考勤',
  resource: 'leave',
  moduleId: 'sms',
  operation: 'command',
  riskLevel: 'low',
  permission: 'sms.leave.create',
  approval: 'confirm',
  timeoutMs: TIMEOUT_MS,
  rateLimit: { max: 30, windowMs: 60_000 },
  schema: isRecord,
  inputJsonSchema: {
    type: 'object',
    properties: { leaveId: { type: 'integer', minimum: 1 } },
    required: ['leaveId'],
    additionalProperties: false
  },
  form: {
    fields: [
      { key: 'leaveId', label: '请假申请', type: 'select', required: true }
    ],
    submitLabel: '撤销申请'
  },
  authorize: actor => write(actor, 'create', 'leave'),
  preview: async (input, actor): Promise<PreviewResult> => {
    const leaveId = positiveId((input as Args).leaveId, 'leaveId')
    const [leave, rows] = await Promise.all([
      findLeaveRequest(actor, leaveId),
      listLeaveRequests(actor, { limit: 100 })
    ])
    if (leave.status !== 'pending' && leave.status !== 'approved') {
      throw createError({ statusCode: 409, message: `请假当前状态为 ${LEAVE_STATUS_LABELS[leave.status] ?? leave.status}` })
    }
    const cancellable = rows.filter(row => row.status === 'pending' || row.status === 'approved')
    return {
      summary: `将撤销「${leave.studentName ?? `#${leave.studentId}`}」${leave.startAt.toISOString().slice(0, 10)} 至 ${leave.endAt.toISOString().slice(0, 10)} 的请假申请。`,
      details: { leaveId, status: leave.status, days: leave.days },
      impact: 1,
      warnings: leave.status === 'approved' ? ['已通过的请假撤销后，对应日期的考勤会回退为缺勤。'] : undefined,
      fieldOptions: {
        leaveId: cancellable.map(row => ({
          label: `${row.studentName ?? `#${row.studentId}`} · ${row.startAt.toISOString().slice(0, 10)}（${LEAVE_STATUS_LABELS[row.status] ?? row.status}）`,
          value: row.id
        }))
      }
    }
  },
  execute: (input, actor) => cancelLeave(actor, positiveId((input as Args).leaveId, 'leaveId')),
  summarize: (value) => {
    const row = isRecord(value) ? value : {}
    return `请假已撤销${typeof row.revertedAttendance === 'number' && row.revertedAttendance > 0 ? `，回退考勤 ${row.revertedAttendance} 条` : ''}`
  }
}

// ---------------------------------------------------------------------------
// Exams, scores & report cards (Slice B)
// ---------------------------------------------------------------------------

const EXAM_TYPE_LABELS: Record<string, string> = {
  regular: '常规',
  midterm: '期中',
  final: '期末',
  quiz: '测验',
  other: '其他'
}

const EXAM_STATUS_LABELS: Record<string, string> = {
  draft: '草稿',
  published: '已发布',
  closed: '已结束'
}

async function draftExamOptions(actor: SmsActor) {
  const exams = await listExams(actor, { status: 'draft', limit: 100 })
  return exams
}

const examsList: Capability = {
  id: 'sms.exams.list',
  title: '考试列表',
  description: '按学年/班级/科目查询考试（学生与家长只看已发布考试）',
  resource: 'exams',
  moduleId: 'sms',
  operation: 'query',
  riskLevel: 'low',
  permission: 'sms.scores.read',
  approval: 'none',
  timeoutMs: TIMEOUT_MS,
  rateLimit: { max: 60, windowMs: 60_000 },
  schema: isRecord,
  inputJsonSchema: {
    type: 'object',
    properties: {
      termId: { type: 'integer', minimum: 1 },
      classId: { type: 'integer', minimum: 1 },
      subjectId: { type: 'integer', minimum: 1 },
      status: { type: 'string', enum: ['draft', 'published', 'closed'] },
      limit: { type: 'integer', minimum: 1, maximum: 200 }
    },
    additionalProperties: false
  },
  authorize: actor => read(actor, 'scores'),
  execute: (input, actor) => listExams(actor, isRecord(input) ? input : {}),
  summarize: rows => listSummary('考试', rows),
  resultView: {
    kind: 'table',
    columns: [
      { key: 'name', label: '考试' },
      { key: 'className', label: '班级' },
      { key: 'subjectName', label: '科目' },
      { key: 'examDate', label: '日期' },
      { key: 'fullScore', label: '满分', format: 'number' },
      { key: 'status', label: '状态' }
    ]
  }
}

const examsCreate: Capability = {
  id: 'sms.exams.create',
  title: '新建考试',
  description: '为班级创建一场考试（草稿状态，录入成绩后可发布）',
  resource: 'exams',
  moduleId: 'sms',
  operation: 'command',
  riskLevel: 'medium',
  permission: 'sms.exams.create',
  approval: 'confirm',
  timeoutMs: TIMEOUT_MS,
  rateLimit: { max: 20, windowMs: 60_000 },
  schema: isRecord,
  inputJsonSchema: {
    type: 'object',
    properties: {
      name: { type: 'string' },
      classId: { type: 'integer', minimum: 1 },
      subjectId: { type: 'integer', minimum: 1 },
      termId: { type: 'integer', minimum: 1 },
      examType: { type: 'string', enum: [...EXAM_TYPES] },
      examDate: { type: 'string', description: 'YYYY-MM-DD' },
      fullScore: { type: 'number', minimum: 1, maximum: 1000 }
    },
    required: ['name', 'classId', 'examDate'],
    additionalProperties: false
  },
  form: {
    fields: [
      { key: 'name', label: '考试名称', type: 'text', required: true, placeholder: '例如：期中数学' },
      { key: 'classId', label: '班级', type: 'select', required: true },
      { key: 'subjectId', label: '科目', type: 'select' },
      {
        key: 'examType',
        label: '考试类型',
        type: 'select',
        options: EXAM_TYPES.map(type => ({ label: EXAM_TYPE_LABELS[type] ?? type, value: type }))
      },
      { key: 'examDate', label: '考试日期', type: 'date', required: true },
      { key: 'fullScore', label: '满分', type: 'number', help: '默认 100' },
      { key: 'termId', label: '学期', type: 'select' }
    ],
    submitLabel: '创建考试',
    layout: 'two-column'
  },
  authorize: actor => write(actor, 'create', 'exams'),
  preview: async (input, actor): Promise<PreviewResult> => {
    const args = isRecord(input) ? input : {}
    const name = text(args.name, '考试名称')
    const classId = positiveId(args.classId, 'classId')
    const examDate = normalizeExamDate(args.examDate)
    const fullScore = normalizeFullScore(args.fullScore)
    const [classes, subjects, years, terms] = await Promise.all([
      listClasses(actor, { limit: 100 }),
      listSubjects(actor),
      listAcademicYears(actor),
      listTerms(actor)
    ])
    const className = classes.find(row => row.id === classId)?.name ?? `#${classId}`
    const subjectId = optionalId(args.subjectId)
    const subjectName = subjects.find(row => row.id === subjectId)?.name
    return {
      summary: `将在「${className}」创建考试「${name}」${subjectName ? `（${subjectName}）` : ''}，日期 ${examDate}，满分 ${fullScore}。`,
      details: { name, classId, subjectId, termId: optionalId(args.termId), examDate, fullScore },
      impact: 1,
      fieldOptions: {
        classId: classes.map(row => ({ label: row.name, value: row.id })),
        subjectId: subjects.map(row => ({ label: `${row.name}（${row.code}）`, value: row.id })),
        termId: terms.map(row => ({ label: row.name, value: row.id })),
        academicYearId: years.map(row => ({ label: row.name, value: row.id }))
      }
    }
  },
  execute: (input, actor) => createExam(actor, input as Record<string, unknown>),
  summarize: (value) => {
    const row = isRecord(value) ? value : {}
    return `考试「${row.name ?? ''}」已创建（#${row.id ?? '-'}，草稿）`
  }
}

const scoresSheet: Capability = {
  id: 'sms.scores.sheet',
  title: '成绩录入表',
  description: '查看某场考试的班级成绩单（含未录入学生）',
  resource: 'scores',
  moduleId: 'sms',
  operation: 'query',
  riskLevel: 'low',
  permission: 'sms.scores.read',
  approval: 'none',
  timeoutMs: TIMEOUT_MS,
  rateLimit: { max: 60, windowMs: 60_000 },
  schema: isRecord,
  inputJsonSchema: {
    type: 'object',
    properties: { examId: { type: 'integer', minimum: 1 } },
    required: ['examId'],
    additionalProperties: false
  },
  authorize: actor => read(actor, 'scores'),
  execute: async (input, actor) => {
    const sheet = await getScoreSheet(actor, { examId: (input as Args).examId })
    return sheet.rows.map(row => ({
      ...row,
      examId: sheet.exam.id,
      examName: sheet.exam.name,
      className: sheet.exam.className,
      fullScore: sheet.exam.fullScore
    }))
  },
  summarize: (value) => {
    if (!Array.isArray(value)) return '成绩单'
    const recorded = value.filter(row => isRecord(row) && (row.score !== null || row.absent === true)).length
    return `成绩单：${value.length} 名学生，已录入 ${recorded} 人`
  },
  resultView: {
    kind: 'table',
    columns: [
      { key: 'studentName', label: '姓名' },
      { key: 'studentNo', label: '学号' },
      { key: 'score', label: '分数', format: 'number' },
      { key: 'absent', label: '缺考', format: 'boolean' },
      { key: 'remark', label: '备注' }
    ],
    component: { id: 'sms.grade-entry-sheet' }
  }
}

const scoresSave: Capability = {
  id: 'sms.scores.save',
  title: '录入成绩',
  description: '为一名学生录入/更正考试成绩（仅草稿考试，改动保留修订记录）',
  resource: 'scores',
  moduleId: 'sms',
  operation: 'command',
  riskLevel: 'medium',
  permission: 'sms.scores.update',
  approval: 'confirm',
  timeoutMs: TIMEOUT_MS,
  rateLimit: { max: 60, windowMs: 60_000 },
  schema: isRecord,
  inputJsonSchema: {
    type: 'object',
    properties: {
      examId: { type: 'integer', minimum: 1 },
      studentId: { type: 'integer', minimum: 1 },
      score: { type: ['number', 'null'] },
      absent: { type: 'boolean' },
      remark: { type: 'string' },
      reason: { type: 'string' }
    },
    required: ['examId', 'studentId'],
    additionalProperties: false
  },
  form: {
    fields: [
      { key: 'examId', label: '考试', type: 'select', required: true },
      { key: 'studentId', label: '学生', type: 'select', required: true },
      { key: 'score', label: '分数', type: 'number', help: '缺考可留空并勾选缺考' },
      { key: 'absent', label: '缺考', type: 'boolean' },
      { key: 'remark', label: '备注', type: 'text' },
      { key: 'reason', label: '更正原因', type: 'text', help: '更正已有成绩时建议填写' }
    ],
    submitLabel: '保存成绩',
    layout: 'two-column'
  },
  authorize: actor => write(actor, 'update', 'scores'),
  preview: async (input, actor): Promise<PreviewResult> => {
    const args = isRecord(input) ? input : {}
    const examId = positiveId(args.examId, 'examId')
    const studentId = positiveId(args.studentId, 'studentId')
    const absent = args.absent === true || args.absent === 'true'
    const sheet = await getScoreSheet(actor, { examId })
    if (sheet.exam.status !== 'draft') {
      throw createError({ statusCode: 409, message: `考试已${EXAM_STATUS_LABELS[sheet.exam.status] ?? sheet.exam.status}，不能再修改成绩` })
    }
    const student = sheet.rows.find(row => row.studentId === studentId)
    if (!student) throw createError({ statusCode: 400, message: '该学生不在考试班级中' })
    const after = normalizeScoreValue(args.score, sheet.exam.fullScore, absent)
    return {
      summary: `将把「${student.studentName}」在「${sheet.exam.name}」的成绩从 ${student.score ?? '未录入'} 记为 ${absent ? '缺考' : after ?? '未录入'}（满分 ${sheet.exam.fullScore}）。`,
      details: {
        examId,
        studentId,
        before: student.score,
        after,
        absent,
        reason: typeof args.reason === 'string' ? args.reason : undefined
      },
      impact: 1,
      fieldOptions: {
        examId: sheet.exam.id
          ? [{ label: `${sheet.exam.name}（${sheet.exam.className ?? ''}）`, value: sheet.exam.id }]
          : [],
        studentId: sheet.rows.map(row => ({ label: `${row.studentName}（${row.studentNo}）`, value: row.studentId }))
      }
    }
  },
  execute: (input, actor) => saveScore(actor, input as Record<string, unknown>),
  summarize: (value) => {
    const row = isRecord(value) ? value : {}
    return `成绩已保存（新增 ${row.created ?? 0} 条，更正 ${row.corrected ?? 0} 条）`
  }
}

const scoresPublish: Capability = {
  id: 'sms.scores.publish',
  title: '发布成绩',
  description: '发布考试成绩（高风险，需二次审批；发布后成绩冻结）',
  resource: 'scores',
  moduleId: 'sms',
  operation: 'command',
  riskLevel: 'high',
  permission: 'sms.scores.publish',
  approval: 'confirm',
  requiresApproval: true,
  timeoutMs: TIMEOUT_MS,
  rateLimit: { max: 10, windowMs: 60_000 },
  schema: isRecord,
  inputJsonSchema: {
    type: 'object',
    properties: { examId: { type: 'integer', minimum: 1 } },
    required: ['examId'],
    additionalProperties: false
  },
  form: {
    fields: [
      { key: 'examId', label: '考试', type: 'select', required: true }
    ],
    submitLabel: '发布成绩'
  },
  authorize: actor => canPublishScores(actor),
  preview: async (input, actor): Promise<PreviewResult> => {
    const examId = positiveId((input as Args).examId, 'examId')
    const [exam, options] = await Promise.all([
      getExam(actor, examId),
      draftExamOptions(actor)
    ])
    if (exam.status !== 'draft') {
      throw createError({ statusCode: 409, message: `考试已${EXAM_STATUS_LABELS[exam.status] ?? exam.status}` })
    }
    return {
      summary: `将发布「${exam.name}」（${exam.className ?? `#${exam.classId}`}）的成绩，发布后学生/家长可见且成绩冻结。`,
      details: { examId, name: exam.name, classId: exam.classId, fullScore: exam.fullScore },
      impact: 1,
      warnings: ['发布属于高风险操作，需要二次审批；发布后如需更正请走修订流程。'],
      fieldOptions: {
        examId: options.map(row => ({ label: `${row.name}（${row.className ?? ''}）`, value: row.id }))
      }
    }
  },
  execute: (input, actor) => publishExam(actor, positiveId((input as Args).examId, 'examId')),
  summarize: (value) => {
    const row = isRecord(value) ? value : {}
    return `考试「${row.name ?? ''}」成绩已发布`
  }
}

const scoresQuery: Capability = {
  id: 'sms.scores.query',
  title: '查询成绩',
  description: '按考试、学生或班级查询成绩（学生/家长仅可见已发布成绩）',
  resource: 'scores',
  moduleId: 'sms',
  operation: 'query',
  riskLevel: 'low',
  permission: 'sms.scores.read',
  approval: 'none',
  timeoutMs: TIMEOUT_MS,
  rateLimit: { max: 60, windowMs: 60_000 },
  schema: isRecord,
  inputJsonSchema: {
    type: 'object',
    properties: {
      examId: { type: 'integer', minimum: 1 },
      studentId: { type: 'integer', minimum: 1 },
      classId: { type: 'integer', minimum: 1 },
      limit: { type: 'integer', minimum: 1, maximum: 200 }
    },
    additionalProperties: false
  },
  authorize: actor => read(actor, 'scores'),
  execute: (input, actor) => listScores(actor, isRecord(input) ? input : {}),
  summarize: rows => listSummary('成绩', rows),
  resultView: {
    kind: 'table',
    columns: [
      { key: 'examName', label: '考试' },
      { key: 'studentName', label: '学生' },
      { key: 'subjectName', label: '科目' },
      { key: 'score', label: '分数', format: 'number' },
      { key: 'fullScore', label: '满分', format: 'number' },
      { key: 'absent', label: '缺考', format: 'boolean' },
      { key: 'examStatus', label: '考试状态' }
    ]
  }
}

const reportCardGenerate: Capability = {
  id: 'sms.report-cards.generate',
  title: '生成成绩单',
  description: '按学生/学期生成不可变成绩单快照（仅已发布考试）',
  resource: 'report-cards',
  moduleId: 'sms',
  operation: 'command',
  riskLevel: 'medium',
  permission: 'sms.report-cards.generate',
  approval: 'confirm',
  timeoutMs: TIMEOUT_MS,
  rateLimit: { max: 20, windowMs: 60_000 },
  schema: isRecord,
  inputJsonSchema: {
    type: 'object',
    properties: {
      studentId: { type: 'integer', minimum: 1 },
      termId: { type: 'integer', minimum: 1 }
    },
    required: ['studentId'],
    additionalProperties: false
  },
  form: {
    fields: [
      { key: 'studentId', label: '学生', type: 'select', required: true },
      { key: 'termId', label: '学期', type: 'select', help: '留空表示全部学期' }
    ],
    submitLabel: '生成成绩单',
    layout: 'two-column'
  },
  authorize: actor => canGenerateReportCard(actor),
  preview: async (input, actor): Promise<PreviewResult> => {
    const args = isRecord(input) ? input : {}
    const studentId = positiveId(args.studentId, 'studentId')
    const [student, students, terms] = await Promise.all([
      getStudent(actor, studentId),
      searchStudents(actor, { limit: 100 }),
      listTerms(actor)
    ])
    const termId = optionalId(args.termId)
    return {
      summary: `将为「${student.name}」生成${termId ? `学期 #${termId} ` : ''}成绩单快照（只统计已发布考试）。`,
      details: { studentId, studentName: student.name, termId },
      impact: 1,
      fieldOptions: {
        studentId: students.map(row => ({ label: `${row.name}（${row.studentNo}）`, value: row.id })),
        termId: terms.map(row => ({ label: row.name, value: row.id }))
      }
    }
  },
  execute: (input, actor) => generateReportCard(actor, input as Record<string, unknown>),
  summarize: (value) => {
    const row = isRecord(value) ? value : {}
    return `成绩单已生成（#${row.id ?? '-'}，平均分 ${row.average ?? 0}，${Array.isArray(row.items) ? row.items.length : 0} 场考试）`
  }
}

// ---------------------------------------------------------------------------
// Admissions (Slice C)
// ---------------------------------------------------------------------------

const ADMISSION_STATUS_LABELS: Record<string, string> = {
  submitted: '已提交',
  reviewing: '审核中',
  accepted: '已录取',
  rejected: '未录取',
  converted: '已转学籍'
}

const admissionCyclesList: Capability = {
  id: 'sms.admission-cycles.list',
  title: '招生批次',
  description: '查看招生批次及其开放状态',
  resource: 'admission-cycles',
  moduleId: 'sms',
  operation: 'query',
  riskLevel: 'low',
  permission: 'sms.applications.read',
  approval: 'none',
  timeoutMs: TIMEOUT_MS,
  rateLimit: { max: 60, windowMs: 60_000 },
  schema: isRecord,
  inputJsonSchema: {
    type: 'object',
    properties: {
      status: { type: 'string', enum: ['open', 'closed'] },
      limit: { type: 'integer', minimum: 1, maximum: 200 }
    },
    additionalProperties: false
  },
  authorize: actor => read(actor, 'applications'),
  execute: (input, actor) => listAdmissionCycles(actor, isRecord(input) ? input : {}),
  summarize: rows => listSummary('招生批次', rows),
  resultView: {
    kind: 'table',
    columns: [
      { key: 'name', label: '批次' },
      { key: 'academicYearName', label: '学年' },
      { key: 'startDate', label: '开始' },
      { key: 'endDate', label: '结束' },
      { key: 'status', label: '状态' }
    ]
  }
}

const admissionCyclesCreate: Capability = {
  id: 'sms.admission-cycles.create',
  title: '新建招生批次',
  description: '创建招生批次（默认开放）',
  resource: 'admission-cycles',
  moduleId: 'sms',
  operation: 'command',
  riskLevel: 'medium',
  permission: 'sms.admission-cycles.create',
  approval: 'confirm',
  timeoutMs: TIMEOUT_MS,
  rateLimit: { max: 20, windowMs: 60_000 },
  schema: isRecord,
  inputJsonSchema: {
    type: 'object',
    properties: {
      name: { type: 'string' },
      academicYearId: { type: 'integer', minimum: 1 },
      startDate: { type: 'string', description: 'YYYY-MM-DD' },
      endDate: { type: 'string', description: 'YYYY-MM-DD' }
    },
    required: ['name', 'academicYearId', 'startDate', 'endDate'],
    additionalProperties: false
  },
  form: {
    fields: [
      { key: 'name', label: '批次名称', type: 'text', required: true },
      { key: 'academicYearId', label: '学年', type: 'select', required: true },
      { key: 'startDate', label: '开始日期', type: 'date', required: true },
      { key: 'endDate', label: '结束日期', type: 'date', required: true }
    ],
    submitLabel: '创建批次',
    layout: 'two-column'
  },
  authorize: actor => actor.permissions?.includes('sms.admission-cycles.create') === true,
  preview: async (input, actor): Promise<PreviewResult> => {
    const args = isRecord(input) ? input : {}
    const name = text(args.name, '批次名称')
    const years = await listAcademicYears(actor)
    const academicYearId = positiveId(args.academicYearId, 'academicYearId')
    const yearName = years.find(row => row.id === academicYearId)?.name ?? `#${academicYearId}`
    return {
      summary: `将创建招生批次「${name}」（学年 ${yearName}，${String(args.startDate ?? '')} 至 ${String(args.endDate ?? '')}）。`,
      details: { name, academicYearId },
      impact: 1,
      fieldOptions: { academicYearId: years.map(row => ({ label: row.name, value: row.id })) }
    }
  },
  execute: (input, actor) => createAdmissionCycle(actor, input as Record<string, unknown>),
  summarize: (value) => {
    const row = isRecord(value) ? value : {}
    return `招生批次「${row.name ?? ''}」已创建`
  }
}

const applicationsList: Capability = {
  id: 'sms.applications.list',
  title: '报名申请',
  description: '查询招生报名申请，可按批次/状态/姓名或电话搜索',
  resource: 'applications',
  moduleId: 'sms',
  operation: 'query',
  riskLevel: 'low',
  permission: 'sms.applications.read',
  approval: 'none',
  timeoutMs: TIMEOUT_MS,
  rateLimit: { max: 60, windowMs: 60_000 },
  schema: isRecord,
  inputJsonSchema: {
    type: 'object',
    properties: {
      cycleId: { type: 'integer', minimum: 1 },
      status: { type: 'string', enum: ['submitted', 'reviewing', 'accepted', 'rejected', 'converted'] },
      query: { type: 'string' },
      limit: { type: 'integer', minimum: 1, maximum: 200 }
    },
    additionalProperties: false
  },
  authorize: actor => read(actor, 'applications'),
  execute: (input, actor) => listApplications(actor, isRecord(input) ? input : {}),
  summarize: rows => listSummary('报名申请', rows),
  resultView: {
    kind: 'table',
    columns: [
      { key: 'applicantName', label: '姓名' },
      { key: 'guardianName', label: '监护人' },
      { key: 'guardianPhone', label: '电话' },
      { key: 'cycleName', label: '批次' },
      { key: 'status', label: '状态' },
      { key: 'createdAt', label: '提交时间', format: 'datetime' }
    ]
  }
}

const applicationsCreate: Capability = {
  id: 'sms.applications.create',
  title: '登记报名',
  description: '为开放批次登记一条报名申请',
  resource: 'applications',
  moduleId: 'sms',
  operation: 'command',
  riskLevel: 'medium',
  permission: 'sms.applications.create',
  approval: 'confirm',
  timeoutMs: TIMEOUT_MS,
  rateLimit: { max: 30, windowMs: 60_000 },
  schema: isRecord,
  inputJsonSchema: {
    type: 'object',
    properties: {
      cycleId: { type: 'integer', minimum: 1 },
      applicantName: { type: 'string' },
      gender: { type: 'string' },
      birthDate: { type: 'string' },
      guardianName: { type: 'string' },
      guardianPhone: { type: 'string' },
      previousSchool: { type: 'string' },
      notes: { type: 'string' }
    },
    required: ['cycleId', 'applicantName'],
    additionalProperties: false
  },
  form: {
    fields: [
      { key: 'cycleId', label: '招生批次', type: 'select', required: true },
      { key: 'applicantName', label: '学生姓名', type: 'text', required: true },
      { key: 'gender', label: '性别', type: 'text' },
      { key: 'birthDate', label: '出生日期', type: 'date' },
      { key: 'guardianName', label: '监护人', type: 'text' },
      { key: 'guardianPhone', label: '联系电话', type: 'text' },
      { key: 'previousSchool', label: '原学校', type: 'text' },
      { key: 'notes', label: '备注', type: 'textarea' }
    ],
    submitLabel: '登记报名',
    layout: 'two-column'
  },
  authorize: actor => write(actor, 'create', 'applications'),
  preview: async (input, actor): Promise<PreviewResult> => {
    const args = isRecord(input) ? input : {}
    const cycleId = positiveId(args.cycleId, 'cycleId')
    const applicantName = text(args.applicantName, '学生姓名')
    const cycles = await listAdmissionCycles(actor, { status: 'open', limit: 100 })
    const cycle = cycles.find(row => row.id === cycleId)
    if (!cycle) throw createError({ statusCode: 409, message: '招生批次不存在或已关闭' })
    return {
      summary: `将在「${cycle.name}」登记「${applicantName}」的报名申请。`,
      details: { cycleId, applicantName },
      impact: 1,
      fieldOptions: { cycleId: cycles.map(row => ({ label: row.name, value: row.id })) }
    }
  },
  execute: (input, actor) => createApplication(actor, input as Record<string, unknown>),
  summarize: (value) => {
    const row = isRecord(value) ? value : {}
    return `报名申请 #${row.id ?? '-'} 已登记`
  }
}

const applicationsReview: Capability = {
  id: 'sms.applications.review',
  title: '审核报名',
  description: '将报名申请标记为审核中、录取或未录取',
  resource: 'applications',
  moduleId: 'sms',
  operation: 'command',
  riskLevel: 'medium',
  permission: 'sms.applications.review',
  approval: 'confirm',
  timeoutMs: TIMEOUT_MS,
  rateLimit: { max: 60, windowMs: 60_000 },
  schema: isRecord,
  inputJsonSchema: {
    type: 'object',
    properties: {
      applicationId: { type: 'integer', minimum: 1 },
      status: { type: 'string', enum: ['reviewing', 'accepted', 'rejected'] },
      note: { type: 'string' }
    },
    required: ['applicationId', 'status'],
    additionalProperties: false
  },
  form: {
    fields: [
      { key: 'applicationId', label: '报名申请', type: 'select', required: true },
      {
        key: 'status',
        label: '审核结果',
        type: 'select',
        required: true,
        options: [
          { label: '审核中', value: 'reviewing' },
          { label: '录取', value: 'accepted' },
          { label: '未录取', value: 'rejected' }
        ]
      },
      { key: 'note', label: '审核意见', type: 'textarea' }
    ],
    submitLabel: '提交审核',
    layout: 'single-column'
  },
  authorize: actor => canReviewApplications(actor),
  preview: async (input, actor): Promise<PreviewResult> => {
    const args = isRecord(input) ? input : {}
    const applicationId = positiveId(args.applicationId, 'applicationId')
    const status = String(args.status ?? '')
    const application = await getApplication(actor, applicationId)
    if (!['reviewing', 'accepted', 'rejected'].includes(status)) {
      throw createError({ statusCode: 400, message: 'status must be reviewing, accepted or rejected' })
    }
    if (!allowedAdmissionTransition(application.status as never, status as never)) {
      throw createError({ statusCode: 409, message: `当前状态为 ${ADMISSION_STATUS_LABELS[application.status] ?? application.status}，不能改为该状态` })
    }
    const pending = await listApplications(actor, { cycleId: application.cycleId, limit: 100 })
    return {
      summary: `将「${application.applicantName}」的报名状态从 ${ADMISSION_STATUS_LABELS[application.status] ?? application.status} 改为 ${ADMISSION_STATUS_LABELS[status] ?? status}。`,
      details: { applicationId, from: application.status, to: status },
      impact: 1,
      fieldOptions: {
        applicationId: pending
          .filter(row => row.status !== 'converted')
          .map(row => ({ label: `${row.applicantName}（${ADMISSION_STATUS_LABELS[row.status] ?? row.status}）`, value: row.id }))
      }
    }
  },
  execute: (input, actor) => reviewApplication(actor, input as Record<string, unknown>),
  summarize: (value) => {
    const row = isRecord(value) ? value : {}
    return `报名审核已更新为 ${ADMISSION_STATUS_LABELS[String(row.status)] ?? row.status}`
  }
}

const applicationsConvert: Capability = {
  id: 'sms.applications.convert',
  title: '转为学籍',
  description: '将已录取的报名申请转为学生并可选直接分班（高风险，需二次审批）',
  resource: 'applications',
  moduleId: 'sms',
  operation: 'command',
  riskLevel: 'high',
  permission: 'sms.applications.convert',
  approval: 'confirm',
  requiresApproval: true,
  timeoutMs: TIMEOUT_MS,
  rateLimit: { max: 20, windowMs: 60_000 },
  schema: isRecord,
  inputJsonSchema: {
    type: 'object',
    properties: {
      applicationId: { type: 'integer', minimum: 1 },
      classId: { type: 'integer', minimum: 1 },
      studentNo: { type: 'string' }
    },
    required: ['applicationId'],
    additionalProperties: false
  },
  form: {
    fields: [
      { key: 'applicationId', label: '报名申请', type: 'select', required: true },
      { key: 'classId', label: '分班（可选）', type: 'select' },
      { key: 'studentNo', label: '学号（留空自动生成）', type: 'text' }
    ],
    submitLabel: '转为学籍',
    layout: 'two-column'
  },
  authorize: actor => canConvertApplications(actor),
  preview: async (input, actor): Promise<PreviewResult> => {
    const args = isRecord(input) ? input : {}
    const applicationId = positiveId(args.applicationId, 'applicationId')
    const application = await getApplication(actor, applicationId)
    if (application.status !== 'accepted') {
      throw createError({ statusCode: 409, message: '只有已录取的申请可以转为学籍' })
    }
    const { classes, options } = await classOptions(actor)
    const classId = optionalId(args.classId)
    const className = classId ? classes.find(row => row.id === classId)?.name : undefined
    const accepted = await listApplications(actor, { cycleId: application.cycleId, status: 'accepted', limit: 100 })
    return {
      summary: `将「${application.applicantName}」转为学籍${className ? `并分入「${className}」` : '（暂不分班）'}。`,
      details: { applicationId, classId, studentNo: args.studentNo },
      impact: 1,
      warnings: ['转学籍会创建学生档案与选课记录，属于高风险操作，需要二次审批。'],
      fieldOptions: {
        classId: options,
        applicationId: accepted.map(row => ({ label: row.applicantName, value: row.id }))
      }
    }
  },
  execute: (input, actor) => convertApplication(actor, input as Record<string, unknown>),
  summarize: (value) => {
    const row = isRecord(value) ? value : {}
    return `已转为学籍：${row.studentName ?? ''}（学号 ${row.studentNo ?? '-'}${row.className ? `，${row.className}` : ''}）`
  }
}

// ---------------------------------------------------------------------------
// Timetable (Slice C)
// ---------------------------------------------------------------------------

const WEEKDAY_LABELS = ['', '周一', '周二', '周三', '周四', '周五', '周六', '周日']

const timetableList: Capability = {
  id: 'sms.timetable.list',
  title: '课表',
  description: '按班级/教师/学期查询课表（学生与家长只看已发布课表）',
  resource: 'timetable',
  moduleId: 'sms',
  operation: 'query',
  riskLevel: 'low',
  permission: 'sms.timetable.read',
  approval: 'none',
  timeoutMs: TIMEOUT_MS,
  rateLimit: { max: 60, windowMs: 60_000 },
  schema: isRecord,
  inputJsonSchema: {
    type: 'object',
    properties: {
      termId: { type: 'integer', minimum: 1 },
      classId: { type: 'integer', minimum: 1 },
      teacherUserId: { type: 'integer', minimum: 1 },
      status: { type: 'string', enum: ['draft', 'published'] },
      limit: { type: 'integer', minimum: 1, maximum: 400 }
    },
    additionalProperties: false
  },
  authorize: actor => read(actor, 'timetable'),
  execute: (input, actor) => listTimetable(actor, isRecord(input) ? input : {}),
  summarize: rows => listSummary('课表', rows),
  resultView: {
    kind: 'table',
    columns: [
      { key: 'weekday', label: '星期', format: 'number' },
      { key: 'periodNo', label: '节次', format: 'number' },
      { key: 'className', label: '班级' },
      { key: 'subjectName', label: '科目' },
      { key: 'teacherName', label: '教师' },
      { key: 'room', label: '教室' },
      { key: 'status', label: '状态' }
    ],
    component: { id: 'sms.timetable-grid' }
  }
}

const timetableCreate: Capability = {
  id: 'sms.timetable.create',
  title: '排课',
  description: '新增一节课程（同一班级/教师/教室时段冲突会被拒绝）',
  resource: 'timetable',
  moduleId: 'sms',
  operation: 'command',
  riskLevel: 'medium',
  permission: 'sms.timetable.update',
  approval: 'confirm',
  timeoutMs: TIMEOUT_MS,
  rateLimit: { max: 60, windowMs: 60_000 },
  schema: isRecord,
  inputJsonSchema: {
    type: 'object',
    properties: {
      classId: { type: 'integer', minimum: 1 },
      subjectId: { type: 'integer', minimum: 1 },
      teacherUserId: { type: 'integer', minimum: 1 },
      termId: { type: 'integer', minimum: 1 },
      weekday: { type: 'integer', minimum: 1, maximum: 7 },
      periodNo: { type: 'integer', minimum: 1, maximum: 12 },
      room: { type: 'string' }
    },
    required: ['classId', 'weekday', 'periodNo'],
    additionalProperties: false
  },
  form: {
    fields: [
      { key: 'classId', label: '班级', type: 'select', required: true },
      { key: 'subjectId', label: '科目', type: 'select' },
      { key: 'teacherUserId', label: '任课教师', type: 'select' },
      { key: 'termId', label: '学期', type: 'select' },
      {
        key: 'weekday',
        label: '星期',
        type: 'select',
        required: true,
        options: WEEKDAY_LABELS.slice(1).map((label, index) => ({ label, value: index + 1 }))
      },
      { key: 'periodNo', label: '节次', type: 'number', required: true, help: '1-12' },
      { key: 'room', label: '教室', type: 'text' }
    ],
    submitLabel: '添加课程',
    layout: 'two-column'
  },
  authorize: actor => write(actor, 'update', 'timetable'),
  preview: async (input, actor): Promise<PreviewResult> => {
    const args = isRecord(input) ? input : {}
    const classId = positiveId(args.classId, 'classId')
    const weekday = normalizeWeekday(args.weekday)
    const periodNo = normalizePeriodNo(args.periodNo)
    const { classes, options } = await classOptions(actor)
    const className = classes.find(row => row.id === classId)?.name ?? `#${classId}`
    const [subjects, teachers, terms] = await Promise.all([
      listSubjects(actor),
      listTeachers(actor, { limit: 100 }),
      listTerms(actor)
    ])
    const subjectName = subjects.find(row => row.id === optionalId(args.subjectId))?.name
    const teacherName = teachers.find(row => row.userId === optionalId(args.teacherUserId))?.name
    return {
      summary: `将为「${className}」添加 ${WEEKDAY_LABELS[weekday]} 第 ${periodNo} 节${subjectName ? `「${subjectName}」` : ''}${teacherName ? `（${teacherName}）` : ''}课程。`,
      details: { classId, weekday, periodNo, subjectId: optionalId(args.subjectId), teacherUserId: optionalId(args.teacherUserId), room: args.room },
      impact: 1,
      fieldOptions: {
        classId: options,
        subjectId: subjects.map(row => ({ label: row.name, value: row.id })),
        teacherUserId: teachers
          .filter(row => typeof row.userId === 'number')
          .map(row => ({ label: row.name ?? `#${row.userId}`, value: row.userId as number })),
        termId: terms.map(row => ({ label: row.name, value: row.id }))
      }
    }
  },
  execute: (input, actor) => createTimetableEntry(actor, input as Record<string, unknown>),
  summarize: (value) => {
    const row = isRecord(value) ? value : {}
    return `已添加 ${WEEKDAY_LABELS[Number(row.weekday)] ?? ''} 第 ${row.periodNo ?? '-'} 节课程（草稿）`
  }
}

const timetablePublish: Capability = {
  id: 'sms.timetable.publish',
  title: '发布课表',
  description: '发布现有草稿课表（高风险，需二次审批）',
  resource: 'timetable',
  moduleId: 'sms',
  operation: 'command',
  riskLevel: 'high',
  permission: 'sms.timetable.publish',
  approval: 'confirm',
  requiresApproval: true,
  timeoutMs: TIMEOUT_MS,
  rateLimit: { max: 10, windowMs: 60_000 },
  schema: isRecord,
  inputJsonSchema: {
    type: 'object',
    properties: {
      classId: { type: 'integer', minimum: 1 },
      termId: { type: 'integer', minimum: 1 }
    },
    additionalProperties: false
  },
  form: {
    fields: [
      { key: 'classId', label: '班级（留空发布全部）', type: 'select' },
      { key: 'termId', label: '学期', type: 'select' }
    ],
    submitLabel: '发布课表'
  },
  authorize: actor => canPublishTimetable(actor),
  preview: async (input, actor): Promise<PreviewResult> => {
    const args = isRecord(input) ? input : {}
    const [terms, draft] = await Promise.all([
      listTerms(actor),
      listTimetable(actor, {
        status: 'draft',
        classId: optionalId(args.classId),
        termId: optionalId(args.termId),
        limit: 400
      })
    ])
    const { options } = await classOptions(actor)
    return {
      summary: `将发布 ${draft.length} 条草稿课表${optionalId(args.classId) ? '（指定班级）' : ''}，发布后学生/家长可见。`,
      details: { classId: optionalId(args.classId), termId: optionalId(args.termId), drafts: draft.length },
      impact: draft.length,
      warnings: draft.length === 0 ? ['当前没有草稿课表可发布。'] : undefined,
      fieldOptions: { classId: options, termId: terms.map(row => ({ label: row.name, value: row.id })) }
    }
  },
  execute: (input, actor) => publishTimetable(actor, isRecord(input) ? input : {}),
  summarize: (value) => {
    const row = isRecord(value) ? value : {}
    return `课表已发布，共 ${row.published ?? 0} 条`
  }
}

// ---------------------------------------------------------------------------
// Finance (Slice D)
// ---------------------------------------------------------------------------

const PAYMENT_METHOD_LABELS: Record<string, string> = {
  cash: '现金',
  transfer: '转账',
  wechat: '微信',
  alipay: '支付宝',
  other: '其他'
}

const INVOICE_STATUS_LABELS: Record<string, string> = {
  unpaid: '未缴',
  partial: '部分缴纳',
  paid: '已缴清',
  void: '作废'
}

const feesList: Capability = {
  id: 'sms.fees.list',
  title: '收费项目',
  description: '查询收费项目及金额',
  resource: 'finance',
  moduleId: 'sms',
  operation: 'query',
  riskLevel: 'low',
  permission: 'sms.finance.read',
  approval: 'none',
  timeoutMs: TIMEOUT_MS,
  rateLimit: { max: 60, windowMs: 60_000 },
  schema: isRecord,
  inputJsonSchema: {
    type: 'object',
    properties: {
      status: { type: 'string', enum: ['active', 'archived'] },
      limit: { type: 'integer', minimum: 1, maximum: 200 }
    },
    additionalProperties: false
  },
  authorize: actor => read(actor, 'finance'),
  execute: (input, actor) => listFeeItems(actor, isRecord(input) ? input : {}),
  summarize: rows => listSummary('收费项目', rows),
  resultView: {
    kind: 'table',
    columns: [
      { key: 'name', label: '项目' },
      { key: 'termName', label: '学期' },
      { key: 'amount', label: '金额', format: 'number' },
      { key: 'dueDate', label: '截止日期' },
      { key: 'status', label: '状态' }
    ]
  }
}

const feesCreate: Capability = {
  id: 'sms.fees.create',
  title: '新建收费项目',
  description: '创建收费项目（金额精确到分）',
  resource: 'finance',
  moduleId: 'sms',
  operation: 'command',
  riskLevel: 'medium',
  permission: 'sms.finance.update',
  approval: 'confirm',
  timeoutMs: TIMEOUT_MS,
  rateLimit: { max: 20, windowMs: 60_000 },
  schema: isRecord,
  inputJsonSchema: {
    type: 'object',
    properties: {
      name: { type: 'string' },
      amount: { type: 'number', minimum: 0.01 },
      termId: { type: 'integer', minimum: 1 },
      gradeId: { type: 'integer', minimum: 1 },
      dueDate: { type: 'string', description: 'YYYY-MM-DD' }
    },
    required: ['name', 'amount'],
    additionalProperties: false
  },
  form: {
    fields: [
      { key: 'name', label: '项目名称', type: 'text', required: true },
      { key: 'amount', label: '金额', type: 'number', required: true },
      { key: 'termId', label: '学期', type: 'select' },
      { key: 'gradeId', label: '年级 ID', type: 'number' },
      { key: 'dueDate', label: '截止日期', type: 'date' }
    ],
    submitLabel: '创建项目',
    layout: 'two-column'
  },
  authorize: actor => write(actor, 'update', 'finance'),
  preview: async (input, actor): Promise<PreviewResult> => {
    const args = isRecord(input) ? input : {}
    const name = text(args.name, '项目名称')
    const amount = normalizeAmount(args.amount, 'amount')
    const terms = await listTerms(actor)
    return {
      summary: `将创建收费项目「${name}」，金额 ¥${amount.toFixed(2)}。`,
      details: { name, amount, termId: optionalId(args.termId), dueDate: args.dueDate },
      impact: 1,
      fieldOptions: { termId: terms.map(row => ({ label: row.name, value: row.id })) }
    }
  },
  execute: (input, actor) => createFeeItem(actor, input as Record<string, unknown>),
  summarize: (value) => {
    const row = isRecord(value) ? value : {}
    return `收费项目「${row.name ?? ''}」已创建（¥${Number(row.amount ?? 0).toFixed(2)}）`
  }
}

const invoicesList: Capability = {
  id: 'sms.invoices.list',
  title: '收费账单',
  description: '查询学生账单与缴费状态（学生/家长只看本人或子女）',
  resource: 'finance',
  moduleId: 'sms',
  operation: 'query',
  riskLevel: 'medium',
  permission: 'sms.finance.read',
  approval: 'none',
  timeoutMs: TIMEOUT_MS,
  rateLimit: { max: 60, windowMs: 60_000 },
  schema: isRecord,
  inputJsonSchema: {
    type: 'object',
    properties: {
      studentId: { type: 'integer', minimum: 1 },
      status: { type: 'string', enum: ['unpaid', 'partial', 'paid', 'void'] },
      limit: { type: 'integer', minimum: 1, maximum: 200 }
    },
    additionalProperties: false
  },
  authorize: actor => read(actor, 'finance'),
  execute: (input, actor) => listInvoices(actor, isRecord(input) ? input : {}),
  summarize: rows => listSummary('账单', rows),
  resultView: {
    kind: 'table',
    columns: [
      { key: 'studentName', label: '学生' },
      { key: 'feeName', label: '项目' },
      { key: 'payable', label: '应缴', format: 'number' },
      { key: 'paid', label: '已缴', format: 'number' },
      { key: 'status', label: '状态' },
      { key: 'dueDate', label: '截止日期' }
    ]
  }
}

const invoicesCreate: Capability = {
  id: 'sms.invoices.create',
  title: '开具账单',
  description: '为学生开具某个收费项目的账单（可设减免）',
  resource: 'finance',
  moduleId: 'sms',
  operation: 'command',
  riskLevel: 'medium',
  permission: 'sms.finance.update',
  approval: 'confirm',
  timeoutMs: TIMEOUT_MS,
  rateLimit: { max: 40, windowMs: 60_000 },
  schema: isRecord,
  inputJsonSchema: {
    type: 'object',
    properties: {
      studentId: { type: 'integer', minimum: 1 },
      feeItemId: { type: 'integer', minimum: 1 },
      discount: { type: 'number', minimum: 0 }
    },
    required: ['studentId', 'feeItemId'],
    additionalProperties: false
  },
  form: {
    fields: [
      { key: 'studentId', label: '学生', type: 'select', required: true },
      { key: 'feeItemId', label: '收费项目', type: 'select', required: true },
      { key: 'discount', label: '减免金额', type: 'number', help: '默认 0' }
    ],
    submitLabel: '开具账单',
    layout: 'two-column'
  },
  authorize: actor => write(actor, 'update', 'finance'),
  preview: async (input, actor): Promise<PreviewResult> => {
    const args = isRecord(input) ? input : {}
    const studentId = positiveId(args.studentId, 'studentId')
    const feeItemId = positiveId(args.feeItemId, 'feeItemId')
    const [student, students, fees] = await Promise.all([
      getStudent(actor, studentId),
      searchStudents(actor, { limit: 100 }),
      listFeeItems(actor, { status: 'active', limit: 100 })
    ])
    const fee = fees.find(row => row.id === feeItemId)
    if (!fee) throw createError({ statusCode: 404, message: '收费项目不存在或已归档' })
    const discount = args.discount === undefined || args.discount === null || args.discount === ''
      ? 0
      : Number(args.discount)
    if (!Number.isFinite(discount) || discount < 0 || discount > fee.amount) {
      throw createError({ statusCode: 400, message: '减免金额不能超过项目金额' })
    }
    return {
      summary: `将为「${student.name}」开具「${fee.name}」账单，应缴 ¥${(fee.amount - discount).toFixed(2)}。`,
      details: { studentId, feeItemId, discount, payable: fee.amount - discount },
      impact: 1,
      fieldOptions: {
        studentId: students.map(row => ({ label: `${row.name}（${row.studentNo}）`, value: row.id })),
        feeItemId: fees.map(row => ({ label: `${row.name}（¥${row.amount}）`, value: row.id }))
      }
    }
  },
  execute: (input, actor) => createInvoice(actor, input as Record<string, unknown>),
  summarize: (value) => {
    const row = isRecord(value) ? value : {}
    return `账单 #${row.id ?? '-'} 已开具，应缴 ¥${Number(row.payable ?? 0).toFixed(2)}`
  }
}

const paymentsCreate: Capability = {
  id: 'sms.payments.create',
  title: '登记缴费',
  description: '为一笔账单登记收款，并自动更新缴费状态',
  resource: 'finance',
  moduleId: 'sms',
  operation: 'command',
  riskLevel: 'medium',
  permission: 'sms.finance.update',
  approval: 'confirm',
  timeoutMs: TIMEOUT_MS,
  rateLimit: { max: 60, windowMs: 60_000 },
  schema: isRecord,
  inputJsonSchema: {
    type: 'object',
    properties: {
      invoiceId: { type: 'integer', minimum: 1 },
      amount: { type: 'number', minimum: 0.01 },
      method: { type: 'string', enum: [...PAYMENT_METHODS] },
      reference: { type: 'string' }
    },
    required: ['invoiceId', 'amount'],
    additionalProperties: false
  },
  form: {
    fields: [
      { key: 'invoiceId', label: '账单', type: 'select', required: true },
      { key: 'amount', label: '金额', type: 'number', required: true },
      {
        key: 'method',
        label: '支付方式',
        type: 'select',
        options: PAYMENT_METHODS.map(method => ({ label: PAYMENT_METHOD_LABELS[method] ?? method, value: method }))
      },
      { key: 'reference', label: '流水号', type: 'text' }
    ],
    submitLabel: '登记缴费',
    layout: 'two-column'
  },
  authorize: actor => write(actor, 'update', 'finance'),
  preview: async (input, actor): Promise<PreviewResult> => {
    const args = isRecord(input) ? input : {}
    const invoiceId = positiveId(args.invoiceId, 'invoiceId')
    const amount = normalizeAmount(args.amount, 'amount')
    const invoices = await listInvoices(actor, { status: 'unpaid', limit: 100 })
    const partial = await listInvoices(actor, { status: 'partial', limit: 100 })
    const invoice = [...invoices, ...partial].find(row => row.id === invoiceId)
    if (!invoice) throw createError({ statusCode: 409, message: '账单不存在或已缴清/作废' })
    const outstanding = invoice.payable - invoice.paid
    if (amount > outstanding + 0.001) {
      throw createError({ statusCode: 400, message: `金额超过未缴余额 ¥${outstanding.toFixed(2)}` })
    }
    const nextPaid = invoice.paid + amount
    const nextStatus = computeInvoiceStatus(invoice.payable, nextPaid)
    return {
      summary: `将为「${invoice.studentName ?? `#${invoice.studentId}`}」的「${invoice.feeName ?? ''}」登记 ¥${amount.toFixed(2)}，剩余 ¥${(invoice.payable - nextPaid).toFixed(2)}。`,
      details: { invoiceId, amount, nextPaid, nextStatus },
      impact: 1,
      fieldOptions: {
        invoiceId: [...invoices, ...partial].map(row => ({
          label: `${row.studentName ?? `#${row.studentId}`} · ${row.feeName ?? ''}（未缴 ¥${(row.payable - row.paid).toFixed(2)}）`,
          value: row.id
        }))
      }
    }
  },
  execute: (input, actor) => recordPayment(actor, input as Record<string, unknown>),
  summarize: (value) => {
    const row = isRecord(value) ? value : {}
    return `缴费已登记：¥${Number(row.amount ?? 0).toFixed(2)}，状态 ${INVOICE_STATUS_LABELS[String(row.status)] ?? row.status}，剩余 ¥${Number(row.outstanding ?? 0).toFixed(2)}`
  }
}

const refundsRequest: Capability = {
  id: 'sms.refunds.request',
  title: '申请退费',
  description: '针对一笔收款发起退费申请（需另一位审批人通过）',
  resource: 'finance',
  moduleId: 'sms',
  operation: 'command',
  riskLevel: 'medium',
  permission: 'sms.finance.update',
  approval: 'confirm',
  timeoutMs: TIMEOUT_MS,
  rateLimit: { max: 20, windowMs: 60_000 },
  schema: isRecord,
  inputJsonSchema: {
    type: 'object',
    properties: {
      paymentId: { type: 'integer', minimum: 1 },
      amount: { type: 'number', minimum: 0.01 },
      reason: { type: 'string' }
    },
    required: ['paymentId', 'amount'],
    additionalProperties: false
  },
  form: {
    fields: [
      { key: 'paymentId', label: '收款记录', type: 'number', required: true },
      { key: 'amount', label: '退费金额', type: 'number', required: true },
      { key: 'reason', label: '退费原因', type: 'textarea' }
    ],
    submitLabel: '提交退费申请',
    layout: 'single-column'
  },
  authorize: actor => write(actor, 'update', 'finance'),
  preview: async (input, _actor): Promise<PreviewResult> => {
    const args = isRecord(input) ? input : {}
    const paymentId = positiveId(args.paymentId, 'paymentId')
    const amount = normalizeAmount(args.amount, 'amount')
    return {
      summary: `将针对收款 #${paymentId} 发起 ¥${amount.toFixed(2)} 的退费申请，需另一位审批人通过后生效。`,
      details: { paymentId, amount, reason: args.reason },
      impact: 1,
      warnings: ['退费属于高风险财务操作，申请人与审批人不能相同。']
    }
  },
  execute: (input, actor) => requestRefund(actor, input as Record<string, unknown>),
  summarize: (value) => {
    const row = isRecord(value) ? value : {}
    return `退费申请 #${row.id ?? '-'} 已提交，等待审批`
  }
}

const refundsList: Capability = {
  id: 'sms.refunds.list',
  title: '退费申请',
  description: '查询退费申请及审批状态',
  resource: 'finance',
  moduleId: 'sms',
  operation: 'query',
  riskLevel: 'medium',
  permission: 'sms.finance.read',
  approval: 'none',
  timeoutMs: TIMEOUT_MS,
  rateLimit: { max: 60, windowMs: 60_000 },
  schema: isRecord,
  inputJsonSchema: {
    type: 'object',
    properties: {
      status: { type: 'string', enum: ['pending', 'approved', 'rejected'] },
      limit: { type: 'integer', minimum: 1, maximum: 200 }
    },
    additionalProperties: false
  },
  authorize: actor => read(actor, 'finance'),
  execute: (input, actor) => listRefunds(actor, isRecord(input) ? input : {}),
  summarize: rows => listSummary('退费申请', rows),
  resultView: {
    kind: 'table',
    columns: [
      { key: 'studentName', label: '学生' },
      { key: 'feeName', label: '项目' },
      { key: 'amount', label: '退费金额', format: 'number' },
      { key: 'status', label: '状态' },
      { key: 'reason', label: '原因' },
      { key: 'createdAt', label: '申请时间', format: 'datetime' }
    ]
  }
}

const refundsApprove: Capability = {
  id: 'sms.refunds.approve',
  title: '审批退费',
  description: '同意或驳回待审批的退费申请（高风险，需二次审批）',
  resource: 'finance',
  moduleId: 'sms',
  operation: 'command',
  riskLevel: 'high',
  permission: 'sms.finance.refund-approve',
  approval: 'confirm',
  requiresApproval: true,
  timeoutMs: TIMEOUT_MS,
  rateLimit: { max: 20, windowMs: 60_000 },
  schema: isRecord,
  inputJsonSchema: {
    type: 'object',
    properties: {
      refundId: { type: 'integer', minimum: 1 },
      decision: { type: 'string', enum: ['approve', 'reject'] },
      comment: { type: 'string' }
    },
    required: ['refundId', 'decision'],
    additionalProperties: false
  },
  form: {
    fields: [
      { key: 'refundId', label: '退费申请', type: 'select', required: true },
      {
        key: 'decision',
        label: '结果',
        type: 'select',
        required: true,
        options: [
          { label: '同意', value: 'approve' },
          { label: '驳回', value: 'reject' }
        ]
      },
      { key: 'comment', label: '意见', type: 'textarea' }
    ],
    submitLabel: '提交',
    layout: 'single-column'
  },
  authorize: actor => canApproveRefund(actor),
  preview: async (input, actor): Promise<PreviewResult> => {
    const args = isRecord(input) ? input : {}
    const refundId = positiveId(args.refundId, 'refundId')
    const decision = args.decision === 'approve' || args.decision === 'reject' ? args.decision : null
    if (!decision) throw createError({ statusCode: 400, message: 'decision must be approve or reject' })
    const pending = await listRefunds(actor, { status: 'pending', limit: 100 })
    const refund = pending.find(row => row.id === refundId)
    if (!refund) throw createError({ statusCode: 409, message: '退费申请不存在或已处理' })
    return {
      summary: `将${decision === 'approve' ? '同意' : '驳回'}「${refund.studentName ?? `#${refund.invoiceId}`}」的 ¥${refund.amount.toFixed(2)} 退费申请。`,
      details: { refundId, decision, amount: refund.amount, invoiceId: refund.invoiceId },
      impact: 1,
      warnings: decision === 'approve' ? ['同意后将从已缴金额中扣减退费金额。'] : undefined,
      fieldOptions: {
        refundId: pending.map(row => ({
          label: `${row.studentName ?? `#${row.invoiceId}`} · ¥${row.amount.toFixed(2)}`,
          value: row.id
        }))
      }
    }
  },
  execute: (input, actor) => approveRefund(actor, input as Record<string, unknown>),
  summarize: (value) => {
    const row = isRecord(value) ? value : {}
    return `退费已${row.status === 'approved' ? '通过' : '驳回'}${row.invoicePaid !== null && row.invoicePaid !== undefined ? `，账单已缴更新为 ¥${Number(row.invoicePaid).toFixed(2)}` : ''}`
  }
}

// ---------------------------------------------------------------------------
// Assets (Slice D)
// ---------------------------------------------------------------------------

const ASSET_STATUS_LABELS: Record<string, string> = {
  in_use: '使用中',
  idle: '闲置',
  maintenance: '维修中',
  disposed: '已处置'
}

const assetsList: Capability = {
  id: 'sms.assets.list',
  title: '资产列表',
  description: '查询固定资产及使用状态',
  resource: 'assets',
  moduleId: 'sms',
  operation: 'query',
  riskLevel: 'low',
  permission: 'sms.assets.read',
  approval: 'none',
  timeoutMs: TIMEOUT_MS,
  rateLimit: { max: 60, windowMs: 60_000 },
  schema: isRecord,
  inputJsonSchema: {
    type: 'object',
    properties: {
      status: { type: 'string', enum: [...ASSET_STATUSES] },
      category: { type: 'string' },
      limit: { type: 'integer', minimum: 1, maximum: 200 }
    },
    additionalProperties: false
  },
  authorize: actor => read(actor, 'assets'),
  execute: (input, actor) => listAssets(actor, isRecord(input) ? input : {}),
  summarize: rows => listSummary('资产', rows),
  resultView: {
    kind: 'table',
    columns: [
      { key: 'assetNo', label: '资产编号' },
      { key: 'name', label: '名称' },
      { key: 'category', label: '分类' },
      { key: 'status', label: '状态' },
      { key: 'location', label: '位置' },
      { key: 'value', label: '价值', format: 'number' }
    ]
  }
}

const assetsCreate: Capability = {
  id: 'sms.assets.create',
  title: '登记资产',
  description: '登记一项固定资产',
  resource: 'assets',
  moduleId: 'sms',
  operation: 'command',
  riskLevel: 'medium',
  permission: 'sms.assets.update',
  approval: 'confirm',
  timeoutMs: TIMEOUT_MS,
  rateLimit: { max: 30, windowMs: 60_000 },
  schema: isRecord,
  inputJsonSchema: {
    type: 'object',
    properties: {
      assetNo: { type: 'string' },
      name: { type: 'string' },
      category: { type: 'string' },
      location: { type: 'string' },
      purchasedAt: { type: 'string' },
      value: { type: 'number', minimum: 0 },
      assignedUserId: { type: 'integer', minimum: 1 }
    },
    required: ['assetNo', 'name'],
    additionalProperties: false
  },
  form: {
    fields: [
      { key: 'assetNo', label: '资产编号', type: 'text', required: true },
      { key: 'name', label: '名称', type: 'text', required: true },
      { key: 'category', label: '分类', type: 'text' },
      { key: 'location', label: '存放位置', type: 'text' },
      { key: 'purchasedAt', label: '购置日期', type: 'date' },
      { key: 'value', label: '价值', type: 'number' }
    ],
    submitLabel: '登记资产',
    layout: 'two-column'
  },
  authorize: actor => write(actor, 'update', 'assets'),
  preview: async (input): Promise<PreviewResult> => {
    const args = isRecord(input) ? input : {}
    const assetNo = text(args.assetNo, '资产编号')
    const name = text(args.name, '名称')
    return {
      summary: `将登记资产「${name}」（编号 ${assetNo}）。`,
      details: { assetNo, name, category: args.category, location: args.location },
      impact: 1
    }
  },
  execute: (input, actor) => createAsset(actor, input as Record<string, unknown>),
  summarize: (value) => {
    const row = isRecord(value) ? value : {}
    return `资产「${row.name ?? ''}」已登记（${ASSET_STATUS_LABELS[String(row.status)] ?? row.status}）`
  }
}

const assetsTransfer: Capability = {
  id: 'sms.assets.transfer',
  title: '资产变动',
  description: '变更资产使用人/位置/状态（处置需谨慎）',
  resource: 'assets',
  moduleId: 'sms',
  operation: 'command',
  riskLevel: 'medium',
  permission: 'sms.assets.update',
  approval: 'confirm',
  timeoutMs: TIMEOUT_MS,
  rateLimit: { max: 40, windowMs: 60_000 },
  schema: isRecord,
  inputJsonSchema: {
    type: 'object',
    properties: {
      assetId: { type: 'integer', minimum: 1 },
      status: { type: 'string', enum: [...ASSET_STATUSES] },
      assignedUserId: { type: 'integer', minimum: 1 },
      location: { type: 'string' },
      note: { type: 'string' }
    },
    required: ['assetId'],
    additionalProperties: false
  },
  form: {
    fields: [
      { key: 'assetId', label: '资产 ID', type: 'number', required: true },
      {
        key: 'status',
        label: '新状态',
        type: 'select',
        options: ASSET_STATUSES.map(status => ({ label: ASSET_STATUS_LABELS[status] ?? status, value: status }))
      },
      { key: 'assignedUserId', label: '使用人用户 ID', type: 'number' },
      { key: 'location', label: '位置', type: 'text' },
      { key: 'note', label: '备注', type: 'text' }
    ],
    submitLabel: '保存变动',
    layout: 'two-column'
  },
  authorize: actor => write(actor, 'update', 'assets'),
  preview: async (input, actor): Promise<PreviewResult> => {
    const args = isRecord(input) ? input : {}
    const assetId = positiveId(args.assetId, 'assetId')
    const assets = await listAssets(actor, { limit: 200 })
    const asset = assets.find(row => row.id === assetId)
    if (!asset) throw createError({ statusCode: 404, message: '资产不存在' })
    const status = args.status === undefined || args.status === null || args.status === ''
      ? asset.status
      : String(args.status)
    return {
      summary: `将把资产「${asset.name}」从 ${ASSET_STATUS_LABELS[asset.status] ?? asset.status} 改为 ${ASSET_STATUS_LABELS[status] ?? status}。`,
      details: { assetId, from: asset.status, to: status, assignedUserId: args.assignedUserId, location: args.location },
      impact: 1,
      warnings: status === 'disposed' ? ['处置后资产不可再移动，请确认。'] : undefined
    }
  },
  execute: (input, actor) => transferAsset(actor, input as Record<string, unknown>),
  summarize: (value) => {
    const row = isRecord(value) ? value : {}
    return `资产状态已更新为 ${ASSET_STATUS_LABELS[String(row.status)] ?? row.status}`
  }
}

// ---------------------------------------------------------------------------
// Library (Slice D)
// ---------------------------------------------------------------------------

const booksList: Capability = {
  id: 'sms.books.list',
  title: '图书目录',
  description: '查询图书及可借数量',
  resource: 'library',
  moduleId: 'sms',
  operation: 'query',
  riskLevel: 'low',
  permission: 'sms.library.read',
  approval: 'none',
  timeoutMs: TIMEOUT_MS,
  rateLimit: { max: 60, windowMs: 60_000 },
  schema: isRecord,
  inputJsonSchema: {
    type: 'object',
    properties: {
      query: { type: 'string' },
      limit: { type: 'integer', minimum: 1, maximum: 200 }
    },
    additionalProperties: false
  },
  authorize: actor => read(actor, 'library'),
  execute: (input, actor) => listBooks(actor, isRecord(input) ? input : {}),
  summarize: rows => listSummary('图书', rows),
  resultView: {
    kind: 'table',
    columns: [
      { key: 'title', label: '书名' },
      { key: 'author', label: '作者' },
      { key: 'isbn', label: 'ISBN' },
      { key: 'category', label: '分类' },
      { key: 'totalCopies', label: '馆藏', format: 'number' },
      { key: 'availableCopies', label: '可借', format: 'number' }
    ]
  }
}

const booksCreate: Capability = {
  id: 'sms.books.create',
  title: '新增图书',
  description: '新增图书并设置馆藏数量',
  resource: 'library',
  moduleId: 'sms',
  operation: 'command',
  riskLevel: 'medium',
  permission: 'sms.library.update',
  approval: 'confirm',
  timeoutMs: TIMEOUT_MS,
  rateLimit: { max: 30, windowMs: 60_000 },
  schema: isRecord,
  inputJsonSchema: {
    type: 'object',
    properties: {
      title: { type: 'string' },
      author: { type: 'string' },
      isbn: { type: 'string' },
      category: { type: 'string' },
      totalCopies: { type: 'integer', minimum: 1, maximum: 999 }
    },
    required: ['title'],
    additionalProperties: false
  },
  form: {
    fields: [
      { key: 'title', label: '书名', type: 'text', required: true },
      { key: 'author', label: '作者', type: 'text' },
      { key: 'isbn', label: 'ISBN', type: 'text' },
      { key: 'category', label: '分类', type: 'text' },
      { key: 'totalCopies', label: '馆藏数量', type: 'number', help: '默认 1' }
    ],
    submitLabel: '新增图书',
    layout: 'two-column'
  },
  authorize: actor => write(actor, 'update', 'library'),
  preview: async (input): Promise<PreviewResult> => {
    const args = isRecord(input) ? input : {}
    const title = text(args.title, '书名')
    const copies = args.totalCopies === undefined ? 1 : Number(args.totalCopies)
    return {
      summary: `将新增图书「${title}」，馆藏 ${copies} 册。`,
      details: { title, author: args.author, isbn: args.isbn, totalCopies: copies },
      impact: 1
    }
  },
  execute: (input, actor) => createBook(actor, input as Record<string, unknown>),
  summarize: (value) => {
    const row = isRecord(value) ? value : {}
    return `图书「${row.title ?? ''}」已入库`
  }
}

const loansBorrow: Capability = {
  id: 'sms.loans.borrow',
  title: '借书',
  description: '为学生办理借书（自动扣减可借数量）',
  resource: 'library',
  moduleId: 'sms',
  operation: 'command',
  riskLevel: 'medium',
  permission: 'sms.library.update',
  approval: 'confirm',
  timeoutMs: TIMEOUT_MS,
  rateLimit: { max: 60, windowMs: 60_000 },
  schema: isRecord,
  inputJsonSchema: {
    type: 'object',
    properties: {
      bookId: { type: 'integer', minimum: 1 },
      studentId: { type: 'integer', minimum: 1 },
      dueAt: { type: 'string', description: 'ISO date, default +30d' }
    },
    required: ['bookId', 'studentId'],
    additionalProperties: false
  },
  form: {
    fields: [
      { key: 'bookId', label: '图书', type: 'select', required: true },
      { key: 'studentId', label: '学生', type: 'select', required: true },
      { key: 'dueAt', label: '应还日期', type: 'date', help: '默认 30 天后' }
    ],
    submitLabel: '办理借书',
    layout: 'two-column'
  },
  authorize: actor => write(actor, 'update', 'library'),
  preview: async (input, actor): Promise<PreviewResult> => {
    const args = isRecord(input) ? input : {}
    const bookId = positiveId(args.bookId, 'bookId')
    const studentId = positiveId(args.studentId, 'studentId')
    const [books, student, students, active] = await Promise.all([
      listBooks(actor, { limit: 200 }),
      getStudent(actor, studentId),
      searchStudents(actor, { limit: 100 }),
      listLoans(actor, { studentId, status: 'borrowed', limit: 100 })
    ])
    const book = books.find(row => row.id === bookId)
    if (!book) throw createError({ statusCode: 404, message: '图书不存在' })
    return {
      summary: `将为「${student.name}」办理借阅「${book.title}」${args.dueAt ? `，应还 ${String(args.dueAt)}` : ''}。`,
      details: { bookId, studentId, dueAt: args.dueAt, activeLoans: active.length },
      impact: 1,
      warnings: active.length >= 5 ? ['该学生已有 5 笔未还借阅，请确认。'] : undefined,
      fieldOptions: {
        bookId: books.filter(row => row.availableCopies > 0).map(row => ({ label: `${row.title}（可借 ${row.availableCopies}）`, value: row.id })),
        studentId: students.map(row => ({ label: `${row.name}（${row.studentNo}）`, value: row.id }))
      }
    }
  },
  execute: (input, actor) => borrowBook(actor, input as Record<string, unknown>),
  summarize: (value) => {
    const row = isRecord(value) ? value : {}
    return `已借出「${row.title ?? ''}」，可借剩余 ${row.availableCopies ?? '-'} 册`
  }
}

const loansReturn: Capability = {
  id: 'sms.loans.return',
  title: '还书',
  description: '办理还书（自动恢复可借数量）',
  resource: 'library',
  moduleId: 'sms',
  operation: 'command',
  riskLevel: 'low',
  permission: 'sms.library.update',
  approval: 'confirm',
  timeoutMs: TIMEOUT_MS,
  rateLimit: { max: 60, windowMs: 60_000 },
  schema: isRecord,
  inputJsonSchema: {
    type: 'object',
    properties: { loanId: { type: 'integer', minimum: 1 } },
    required: ['loanId'],
    additionalProperties: false
  },
  form: {
    fields: [
      { key: 'loanId', label: '借阅记录', type: 'select', required: true }
    ],
    submitLabel: '办理还书'
  },
  authorize: actor => write(actor, 'update', 'library'),
  preview: async (input, actor): Promise<PreviewResult> => {
    const loanId = positiveId((input as Args).loanId, 'loanId')
    const loans = await listLoans(actor, { status: 'borrowed', limit: 200 })
    const loan = loans.find(row => row.id === loanId)
    if (!loan) throw createError({ statusCode: 404, message: '借阅记录不存在或已归还' })
    return {
      summary: `将为「${loan.studentName ?? `#${loan.studentId}`}」办理归还「${loan.title ?? ''}」。`,
      details: { loanId, bookId: loan.bookId, studentId: loan.studentId },
      impact: 1,
      fieldOptions: {
        loanId: loans.map(row => ({
          label: `${row.studentName ?? `#${row.studentId}`} · ${row.title ?? ''}（应还 ${row.dueAt.toISOString().slice(0, 10)}）`,
          value: row.id
        }))
      }
    }
  },
  execute: (input, actor) => returnBook(actor, positiveId((input as Args).loanId, 'loanId')),
  summarize: () => '还书已登记'
}

// ---------------------------------------------------------------------------
// Reports (Phase 5)
// ---------------------------------------------------------------------------

const reportsAttendance: Capability = {
  id: 'sms.reports.attendance',
  title: '考勤报表',
  description: '按班级/日期区间统计出勤、缺勤与请假（默认最近 30 天）',
  resource: 'reports',
  moduleId: 'sms',
  operation: 'query',
  riskLevel: 'low',
  permission: 'sms.reports.read',
  approval: 'none',
  timeoutMs: TIMEOUT_MS,
  rateLimit: { max: 30, windowMs: 60_000 },
  schema: isRecord,
  inputJsonSchema: {
    type: 'object',
    properties: {
      classId: { type: 'integer', minimum: 1 },
      from: { type: 'string', description: 'YYYY-MM-DD' },
      to: { type: 'string', description: 'YYYY-MM-DD' }
    },
    additionalProperties: false
  },
  authorize: actor => read(actor, 'reports'),
  execute: (input, actor) => attendanceReport(actor, isRecord(input) ? input : {}),
  summarize: (value) => {
    const row = isRecord(value) ? value : {}
    return `考勤报表（${String(row.from ?? '')} 至 ${String(row.to ?? '')}）：${Array.isArray(row.rows) ? row.rows.length : 0} 个班级`
  },
  resultView: {
    kind: 'table',
    columns: [
      { key: 'className', label: '班级' },
      { key: 'present', label: '出勤', format: 'number' },
      { key: 'late', label: '迟到', format: 'number' },
      { key: 'absent', label: '缺勤', format: 'number' },
      { key: 'leave', label: '请假', format: 'number' },
      { key: 'total', label: '合计', format: 'number' },
      { key: 'attendanceRate', label: '出勤率%', format: 'number' }
    ]
  }
}

const reportsScores: Capability = {
  id: 'sms.reports.scores',
  title: '成绩报表',
  description: '按科目统计已发布考试的平均分、最高分、最低分',
  resource: 'reports',
  moduleId: 'sms',
  operation: 'query',
  riskLevel: 'low',
  permission: 'sms.reports.read',
  approval: 'none',
  timeoutMs: TIMEOUT_MS,
  rateLimit: { max: 30, windowMs: 60_000 },
  schema: isRecord,
  inputJsonSchema: {
    type: 'object',
    properties: {
      classId: { type: 'integer', minimum: 1 },
      termId: { type: 'integer', minimum: 1 }
    },
    additionalProperties: false
  },
  authorize: actor => read(actor, 'reports'),
  execute: (input, actor) => scoreReport(actor, isRecord(input) ? input : {}),
  summarize: (value) => {
    const row = isRecord(value) ? value : {}
    return `成绩报表：${Array.isArray(row.rows) ? row.rows.length : 0} 个科目`
  },
  resultView: {
    kind: 'table',
    columns: [
      { key: 'subjectName', label: '科目' },
      { key: 'count', label: '人数', format: 'number' },
      { key: 'average', label: '平均分', format: 'number' },
      { key: 'minimum', label: '最低分', format: 'number' },
      { key: 'maximum', label: '最高分', format: 'number' }
    ]
  }
}

const reportsFinance: Capability = {
  id: 'sms.reports.finance',
  title: '财务报表',
  description: '统计账单状态、区间收款与已批准退费（需财务读权限）',
  resource: 'reports',
  moduleId: 'sms',
  operation: 'query',
  riskLevel: 'medium',
  permission: 'sms.reports.read',
  approval: 'none',
  timeoutMs: TIMEOUT_MS,
  rateLimit: { max: 30, windowMs: 60_000 },
  schema: isRecord,
  inputJsonSchema: {
    type: 'object',
    properties: {
      from: { type: 'string', description: 'YYYY-MM-DD' },
      to: { type: 'string', description: 'YYYY-MM-DD' }
    },
    additionalProperties: false
  },
  authorize: actor => read(actor, 'reports') && read(actor, 'finance'),
  execute: (input, actor) => financeReport(actor, isRecord(input) ? input : {}),
  summarize: (value) => {
    const row = isRecord(value) ? value : {}
    const payments = isRecord(row.payments) ? row.payments : {}
    return `财务报表（${String(row.from ?? '')} 至 ${String(row.to ?? '')}）：收款 ¥${Number(payments.total ?? 0).toFixed(2)}`
  },
  resultView: {
    kind: 'table',
    columns: [
      { key: 'status', label: '账单状态' },
      { key: 'count', label: '笔数', format: 'number' },
      { key: 'payable', label: '应缴', format: 'number' },
      { key: 'paid', label: '已缴', format: 'number' }
    ]
  }
}

const reportsExport: Capability = {
  id: 'sms.reports.export',
  title: '导出报表',
  description: '导出考勤/成绩/财务 CSV（高风险，需二次审批）',
  resource: 'reports',
  moduleId: 'sms',
  operation: 'command',
  riskLevel: 'high',
  permission: 'sms.reports.export',
  approval: 'confirm',
  requiresApproval: true,
  timeoutMs: TIMEOUT_MS,
  rateLimit: { max: 10, windowMs: 60_000 },
  schema: isRecord,
  inputJsonSchema: {
    type: 'object',
    properties: {
      type: { type: 'string', enum: [...REPORT_TYPES] },
      classId: { type: 'integer', minimum: 1 },
      termId: { type: 'integer', minimum: 1 },
      from: { type: 'string', description: 'YYYY-MM-DD' },
      to: { type: 'string', description: 'YYYY-MM-DD' }
    },
    required: ['type'],
    additionalProperties: false
  },
  form: {
    fields: [
      {
        key: 'type',
        label: '报表类型',
        type: 'select',
        required: true,
        options: [
          { label: '考勤', value: 'attendance' },
          { label: '成绩', value: 'scores' },
          { label: '财务', value: 'finance' }
        ]
      },
      { key: 'classId', label: '班级', type: 'number' },
      { key: 'termId', label: '学期', type: 'number' },
      { key: 'from', label: '开始日期', type: 'date' },
      { key: 'to', label: '结束日期', type: 'date' }
    ],
    submitLabel: '导出 CSV',
    layout: 'two-column'
  },
  authorize: actor => canExportReports(actor),
  preview: async (input, actor): Promise<PreviewResult> => {
    const args = isRecord(input) ? input : {}
    const type = normalizeReportType(args.type)
    const report = type === 'attendance'
      ? await attendanceReport(actor, { classId: args.classId, from: args.from, to: args.to })
      : type === 'scores'
        ? await scoreReport(actor, { classId: args.classId, termId: args.termId })
        : await financeReport(actor, { from: args.from, to: args.to })
    const count = type === 'attendance'
      ? (report as { rows: unknown[] }).rows.length
      : type === 'scores'
        ? (report as { rows: unknown[] }).rows.length
        : (report as { invoices: unknown[] }).invoices.length + 2
    return {
      summary: `将导出${type === 'attendance' ? '考勤' : type === 'scores' ? '成绩' : '财务'} CSV，约 ${count} 行。`,
      details: { type, classId: args.classId, termId: args.termId, from: args.from, to: args.to },
      impact: 1,
      warnings: ['报表导出属于高风险操作，需要二次审批。']
    }
  },
  execute: (input, actor) => exportReport(actor, input as Record<string, unknown>),
  summarize: (value) => {
    const row = isRecord(value) ? value : {}
    return `已生成${String(row.type ?? '')} CSV，共 ${row.rowCount ?? 0} 行`
  }
}

const notificationsList: Capability = {
  id: 'sms.notifications.list',
  title: '我的通知',
  description: '查看当前用户收到的站内通知与未读数量（按组织隔离）',
  resource: 'notifications',
  moduleId: 'sms',
  operation: 'query',
  riskLevel: 'low',
  permission: 'sms.notifications.read',
  approval: 'none',
  timeoutMs: TIMEOUT_MS,
  rateLimit: { max: 60, windowMs: 60_000 },
  schema: isRecord,
  inputJsonSchema: {
    type: 'object',
    properties: {
      status: { type: 'string', enum: ['unread', 'read', 'all'] },
      category: { type: 'string', enum: ['attendance', 'leave', 'finance', 'approval', 'academic', 'system'] },
      limit: { type: 'integer', minimum: 1, maximum: 200 }
    },
    additionalProperties: false
  },
  authorize: actor => read(actor, 'notifications'),
  execute: async (input, actor) => {
    const rows = await listNotifications(actor, isRecord(input) ? input : {})
    return { rows, unread: await unreadNotificationCount(actor) }
  },
  summarize: (value) => {
    const rows = isRecord(value) && Array.isArray(value.rows) ? value.rows : []
    const unread = isRecord(value) ? Number(value.unread ?? 0) : 0
    return rows.length === 0 ? '没有通知' : `共 ${rows.length} 条通知，其中 ${unread} 条未读`
  },
  resultView: {
    kind: 'table',
    columns: [
      { key: 'title', label: '标题' },
      { key: 'category', label: '类别' },
      { key: 'status', label: '状态' },
      { key: 'createdAt', label: '时间', format: 'datetime' },
      { key: 'link', label: '链接' }
    ]
  }
}

const notificationsSend: Capability = {
  id: 'sms.notifications.send',
  title: '发送通知',
  description: '向本组织成员发送站内通知，可按角色或指定用户定向发送',
  resource: 'notifications',
  moduleId: 'sms',
  operation: 'command',
  riskLevel: 'medium',
  permission: 'sms.notifications.send',
  approval: 'confirm',
  timeoutMs: TIMEOUT_MS,
  rateLimit: { max: 20, windowMs: 60_000 },
  schema: isRecord,
  inputJsonSchema: {
    type: 'object',
    properties: {
      title: { type: 'string' },
      body: { type: 'string' },
      category: { type: 'string', enum: ['attendance', 'leave', 'finance', 'approval', 'academic', 'system'] },
      roleNames: { type: 'array', items: { type: 'string' }, description: '目标角色名称，例如 sms.teacher' },
      recipientUserIds: { type: 'array', items: { type: 'integer', minimum: 1 } },
      link: { type: 'string', description: '站内路径，例如 /sms' }
    },
    required: ['title'],
    additionalProperties: false
  },
  form: {
    fields: [
      { key: 'title', label: '标题', type: 'text', required: true },
      { key: 'body', label: '内容', type: 'textarea' },
      { key: 'category', label: '类别', type: 'select', required: true },
      { key: 'roleNames', label: '目标角色', type: 'text', help: '多个角色用逗号分隔' },
      { key: 'link', label: '站内链接', type: 'text', placeholder: '/sms' }
    ],
    submitLabel: '发送通知',
    layout: 'single-column'
  },
  authorize: actor => canSendNotification(actor),
  preview: (input): PreviewResult => {
    const args = isRecord(input) ? input : {}
    const roles = Array.isArray(args.roleNames) ? args.roleNames.length : 0
    const users = Array.isArray(args.recipientUserIds) ? args.recipientUserIds.length : 0
    const targets = roles + users
    return {
      summary: targets > 0
        ? `将向 ${targets} 个目标发送通知「${String(args.title ?? '')}」。`
        : '尚未指定收件人，请选择目标角色或用户。',
      details: { title: args.title, category: args.category, roles, users },
      impact: Math.max(targets, 1),
      warnings: targets === 0 ? ['没有收件人时发送会被拒绝。'] : undefined
    }
  },
  execute: (input, actor) => sendNotification(actor, isRecord(input) ? input : {}),
  summarize: (value) => {
    const row = isRecord(value) ? value : {}
    return `已发送通知给 ${row.sent ?? 0} 人`
  }
}

const knowledgeSearch: Capability = {
  id: 'sms.knowledge.search',
  title: '检索校规知识库',
  description: '按关键词检索校规、请假制度、收费说明等知识条目（按角色可见范围过滤）',
  resource: 'knowledge',
  moduleId: 'sms',
  operation: 'query',
  riskLevel: 'low',
  permission: 'sms.knowledge.read',
  approval: 'none',
  timeoutMs: TIMEOUT_MS,
  rateLimit: { max: 60, windowMs: 60_000 },
  schema: isRecord,
  inputJsonSchema: {
    type: 'object',
    properties: {
      query: { type: 'string' },
      tags: { type: 'string' },
      limit: { type: 'integer', minimum: 1, maximum: 50 }
    },
    additionalProperties: false
  },
  authorize: actor => read(actor, 'knowledge'),
  execute: (input, actor) => searchKnowledge(actor, isRecord(input) ? input : {}),
  summarize: rows => listSummary('知识条目', rows),
  resultView: {
    kind: 'table',
    columns: [
      { key: 'title', label: '标题' },
      { key: 'snippet', label: '摘要' },
      { key: 'tags', label: '标签' },
      { key: 'audience', label: '可见范围' },
      { key: 'updatedAt', label: '更新时间', format: 'datetime' }
    ]
  }
}

const knowledgeCreate: Capability = {
  id: 'sms.knowledge.create',
  title: '新增知识条目',
  description: '向校规知识库新增一条可检索的制度说明',
  resource: 'knowledge',
  moduleId: 'sms',
  operation: 'command',
  riskLevel: 'medium',
  permission: 'sms.knowledge.create',
  approval: 'confirm',
  timeoutMs: TIMEOUT_MS,
  rateLimit: { max: 20, windowMs: 60_000 },
  schema: isRecord,
  inputJsonSchema: {
    type: 'object',
    properties: {
      title: { type: 'string' },
      content: { type: 'string' },
      tags: { type: 'string' },
      audience: { type: 'string', enum: ['all', 'staff', 'student', 'guardian'] },
      status: { type: 'string', enum: ['published', 'draft'] }
    },
    required: ['title', 'content'],
    additionalProperties: false
  },
  form: {
    fields: [
      { key: 'title', label: '标题', type: 'text', required: true },
      { key: 'content', label: '正文', type: 'textarea', required: true },
      { key: 'tags', label: '标签', type: 'text', help: '用逗号分隔' },
      { key: 'audience', label: '可见范围', type: 'select', required: true },
      { key: 'status', label: '状态', type: 'select', required: true }
    ],
    submitLabel: '保存条目',
    layout: 'single-column'
  },
  authorize: actor => isSmsAdmin(actor) || (actor.permissions ?? []).includes('sms.knowledge.create'),
  preview: (input): PreviewResult => {
    const args = isRecord(input) ? input : {}
    return {
      summary: `将新增知识条目「${String(args.title ?? '')}」。`,
      details: { title: args.title, audience: args.audience, status: args.status },
      impact: 1,
      warnings: args.status === 'draft' ? ['草稿不会出现在检索结果中。'] : undefined
    }
  },
  execute: (input, actor) => createKnowledgeArticle(actor, isRecord(input) ? input : {}),
  summarize: (value) => {
    const row = isRecord(value) ? value : {}
    return `知识条目已保存：#${row.id ?? '-'}`
  }
}

const studentsImport: Capability = {
  id: 'sms.students.import',
  title: '批量导入学生',
  description: '通过 CSV 批量导入学生档案，逐行校验并返回导入报告（高风险，需确认）',
  resource: 'students',
  moduleId: 'sms',
  operation: 'command',
  riskLevel: 'high',
  permission: 'sms.students.create',
  approval: 'confirm',
  requiresApproval: true,
  timeoutMs: 60_000,
  rateLimit: { max: 5, windowMs: 60_000 },
  schema: isRecord,
  inputJsonSchema: {
    type: 'object',
    properties: {
      csv: { type: 'string', description: '表头需包含 name, studentNo, classId' },
      dryRun: { type: 'boolean', description: '只校验不写入' }
    },
    required: ['csv'],
    additionalProperties: false
  },
  form: {
    fields: [
      {
        key: 'csv',
        label: 'CSV 内容',
        type: 'textarea',
        required: true,
        help: `表头：name,studentNo,classId；单次最多 ${IMPORT_MAX_ROWS} 行`
      },
      { key: 'dryRun', label: '仅校验', type: 'boolean', help: '开启后不会写入数据库' }
    ],
    submitLabel: '开始导入',
    layout: 'single-column'
  },
  authorize: actor => write(actor, 'create', 'students'),
  preview: (input): PreviewResult => {
    const args = isRecord(input) ? input : {}
    const csv = typeof args.csv === 'string' ? args.csv : ''
    const dataRows = Math.max(parseCsv(csv).length - 1, 0)
    return {
      summary: args.dryRun === true
        ? `将校验 ${dataRows} 行学生数据（不写入）。`
        : `将导入最多 ${dataRows} 行学生数据。`,
      details: { rows: dataRows, dryRun: args.dryRun === true },
      impact: dataRows,
      warnings: dataRows > IMPORT_MAX_ROWS ? [`超过单次上限 ${IMPORT_MAX_ROWS} 行，将被拒绝。`] : undefined
    }
  },
  execute: (input, actor) => importStudentsCsv(actor, isRecord(input) ? input : {}),
  summarize: (value) => {
    const row = isRecord(value) ? value : {}
    return `导入完成：成功 ${row.imported ?? 0} 行，失败 ${row.invalid ?? 0} 行`
  }
}

const reportsDaily: Capability = {
  id: 'sms.reports.daily',
  title: '日报汇总',
  description: '查询预聚合的按班级每日考勤汇总（避免扫描原始考勤表）',
  resource: 'reports',
  moduleId: 'sms',
  operation: 'query',
  riskLevel: 'low',
  permission: 'sms.reports.read',
  approval: 'none',
  timeoutMs: TIMEOUT_MS,
  rateLimit: { max: 60, windowMs: 60_000 },
  schema: isRecord,
  inputJsonSchema: {
    type: 'object',
    properties: {
      from: { type: 'string', description: 'YYYY-MM-DD' },
      to: { type: 'string', description: 'YYYY-MM-DD' },
      classId: { type: 'integer', minimum: 0 },
      limit: { type: 'integer', minimum: 1, maximum: 500 }
    },
    additionalProperties: false
  },
  authorize: actor => read(actor, 'reports'),
  execute: (input, actor) => listDailyReport(actor, isRecord(input) ? input : {}),
  summarize: rows => listSummary('日报', rows),
  resultView: {
    kind: 'table',
    columns: [
      { key: 'reportDate', label: '日期', format: 'datetime' },
      { key: 'classId', label: '班级 ID', format: 'number' },
      { key: 'present', label: '出勤', format: 'number' },
      { key: 'late', label: '迟到', format: 'number' },
      { key: 'absent', label: '缺勤', format: 'number' },
      { key: 'leave', label: '请假', format: 'number' },
      { key: 'total', label: '合计', format: 'number' }
    ]
  }
}

const agentTasksList: Capability = {
  id: 'sms.agent-tasks.list',
  title: '我的 Agent 任务',
  description: '列出当前用户创建的任务型 Agent 运行记录及状态',
  resource: 'agent-tasks',
  moduleId: 'sms',
  operation: 'query',
  riskLevel: 'low',
  permission: 'sms.agent-tasks.read',
  approval: 'none',
  timeoutMs: TIMEOUT_MS,
  rateLimit: { max: 60, windowMs: 60_000 },
  schema: isRecord,
  inputJsonSchema: {
    type: 'object',
    properties: {
      status: { type: 'string', enum: ['all', 'pending', 'running', 'waiting_approval', 'done', 'failed', 'cancelled'] },
      limit: { type: 'integer', minimum: 1, maximum: 100 }
    },
    additionalProperties: false
  },
  authorize: actor => read(actor, 'agent-tasks'),
  execute: (input, actor) => listAgentTasks(actor, isRecord(input) ? input : {}),
  summarize: rows => listSummary('Agent 任务', rows),
  resultView: {
    kind: 'table',
    columns: [
      { key: 'title', label: '任务' },
      { key: 'status', label: '状态' },
      { key: 'step', label: '步骤', format: 'number' },
      { key: 'maxSteps', label: '上限', format: 'number' },
      { key: 'updatedAt', label: '更新时间', format: 'datetime' }
    ]
  }
}

const agentTasksCreate: Capability = {
  id: 'sms.agent-tasks.create',
  title: '创建 Agent 任务',
  description: '为一个多步骤目标创建可恢复的任务型 Agent 运行',
  resource: 'agent-tasks',
  moduleId: 'sms',
  operation: 'command',
  riskLevel: 'medium',
  permission: 'sms.agent-tasks.create',
  approval: 'confirm',
  timeoutMs: TIMEOUT_MS,
  rateLimit: { max: 20, windowMs: 60_000 },
  schema: isRecord,
  inputJsonSchema: {
    type: 'object',
    properties: {
      title: { type: 'string' },
      goal: { type: 'string' },
      payload: { type: 'object' }
    },
    required: ['title'],
    additionalProperties: false
  },
  form: {
    fields: [
      { key: 'title', label: '任务名称', type: 'text', required: true },
      { key: 'goal', label: '目标', type: 'textarea' }
    ],
    submitLabel: '创建任务',
    layout: 'single-column'
  },
  authorize: actor => isSmsAdmin(actor) || (actor.permissions ?? []).includes('sms.agent-tasks.create'),
  preview: (input): PreviewResult => {
    const args = isRecord(input) ? input : {}
    return {
      summary: `将创建 Agent 任务「${String(args.title ?? '')}」。`,
      details: { title: args.title, goal: args.goal },
      impact: 1
    }
  },
  execute: (input, actor) => createAgentTask(actor, isRecord(input) ? input : {}),
  summarize: (value) => {
    const row = isRecord(value) ? value : {}
    return `Agent 任务已创建：#${row.id ?? '-'}`
  }
}

const agentTasksAdvance: Capability = {
  id: 'sms.agent-tasks.advance',
  title: '推进 Agent 任务',
  description: '按状态机推进任务（开始/等待审批/恢复/完成/失败/取消）',
  resource: 'agent-tasks',
  moduleId: 'sms',
  operation: 'command',
  riskLevel: 'low',
  permission: 'sms.agent-tasks.read',
  approval: 'confirm',
  timeoutMs: TIMEOUT_MS,
  rateLimit: { max: 60, windowMs: 60_000 },
  schema: isRecord,
  inputJsonSchema: {
    type: 'object',
    properties: {
      taskId: { type: 'integer', minimum: 1 },
      event: { type: 'string', enum: [...AGENT_TASK_EVENTS] },
      note: { type: 'string' }
    },
    required: ['taskId', 'event'],
    additionalProperties: false
  },
  authorize: actor => read(actor, 'agent-tasks'),
  preview: (input): PreviewResult => {
    const args = isRecord(input) ? input : {}
    return {
      summary: `将把 Agent 任务 #${String(args.taskId ?? '')} 推进为「${String(args.event ?? '')}」。`,
      details: { taskId: args.taskId, event: args.event },
      impact: 1
    }
  },
  execute: (input, actor) => advanceAgentTask(actor, isRecord(input) ? input : {}),
  summarize: (value) => {
    const row = isRecord(value) ? value : {}
    return `Agent 任务状态：${row.status ?? '-'}`
  }
}

const assignmentsCreate: Capability = {
  id: 'sms.assignments.create',
  title: '布置作业',
  description: '为班级和科目创建作业（草稿或直接发布）',
  resource: 'assignments',
  moduleId: 'sms',
  operation: 'command',
  riskLevel: 'medium',
  permission: 'sms.assignments.update',
  approval: 'confirm',
  timeoutMs: TIMEOUT_MS,
  rateLimit: { max: 30, windowMs: 60_000 },
  schema: isRecord,
  inputJsonSchema: {
    type: 'object',
    properties: {
      classId: { type: 'integer', minimum: 1 },
      subjectId: { type: 'integer', minimum: 1 },
      title: { type: 'string' },
      description: { type: 'string' },
      dueAt: { type: 'string' },
      status: { type: 'string', enum: ['draft', 'published', 'closed'] }
    },
    required: ['classId', 'subjectId', 'title'],
    additionalProperties: false
  },
  form: {
    fields: [
      { key: 'classId', label: '班级 ID', type: 'number', required: true },
      { key: 'subjectId', label: '科目 ID', type: 'number', required: true },
      { key: 'title', label: '标题', type: 'text', required: true },
      { key: 'description', label: '说明', type: 'textarea' },
      { key: 'dueAt', label: '截止时间', type: 'text', help: 'ISO 时间' },
      { key: 'status', label: '状态', type: 'select', required: true }
    ],
    submitLabel: '保存作业',
    layout: 'single-column'
  },
  authorize: actor => write(actor, 'update', 'assignments'),
  preview: (input): PreviewResult => {
    const args = isRecord(input) ? input : {}
    return {
      summary: `将在班级 ${String(args.classId ?? '')} 布置作业「${String(args.title ?? '')}」。`,
      details: { classId: args.classId, subjectId: args.subjectId, status: args.status },
      impact: 1
    }
  },
  execute: (input, actor) => createAssignment(actor, isRecord(input) ? input : {}),
  summarize: (value) => {
    const row = isRecord(value) ? value : {}
    return `作业已保存：#${row.id ?? '-'}`
  }
}

const assignmentsList: Capability = {
  id: 'sms.assignments.list',
  title: '查询作业',
  description: '按班级与状态查询作业（学生仅能看到已发布作业）',
  resource: 'assignments',
  moduleId: 'sms',
  operation: 'query',
  riskLevel: 'low',
  permission: 'sms.assignments.read',
  approval: 'none',
  timeoutMs: TIMEOUT_MS,
  rateLimit: { max: 60, windowMs: 60_000 },
  schema: isRecord,
  inputJsonSchema: {
    type: 'object',
    properties: {
      classId: { type: 'integer', minimum: 1 },
      status: { type: 'string', enum: ['draft', 'published', 'closed'] },
      limit: { type: 'integer', minimum: 1, maximum: 200 }
    },
    additionalProperties: false
  },
  authorize: actor => read(actor, 'assignments'),
  execute: (input, actor) => listAssignments(actor, isRecord(input) ? input : {}),
  summarize: rows => listSummary('作业', rows),
  resultView: {
    kind: 'table',
    columns: [
      { key: 'title', label: '作业' },
      { key: 'classId', label: '班级 ID', format: 'number' },
      { key: 'subjectId', label: '科目 ID', format: 'number' },
      { key: 'status', label: '状态' },
      { key: 'dueAt', label: '截止', format: 'datetime' }
    ]
  }
}

const assignmentsSubmit: Capability = {
  id: 'sms.assignments.submit',
  title: '提交作业',
  description: '学生提交或更新自己的作业内容',
  resource: 'assignments',
  moduleId: 'sms',
  operation: 'command',
  riskLevel: 'low',
  permission: 'sms.assignments.submit',
  approval: 'confirm',
  timeoutMs: TIMEOUT_MS,
  rateLimit: { max: 30, windowMs: 60_000 },
  schema: isRecord,
  inputJsonSchema: {
    type: 'object',
    properties: {
      assignmentId: { type: 'integer', minimum: 1 },
      content: { type: 'string' }
    },
    required: ['assignmentId'],
    additionalProperties: false
  },
  authorize: actor => canUseSms(actor, 'create', 'assignments'),
  preview: (input): PreviewResult => {
    const args = isRecord(input) ? input : {}
    return {
      summary: `将提交作业 #${String(args.assignmentId ?? '')}。`,
      details: { assignmentId: args.assignmentId, length: String(args.content ?? '').length },
      impact: 1
    }
  },
  execute: (input, actor) => submitAssignment(actor, isRecord(input) ? input : {}),
  summarize: (value) => {
    const row = isRecord(value) ? value : {}
    return `作业已提交：#${row.id ?? '-'}`
  }
}

const assignmentsGrade: Capability = {
  id: 'sms.assignments.grade',
  title: '批改作业',
  description: '为作业提交打分并填写评语（限所授班级）',
  resource: 'assignments',
  moduleId: 'sms',
  operation: 'command',
  riskLevel: 'medium',
  permission: 'sms.assignments.update',
  approval: 'confirm',
  timeoutMs: TIMEOUT_MS,
  rateLimit: { max: 60, windowMs: 60_000 },
  schema: isRecord,
  inputJsonSchema: {
    type: 'object',
    properties: {
      submissionId: { type: 'integer', minimum: 1 },
      score: { type: 'number', minimum: 0, maximum: 1000 },
      feedback: { type: 'string' }
    },
    required: ['submissionId', 'score'],
    additionalProperties: false
  },
  authorize: actor => write(actor, 'update', 'assignments'),
  preview: (input): PreviewResult => {
    const args = isRecord(input) ? input : {}
    return {
      summary: `将批改提交 #${String(args.submissionId ?? '')}，得分 ${String(args.score ?? '')}。`,
      details: { submissionId: args.submissionId, score: args.score },
      impact: 1
    }
  },
  execute: (input, actor) => gradeSubmission(actor, isRecord(input) ? input : {}),
  summarize: (value) => {
    const row = isRecord(value) ? value : {}
    return `批改完成：${row.score ?? '-'} 分`
  }
}

const electionsList: Capability = {
  id: 'sms.elections.list',
  title: '查询选课',
  description: '查询学生选课记录（学生仅能看到自己的记录）',
  resource: 'elections',
  moduleId: 'sms',
  operation: 'query',
  riskLevel: 'low',
  permission: 'sms.elections.read',
  approval: 'none',
  timeoutMs: TIMEOUT_MS,
  rateLimit: { max: 60, windowMs: 60_000 },
  schema: isRecord,
  inputJsonSchema: {
    type: 'object',
    properties: {
      studentId: { type: 'integer', minimum: 1 },
      termId: { type: 'integer', minimum: 1 },
      status: { type: 'string', enum: ['selected', 'dropped'] },
      limit: { type: 'integer', minimum: 1, maximum: 300 }
    },
    additionalProperties: false
  },
  authorize: actor => read(actor, 'elections'),
  execute: (input, actor) => listElections(actor, isRecord(input) ? input : {}),
  summarize: rows => listSummary('选课记录', rows),
  resultView: {
    kind: 'table',
    columns: [
      { key: 'studentId', label: '学生 ID', format: 'number' },
      { key: 'subjectId', label: '科目 ID', format: 'number' },
      { key: 'termId', label: '学期 ID', format: 'number' },
      { key: 'status', label: '状态' },
      { key: 'electedAt', label: '时间', format: 'datetime' }
    ]
  }
}

const electionsUpdate: Capability = {
  id: 'sms.elections.update',
  title: '选课/退选',
  description: '学生选择或退选一门课程（同一科目学期内幂等）',
  resource: 'elections',
  moduleId: 'sms',
  operation: 'command',
  riskLevel: 'low',
  permission: 'sms.elections.create',
  approval: 'confirm',
  timeoutMs: TIMEOUT_MS,
  rateLimit: { max: 30, windowMs: 60_000 },
  schema: isRecord,
  inputJsonSchema: {
    type: 'object',
    properties: {
      subjectId: { type: 'integer', minimum: 1 },
      termId: { type: 'integer', minimum: 1 },
      action: { type: 'string', enum: ['elect', 'drop'] }
    },
    required: ['subjectId', 'termId'],
    additionalProperties: false
  },
  authorize: actor => canUseSms(actor, 'create', 'elections'),
  preview: (input): PreviewResult => {
    const args = isRecord(input) ? input : {}
    return {
      summary: args.action === 'drop'
        ? `将退选科目 ${String(args.subjectId ?? '')}。`
        : `将选择科目 ${String(args.subjectId ?? '')}。`,
      details: { subjectId: args.subjectId, termId: args.termId, action: args.action ?? 'elect' },
      impact: 1
    }
  },
  execute: (input, actor) => setCourseElection(actor, isRecord(input) ? input : {}),
  summarize: (value) => {
    const row = isRecord(value) ? value : {}
    return `选课状态：${row.status ?? '-'}`
  }
}

export const smsCapabilities: Capability[] = [
  studentSearch,
  studentGet,
  classList,
  teacherList,
  enrollmentList,
  guardianList,
  studentCreate,
  studentUpdate,
  studentDelete,
  enrollmentCreate,
  enrollmentWithdraw,
  enrollmentTransfer,
  teacherAssign,
  guardianLink,
  attendanceRoster,
  attendanceRecords,
  attendanceSummary,
  attendanceMark,
  attendanceAlerts,
  attendanceAlertAck,
  leaveApply,
  leaveList,
  approvalsList,
  leaveApprove,
  leaveReject,
  leaveCancel,
  examsList,
  examsCreate,
  scoresSheet,
  scoresSave,
  scoresPublish,
  scoresQuery,
  reportCardGenerate,
  admissionCyclesList,
  admissionCyclesCreate,
  applicationsList,
  applicationsCreate,
  applicationsReview,
  applicationsConvert,
  timetableList,
  timetableCreate,
  timetablePublish,
  feesList,
  feesCreate,
  invoicesList,
  invoicesCreate,
  paymentsCreate,
  refundsRequest,
  refundsList,
  refundsApprove,
  assetsList,
  assetsCreate,
  assetsTransfer,
  booksList,
  booksCreate,
  loansBorrow,
  loansReturn,
  reportsAttendance,
  reportsScores,
  reportsFinance,
  reportsExport,
  notificationsList,
  notificationsSend,
  knowledgeSearch,
  knowledgeCreate,
  studentsImport,
  reportsDaily,
  agentTasksList,
  agentTasksCreate,
  agentTasksAdvance,
  assignmentsCreate,
  assignmentsList,
  assignmentsSubmit,
  assignmentsGrade,
  electionsList,
  electionsUpdate
]
