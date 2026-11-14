/**
 * Teaching domain (P2): assignments, submissions and course elections.
 *
 * Students act on their own records (resolved from the authenticated user), while
 * staff are limited to their assigned / homeroom classes unless they hold a
 * school-wide scope flag.
 */
import { and, desc, eq, inArray, isNull, notInArray, sql } from 'drizzle-orm'
import { createError } from 'h3'
import { db, writeAudit } from '../../../server/sdk'
import { files } from '../../../server/database/schema'
import {
  smsAssignments,
  smsAssignmentSubmissions,
  smsClasses,
  smsCourseElections,
  smsStudents,
  smsSubjects,
  smsTerms
} from './database/schema'
import { assertSubjectInContext, assertTermInContext } from './academics'
import { assertClassInContext, assignedClassIds, getStudent } from './students'
import { guardianStudentIds, resolveGuardianStudentId } from './guardians'
import { canUseSms, isSmsAdmin, requireSmsOrganization, type SmsActor } from './context'

export const ASSIGNMENT_STATUSES = ['draft', 'published', 'closed'] as const
export type AssignmentStatus = typeof ASSIGNMENT_STATUSES[number]

export function normalizeAssignmentStatus(value: unknown): AssignmentStatus {
  if (value === undefined || value === null || value === '') return 'draft'
  if (typeof value === 'string' && (ASSIGNMENT_STATUSES as readonly string[]).includes(value)) {
    return value as AssignmentStatus
  }
  throw createError({ statusCode: 400, message: `status must be one of ${ASSIGNMENT_STATUSES.join(', ')}` })
}

function positiveId(value: unknown, field: string): number {
  const id = Number(value)
  if (!Number.isSafeInteger(id) || id <= 0) {
    throw createError({ statusCode: 400, message: `${field} 必须是正整数` })
  }
  return id
}

function requireAssignmentRead(actor: SmsActor): number {
  const organizationId = requireSmsOrganization(actor)
  if (!canUseSms(actor, 'read', 'assignments')) {
    throw createError({ statusCode: 403, statusMessage: 'Forbidden', message: 'No permission to read assignments' })
  }
  return organizationId
}

function requireAssignmentWrite(actor: SmsActor): number {
  const organizationId = requireSmsOrganization(actor)
  if (!canUseSms(actor, 'update', 'assignments')) {
    throw createError({ statusCode: 403, statusMessage: 'Forbidden', message: 'No permission to edit assignments' })
  }
  return organizationId
}

function hasSchoolWide(actor: SmsActor): boolean {
  return isSmsAdmin(actor) || (actor.permissions ?? []).includes('sms.scores.all')
}

/** Student profile linked to the signed-in user. */
async function resolveStudent(actor: SmsActor) {
  const organizationId = requireSmsOrganization(actor)
  const [student] = await db.select({
    id: smsStudents.id,
    classId: smsStudents.classId,
    name: smsStudents.name
  }).from(smsStudents)
    .where(and(
      eq(smsStudents.organizationId, organizationId),
      eq(smsStudents.userId, actor.userId),
      isNull(smsStudents.deletedAt)
    ))
    .limit(1)
  if (!student) {
    throw createError({ statusCode: 403, statusMessage: 'Forbidden', message: 'No student profile is linked to this user' })
  }
  return student
}

async function teachingClassIds(actor: SmsActor): Promise<number[]> {
  const organizationId = requireSmsOrganization(actor)
  const [assigned, homeroom] = await Promise.all([
    assignedClassIds(actor),
    db.select({ id: smsClasses.id }).from(smsClasses).where(and(
      eq(smsClasses.organizationId, organizationId),
      eq(smsClasses.homeroomUserId, actor.userId),
      isNull(smsClasses.deletedAt)
    ))
  ])
  return [...new Set([...assigned, ...homeroom.map(row => row.id)])]
}

