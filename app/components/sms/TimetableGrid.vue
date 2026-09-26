<script setup lang="ts">
/**
 * The weekly grid, drawn once and reused by the timetable page, a class page and
 * the portal's "today" strip.
 *
 * Rows are the bell periods, columns the weekdays the API asked for (Saturday
 * appears only when it is used), and a cell may hold more than one lesson — that
 * is not a rendering bug, it is a clash, and the whole cell is tinted so it reads
 * as one. The colour comes from the response's own `conflicts`, so what the grid
 * flags and what the page lists can never disagree.
 */
import type { TimetableResponse } from '../../composables/useSms'

const props = withDefaults(defineProps<{
  timetable: TimetableResponse
  showTeachers?: boolean
}>(), {
  showTeachers: true
})

const { t } = useI18n()

const conflictSlots = computed(() => {
  const slots = new Set<string>()
  for (const conflict of props.timetable.conflicts) {
    slots.add(`${conflict.weekday}:${conflict.periodId}`)
  }
  return slots
})

function isConflict(weekday: number | undefined, periodId: number): boolean {
  if (weekday == null) return false
  return conflictSlots.value.has(`${weekday}:${periodId}`)
}
</script>

<template>
  <div class="overflow-x-auto rounded-xl border border-default">
    <table class="w-full border-collapse text-sm">
      <thead>
        <tr class="bg-elevated/60">
          <th class="w-32 border-b border-default px-3 py-2 text-left text-xs font-medium text-muted">
            {{ t('sms.timetable.period') }}
          </th>
          <th
            v-for="weekday in props.timetable.weekdays"
            :key="weekday"
            class="min-w-40 border-b border-l border-default px-3 py-2 text-left text-xs font-medium text-muted"
          >
            {{ t(`sms.timetable.weekday${weekday}`) }}
          </th>
        </tr>
      </thead>
      <tbody>
        <tr
          v-for="row in props.timetable.grid"
          :key="row.period.id"
        >
          <th class="border-b border-default px-3 py-2 text-left align-top font-normal">
            <span class="block text-sm font-medium text-highlighted">{{ row.period.name }}</span>
            <span class="block text-xs text-dimmed">{{ row.period.startTime }}–{{ row.period.endTime }}</span>
          </th>
          <td
            v-for="(cell, index) in row.cells"
            :key="index"
            class="border-b border-l border-default px-2 py-2 align-top"
            :class="isConflict(props.timetable.weekdays[index], row.period.id) ? 'bg-error/10' : ''"
          >
            <div
              v-if="cell.length"
              class="space-y-1"
            >
              <div
                v-for="entry in cell"
                :key="entry.id"
                class="rounded-md bg-elevated px-2 py-1"
              >
                <p class="text-xs font-medium text-highlighted">
                  {{ entry.courseName }}
                </p>
                <p
                  v-if="entry.className"
                  class="text-[11px] text-muted"
                >
                  {{ entry.className }}
                </p>
                <p
                  v-if="props.showTeachers && entry.teacherNames.length"
                  class="text-[11px] text-muted"
                >
                  {{ entry.teacherNames.join(', ') }}
                </p>
                <p
                  v-if="entry.classroomName"
                  class="text-[11px] text-dimmed"
                >
                  {{ entry.classroomName }}
                </p>
              </div>
            </div>
            <span
              v-else
              class="text-xs text-dimmed"
            >—</span>
          </td>
        </tr>
      </tbody>
    </table>
  </div>
</template>
