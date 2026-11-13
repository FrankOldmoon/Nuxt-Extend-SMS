<script setup lang="ts">
import type { SmsToolTable, SmsToolTableColumn } from '../../composables/useSmsChat'

/**
 * Fixed result table for read capabilities. Columns come from the server
 * capability definition, so the layout never depends on model output.
 */
const props = defineProps<{ table: SmsToolTable }>()

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

const truncated = computed(() => props.table.total > props.table.rows.length)
</script>

<template>
  <div class="mt-2 overflow-hidden rounded-lg border border-default">
    <div class="max-h-72 overflow-auto">
      <table class="min-w-full border-collapse text-left text-xs">
        <thead class="sticky top-0 bg-elevated">
          <tr>
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
          >
            <td
              v-for="column in table.columns"
              :key="column.key"
              class="max-w-56 truncate border-b border-default/60 px-2.5 py-1.5 text-highlighted"
              :title="formatCell(row[column.key], column)"
            >
              {{ formatCell(row[column.key], column) }}
            </td>
          </tr>
          <tr v-if="table.rows.length === 0">
            <td
              :colspan="table.columns.length"
              class="px-2.5 py-3 text-center text-muted"
            >
              没有匹配的数据
            </td>
          </tr>
        </tbody>
      </table>
    </div>
    <p
      v-if="truncated"
      class="border-t border-default bg-elevated px-2.5 py-1 text-[11px] text-muted"
    >
      共 {{ table.total }} 条，仅显示前 {{ table.rows.length }} 条
    </p>
  </div>
</template>
