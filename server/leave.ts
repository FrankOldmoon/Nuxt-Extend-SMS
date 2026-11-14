/**
 * Leave requests and the business approval queue (Slice A, `sms-affairs`).
 *
 * Data scope mirrors attendance:
 * - `sms.leave.all` (or admin) sees the whole organization;
 * - homeroom / subject teachers see their own classes;
 * - students and guardians see applications for themselves / linked children.
 *
 * Approving a student leave is the only path that turns attendance rows into
 * `leave`; cancelling an approved leave rolls those rows back to `absent`.
 * Nothing is deleted.
 */
import { and, asc, desc, eq, inArray, isNull, or } from 'drizzle-orm'
import { createError } from 'h3'
import { db, writeAudit } from '../../../server/sdk'
import {
  smsApprovalTasks,
  smsAttendanceRecords,
  smsClasses,
  smsLeaveRequests,
  smsStudents,
  smsTeacherAssignments
} from './database/schema'
import { canUseSms, isSmsAdmin, requireSmsOrganization, type SmsActor } from './context'
import { getStudent } from './students'
import { guardianStudentIds } from './guardians'
import { notifyLeaveDecided, notifyLeaveSubmitted } from './notifications'
import {
  cancelPendingApprovalTasks,
  completeApprovalTask,
  insertApprovalSteps,
  loadNextPendingApprovalTask,
  loadPendingApprovalTask
} from './approvals'

export const LEAVE_SUBJECT_TYPES = ['student', 'staff'] as const
export type LeaveSubjectType = typeof LEAVE_SUBJECT_TYPES[number]

export const LEAVE_TYPES = ['sick', 'personal', 'other'] as const
export type LeaveType = typeof LEAVE_TYPES[number]

export const LEAVE_STATUSES = ['pending', 'approved', 'rejected', 'cancelled'] as const
export type LeaveStatus = typeof LEAVE_STATUSES[number]

export const APPROVAL_STATUSES = ['pending', 'approved', 'rejected', 'cancelled'] as const

/** D4: three or more days escalates from homeroom to the grade leader. */
export const LEAVE_ESCALATION_DAYS = 3
export const MAX_LEAVE_DAYS = 60

const DAY_MS = 24 * 60 * 60 * 1000

// ---------------------------------------------------------------------------
// Normalisation (pure, unit-tested)
// ---------------------------------------------------------------------------

export function normalizeLeaveSubjectType(value: unknown): LeaveSubjectType {
  if (value === undefined || value === null || value === '') return 'student'
  if (typeof value === 'string' && (LEAVE_SUBJECT_TYPES as readonly string[]).includes(value)) {
    return value as LeaveSubjectType
  }
  throw createError({ statusCode: 400, message: `subjectType must be one of ${LEAVE_SUBJECT_TYPES.join(', ')}` })
}

export function normalizeLeaveType(value: unknown): LeaveType {
  if (typeof value === 'string' && (LEAVE_TYPES as readonly string[]).includes(value)) {
    return value as LeaveType
  }
  throw createError({ statusCode: 400, message: `type must be one of ${LEAVE_TYPES.join(', ')}` })
}

export function normalizeLeaveStatus(value: unknown): LeaveStatus {
  if (typeof value === 'string' && (LEAVE_STATUSES as readonly string[]).includes(value)) {
    return value as LeaveStatus
  }
  throw createError({ statusCode: 400, message: `status must be one of ${LEAVE_STATUSES.join(', ')}` })
}

export interface LeaveWindow {
  startAt: Date
  endAt: Date
  startDate: string
  endDate: string
  days: number
}

function parseMoment(value: unknown, field: string, endOfDay = false): Date {
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value
  if (typeof value === 'string' && value.trim()) {
    const text = value.trim()
    if (/^\d{4}-\d{2}-\d{2}$/.test(text)) {
      const parsed = new Date(`${text}T${endOfDay ? '23:59:59.999' : '00:00:00.000'}Z`)
      if (!Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === text) return parsed
      throw createError({ statusCode: 400, message: `${field} is not a valid calendar day` })
    }
    const parsed = new Date(text)
    if (!Number.isNaN(parsed.getTime())) return parsed
  }
  throw createError({ statusCode: 400, message: `${field} must be an ISO date` })
}

