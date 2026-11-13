/**
 * SMS capabilities — the single capability set shared by Chat, Apps and Agents.
 *
 * Read capabilities execute directly; write capabilities expose a server-side
 * form + preview and are only executed after the user confirms the draft
 * (Phase 2/3 of the chat plan).
 */
import { createError } from 'h3'
import type { CapabilityDefinition, PreviewResult } from '../../../server/sdk'
import { canUseSms, type SmsActor } from './context'
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
    ]
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
    ]
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
  guardianLink
]