async function guardianClassIds(actor: SmsActor): Promise<number[]> {
  const organizationId = requireSmsOrganization(actor)
  const studentIds = await guardianStudentIds(actor)
  if (studentIds.length === 0) return []
  const rows = await db.select({ classId: smsStudents.classId }).from(smsStudents)
    .where(and(
      eq(smsStudents.organizationId, organizationId),
      inArray(smsStudents.id, studentIds),
      isNull(smsStudents.deletedAt)
    ))
  return [...new Set(rows.map(row => row.classId).filter((id): id is number => Number.isSafeInteger(id)))]
}

export interface CreateAssignmentInput {
  classId?: unknown
  subjectId?: unknown
  title?: unknown
  description?: unknown
  dueAt?: unknown
  status?: unknown
  /** 评分标准，例如 { criteria: [{ name: '完整性', weight: 0.4 }] }。 */
  rubric?: unknown
}

/** 只接受结构化评分标准，避免把任意大对象写入数据库。 */
function normalizeRubric(value: unknown): Record<string, unknown> | null {
  if (value === undefined || value === null) return null
  if (typeof value !== 'object' || Array.isArray(value)) {
    throw createError({ statusCode: 400, message: 'rubric 必须是对象' })
  }
  const criteria = (value as Record<string, unknown>).criteria
  if (!Array.isArray(criteria) || criteria.length === 0 || criteria.length > 20) {
    throw createError({ statusCode: 400, message: 'rubric.criteria 必须是 1-20 条的数组' })
  }
  return {
    criteria: criteria.map((item) => {
      if (typeof item !== 'object' || item === null || Array.isArray(item)) {
        throw createError({ statusCode: 400, message: 'rubric.criteria 每项必须是对象' })
      }
      const row = item as Record<string, unknown>
      const name = typeof row.name === 'string' ? row.name.trim().slice(0, 80) : ''
      const weight = Number(row.weight)
      if (!name) throw createError({ statusCode: 400, message: 'rubric 评分项名称不能为空' })
      if (!Number.isFinite(weight) || weight <= 0 || weight > 100) {
        throw createError({ statusCode: 400, message: 'rubric 权重必须在 0-100 之间' })
      }
      return { name, weight }
    })
  }
}

export async function createAssignment(actor: SmsActor, input: CreateAssignmentInput) {
  const organizationId = requireAssignmentWrite(actor)
  const classId = positiveId(input.classId, 'classId')
  const subjectId = positiveId(input.subjectId, 'subjectId')
  const title = typeof input.title === 'string' ? input.title.trim().slice(0, 200) : ''
  if (!title) throw createError({ statusCode: 400, message: 'title 不能为空' })
  await assertClassInContext(actor, classId)
  await assertSubjectInContext(actor, subjectId)
  // 组织内存在不等于“我教的班”：非全校范围角色必须是任课/班主任班级。
  if (!hasSchoolWide(actor)) {
    const classIds = await teachingClassIds(actor)
    if (!classIds.includes(classId)) {
      throw createError({ statusCode: 403, statusMessage: 'Forbidden', message: 'Assignment is outside your classes' })
    }
  }
  const rubric = normalizeRubric(input.rubric)

  const description = typeof input.description === 'string' ? input.description.trim().slice(0, 20_000) : null
  const status = normalizeAssignmentStatus(input.status)
  let dueAt: Date | null = null
  if (typeof input.dueAt === 'string' && input.dueAt.trim()) {
    const parsed = new Date(input.dueAt)
    if (Number.isNaN(parsed.getTime())) throw createError({ statusCode: 400, message: 'dueAt 不是合法时间' })
    dueAt = parsed
  }

  return await db.transaction(async (tx) => {
    const [row] = await tx.insert(smsAssignments).values({
      organizationId,
      tenantId: actor.tenantId ?? null,
      classId,
      subjectId,
      title,
      description,
      dueAt,
      status,
      rubric,
      createdBy: actor.userId
    }).returning()
    if (!row) throw createError({ statusCode: 500, message: 'Failed to create assignment' })
    await writeAudit(tx, {
      actorUserId: actor.userId,
      tenantId: actor.tenantId ?? undefined,
      organizationId,
      moduleId: 'sms',
      action: 'assignment.create',
      resource: 'assignments',
      recordId: row.id,
      after: { title, classId, subjectId, status, hasRubric: Boolean(rubric) },
      source: 'sms-service'
    })
    return row
  })
}

