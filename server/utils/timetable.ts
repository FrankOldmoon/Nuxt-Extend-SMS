/**
 * Timetable — laying placements out as a weekly grid, and finding the clashes
 * that make a timetable wrong.
 *
 * The grid and the conflict check read the same input, which is why they live
 * together: a placement names a course, a weekday, a period **and a room**, and
 * that is exactly the set of facts needed both to draw the week and to answer
 * "is this teacher in two rooms at once".
 *
 * The result of `findConflicts` is what a school actually wants before term
 * starts, and it is impossible to compute from a `courses.weekday` column — which
 * is the reason the schema has `sms_periods` and `sms_timetable_entries` instead.
 */

export interface Period {
  id: number
  name: string
  /** 1-based position within the day; the row order of the grid. */
  index: number
  startTime: string | null
  endTime: string | null
  /** `class` slots are drawn; `break` slots occupy the day but are not taught. */
  kind: string
}

export interface Placement {
  id: number
  courseId: number
  periodId: number
  /** ISO weekday: 1 = Monday … 7 = Sunday. */
  weekday: number
  classroomId: number | null
  /** Everyone who teaches this course, so a shared course clashes for all of them. */
  teacherIds: number[]
  classId: number | null
}

/** The default columns: Monday to Friday. */
export const SCHOOL_WEEKDAYS = [1, 2, 3, 4, 5] as const

export interface WeekRow<T> {
  period: Period
  /** One cell per weekday column, in `weekdays` order. A cell may hold several
   *  placements — when it does, that is a conflict the UI shows rather than
   *  hides. */
  cells: T[][]
}

/**
 * Build the week grid.
 *
 * Rows are the `class` periods in bell order, columns are the requested weekdays.
 * Break periods are deliberately dropped: they exist so the day's times line up,
 * not so anything can be scheduled into them.
 */
export function buildWeekGrid<T extends Placement>(
  periods: Period[],
  placements: T[],
  weekdays: readonly number[] = SCHOOL_WEEKDAYS
): Array<WeekRow<T>> {
  const bySlot = new Map<string, T[]>()
  for (const placement of placements) {
    const key = `${placement.weekday}:${placement.periodId}`
    const bucket = bySlot.get(key)
    if (bucket) bucket.push(placement)
    else bySlot.set(key, [placement])
  }

  return periods
    .filter(period => period.kind !== 'break')
    .sort((a, b) => a.index - b.index)
    .map(period => ({
      period,
      cells: weekdays.map(weekday => bySlot.get(`${weekday}:${period.id}`) ?? [])
    }))
}

export interface Conflict {
  /** Which resource is double-booked. */
  kind: 'teacher' | 'classroom' | 'class'
  /** The id of the teacher / classroom / class involved. */
  key: number
  weekday: number
  periodId: number
  /** The placements that collide — always two or more. */
  entryIds: number[]
}

/**
 * Every clash in a set of placements.
 *
 * One entry per (resource, weekday, period) rather than one per pair, so a
 * three-way collision reads as one problem with three placements rather than as
 * three problems. The output order is stable (weekday, then period, then kind) so
 * two runs of the same data produce the same list.
 */
export function findConflicts(placements: Placement[]): Conflict[] {
  const bySlot = new Map<string, Placement[]>()
  for (const placement of placements) {
    const key = `${placement.weekday}:${placement.periodId}`
    const bucket = bySlot.get(key)
    if (bucket) bucket.push(placement)
    else bySlot.set(key, [placement])
  }

  const conflicts: Conflict[] = []
  for (const bucket of bySlot.values()) {
    if (bucket.length < 2) continue

    const resources: Array<{ kind: Conflict['kind'], ids: number[] }> = [
      { kind: 'teacher', ids: bucket.flatMap(placement => placement.teacherIds) },
      { kind: 'classroom', ids: bucket.map(placement => placement.classroomId).filter((id): id is number => id != null) },
      { kind: 'class', ids: bucket.map(placement => placement.classId).filter((id): id is number => id != null) }
    ]

    for (const resource of resources) {
      const ids = [...new Set(resource.ids)]
      for (const id of ids) {
        const colliding = bucket.filter((placement) => {
          if (resource.kind === 'teacher') return placement.teacherIds.includes(id)
          if (resource.kind === 'classroom') return placement.classroomId === id
          return placement.classId === id
        })
        if (colliding.length < 2) continue
        conflicts.push({
          kind: resource.kind,
          key: id,
          weekday: bucket[0]!.weekday,
          periodId: bucket[0]!.periodId,
          entryIds: colliding.map(placement => placement.id).sort((a, b) => a - b)
        })
      }
    }
  }

  return conflicts.sort((a, b) =>
    a.weekday - b.weekday
    || a.periodId - b.periodId
    || a.kind.localeCompare(b.kind)
    || a.key - b.key
  )
}

/** How full a week is: how many slots are taught out of the slots available. */
export function utilisation(periods: Period[], placements: Placement[], weekdays: readonly number[] = SCHOOL_WEEKDAYS): {
  slots: number
  filled: number
  ratio: number
} {
  const teachingPeriods = periods.filter(period => period.kind !== 'break').length
  const slots = teachingPeriods * weekdays.length
  return { slots, filled: placements.length, ratio: slots > 0 ? Math.round((placements.length / slots) * 100) / 100 : 0 }
}