/** Validates the leave window and derives the inclusive calendar-day range. */
export function normalizeLeaveWindow(startAt: unknown, endAt: unknown): LeaveWindow {
  const start = parseMoment(startAt, 'startAt')
  const end = parseMoment(endAt, 'endAt', true)
  if (end.getTime() < start.getTime()) {
    throw createError({ statusCode: 400, message: 'endAt must not be before startAt' })
  }
  const startDate = start.toISOString().slice(0, 10)
  const endDate = end.toISOString().slice(0, 10)
  const days = Math.floor(
    (Date.parse(`${endDate}T00:00:00Z`) - Date.parse(`${startDate}T00:00:00Z`)) / DAY_MS
  ) + 1
  if (days < 1) throw createError({ statusCode: 400, message: 'leave must cover at least one day' })
  if (days > MAX_LEAVE_DAYS) {
    throw createError({ statusCode: 400, message: `leave must not exceed ${MAX_LEAVE_DAYS} days` })
  }
  return { startAt: start, endAt: end, startDate, endDate, days }
}

/** Inclusive calendar days covered by a leave window. */
export function leaveDateRange(window: Pick<LeaveWindow, 'startDate' | 'endDate'>): string[] {
  const dates: string[] = []
  const start = Date.parse(`${window.startDate}T00:00:00Z`)
  const end = Date.parse(`${window.endDate}T00:00:00Z`)
  for (let time = start; time <= end; time += DAY_MS) {
    dates.push(new Date(time).toISOString().slice(0, 10))
  }
  return dates
}

export interface LeaveRouteStep {
  step: number
  assigneeRole: 'homeroom' | 'grade_leader' | 'school_admin'
  assigneeUserId: number | null
}

/**
 * Approval routing. v1 is single-level (homeroom); from three days on a second
 * step is added, unassigned, so a school-wide approver picks it up.
 */
export function resolveLeaveRoute(input: { days: number, homeroomUserId?: number | null }): LeaveRouteStep[] {
  const homeroomUserId = input.homeroomUserId ?? null
  const steps: LeaveRouteStep[] = [
    homeroomUserId
      ? { step: 1, assigneeRole: 'homeroom', assigneeUserId: homeroomUserId }
      : { step: 1, assigneeRole: 'school_admin', assigneeUserId: null }
  ]
  if (input.days >= LEAVE_ESCALATION_DAYS) {
    steps.push({ step: steps.length + 1, assigneeRole: 'grade_leader', assigneeUserId: null })
  }
  return steps
}

// ---------------------------------------------------------------------------
// Permissions & scope
// ---------------------------------------------------------------------------

function positiveId(value: unknown, field: string): number {
  const id = Number(value)
  if (!Number.isSafeInteger(id) || id <= 0) {
    throw createError({ statusCode: 400, message: `${field} must be a positive integer` })
  }
  return id
}

function optionalId(value: unknown): number | null {
  if (value === undefined || value === null || value === '') return null
  const id = Number(value)
  return Number.isSafeInteger(id) && id > 0 ? id : null
}

function requireLeaveRead(actor: SmsActor): number {
  const organizationId = requireSmsOrganization(actor)
  if (!canUseSms(actor, 'read', 'leave')) {
    throw createError({ statusCode: 403, statusMessage: 'Forbidden', message: 'No permission to read leave' })
  }
  return organizationId
}

function requireLeaveApply(actor: SmsActor): number {
  const organizationId = requireSmsOrganization(actor)
  if (!canUseSms(actor, 'create', 'leave')) {
    throw createError({ statusCode: 403, statusMessage: 'Forbidden', message: 'No permission to apply for leave' })
  }
  return organizationId
}