export interface ListAssignmentQuery {
  classId?: unknown
  status?: unknown
  /** 家长当前子女；必须属于 guardianStudentIds。 */
  studentId?: unknown
  limit?: unknown
}

export async function listAssignments(actor: SmsActor, options: ListAssignmentQuery = {}) {
  const organizationId = requireAssignmentRead(actor)
  const conditions = [eq(smsAssignments.organizationId, organizationId)]

  if (actor.roleName === 'student') {
    const student = await resolveStudent(actor)
    conditions.push(eq(smsAssignments.classId, student.classId ?? -1))
    conditions.push(eq(smsAssignments.status, 'published'))
  } else if (actor.roleName === 'guardian') {
    const requested = await resolveGuardianStudentId(actor, options.studentId)
    if (requested !== null) {
      // 指定当前子女时按该子女的班级过滤，避免把其他子女班级的作业混在一起。
      const [child] = await db.select({ classId: smsStudents.classId }).from(smsStudents)
        .where(and(
          eq(smsStudents.organizationId, organizationId),
          eq(smsStudents.id, requested),
          isNull(smsStudents.deletedAt)
        ))
        .limit(1)
      conditions.push(child?.classId ? eq(smsAssignments.classId, child.classId) : eq(smsAssignments.id, -1))
    } else {
      const classIds = await guardianClassIds(actor)
      if (classIds.length === 0) return []
      conditions.push(inArray(smsAssignments.classId, classIds))
    }
    conditions.push(eq(smsAssignments.status, 'published'))
  } else if (!hasSchoolWide(actor)) {
    const classIds = await teachingClassIds(actor)
    if (classIds.length === 0) return []
    conditions.push(inArray(smsAssignments.classId, classIds))
  }

  if (options.classId !== undefined && options.classId !== null && options.classId !== '') {
    conditions.push(eq(smsAssignments.classId, positiveId(options.classId, 'classId')))
  }
  if (options.status !== undefined && options.status !== null && options.status !== '') {
    conditions.push(eq(smsAssignments.status, normalizeAssignmentStatus(options.status)))
  }
  const limit = Math.min(Math.max(Math.floor(Number(options.limit ?? 50) || 50), 1), 200)
  return await db.select({
    id: smsAssignments.id,
    classId: smsAssignments.classId,
    subjectId: smsAssignments.subjectId,
    title: smsAssignments.title,
    description: smsAssignments.description,
    dueAt: smsAssignments.dueAt,
    status: smsAssignments.status,
    createdAt: smsAssignments.createdAt
  }).from(smsAssignments)
    .where(and(...conditions))
    .orderBy(desc(smsAssignments.createdAt))
    .limit(limit)
}

export interface SubmitAssignmentInput {
  assignmentId?: unknown
  content?: unknown
  /** 附件地址：站内路径或 http(s) URL；不接收任意协议。 */
  attachmentUrl?: unknown
  /** 平台文件 ID（优先于 attachmentUrl）；必须是本组织未删除文件。 */
  attachmentFileId?: unknown
}

/**
 * 校验附件文件归属：只允许引用当前组织、未删除的文件，
 * 防止通过猜测 file id 读取其他租户的资源。
 */
async function resolveAttachmentFileId(value: unknown, organizationId: number): Promise<number | null> {
  if (value === undefined || value === null || value === '') return null
  const fileId = positiveId(value, 'attachmentFileId')
  const [file] = await db.select({ id: files.id }).from(files)
    .where(and(
      eq(files.id, fileId),
      eq(files.organizationId, organizationId),
      isNull(files.deletedAt)
    ))
    .limit(1)
  if (!file) {
    throw createError({ statusCode: 400, message: 'attachmentFileId 不属于当前组织或已删除' })
  }
  return file.id
}

function normalizeAttachmentUrl(value: unknown): string | null {
  if (value === undefined || value === null || value === '') return null
  if (typeof value !== 'string') throw createError({ statusCode: 400, message: 'attachmentUrl 必须是字符串' })
  const url = value.trim().slice(0, 500)
  if (!url) return null
  const isInternal = url.startsWith('/') && !url.startsWith('//')
  const isHttp = /^https?:\/\//i.test(url)
  if (!isInternal && !isHttp) {
    throw createError({ statusCode: 400, message: 'attachmentUrl 只允许站内路径或 http(s) 地址' })
  }
  return url
}

