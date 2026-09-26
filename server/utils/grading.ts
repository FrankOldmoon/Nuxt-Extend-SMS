/**
 * Marking — turning assessment weights and raw scores into a report card.
 *
 * Three decisions shape everything here, and each of them exists to avoid a
 * specific way report cards lie:
 *
 * **1. "Not marked" is not zero.** `sms_scores.score` is nullable, and a missing
 * mark is excluded from the weighted total rather than counted as a failure. A
 * student who has sat three of four assessments gets the average of those three
 * — along with a `coverage` figure saying how much of the course's weight that
 * average actually rests on, so a report card can print "based on 60% of the
 * grade" instead of quietly pretending to be complete.
 *
 * **2. Weights are validated, not assumed.** A course whose assessments add up to
 * 90% or 110% is a data-entry mistake, and `courseTotal` says so (`weightsValid`,
 * `weightSum`) rather than producing a number nobody can explain.
 *
 * **3. A mark is normalised before it is weighted.** A 20-mark quiz and a
 * 150-mark paper both become a percentage, so `weight` means the same thing in
 * both rows.
 *
 * Everything is a pure function of plain objects, so the whole report-card maths
 * is unit-testable without a database.
 */

export type GradeLetter = 'A' | 'B' | 'C' | 'D' | 'F'

export interface Assessment {
  id: number
  /** Percentage of the final grade; a course's weights must add up to 100. */
  weight: number
  /** Marks the assessment is out of. */
  maxScore: number
}

export interface ScoreInput {
  assessmentId: number
  /** Null means "not marked yet", which is not the same as zero. */
  score: number | null
}

export interface CourseTotal {
  /** 0–100 rounded to two decimals, or null when nothing has been marked. */
  total: number | null
  /** Share of the course's weight that has marks behind it, 0–1. */
  coverage: number
  /** How many assessments have a mark / do not. */
  marked: number
  missing: number
  /** The assessments' weights do not add up to 100 — a data-entry mistake. */
  weightsValid: boolean
  weightSum: number
}

/** Round to two decimals, which is as precise as a percentage ever needs to be. */
function round2(value: number): number {
  return Math.round(value * 100) / 100
}

/**
 * A raw mark as a percentage of what it was out of.
 *
 * Returns null for an unmarked assessment, and clamps to 0–100 so a bonus mark
 * (or a typo) cannot push a course total past 100.
 */
export function percentOf(score: number | null | undefined, maxScore: number): number | null {
  if (score == null || !Number.isFinite(score)) return null
  if (!Number.isFinite(maxScore) || maxScore <= 0) return null
  return Math.min(100, Math.max(0, (score / maxScore) * 100))
}

/** Do a course's assessment weights add up to 100? */
export function validateWeights(assessments: Array<Pick<Assessment, 'weight'>>): { sum: number, valid: boolean } {
  const sum = assessments.reduce((total, assessment) => total + (Number.isFinite(assessment.weight) ? assessment.weight : 0), 0)
  // Floating point is not a concern with integer weights, but a tolerance keeps
  // this honest if somebody stores 33.3 + 33.3 + 33.4.
  return { sum: round2(sum), valid: Math.abs(sum - 100) < 0.01 }
}

/**
 * The weighted total for one student in one course.
 *
 * The denominator is the weight that has actually been marked — see the header.
 */
export function courseTotal(assessments: Assessment[], scores: ScoreInput[]): CourseTotal {
  const byAssessment = new Map(scores.map(entry => [entry.assessmentId, entry.score]))
  const { sum: weightSum, valid: weightsValid } = validateWeights(assessments)

  let weighted = 0
  let markedWeight = 0
  let marked = 0
  let missing = 0

  for (const assessment of assessments) {
    const percent = percentOf(byAssessment.get(assessment.id), assessment.maxScore)
    if (percent == null) {
      missing++
      continue
    }
    marked++
    weighted += percent * assessment.weight
    markedWeight += assessment.weight
  }

  return {
    total: markedWeight > 0 ? round2(weighted / markedWeight) : null,
    coverage: weightSum > 0 ? round2(markedWeight / weightSum) : 0,
    marked,
    missing,
    weightsValid,
    weightSum
  }
}