/** Whole-organization leave visibility (admin or the explicit `sms.leave.all`). */
export function hasSchoolWideLeave(actor: SmsActor): boolean {
  if (isSmsAdmin(actor)) return true
  return (actor.permissions ?? []).includes('sms.leave.all')
}

/** Deciding is gated by `sms.leave.approve` (or a coarse SMS write grant). */
export function canApproveLeave(actor: SmsActor): boolean {
  if (isSmsAdmin(actor)) return true
  const permissions = actor.permissions ?? []
  return permissions.includes('sms.leave.approve')
    || permissions.includes('sms.leave')
    || permissions.includes('sms:update')
    || permissions.includes('sms:create')
}

/** `null` means whole organization; otherwise the classes the actor owns. */
export async function scopedLeaveClassIds(actor: SmsActor): Promise<number[] | null> {
  if (hasSchoolWideLeave(actor)) return null
  const organizationId = requireSmsOrganization(actor)
  const rows = await db.selectDistinct({ classId: smsClasses.id })
    .from(smsClasses)
    .leftJoin(smsTeacherAssignments, and(
      eq(smsTeacherAssignments.classId, smsClasses.id),
      eq(smsTeacherAssignments.organizationId, organizationId),
      eq(smsTeacherAssignments.teacherUserId, actor.userId)
    ))
    .where(and(
      eq(smsClasses.organizationId, organizationId),
      isNull(smsClasses.deletedAt),
      or(
        eq(smsClasses.homeroomUserId, actor.userId),
        eq(smsTeacherAssignments.teacherUserId, actor.userId)
      )
    ))
  return rows.map(row => row.classId)
}

async function homeroomUserIdForClass(organizationId: number, classId: number | null): Promise<number | null> {
  if (!classId) return null
  const [row] = await db.select({ homeroomUserId: smsClasses.homeroomUserId })
    .from(smsClasses)
    .where(and(eq(smsClasses.id, classId), eq(smsClasses.organizationId, organizationId)))
    .limit(1)
  return row?.homeroomUserId ?? null
}

// ---------------------------------------------------------------------------
// Apply / cancel
// ---------------------------------------------------------------------------

export interface ApplyLeaveInput {
  subjectType?: unknown
  studentId?: unknown
  staffUserId?: unknown
  type?: unknown
  startAt?: unknown
  endAt?: unknown
  reason?: unknown
  attachmentFileId?: unknown
}

export async function applyLeave(actor: SmsActor, input: ApplyLeaveInput) {
  const organizationId = requireLeaveApply(actor)
  const subjectType = normalizeLeaveSubjectType(input.subjectType)
  const type = normalizeLeaveType(input.type)
  const window = normalizeLeaveWindow(input.startAt, input.endAt)
  const reason = typeof input.reason === 'string' && input.reason.trim()
    ? input.reason.trim().slice(0, 500)
    : null
  const attachmentFileId = optionalId(input.attachmentFileId)

  let studentId: number | null = null
  let staffUserId: number | null = null
  let homeroomUserId: number | null = null

  if (subjectType === 'student') {
    studentId = positiveId(input.studentId, 'studentId')
    // Reuses the student data scope: self, linked child, or own class.
    const student = await getStudent(actor, studentId)
    homeroomUserId = await homeroomUserIdForClass(organizationId, student.classId)
  } else {
    const requestedStaff = optionalId(input.staffUserId)
    if (requestedStaff && requestedStaff !== actor.userId && !hasSchoolWideLeave(actor)) {
      throw createError({ statusCode: 403, statusMessage: 'Forbidden', message: 'Staff can only apply for themselves' })
    }
    staffUserId = requestedStaff ?? actor.userId
  }

  const route = resolveLeaveRoute({ days: window.days, homeroomUserId })

  return await db.transaction(async (tx) => {
    const [request] = await tx.insert(smsLeaveRequests).values({
      organizationId,
      tenantId: actor.tenantId ?? null,
      subjectType,
      studentId,
      staffUserId,
      applicantUserId: actor.userId,
      type,
      startAt: window.startAt,
      endAt: window.endAt,
      reason,
      attachmentFileId,
      status: 'pending'
    }).returning()
    if (!request) throw createError({ statusCode: 500, message: 'Failed to create leave request' })

    const tasks = await insertApprovalSteps(tx, {
      organizationId,
      tenantId: actor.tenantId ?? null,
      subjectType: 'leave',
      subjectId: request.id,
      steps: route
    })

    await notifyLeaveSubmitted(tx, {
      organizationId,
      tenantId: actor.tenantId ?? null,
      leaveId: request.id,
      applicantUserId: actor.userId,
      assigneeUserId: tasks.find(task => task.step === 1)?.assigneeUserId ?? null,
      days: window.days
    })

    await writeAudit(tx, {
      actorUserId: actor.userId,
      tenantId: actor.tenantId ?? undefined,
      organizationId,
      moduleId: 'sms',
      action: 'leave.apply',
      resource: 'leave',
      recordId: request.id,
      after: { ...request, route: route.map(step => step.assigneeRole) },
      source: 'sms-service'
    })

    return {
      id: request.id,
      status: request.status,
      subjectType,
      studentId,
      type,
      startAt: request.startAt,
      endAt: request.endAt,
      days: window.days,
      approved: false,
      escalated: route.length > 1,
      steps: tasks.map(task => ({
        step: task.step,
        assigneeRole: task.assigneeRole,
        assigneeUserId: task.assigneeUserId,
        status: task.status
      }))
    }
  })
}