export async function submitAssignment(actor: SmsActor, input: SubmitAssignmentInput) {
  const organizationId = requireSmsOrganization(actor)
  if (!canUseSms(actor, 'create', 'assignments')) {
    throw createError({ statusCode: 403, statusMessage: 'Forbidden', message: 'No permission to submit assignments' })
  }
  const assignmentId = positiveId(input.assignmentId, 'assignmentId')
  const student = await resolveStudent(actor)
  const [assignment] = await db.select({
    id: smsAssignments.id,
    classId: smsAssignments.classId,
    status: smsAssignments.status,
    title: smsAssignments.title
  }).from(smsAssignments)
    .where(and(
      eq(smsAssignments.id, assignmentId),
      eq(smsAssignments.organizationId, organizationId)
    ))
    .limit(1)
  if (!assignment) throw createError({ statusCode: 404, message: 'Assignment not found' })
  if (assignment.status !== 'published') {
    throw createError({ statusCode: 409, message: 'Assignment is not open for submission' })
  }
  if (assignment.classId !== student.classId) {
    throw createError({ statusCode: 403, statusMessage: 'Forbidden', message: 'Assignment is not for your class' })
  }
  const content = typeof input.content === 'string' ? input.content.trim().slice(0, 50_000) : null
  const attachmentUrl = normalizeAttachmentUrl(input.attachmentUrl)
  const attachmentFileId = await resolveAttachmentFileId(input.attachmentFileId, organizationId)

  return await db.transaction(async (tx) => {
    const [row] = await tx.insert(smsAssignmentSubmissions).values({
      organizationId,
      tenantId: actor.tenantId ?? null,
      assignmentId,
      studentId: student.id,
      content,
      attachmentUrl,
      attachmentFileId,
      status: 'submitted',
      submittedAt: new Date()
    }).onConflictDoUpdate({
      target: [
        smsAssignmentSubmissions.organizationId,
        smsAssignmentSubmissions.assignmentId,
        smsAssignmentSubmissions.studentId
      ],
      set: { content, attachmentUrl, attachmentFileId, status: 'submitted', submittedAt: new Date() }
    }).returning()
    await writeAudit(tx, {
      actorUserId: actor.userId,
      tenantId: actor.tenantId ?? undefined,
      organizationId,
      moduleId: 'sms',
      action: 'assignment.submit',
      resource: 'assignments',
      recordId: assignmentId,
      after: { studentId: student.id, submissionId: row?.id },
      source: 'sms-service'
    })
    return row ?? null
  })
}

export interface GradeSubmissionInput {
  submissionId?: unknown
  score?: unknown
  feedback?: unknown
}

export async function gradeSubmission(actor: SmsActor, input: GradeSubmissionInput) {
  const organizationId = requireAssignmentWrite(actor)
  const submissionId = positiveId(input.submissionId, 'submissionId')
  const score = Number(input.score)
  if (!Number.isFinite(score) || score < 0 || score > 1000) {
    throw createError({ statusCode: 400, message: 'score 必须在 0 到 1000 之间' })
  }
  const [row] = await db.select({
    submissionId: smsAssignmentSubmissions.id,
    assignmentId: smsAssignmentSubmissions.assignmentId,
    classId: smsAssignments.classId
  }).from(smsAssignmentSubmissions)
    .innerJoin(smsAssignments, eq(smsAssignments.id, smsAssignmentSubmissions.assignmentId))
    .where(and(
      eq(smsAssignmentSubmissions.id, submissionId),
      eq(smsAssignmentSubmissions.organizationId, organizationId)
    ))
    .limit(1)
  if (!row) throw createError({ statusCode: 404, message: 'Submission not found' })
  if (!hasSchoolWide(actor)) {
    const classIds = await teachingClassIds(actor)
    if (!classIds.includes(row.classId)) {
      throw createError({ statusCode: 403, statusMessage: 'Forbidden', message: 'Submission is outside your classes' })
    }
  }
  const feedback = typeof input.feedback === 'string' ? input.feedback.trim().slice(0, 500) : null

  return await db.transaction(async (tx) => {
    const [updated] = await tx.update(smsAssignmentSubmissions)
      .set({
        status: 'graded',
        score: score.toFixed(2),
        feedback,
        gradedBy: actor.userId,
        gradedAt: new Date()
      })
      .where(eq(smsAssignmentSubmissions.id, submissionId))
      .returning()
    await writeAudit(tx, {
      actorUserId: actor.userId,
      tenantId: actor.tenantId ?? undefined,
      organizationId,
      moduleId: 'sms',
      action: 'assignment.grade',
      resource: 'assignments',
      recordId: submissionId,
      after: { score: score.toFixed(2), feedback },
      source: 'sms-service'
    })
    return updated ?? null
  })
}

