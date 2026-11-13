<script setup lang="ts">
import type { SmsToolTable } from '../../composables/useSmsChat'

/**
 * Chat component `sms.student-table`.
 *
 * The model only passes an optional search query; rows are loaded from the
 * permission-checked module API, so the model can never fabricate data.
 */
interface StudentRow {
  id: number
  name: string
  studentNo: string
  classId: number | null
}

const props = defineProps<{
  query?: string
  limit?: number
}>()

const students = ref<StudentRow[]>([])
const loading = ref(true)
const error = ref('')

function errorMessage(value: unknown): string {
  if (value && typeof value === 'object') {
    const data = (value as { data?: { message?: unknown } }).data
    if (data && typeof data.message === 'string') return data.message
    const message = (value as { message?: unknown }).message
    if (typeof message === 'string') return message
  }
  return '加载学生失败'
}

async function load(): Promise<void> {
  loading.value = true
  error.value = ''
  try {
    const rows = await $fetch<StudentRow[]>('/api/modules/sms/students', {
      query: { q: props.query ?? '' }
    })
    students.value = Array.isArray(rows) ? rows : []
  } catch (value) {
    error.value = errorMessage(value)
    students.value = []
  } finally {
    loading.value = false
  }
}

onMounted(load)
watch(() => props.query, load)

const table = computed<SmsToolTable>(() => {
  const limit = Math.min(Math.max(props.limit ?? 20, 1), 100)
  return {
    columns: [
      { key: 'name', label: '姓名' },
      { key: 'studentNo', label: '学号' },
      { key: 'classId', label: '班级 ID', format: 'number' }
    ],
    rows: students.value.slice(0, limit) as unknown as Array<Record<string, unknown>>,
    total: students.value.length
  }
})
</script>

<template>
  <div class="mt-2">
    <p
      v-if="loading"
      class="flex items-center gap-1.5 text-xs text-muted"
    >
      <UIcon
        name="i-lucide-loader-circle"
        class="size-3.5 animate-spin"
      />
      正在加载学生…
    </p>
    <p
      v-else-if="error"
      class="rounded-lg bg-red-50 px-2.5 py-1.5 text-xs text-red-700 dark:bg-red-950/40 dark:text-red-300"
    >
      {{ error }}
    </p>
    <SmsResultTable
      v-else
      :table="table"
    />
  </div>
</template>