export async function cancelLeave(actor: SmsActor, leaveId: number) {
  const organizationId = requireLeaveRead(actor)
  const [request] = await db.select().from(smsLeaveRequests)
    .where(and(eq(smsLeaveRequests.id, leaveId), eq(smsLeaveRequests.organizationId, organizationId)))
    .limit(1)
  if (!request) throw createError({ statusCode: 404, message: 'Leave request not found' })
  if (request.applicantUserId !== actor.userId && !hasSchoolWideLeave(actor)) {
    throw createError({ statusCode: 403, statusMessage: 'Forbidden', message: 'Only the applicant can cancel this leave' })
  }
  if (request.status !== 'pending' && request.status !== 'approved') {
    throw createError({ statusCode: 409, message: `Leave in status ${request.status} cannot be cancelled` })
  }
  const wasApproved = request.status === 'approved'

  return await db.transaction(async (tx) => {
    const [updated] = await tx.update(smsLeaveRequests)
      .set({ status: 'cancelled', updatedAt: new Date() })
      .where(eq(smsLeaveRequests.id, leaveId))
      .returning()
    if (!updated) throw createError({ statusCode: 500, message: 'Failed to cancel leave' })

    await cancelPendingApprovalTasks(
      tx,
      { organizationId, subjectType: 'leave', subjectId: leaveId },
      actor.userId
    )

    let reverted = 0
    if (wasApproved && request.subjectType === 'student' && request.studentId) {
      const rows = await tx.update(smsAttendanceRecords)
        .set({ status: 'absent', leaveRequestId: null, recordedBy: actor.userId, updatedAt: new Date() })
        .where(and(
          eq(smsAttendanceRecords.organizationId, organizationId),
          eq(smsAttendanceRecords.studentId, request.studentId),
          eq(smsAttendanceRecords.leaveRequestId, leaveId)
        ))
        .returning({ id: smsAttendanceRecords.id })
      reverted = rows.length
    }

    await writeAudit(tx, {
      actorUserId: actor.userId,
      tenantId: actor.tenantId ?? undefined,
      organizationId,
      moduleId: 'sms',
      action: 'leave.cancel',
      resource: 'leave',
      recordId: leaveId,
      before: { status: request.status },
      after: { status: 'cancelled', revertedAttendance: reverted },
      source: 'sms-service'
    })

    return { id: leaveId, status: 'cancelled', revertedAttendance: reverted }
  })
}

// ---------------------------------------------------------------------------
// Decide
// ---------------------------------------------------------------------------

export type LeaveDecision = 'approve' | 'reject'