export interface ElectionQuery {
  studentId?: unknown
  termId?: unknown
  status?: unknown
  limit?: unknown
}

export async function listElections(actor: SmsActor, options: ElectionQuery = {}) {
  const organizationId = requireSmsOrganization(actor)
  if (!canUseSms(actor, 'read', 'elections')) {
    throw createError({ statusCode: 403, statusMessage: 'Forbidden', message: 'No permission to read course elections' })
  }
  const conditions = [eq(smsCourseElections.organizationId, organizationId)]

  if (actor.roleName === 'student') {
    const student = await resolveStudent(actor)
    conditions.push(eq(smsCourseElections.studentId, student.id))
  } else if (actor.roleName === 'guardian') {
    const requested = await resolveGuardianStudentId(actor, options.studentId)
    if (requested !== null) {
      conditions.push(eq(smsCourseElections.studentId, requested))
    } else {
      const studentIds = await guardianStudentIds(actor)
      if (studentIds.length === 0) return []
      conditions.push(inArray(smsCourseElections.studentId, studentIds))
    }
  } else {
    if (options.studentId !== undefined && options.studentId !== null && options.studentId !== '') {
      conditions.push(eq(smsCourseElections.studentId, positiveId(options.studentId, 'studentId')))
    } else if (!hasSchoolWide(actor)) {
      const classIds = await teachingClassIds(actor)
      if (classIds.length === 0) return []
      const students = await db.select({ id: smsStudents.id }).from(smsStudents).where(and(
        eq(smsStudents.organizationId, organizationId),
        inArray(smsStudents.classId, classIds),
        isNull(smsStudents.deletedAt)
      ))
      if (students.length === 0) return []
      conditions.push(inArray(smsCourseElections.studentId, students.map(student => student.id)))
    }
  }
  if (options.termId !== undefined && options.termId !== null && options.termId !== '') {
    conditions.push(eq(smsCourseElections.termId, positiveId(options.termId, 'termId')))
  }
  if (options.status === 'selected' || options.status === 'dropped') {
    conditions.push(eq(smsCourseElections.status, options.status))
  }
  const limit = Math.min(Math.max(Math.floor(Number(options.limit ?? 100) || 100), 1), 300)
  return await db.select({
    id: smsCourseElections.id,
    studentId: smsCourseElections.studentId,
    studentName: smsStudents.name,
    studentNo: smsStudents.studentNo,
    subjectId: smsCourseElections.subjectId,
    subjectName: smsSubjects.name,
    subjectCapacity: smsSubjects.capacity,
    termId: smsCourseElections.termId,
    termName: smsTerms.name,
    status: smsCourseElections.status,
    electedAt: smsCourseElections.electedAt
  }).from(smsCourseElections)
    .innerJoin(smsStudents, eq(smsStudents.id, smsCourseElections.studentId))
    .innerJoin(smsSubjects, eq(smsSubjects.id, smsCourseElections.subjectId))
    .innerJoin(smsTerms, eq(smsTerms.id, smsCourseElections.termId))
    .where(and(...conditions))
    .orderBy(desc(smsCourseElections.electedAt))
    .limit(limit)
}

export interface SetElectionInput {
  subjectId?: unknown
  termId?: unknown
  action?: unknown
}

