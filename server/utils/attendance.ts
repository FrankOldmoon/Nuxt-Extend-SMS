/**
 * Attendance — turning a pile of records into an attendance rate.
 *
 * The whole file exists because "attendance rate" is ambiguous, and the wrong
 * reading is unfair to students:
 *
 *   - `leave` and `excused` are **authorised** absences. They do not count as
 *     attended, but they must not count against the student either, so they are
 *     removed from the denominator rather than from the numerator. A student who
 *     missed a week with a doctor's note still has a 100% attendance rate, which
 *     is what every school means by it.
 *   - `late` **is** attendance. The student was there; `minutesLate` and the
 *     status exist so it can be reported separately, not so it can be punished
 *     twice.
 *
 * So: `rate = attended / (total − authorised)`.
 */

export const ATTENDANCE_STATUSES = ['present', 'late', 'absent', 'leave', 'excused'] as const

export type AttendanceStatus = typeof ATTENDANCE_STATUSES[number]

export function isAttendanceStatus(value: unknown): value is AttendanceStatus {
  return ATTENDANCE_STATUSES.includes(String(value) as AttendanceStatus)
}

export interface AttendanceRow {
  studentId: number
  status: string
  minutesLate?: number | null
  date: string
  periodId?: number | null
}

export interface AttendanceStats {
  /** Every record counted, including authorised absences. */
  total: number
  present: number
  late: number
  absent: number
  leave: number
  excused: number
  /** present + late. */
  attended: number
  /** Records that count towards the rate: total − leave − excused. */
  counted: number
  /** 0–1, or null when there is nothing to rate. */
  rate: number | null
  /** Total lateness in minutes, for the "why is this student late" report. */
  minutesLate: number
  /** Distinct dates with at least one record. */
  sessions: number
}

function emptyStats(): AttendanceStats {
  return {
    total: 0, present: 0, late: 0, absent: 0, leave: 0, excused: 0,
    attended: 0, counted: 0, rate: null, minutesLate: 0, sessions: 0
  }
}

/** A record never counted, when a status is not one this module knows. */
function tally(stats: AttendanceStats, status: string): void {
  if (status === 'present') stats.present++
  else if (status === 'late') stats.late++
  else if (status === 'absent') stats.absent++
  else if (status === 'leave') stats.leave++
  else if (status === 'excused') stats.excused++
  // Anything else is left out of the buckets but still counted in `total`, so it
  // shows up as an anomaly instead of being silently dropped.
}

function finalise(stats: AttendanceStats, dates: Set<string>): AttendanceStats {
  stats.attended = stats.present + stats.late
  stats.counted = stats.total - stats.leave - stats.excused
  stats.rate = stats.counted > 0 ? Math.round((stats.attended / stats.counted) * 10000) / 10000 : null
  stats.sessions = dates.size
  return stats
}

/** The attendance summary for one student's records. */
export function summarizeAttendance(rows: AttendanceRow[]): AttendanceStats {
  const stats = emptyStats()
  const dates = new Set<string>()
  for (const row of rows) {
    // Counted before the buckets, so a status this module does not know about
    // still shows up in the totals and the denominator instead of vanishing.
    stats.total++
    tally(stats, row.status)
    const late = row.minutesLate
    if (typeof late === 'number' && Number.isFinite(late)) stats.minutesLate += late
    if (row.date) dates.add(row.date)
  }
  return finalise(stats, dates)
}

/** The summary for every student in the list, keyed by student id. */
export function summarizeByStudent(rows: AttendanceRow[]): Map<number, AttendanceStats> {
  const grouped = new Map<number, AttendanceRow[]>()
  for (const row of rows) {
    const bucket = grouped.get(row.studentId)
    if (bucket) bucket.push(row)
    else grouped.set(row.studentId, [row])
  }
  const result = new Map<number, AttendanceStats>()
  for (const [studentId, studentRows] of grouped) {
    result.set(studentId, summarizeAttendance(studentRows))
  }
  return result
}

/** Just the rate, for callers that only need the number. */
export function attendanceRate(rows: AttendanceRow[]): number | null {
  return summarizeAttendance(rows).rate
}

/**
 * The statuses to pre-fill a new session with.
 *
 * Marking a class is almost always "everyone is here" followed by a few
 * corrections, so the sheet starts full of `present` rather than empty — an empty
 * sheet cannot be told apart from an unsaved one.
 */
export function defaultSheet(studentIds: number[]): Array<{ studentId: number, status: AttendanceStatus }> {
  return studentIds.map(studentId => ({ studentId, status: 'present' as AttendanceStatus }))
}
