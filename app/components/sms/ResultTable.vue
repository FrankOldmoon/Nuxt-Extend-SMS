<script setup lang="ts">
import type { SmsToolTable, SmsToolTableColumn } from '../../composables/useSmsChat'

/**
 * Fixed result table for read capabilities. Columns come from the server
 * capability definition, so the layout never depends on model output.
 *
 * When `linkKey` is set, that column renders as a link and the row emits
 * `rowClick` (used to open the detail dialog). Tables also render as cards on
 * small screens, and support checkbox selection for batch actions.
 */
const props = defineProps<{
  table: SmsToolTable
  linkKey?: string
  rowClickable?: boolean
  selectable?: boolean
  selected?: ReadonlySet<string>
}>()

const emit = defineEmits<{
  rowClick: [row: Record<string, unknown>]
  toggleRow: [id: string]
}>()

function formatCell(value: unknown, column: SmsToolTableColumn): string {
  if (value === null || value === undefined || value === '') return '—'
  if (column.format === 'boolean') return value ? '是' : '否'
  if (column.format === 'datetime') {
    const date = new Date(String(value))
    return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleString('zh-CN')
  }
  if (column.format === 'number') {
    const n = Number(value)
    return Number.isFinite(n) ? String(n) : String(value)
  }
  return String(value)
}

function rowId(row: Record<string, unknown>): string | null {
  return row.id === null || row.id === undefined ? null : String(row.id)
}

function isSelected(row: Record<string, unknown>): boolean {
  const id = rowId(row)
  return !!id && props.selected?.has(id) === true
}

function linkLabel(row: Record<string, unknown>): string {
  const column = props.table.columns.find(item => item.key === props.linkKey)
  return column ? formatCell(row[column.key], column) : ''
}

const truncated = computed(() => props.table.total > props.table.rows.length)
</script>

<template>
  <div class="mt-2 overflow-hidden rounded-lg border border-default">
    <div class="hidden max-h-72 overflow-auto sm:block">
      <table class="min-w-full border-collapse text-left text-xs">
        <thead class="sticky top-0 bg-elevated">
          <tr>
            <th
              v-if="selectable"
              class="w-8 border-b border-default px-2 py-1.5"
            />
            <th
              v-for="column in table.columns"
              :key="column.key"
              class="whitespace-nowrap border-b border-default px-2.5 py-1.5 font-medium text-toned"
            >
              {{ column.label }}
            </th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="(row, index) in table.rows"
            :key="index"
            class="odd:bg-default even:bg-elevated/40"
            :class="rowClickable ? 'cursor-pointer hover:bg-elevated' : ''"
            @click="rowClickable ? emit('rowClick', row) : undefined"
          >
            <td
              v-if="selectable"
              class="border-b border-default/60 px-2 py-1.5"
              @click.stop
            >
              <input
                v-if="rowId(row)"
                type="checkbox"
                class="size-3.5 rounded border-default"
                :checked="isSelected(row)"
                :aria-label="`选择第 ${index + 1} 行`"
                @change="emit('toggleRow', rowId(row)!)"
              >
            </td>
            <td
              v-for="column in table.columns"
              :key="column.key"
              class="max-w-56 truncate border-b border-default/60 px-2.5 py-1.5 text-highlighted"
              :title="formatCell(row[column.key], column)"
            >
              <button
                v-if="rowClickable && column.key === linkKey"
                type="button"
                class="text-primary hover:underline"
                @click.stop="emit('rowClick', row)"
              >
                {{ formatCell(row[column.key], column) }}
              </button>
              <template v-else>
                {{ formatCell(row[column.key], column) }}
              </template>
            </td>
          </tr>
          <tr v-if="table.rows.length === 0">
            <td
              :colspan="table.columns.length + (selectable ? 1 : 0)"
              class="px-2.5 py-3 text-center text-muted"
            >
              没有匹配的数据
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <!-- Mobile: one card per row with label/value pairs. -->
    <div class="divide-y divide-default sm:hidden">
      <div
        v-for="(row, index) in table.rows"
        :key="index"
        class="flex gap-2 px-2.5 py-2"
      >
        <input
          v-if="selectable && rowId(row)"
          type="checkbox"
          class="mt-0.5 size-3.5 shrink-0 rounded border-default"
          :checked="isSelected(row)"
          :aria-label="`选择第 ${index + 1} 行`"
          @change="emit('toggleRow', rowId(row)!)"
        >
        <div class="min-w-0 flex-1">
          <button
            v-if="rowClickable && linkKey"
            type="button"
            class="text-xs font-medium text-primary hover:underline"
            @click="emit('rowClick', row)"
          >
            {{ linkLabel(row) }}
          </button>
          <dl class="mt-1 grid grid-cols-2 gap-x-3 gap-y-0.5 text-[11px]">
            <template
              v-for="column in table.columns"
              :key="column.key"
            >
              <template v-if="column.key !== linkKey || !rowClickable">
                <dt class="text-muted">
                  {{ column.label }}
                </dt>
                <dd class="truncate text-highlighted">
                  {{ formatCell(row[column.key], column) }}
                </dd>
              </template>
            </template>
          </dl>
        </div>
      </div>
      <p
        v-if="table.rows.length === 0"
        class="px-2.5 py-3 text-center text-xs text-muted"
      >
        没有匹配的数据
      </p>
    </div>

    <p
      v-if="truncated"
      class="border-t border-default bg-elevated px-2.5 py-1 text-[11px] text-muted"
    >
      共 {{ table.total }} 条，仅显示前 {{ table.rows.length }} 条
    </p>
  </div>
</template>