export async function setCourseElection(actor: SmsActor, input: SetElectionInput) {
  const organizationId = requireSmsOrganization(actor)
  if (!canUseSms(actor, 'create', 'elections')) {
    throw createError({ statusCode: 403, statusMessage: 'Forbidden', message: 'No permission to change course elections' })
  }
  const subjectId = positiveId(input.subjectId, 'subjectId')
  const termId = positiveId(input.termId, 'termId')
  const action = input.action === 'drop' ? 'drop' : 'elect'
  await assertSubjectInContext(actor, subjectId)
  await assertTermInContext(actor, termId)
  const student = await resolveStudent(actor)

  // 选课容量：仅对“新选”生效，已在课或退课不受影响。
  if (action === 'elect') {
    const [subject] = await db.select({ capacity: smsSubjects.capacity }).from(smsSubjects)
      .where(and(eq(smsSubjects.id, subjectId), eq(smsSubjects.organizationId, organizationId)))
      .limit(1)
    if (!subject) throw createError({ statusCode: 404, message: 'Subject not found' })
    if (subject.capacity !== null) {
      const [current] = await db.select({ status: smsCourseElections.status }).from(smsCourseElections)
        .where(and(
          eq(smsCourseElections.organizationId, organizationId),
          eq(smsCourseElections.studentId, student.id),
          eq(smsCourseElections.subjectId, subjectId),
          eq(smsCourseElections.termId, termId)
        ))
        .limit(1)
      if (current?.status !== 'selected') {
        const [counted] = await db.select({ value: sql<number>`count(*)::int` }).from(smsCourseElections)
          .where(and(
            eq(smsCourseElections.organizationId, organizationId),
            eq(smsCourseElections.subjectId, subjectId),
            eq(smsCourseElections.termId, termId),
            eq(smsCourseElections.status, 'selected')
          ))
        if (Number(counted?.value ?? 0) >= subject.capacity) {
          throw createError({ statusCode: 409, message: '课程容量已满' })
        }
      }
    }
  }

  return await db.transaction(async (tx) => {
    const [row] = await tx.insert(smsCourseElections).values({
      organizationId,
      tenantId: actor.tenantId ?? null,
      studentId: student.id,
      subjectId,
      termId,
      status: action === 'drop' ? 'dropped' : 'selected'
    }).onConflictDoUpdate({
      target: [
        smsCourseElections.organizationId,
        smsCourseElections.studentId,
        smsCourseElections.subjectId,
        smsCourseElections.termId
      ],
      set: { status: action === 'drop' ? 'dropped' : 'selected', updatedAt: new Date() }
    }).returning()
    await writeAudit(tx, {
      actorUserId: actor.userId,
      tenantId: actor.tenantId ?? undefined,
      organizationId,
      moduleId: 'sms',
      action: action === 'drop' ? 'election.drop' : 'election.elect',
      resource: 'elections',
      recordId: row?.id ?? 0,
      after: { studentId: student.id, subjectId, termId, status: row?.status },
      source: 'sms-service'
    })
    return row ?? null
  })
}

export interface SetElectionsBatchInput {
  /** 教师/管理员代选时传；学生本人省略。 */
  studentId?: unknown
  termId?: unknown
  subjectIds?: unknown
}