export interface DecideLeaveInput {
  leaveId?: unknown
  decision?: unknown
  comment?: unknown
}

function normalizeDecision(value: unknown): LeaveDecision {
  if (value === 'approve' || value === 'reject') return value
  throw createError({ statusCode: 400, message: 'decision must be approve or reject' })
}

interface PendingTask {
  id: number
  step: number
  assigneeUserId: number | null
  assigneeRole: string | null
}

async function assertCanDecide(
  actor: SmsActor,
  task: PendingTask,
  studentClassId: number | null
): Promise<void> {
  if (hasSchoolWideLeave(actor)) return
  if (!canApproveLeave(actor)) {
    throw createError({ statusCode: 403, statusMessage: 'Forbidden', message: 'No permission to decide leave' })
  }
  if (task.assigneeUserId !== null) {
    if (task.assigneeUserId !== actor.userId) {
      throw createError({ statusCode: 403, statusMessage: 'Forbidden', message: 'This leave is assigned to another approver' })
    }
    return
  }
  // Unassigned steps (grade leader / school admin) are open to approvers, but a
  // homeroom-only teacher still only decides their own classes.
  if (task.assigneeRole === 'homeroom') {
    const classIds = await scopedLeaveClassIds(actor)
    if (!classIds || !studentClassId || !classIds.includes(studentClassId)) {
      throw createError({ statusCode: 403, statusMessage: 'Forbidden', message: 'No access to this class' })
    }
  }
}

export async function decideLeave(actor: SmsActor, input: DecideLeaveInput) {
  const organizationId = requireLeaveRead(actor)
  const leaveId = positiveId(input.leaveId, 'leaveId')
  const decision = normalizeDecision(input.decision)
  const comment = typeof input.comment === 'string' && input.comment.trim()
    ? input.comment.trim().slice(0, 500)
    : null

  const [request] = await db.select().from(smsLeaveRequests)
    .where(and(eq(smsLeaveRequests.id, leaveId), eq(smsLeaveRequests.organizationId, organizationId)))
    .limit(1)
  if (!request) throw createError({ statusCode: 404, message: 'Leave request not found' })
  if (request.status !== 'pending') {
    throw createError({ statusCode: 409, message: `Leave is already ${request.status}` })
  }

  const task = await loadPendingApprovalTask(db, {
    organizationId,
    subjectType: 'leave',
    subjectId: leaveId
  })
  if (!task) throw createError({ statusCode: 409, message: 'No pending approval step for this leave' })

  let studentClassId: number | null = null
  if (request.subjectType === 'student' && request.studentId) {
    const [student] = await db.select({ classId: smsStudents.classId })
      .from(smsStudents)
      .where(eq(smsStudents.id, request.studentId))
      .limit(1)
    studentClassId = student?.classId ?? null
  }
  await assertCanDecide(actor, task, studentClassId)

  return await db.transaction(async (tx) => {
    await completeApprovalTask(tx, {
      taskId: task.id,
      actorUserId: actor.userId,
      decision: decision === 'approve' ? 'approved' : 'rejected',
      comment
    })

    if (decision === 'reject') {
      const [updated] = await tx.update(smsLeaveRequests)
        .set({
          status: 'rejected',
          decidedBy: actor.userId,
          decidedAt: new Date(),
          decisionNote: comment,
          updatedAt: new Date()
        })
        .where(eq(smsLeaveRequests.id, leaveId))
        .returning()
      await cancelPendingApprovalTasks(
        tx,
        { organizationId, subjectType: 'leave', subjectId: leaveId },
        actor.userId
      )
      await writeAudit(tx, {
        actorUserId: actor.userId,
        tenantId: actor.tenantId ?? undefined,
        organizationId,
        moduleId: 'sms',
        action: 'leave.reject',
        resource: 'leave',
        recordId: leaveId,
        before: { status: request.status },
        after: { status: 'rejected', step: task.step, comment },
        source: 'sms-service'
      })
      await notifyLeaveDecided(tx, {
        organizationId,
        tenantId: actor.tenantId ?? null,
        leaveId,
        applicantUserId: request.applicantUserId,
        status: 'rejected',
        comment
      })
      return { id: leaveId, status: updated?.status ?? 'rejected', step: task.step, escalated: false, attendance: 0 }
    }

    const next = await loadNextPendingApprovalTask(tx, {
      organizationId,
      subjectType: 'leave',
      subjectId: leaveId
    })
    if (next) {
      await writeAudit(tx, {
        actorUserId: actor.userId,
        tenantId: actor.tenantId ?? undefined,
        organizationId,
        moduleId: 'sms',
        action: 'leave.approve.step',
        resource: 'leave',
        recordId: leaveId,
        before: { status: 'pending', step: task.step },
        after: { status: 'pending', nextStep: next.step },
        source: 'sms-service'
      })
      await notifyLeaveSubmitted(tx, {
        organizationId,
        tenantId: actor.tenantId ?? null,
        leaveId,
        applicantUserId: request.applicantUserId,
        assigneeUserId: next.assigneeUserId,
        days: leaveDays(request.startAt, request.endAt)
      })
      return { id: leaveId, status: 'pending', step: task.step, escalated: true, attendance: 0 }
    }

    const now = new Date()
    const [updated] = await tx.update(smsLeaveRequests)
      .set({
        status: 'approved',
        decidedBy: actor.userId,
        decidedAt: now,
        decisionNote: comment,
        updatedAt: now
      })
      .where(eq(smsLeaveRequests.id, leaveId))
      .returning()

    const attendance = await writeLeaveAttendance(tx, {
      organizationId,
      tenantId: actor.tenantId ?? null,
      request,
      classId: studentClassId,
      actorUserId: actor.userId,
      now
    })

    await writeAudit(tx, {
      actorUserId: actor.userId,
      tenantId: actor.tenantId ?? undefined,
      organizationId,
      moduleId: 'sms',
      action: 'leave.approve',
      resource: 'leave',
      recordId: leaveId,
      before: { status: request.status },
      after: { status: 'approved', step: task.step, attendance },
      source: 'sms-service'
    })
    await notifyLeaveDecided(tx, {
      organizationId,
      tenantId: actor.tenantId ?? null,
      leaveId,
      applicantUserId: request.applicantUserId,
      status: 'approved',
      comment
    })

    return { id: leaveId, status: updated?.status ?? 'approved', step: task.step, escalated: false, attendance }
  })
}

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0]

