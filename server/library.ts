/**
 * Library (Slice D): catalogue and circulation.
 *
 * Borrowing decrements `available_copies` and returning increments it, both in
 * a transaction. Students may not hold two active loans of the same title.
 */
import { and, asc, desc, eq, ilike, or, sql } from 'drizzle-orm'
import { createError } from 'h3'
import { db, writeAudit } from '../../../server/sdk'
import { smsBookLoans, smsBooks, smsStudents } from './database/schema'
import { canUseSms, requireSmsOrganization, type SmsActor } from './context'
import { getStudent } from './students'

export const LOAN_STATUSES = ['borrowed', 'returned', 'overdue'] as const
export type LoanStatus = typeof LOAN_STATUSES[number]

const DEFAULT_LOAN_DAYS = 30
const DAY_MS = 24 * 60 * 60 * 1000

/** Default due date: 30 days from now. */
export function defaultDueDate(from: Date = new Date()): Date {
  return new Date(from.getTime() + DEFAULT_LOAN_DAYS * DAY_MS)
}

export function normalizeDueAt(value: unknown): Date {
  if (value === undefined || value === null || value === '') return defaultDueDate()
  const date = value instanceof Date ? value : new Date(String(value))
  if (Number.isNaN(date.getTime())) throw createError({ statusCode: 400, message: 'dueAt must be an ISO date' })
  if (date.getTime() <= Date.now()) throw createError({ statusCode: 400, message: 'dueAt must be in the future' })
  return date
}

function positiveId(value: unknown, field: string): number {
  const id = Number(value)
  if (!Number.isSafeInteger(id) || id <= 0) {
    throw createError({ statusCode: 400, message: `${field} must be a positive integer` })
  }
  return id
}

function text(value: unknown, max: number): string | null {
  return typeof value === 'string' && value.trim() ? value.trim().slice(0, max) : null
}

function requireLibraryRead(actor: SmsActor): number {
  const organizationId = requireSmsOrganization(actor)
  if (!canUseSms(actor, 'read', 'library')) {
    throw createError({ statusCode: 403, statusMessage: 'Forbidden', message: 'No permission to read library' })
  }
  return organizationId
}

function requireLibraryWrite(actor: SmsActor): number {
  const organizationId = requireSmsOrganization(actor)
  if (!canUseSms(actor, 'update', 'library')) {
    throw createError({ statusCode: 403, statusMessage: 'Forbidden', message: 'No permission to update library' })
  }
  return organizationId
}

export async function listBooks(actor: SmsActor, options: { query?: unknown, limit?: unknown } = {}) {
  const organizationId = requireLibraryRead(actor)
  const conditions = [eq(smsBooks.organizationId, organizationId)]
  const query = typeof options.query === 'string' ? options.query.trim() : ''
  if (query) {
    const clause = or(
      ilike(smsBooks.title, `%${query}%`),
      ilike(smsBooks.author, `%${query}%`),
      ilike(smsBooks.isbn, `%${query}%`)
    )
    if (clause) conditions.push(clause)
  }
  const limit = Math.min(Math.max(Math.floor(Number(options.limit ?? 50) || 50), 1), 200)
  return await db.select().from(smsBooks)
    .where(and(...conditions))
    .orderBy(desc(smsBooks.createdAt))
    .limit(limit)
}

export interface CreateBookInput {
  title?: unknown
  author?: unknown
  isbn?: unknown
  category?: unknown
  totalCopies?: unknown
}

export async function createBook(actor: SmsActor, input: CreateBookInput) {
  const organizationId = requireLibraryWrite(actor)
  const title = typeof input.title === 'string' ? input.title.trim() : ''
  if (!title || title.length > 160) throw createError({ statusCode: 400, message: 'title must be 1-160 characters' })
  const totalCopies = input.totalCopies === undefined || input.totalCopies === null || input.totalCopies === ''
    ? 1
    : Number(input.totalCopies)
  if (!Number.isSafeInteger(totalCopies) || totalCopies < 1 || totalCopies > 999) {
    throw createError({ statusCode: 400, message: 'totalCopies must be an integer between 1 and 999' })
  }

  return await db.transaction(async (tx) => {
    const [row] = await tx.insert(smsBooks).values({
      organizationId,
      tenantId: actor.tenantId ?? null,
      title,
      author: text(input.author, 120),
      isbn: text(input.isbn, 20),
      category: text(input.category, 60),
      totalCopies,
      availableCopies: totalCopies
    }).returning()
    if (!row) throw createError({ statusCode: 500, message: 'Failed to create book' })
    await writeAudit(tx, {
      actorUserId: actor.userId,
      tenantId: actor.tenantId ?? undefined,
      organizationId,
      moduleId: 'sms',
      action: 'book.create',
      resource: 'library',
      recordId: row.id,
      after: row,
      source: 'sms-service'
    })
    return row
  })
}

export interface BorrowBookInput {
  bookId?: unknown
  studentId?: unknown
  dueAt?: unknown
}