/** 代选或本人选科：以本次提交的科目集合为准，未提交的已选科目自动退课。 */
export async function setStudentElections(actor: SmsActor, input: SetElectionsBatchInput) {
  const organizationId = requireSmsOrganization(actor)
  if (!canUseSms(actor, 'create', 'elections')) {
    throw createError({ statusCode: 403, statusMessage: 'Forbidden', message: 'No permission to change course elections' })
  }
  const termId = positiveId(input.termId, 'termId')
  await assertTermInContext(actor, termId)
  if (!Array.isArray(input.subjectIds)) {
    throw createError({ statusCode: 400, message: 'subjectIds 必须是数组' })
  }
  const subjectIds = [...new Set(input.subjectIds.map(Number))]
  if (subjectIds.length > 20) {
    throw createError({ statusCode: 400, message: '单次最多选择 20 门科目' })
  }
  if (subjectIds.some(id => !Number.isSafeInteger(id) || id <= 0)) {
    throw createError({ statusCode: 400, message: 'subjectIds 必须是正整数' })
  }
  for (const subjectId of subjectIds) await assertSubjectInContext(actor, subjectId)

  const student = await (async () => {
    if (input.studentId === undefined || input.studentId === null || input.studentId === '') {
      return await resolveStudent(actor)
    }
    if (actor.roleName === 'guardian') {
      throw createError({ statusCode: 403, message: '家长不能代选科目' })
    }
    const row = await getStudent(actor, positiveId(input.studentId, 'studentId'))
    return { id: row.id, classId: row.classId, name: row.name }
  })()

  const current = await db.select({
    subjectId: smsCourseElections.subjectId,
    status: smsCourseElections.status
  }).from(smsCourseElections).where(and(
    eq(smsCourseElections.organizationId, organizationId),
    eq(smsCourseElections.studentId, student.id),
    eq(smsCourseElections.termId, termId)
  ))
  const selected = new Set(current.filter(row => row.status === 'selected').map(row => row.subjectId))
  const newSubjectIds = subjectIds.filter(id => !selected.has(id))

  if (newSubjectIds.length > 0) {
    const subjects = await db.select({ id: smsSubjects.id, capacity: smsSubjects.capacity })
      .from(smsSubjects)
      .where(and(
        eq(smsSubjects.organizationId, organizationId),
        inArray(smsSubjects.id, newSubjectIds),
        isNull(smsSubjects.deletedAt)
      ))
    if (subjects.length !== newSubjectIds.length) {
      throw createError({ statusCode: 404, message: '包含不存在或已删除的科目' })
    }
    const counted = await db.select({
      subjectId: smsCourseElections.subjectId,
      value: sql<number>`count(*)::int`
    }).from(smsCourseElections)
      .where(and(
        eq(smsCourseElections.organizationId, organizationId),
        eq(smsCourseElections.termId, termId),
        eq(smsCourseElections.status, 'selected'),
        inArray(smsCourseElections.subjectId, newSubjectIds)
      ))
      .groupBy(smsCourseElections.subjectId)
    const counts = new Map(counted.map(row => [row.subjectId, Number(row.value)]))
    for (const subject of subjects) {
      if (subject.capacity !== null && (counts.get(subject.id) ?? 0) >= subject.capacity) {
        throw createError({ statusCode: 409, message: `科目 #${subject.id} 容量已满` })
      }
    }
  }

  const result = await db.transaction(async (tx) => {
    for (const subjectId of subjectIds) {
      await tx.insert(smsCourseElections).values({
        organizationId,
        tenantId: actor.tenantId ?? null,
        studentId: student.id,
        subjectId,
        termId,
        status: 'selected'
      }).onConflictDoUpdate({
        target: [
          smsCourseElections.organizationId,
          smsCourseElections.studentId,
          smsCourseElections.subjectId,
          smsCourseElections.termId
        ],
        set: { status: 'selected', updatedAt: new Date() }
      })
    }
    const dropConditions = [
      eq(smsCourseElections.organizationId, organizationId),
      eq(smsCourseElections.studentId, student.id),
      eq(smsCourseElections.termId, termId),
      eq(smsCourseElections.status, 'selected')
    ]
    if (subjectIds.length > 0) dropConditions.push(notInArray(smsCourseElections.subjectId, subjectIds))
    const dropped = await tx.update(smsCourseElections)
      .set({ status: 'dropped', updatedAt: new Date() })
      .where(and(...dropConditions))
      .returning({ id: smsCourseElections.id })
    await writeAudit(tx, {
      actorUserId: actor.userId,
      tenantId: actor.tenantId ?? undefined,
      organizationId,
      moduleId: 'sms',
      action: 'election.batch',
      resource: 'elections',
      recordId: student.id,
      after: { studentId: student.id, termId, subjectIds, dropped: dropped.length },
      source: 'sms-service'
    })
    return { selected: subjectIds.length, dropped: dropped.length }
  })

  return { studentId: student.id, termId, ...result }
}