/**
 * Marks every calendar day of the leave as `leave` for the student. Existing
 * rows are corrected in place (never duplicated), matching the attendance
 * unique key (organization × student × date × session).
 */
async function writeLeaveAttendance(
  tx: Tx,
  input: {
    organizationId: number
    tenantId: number | null
    request: typeof smsLeaveRequests.$inferSelect
    classId: number | null
    actorUserId: number
    now: Date
  }
): Promise<number> {
  const { request } = input
  if (request.subjectType !== 'student' || !request.studentId || !input.classId) return 0
  const window = {
    startDate: request.startAt.toISOString().slice(0, 10),
    endDate: request.endAt.toISOString().slice(0, 10)
  }
  let written = 0
  for (const date of leaveDateRange(window)) {
    const [existing] = await tx.select({ id: smsAttendanceRecords.id }).from(smsAttendanceRecords)
      .where(and(
        eq(smsAttendanceRecords.organizationId, input.organizationId),
        eq(smsAttendanceRecords.studentId, request.studentId),
        eq(smsAttendanceRecords.attendanceDate, date),
        eq(smsAttendanceRecords.session, 'full_day'),
        isNull(smsAttendanceRecords.periodNo)
      ))
      .limit(1)
    if (existing) {
      await tx.update(smsAttendanceRecords)
        .set({
          status: 'leave',
          leaveRequestId: request.id,
          recordedBy: input.actorUserId,
          updatedAt: input.now
        })
        .where(eq(smsAttendanceRecords.id, existing.id))
    } else {
      await tx.insert(smsAttendanceRecords).values({
        organizationId: input.organizationId,
        tenantId: input.tenantId,
        classId: input.classId,
        studentId: request.studentId,
        attendanceDate: date,
        session: 'full_day',
        status: 'leave',
        leaveRequestId: request.id,
        recordedBy: input.actorUserId
      })
    }
    written += 1
  }
  return written
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

export interface LeaveListQuery {
  status?: unknown
  studentId?: unknown
  type?: unknown
  limit?: unknown
}

export async function listLeaveRequests(actor: SmsActor, options: LeaveListQuery = {}) {
  const organizationId = requireLeaveRead(actor)
  const conditions = [eq(smsLeaveRequests.organizationId, organizationId)]

  if (!hasSchoolWideLeave(actor)) {
    const [classIds, childIds] = await Promise.all([
      scopedLeaveClassIds(actor),
      actor.roleName === 'guardian' ? guardianStudentIds(actor) : Promise.resolve([])
    ])
    const visible = [eq(smsLeaveRequests.applicantUserId, actor.userId)]
    if (childIds.length) visible.push(inArray(smsLeaveRequests.studentId, childIds))
    if (classIds?.length) {
      const rows = await db.select({ id: smsStudents.id }).from(smsStudents)
        .where(and(
          eq(smsStudents.organizationId, organizationId),
          inArray(smsStudents.classId, classIds)
        ))
      if (rows.length) visible.push(inArray(smsLeaveRequests.studentId, rows.map(row => row.id)))
    }
    conditions.push(or(...visible) ?? eq(smsLeaveRequests.id, -1))
  }

  if (options.status !== undefined && options.status !== null && options.status !== '') {
    conditions.push(eq(smsLeaveRequests.status, normalizeLeaveStatus(options.status)))
  }
  if (options.type !== undefined && options.type !== null && options.type !== '') {
    conditions.push(eq(smsLeaveRequests.type, normalizeLeaveType(options.type)))
  }
  const studentId = optionalId(options.studentId)
  if (studentId) conditions.push(eq(smsLeaveRequests.studentId, studentId))

  const limit = Math.min(Math.max(Math.floor(Number(options.limit ?? 50) || 50), 1), 200)
  const rows = await db.select({
    id: smsLeaveRequests.id,
    subjectType: smsLeaveRequests.subjectType,
    studentId: smsLeaveRequests.studentId,
    studentName: smsStudents.name,
    studentNo: smsStudents.studentNo,
    classId: smsStudents.classId,
    className: smsClasses.name,
    applicantUserId: smsLeaveRequests.applicantUserId,
    type: smsLeaveRequests.type,
    startAt: smsLeaveRequests.startAt,
    endAt: smsLeaveRequests.endAt,
    reason: smsLeaveRequests.reason,
    status: smsLeaveRequests.status,
    decidedBy: smsLeaveRequests.decidedBy,
    decidedAt: smsLeaveRequests.decidedAt,
    decisionNote: smsLeaveRequests.decisionNote,
    createdAt: smsLeaveRequests.createdAt
  }).from(smsLeaveRequests)
    .leftJoin(smsStudents, eq(smsStudents.id, smsLeaveRequests.studentId))
    .leftJoin(smsClasses, eq(smsClasses.id, smsStudents.classId))
    .where(and(...conditions))
    .orderBy(desc(smsLeaveRequests.createdAt))
    .limit(limit)

  return rows.map(row => ({ ...row, days: leaveDays(row.startAt, row.endAt) }))
}

function leaveDays(startAt: Date, endAt: Date): number {
  return Math.floor(
    (Date.parse(`${endAt.toISOString().slice(0, 10)}T00:00:00Z`)
      - Date.parse(`${startAt.toISOString().slice(0, 10)}T00:00:00Z`)) / DAY_MS
  ) + 1
}

export interface ApprovalListQuery {
  status?: unknown
  limit?: unknown
}

export async function listApprovalTasks(actor: SmsActor, options: ApprovalListQuery = {}) {
  const organizationId = requireLeaveRead(actor)
  const conditions = [
    eq(smsApprovalTasks.organizationId, organizationId),
    eq(smsApprovalTasks.subjectType, 'leave')
  ]
  const status = options.status === undefined || options.status === null || options.status === ''
    ? 'pending'
    : String(options.status)
  if (!(APPROVAL_STATUSES as readonly string[]).includes(status)) {
    throw createError({ statusCode: 400, message: `status must be one of ${APPROVAL_STATUSES.join(', ')}` })
  }
  conditions.push(eq(smsApprovalTasks.status, status))

  if (!hasSchoolWideLeave(actor)) {
    const own = eq(smsApprovalTasks.assigneeUserId, actor.userId)
    conditions.push(canApproveLeave(actor) ? (or(own, isNull(smsApprovalTasks.assigneeUserId)) ?? own) : own)
  }

  const limit = Math.min(Math.max(Math.floor(Number(options.limit ?? 50) || 50), 1), 200)
  const rows = await db.select({
    id: smsApprovalTasks.id,
    subjectId: smsApprovalTasks.subjectId,
    step: smsApprovalTasks.step,
    assigneeUserId: smsApprovalTasks.assigneeUserId,
    assigneeRole: smsApprovalTasks.assigneeRole,
    status: smsApprovalTasks.status,
    createdAt: smsApprovalTasks.createdAt,
    studentId: smsLeaveRequests.studentId,
    studentName: smsStudents.name,
    studentNo: smsStudents.studentNo,
    className: smsClasses.name,
    type: smsLeaveRequests.type,
    startAt: smsLeaveRequests.startAt,
    endAt: smsLeaveRequests.endAt,
    reason: smsLeaveRequests.reason,
    leaveStatus: smsLeaveRequests.status
  }).from(smsApprovalTasks)
    .innerJoin(smsLeaveRequests, and(
      eq(smsLeaveRequests.id, smsApprovalTasks.subjectId),
      eq(smsLeaveRequests.organizationId, organizationId)
    ))
    .leftJoin(smsStudents, eq(smsStudents.id, smsLeaveRequests.studentId))
    .leftJoin(smsClasses, eq(smsClasses.id, smsStudents.classId))
    .where(and(...conditions))
    .orderBy(asc(smsApprovalTasks.createdAt))
    .limit(limit)

  return rows.map(row => ({
    ...row,
    days: row.startAt && row.endAt ? leaveDays(row.startAt, row.endAt) : 0
  }))
}

export async function findLeaveRequest(actor: SmsActor, leaveId: number) {
  const organizationId = requireLeaveRead(actor)
  const [row] = await db.select({
    id: smsLeaveRequests.id,
    status: smsLeaveRequests.status,
    subjectType: smsLeaveRequests.subjectType,
    studentId: smsLeaveRequests.studentId,
    applicantUserId: smsLeaveRequests.applicantUserId,
    type: smsLeaveRequests.type,
    startAt: smsLeaveRequests.startAt,
    endAt: smsLeaveRequests.endAt,
    reason: smsLeaveRequests.reason,
    studentName: smsStudents.name,
    studentNo: smsStudents.studentNo,
    className: smsClasses.name
  }).from(smsLeaveRequests)
    .leftJoin(smsStudents, eq(smsStudents.id, smsLeaveRequests.studentId))
    .leftJoin(smsClasses, eq(smsClasses.id, smsStudents.classId))
    .where(and(eq(smsLeaveRequests.id, leaveId), eq(smsLeaveRequests.organizationId, organizationId)))
    .limit(1)
  if (!row) throw createError({ statusCode: 404, message: 'Leave request not found' })

  // Non-admin viewers must be able to see the row (same scope as the list).
  if (!hasSchoolWideLeave(actor)) {
    const list = await listLeaveRequests(actor, { limit: 200 })
    if (!list.some(item => item.id === leaveId)) {
      throw createError({ statusCode: 404, message: 'Leave request not found' })
    }
  }
  return { ...row, days: leaveDays(row.startAt, row.endAt) }
}