export async function borrowBook(actor: SmsActor, input: BorrowBookInput) {
  const organizationId = requireLibraryWrite(actor)
  const bookId = positiveId(input.bookId, 'bookId')
  const studentId = positiveId(input.studentId, 'studentId')
  await getStudent(actor, studentId)
  const dueAt = normalizeDueAt(input.dueAt)

  const [book] = await db.select().from(smsBooks)
    .where(and(eq(smsBooks.id, bookId), eq(smsBooks.organizationId, organizationId)))
    .limit(1)
  if (!book) throw createError({ statusCode: 404, message: 'Book not found' })
  if (book.availableCopies <= 0) throw createError({ statusCode: 409, message: 'No copies available' })

  const [active] = await db.select({ id: smsBookLoans.id }).from(smsBookLoans)
    .where(and(
      eq(smsBookLoans.organizationId, organizationId),
      eq(smsBookLoans.bookId, bookId),
      eq(smsBookLoans.studentId, studentId),
      eq(smsBookLoans.status, 'borrowed')
    ))
    .limit(1)
  if (active) throw createError({ statusCode: 409, message: 'This student already has an active loan for the book' })

  return await db.transaction(async (tx) => {
    const [loan] = await tx.insert(smsBookLoans).values({
      organizationId,
      tenantId: actor.tenantId ?? null,
      bookId,
      studentId,
      dueAt,
      status: 'borrowed',
      createdBy: actor.userId
    }).returning()
    if (!loan) throw createError({ statusCode: 500, message: 'Failed to create loan' })
    await tx.update(smsBooks)
      .set({
        availableCopies: sql`${smsBooks.availableCopies} - 1`,
        updatedAt: new Date()
      })
      .where(eq(smsBooks.id, bookId))
    await writeAudit(tx, {
      actorUserId: actor.userId,
      tenantId: actor.tenantId ?? undefined,
      organizationId,
      moduleId: 'sms',
      action: 'loan.borrow',
      resource: 'library',
      recordId: loan.id,
      after: { bookId, studentId, dueAt },
      source: 'sms-service'
    })
    return {
      loanId: loan.id,
      bookId,
      studentId,
      title: book.title,
      dueAt,
      availableCopies: book.availableCopies - 1
    }
  })
}

export async function returnBook(actor: SmsActor, loanId: number) {
  const organizationId = requireLibraryWrite(actor)
  const [loan] = await db.select().from(smsBookLoans)
    .where(and(eq(smsBookLoans.id, loanId), eq(smsBookLoans.organizationId, organizationId)))
    .limit(1)
  if (!loan) throw createError({ statusCode: 404, message: 'Loan not found' })
  if (loan.status === 'returned') throw createError({ statusCode: 409, message: 'Book already returned' })

  return await db.transaction(async (tx) => {
    const now = new Date()
    await tx.update(smsBookLoans)
      .set({ status: 'returned', returnedAt: now })
      .where(eq(smsBookLoans.id, loanId))
    await tx.update(smsBooks)
      .set({
        availableCopies: sql`LEAST(${smsBooks.availableCopies} + 1, ${smsBooks.totalCopies})`,
        updatedAt: now
      })
      .where(eq(smsBooks.id, loan.bookId))
    await writeAudit(tx, {
      actorUserId: actor.userId,
      tenantId: actor.tenantId ?? undefined,
      organizationId,
      moduleId: 'sms',
      action: 'loan.return',
      resource: 'library',
      recordId: loanId,
      before: { status: loan.status },
      after: { status: 'returned', bookId: loan.bookId, studentId: loan.studentId },
      source: 'sms-service'
    })
    return { loanId, status: 'returned', bookId: loan.bookId, returnedAt: now }
  })
}

export async function listLoans(actor: SmsActor, options: { studentId?: unknown, status?: unknown, limit?: unknown } = {}) {
  const organizationId = requireLibraryRead(actor)
  const conditions = [eq(smsBookLoans.organizationId, organizationId)]
  const studentId = options.studentId === undefined || options.studentId === null || options.studentId === ''
    ? null
    : positiveId(options.studentId, 'studentId')
  if (studentId) conditions.push(eq(smsBookLoans.studentId, studentId))
  if (options.status !== undefined && options.status !== null && options.status !== '') {
    const status = String(options.status)
    if (!(LOAN_STATUSES as readonly string[]).includes(status)) {
      throw createError({ statusCode: 400, message: `status must be one of ${LOAN_STATUSES.join(', ')}` })
    }
    conditions.push(eq(smsBookLoans.status, status))
  }
  const limit = Math.min(Math.max(Math.floor(Number(options.limit ?? 50) || 50), 1), 200)
  return await db.select({
    id: smsBookLoans.id,
    bookId: smsBookLoans.bookId,
    title: smsBooks.title,
    studentId: smsBookLoans.studentId,
    studentName: smsStudents.name,
    borrowedAt: smsBookLoans.borrowedAt,
    dueAt: smsBookLoans.dueAt,
    returnedAt: smsBookLoans.returnedAt,
    status: smsBookLoans.status
  }).from(smsBookLoans)
    .leftJoin(smsBooks, eq(smsBooks.id, smsBookLoans.bookId))
    .leftJoin(smsStudents, eq(smsStudents.id, smsBookLoans.studentId))
    .where(and(...conditions))
    .orderBy(asc(smsBookLoans.dueAt))
    .limit(limit)
}