/**
 * The letter for a percentage.
 *
 * The D band's floor is the school's pass mark rather than a fixed 60, so a
 * school that passes at 50 gets a D where another gets an F, which is the only
 * behaviour that makes `sms.passMark` mean anything.
 */
export function letterGrade(percent: number | null | undefined, passMark = 60): GradeLetter | null {
  if (percent == null || !Number.isFinite(percent)) return null
  if (percent >= 90) return 'A'
  if (percent >= 80) return 'B'
  if (percent >= 70) return 'C'
  if (percent >= passMark) return 'D'
  return 'F'
}

/** Grade point on a 4.0 scale, or null when there is nothing to point at. */
export function gradePoint(percent: number | null | undefined, passMark = 60): number | null {
  const letter = letterGrade(percent, passMark)
  if (!letter) return null
  return { A: 4, B: 3, C: 2, D: 1, F: 0 }[letter]
}

/**
 * Rank a cohort, highest total first.
 *
 * Standard competition ranking: equal totals share a rank and the next rank skips
 * (1, 2, 2, 4) — which is what a school's notice board shows. Students with no
 * marks get no rank rather than the last place.
 */
export function rankStudents(rows: Array<{ studentId: number, total: number | null }>): Map<number, number | null> {
  const ranked = rows
    .filter(row => row.total != null)
    .sort((a, b) => (b.total as number) - (a.total as number))

  const result = new Map<number, number | null>()
  for (const row of rows) {
    if (row.total == null) result.set(row.studentId, null)
  }

  let rank = 0
  let previous: number | null = null
  ranked.forEach((row, index) => {
    if (previous == null || row.total !== previous) rank = index + 1
    previous = row.total
    result.set(row.studentId, rank)
  })
  return result
}

/**
 * A term's overall average across courses, weighted by each course's credits.
 *
 * Courses with no marks are skipped rather than pulling the average towards zero,
 * and courses that are not graded never reach this function.
 */
export function overallAverage(rows: Array<{ total: number | null, credits: number }>): number | null {
  let weighted = 0
  let weight = 0
  for (const row of rows) {
    if (row.total == null) continue
    const credits = Number.isFinite(row.credits) && row.credits > 0 ? row.credits : 1
    weighted += row.total * credits
    weight += credits
  }
  return weight > 0 ? round2(weighted / weight) : null
}

export interface ReportCardSummary {
  average: number | null
  courses: number
  passed: number
  failed: number
  best: { courseId: number, total: number } | null
  worst: { courseId: number, total: number } | null
  /** Conduct points, which the report card prints next to the average. */
  merits: number
  demerits: number
}

/** The headline numbers a report card puts at the top of the page. */
export function reportCardSummary(
  rows: Array<{ courseId: number, total: number | null, credits: number }>,
  conduct: Array<{ kind: string, points: number }> = [],
  passMark = 60
): ReportCardSummary {
  const marked = rows.filter((row): row is { courseId: number, total: number, credits: number } => row.total != null)

  let best: { courseId: number, total: number } | null = null
  let worst: { courseId: number, total: number } | null = null
  for (const row of marked) {
    if (!best || row.total > best.total) best = { courseId: row.courseId, total: row.total }
    if (!worst || row.total < worst.total) worst = { courseId: row.courseId, total: row.total }
  }

  let merits = 0
  let demerits = 0
  for (const record of conduct) {
    if (record.kind === 'merit') merits += record.points
    else demerits += record.points
  }

  return {
    average: overallAverage(rows),
    courses: marked.length,
    passed: marked.filter(row => row.total >= passMark).length,
    failed: marked.filter(row => row.total < passMark).length,
    best,
    worst,
    merits,
    demerits
  }
}
