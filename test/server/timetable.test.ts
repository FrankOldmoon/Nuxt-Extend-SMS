import { describe, it, expect } from 'vitest'
import {
  buildWeekGrid,
  findConflicts,
  utilisation,
  SCHOOL_WEEKDAYS
} from '../../server/utils/timetable'
import type { Period, Placement } from '../../server/utils/timetable'

const periods: Period[] = [
  { id: 1, name: 'Period 1', index: 1, startTime: '08:00', endTime: '08:45', kind: 'class' },
  { id: 2, name: 'Break', index: 2, startTime: '08:45', endTime: '09:00', kind: 'break' },
  { id: 3, name: 'Period 2', index: 3, startTime: '09:00', endTime: '09:45', kind: 'class' }
]

function placement(overrides: Partial<Placement> & Pick<Placement, 'id'>): Placement {
  return {
    courseId: 1,
    periodId: 1,
    weekday: 1,
    classroomId: null,
    teacherIds: [],
    classId: null,
    ...overrides
  }
}

describe('SCHOOL_WEEKDAYS', () => {
  it('is Monday to Friday', () => {
    expect([...SCHOOL_WEEKDAYS]).toEqual([1, 2, 3, 4, 5])
  })
})

describe('buildWeekGrid', () => {
  it('drops break periods, orders rows by index and buckets placements by slot', () => {
    const grid = buildWeekGrid(periods, [
      placement({ id: 10, periodId: 1, weekday: 1, courseId: 7 }),
      placement({ id: 11, periodId: 3, weekday: 2, courseId: 8 })
    ])
    expect(grid.map(row => row.period.id)).toEqual([1, 3])
    // Row 1 (period 1): Monday has the placement, Tuesday is empty.
    expect(grid[0]!.cells[0]!.map(item => item.id)).toEqual([10])
    expect(grid[0]!.cells[1]).toEqual([])
    // Row 2 (period 3): Tuesday has the placement.
    expect(grid[1]!.cells[1]!.map(item => item.id)).toEqual([11])
  })

  it('keeps several placements in one cell rather than hiding the clash', () => {
    const grid = buildWeekGrid(periods, [
      placement({ id: 10, periodId: 1, weekday: 1 }),
      placement({ id: 11, periodId: 1, weekday: 1 })
    ])
    expect(grid[0]!.cells[0]!.map(item => item.id)).toEqual([10, 11])
  })

  it('honours a custom weekday list', () => {
    const grid = buildWeekGrid(periods, [], [1, 2, 6])
    expect(grid[0]!.cells).toHaveLength(3)
  })
})

describe('findConflicts', () => {
  it('finds no conflict when placements share no resource', () => {
    expect(findConflicts([
      placement({ id: 1, weekday: 1, periodId: 1, teacherIds: [1], classroomId: 1, classId: 1 }),
      placement({ id: 2, weekday: 1, periodId: 1, teacherIds: [2], classroomId: 2, classId: 2 })
    ])).toEqual([])
  })

  it('flags a teacher booked twice', () => {
    const conflicts = findConflicts([
      placement({ id: 1, teacherIds: [5], classroomId: 1, classId: 1 }),
      placement({ id: 2, teacherIds: [5], classroomId: 2, classId: 2 })
    ])
    expect(conflicts).toHaveLength(1)
    expect(conflicts[0]).toMatchObject({ kind: 'teacher', key: 5, weekday: 1, periodId: 1, entryIds: [1, 2] })
  })

  it('flags a double-booked room and a double-booked class', () => {
    const conflicts = findConflicts([
      placement({ id: 1, classroomId: 9, classId: 3 }),
      placement({ id: 2, classroomId: 9, classId: 3 })
    ])
    expect(conflicts.map(c => c.kind).sort()).toEqual(['class', 'classroom'])
    expect(conflicts.find(c => c.kind === 'classroom')?.entryIds).toEqual([1, 2])
    expect(conflicts.find(c => c.kind === 'class')?.entryIds).toEqual([1, 2])
  })

  it('reports a three-way collision once per resource, not once per pair', () => {
    const conflicts = findConflicts([
      placement({ id: 1, teacherIds: [5] }),
      placement({ id: 2, teacherIds: [5] }),
      placement({ id: 3, teacherIds: [5] })
    ])
    expect(conflicts).toHaveLength(1)
    expect(conflicts[0]!.entryIds).toEqual([1, 2, 3])
  })

  it('outputs a stable order (weekday, period, kind)', () => {
    const conflicts = findConflicts([
      placement({ id: 1, weekday: 2, periodId: 1, classroomId: 1 }),
      placement({ id: 2, weekday: 2, periodId: 1, classroomId: 1 }),
      placement({ id: 3, weekday: 1, periodId: 3, classId: 1 }),
      placement({ id: 4, weekday: 1, periodId: 3, classId: 1 })
    ])
    expect(conflicts.map(c => `${c.weekday}:${c.periodId}:${c.kind}`)).toEqual([
      '1:3:class',
      '2:1:classroom'
    ])
  })
})

describe('utilisation', () => {
  it('measures filled teaching slots out of the available ones', () => {
    // Two teaching periods × five weekdays = 10 slots.
    const result = utilisation(periods, [placement({ id: 1 }), placement({ id: 2 })])
    expect(result.slots).toBe(10)
    expect(result.filled).toBe(2)
    expect(result.ratio).toBe(0.2)
  })

  it('is zero when there are no slots', () => {
    expect(utilisation([], []).ratio).toBe(0)
  })
})
