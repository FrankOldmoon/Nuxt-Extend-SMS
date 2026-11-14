<script setup lang="ts">
import type { SmsRecordField, SmsRecordFieldOption } from '../../composables/useSmsRecord'
import type { SmsToolTable } from '../../composables/useSmsChat'
import { exportSmsRowsCsv } from '../../composables/useSmsRecord'

/**
 * Chat component `sms.student-table`.
 *
 * Rows come from the permission-checked module API; the model can only pass a
 * search query and a page size. The table adds search, sorting, paging,
 * selection/CSV export, and a detail dialog with permission-gated editing.
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

const { can } = useSmsPermission()
const canEdit = computed(() => can('students', 'update'))

const students = ref<StudentRow[]>([])
const loading = ref(true)
const error = ref('')
const search = ref(props.query ?? '')
const sortKey = ref<'name' | 'studentNo'>('name')
const sortAsc = ref(true)
const page = ref(1)
const selectedIds = ref<Set<string>>(new Set())
const classes = ref<Array<{ id: number, name: string }>>([])
const classesLoaded = ref(false)

const pageSize = computed(() => Math.min(Math.max(props.limit ?? 10, 5), 100))

function statusOf(value: unknown): number | undefined {
  if (!value || typeof value !== 'object') return undefined
  const direct = (value as { statusCode?: unknown, status?: unknown }).statusCode
  if (typeof direct === 'number') return direct
  const status = (value as { status?: unknown }).status
  if (typeof status === 'number') return status
  const response = (value as { response?: { status?: unknown } }).response
  return typeof response?.status === 'number' ? response.status : undefined
}

function errorMessage(value: unknown): string {
  if (statusOf(value) === 403) return '没有权限查看学生名单，请在 Apps 中确认角色权限。'
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
      query: { q: search.value.trim() }
    })
    students.value = Array.isArray(rows) ? rows : []
    page.value = 1
    selectedIds.value = new Set()
  } catch (value) {
    error.value = errorMessage(value)
    students.value = []
  } finally {
    loading.value = false
  }
}

onMounted(load)
watch(() => props.query, (value) => {
  search.value = value ?? ''
  void load()
})

let searchTimer: ReturnType<typeof setTimeout> | undefined
watch(search, () => {
  if (searchTimer) clearTimeout(searchTimer)
  searchTimer = setTimeout(() => {
    void load()
  }, 300)
})
onBeforeUnmount(() => {
  if (searchTimer) clearTimeout(searchTimer)
})

const sorted = computed(() => {
  const rows = [...students.value]
  rows.sort((a, b) => {
    const left = String(a[sortKey.value] ?? '')
    const right = String(b[sortKey.value] ?? '')
    const result = left.localeCompare(right, 'zh-CN')
    return sortAsc.value ? result : -result
  })
  return rows
})

const total = computed(() => sorted.value.length)
const pageCount = computed(() => Math.max(1, Math.ceil(total.value / pageSize.value)))
const paged = computed(() => sorted.value.slice((page.value - 1) * pageSize.value, page.value * pageSize.value))

watch([pageSize, total], () => {
  if (page.value > pageCount.value) page.value = pageCount.value
})

const table = computed<SmsToolTable>(() => ({
  columns: [
    { key: 'name', label: '姓名' },
    { key: 'studentNo', label: '学号' },
    { key: 'classId', label: '班级 ID', format: 'number' }
  ],
  rows: paged.value as unknown as Array<Record<string, unknown>>,
  total: total.value
}))

const selectedRows = computed(() => students.value.filter(row => selectedIds.value.has(String(row.id))))

function toggleRow(id: string): void {
  const next = new Set(selectedIds.value)
  if (next.has(id)) next.delete(id)
  else next.add(id)
  selectedIds.value = next
}

function exportSelected(): void {
  if (selectedRows.value.length === 0) return
  exportSmsRowsCsv(
    `students-${new Date().toISOString().slice(0, 10)}.csv`,
    table.value.columns,
    selectedRows.value as unknown as Array<Record<string, unknown>>
  )
}

/** Class names are only needed for the dialog; missing permission falls back to IDs. */
async function ensureClasses(): Promise<void> {
  if (!canEdit.value || classesLoaded.value) return
  try {
    const response = await $fetch<{ items: Array<{ id: number, name: string }> }>('/api/dashboard/data/classes', {
      query: { pageSize: 100 }
    })
    classes.value = (response.items ?? []).map(item => ({ id: Number(item.id), name: String(item.name) }))
    classesLoaded.value = true
  } catch {
    // Keep ID-only display when the viewer cannot read classes.
  }
}

const {
  dialogOpen,
  selected,
  detailLoading,
  detailError,
  saving,
  open: openRecord,
  save: saveRecord
} = useChatRecord({
  table: 'students',
  fallbackError: '加载学生详情失败',
  onSaved: (item) => {
    const index = students.value.findIndex(row => String(row.id) === String(item.id))
    if (index < 0) return
    students.value[index] = {
      ...students.value[index]!,
      name: String(item.name ?? ''),
      studentNo: String(item.studentNo ?? ''),
      classId: typeof item.classId === 'number' ? item.classId : null
    }
  }
})

const classOptions = computed<SmsRecordFieldOption[]>(() => {
  const options: SmsRecordFieldOption[] = [{ label: '未分班', value: null }]
  const current = selected.value?.classId
  if (typeof current === 'number' && !classes.value.some(item => item.id === current)) {
    options.push({ label: `班级 #${current}`, value: current })
  }
  for (const item of classes.value) options.push({ label: item.name, value: item.id })
  return options
})

const detailFields = computed<SmsRecordField[]>(() => [
  { key: 'name', label: '姓名', required: true },
  { key: 'studentNo', label: '学号', required: true },
  { key: 'classId', label: '班级', type: 'select', options: classOptions.value },
  { key: 'userId', label: '用户 ID', type: 'number', editable: false, mask: true }
])

function openDetail(row: StudentRow): void {
  void ensureClasses()
  void openRecord(row.id)
}

function handleRowClick(row: Record<string, unknown>): void {
  openDetail(row as unknown as StudentRow)
}
</script>

<template>
  <div class="mt-2">
    <div class="mb-1.5 flex flex-wrap items-center gap-1.5">
      <input
        v-model="search"
        type="search"
        placeholder="搜索姓名或学号"
        class="h-7 min-w-0 flex-1 rounded-md border border-default bg-default px-2 text-xs text-highlighted outline-none focus:border-primary"
      >
      <select
        v-model="sortKey"
        class="h-7 rounded-md border border-default bg-default px-1.5 text-xs text-toned outline-none focus:border-primary"
        aria-label="排序字段"
      >
        <option value="name">
          按姓名
        </option>
        <option value="studentNo">
          按学号
        </option>
      </select>
      <UButton
        color="neutral"
        variant="ghost"
        size="xs"
        :icon="sortAsc ? 'i-lucide-arrow-up-a-z' : 'i-lucide-arrow-down-z-a'"
        :aria-label="sortAsc ? '升序' : '降序'"
        @click="sortAsc = !sortAsc"
      />
      <UButton
        v-if="selectedRows.length"
        color="neutral"
        variant="soft"
        size="xs"
        icon="i-lucide-file-down"
        @click="exportSelected"
      >
        导出 {{ selectedRows.length }}
      </UButton>
    </div>

    <div
      v-if="loading"
      class="space-y-1.5 rounded-lg border border-default p-2"
      aria-busy="true"
      aria-label="正在加载学生"
    >
      <div
        v-for="n in 3"
        :key="n"
        class="h-4 animate-pulse rounded bg-elevated"
      />
    </div>

    <div
      v-else-if="error"
      class="rounded-lg bg-red-50 px-2.5 py-1.5 text-xs text-red-700 dark:bg-red-950/40 dark:text-red-300"
    >
      <p>{{ error }}</p>
      <div class="mt-1 flex gap-2">
        <button
          type="button"
          class="text-primary hover:underline"
          @click="load"
        >
          重试
        </button>
        <NuxtLink
          to="/dashboard/students"
          class="text-primary hover:underline"
        >
          在 Apps 中打开
        </NuxtLink>
      </div>
    </div>

    <template v-else>
      <SmsResultTable
        :table="table"
        link-key="name"
        row-clickable
        selectable
        :selected="selectedIds"
        @row-click="handleRowClick"
        @toggle-row="toggleRow"
      />
      <div
        v-if="pageCount > 1"
        class="mt-1.5 flex items-center justify-between text-[11px] text-muted"
      >
        <span>第 {{ page }} / {{ pageCount }} 页 · 共 {{ total }} 条</span>
        <div class="flex gap-1">
          <UButton
            color="neutral"
            variant="ghost"
            size="xs"
            :disabled="page <= 1"
            @click="page -= 1"
          >
            上一页
          </UButton>
          <UButton
            color="neutral"
            variant="ghost"
            size="xs"
            :disabled="page >= pageCount"
            @click="page += 1"
          >
            下一页
          </UButton>
        </div>
      </div>
    </template>

    <SmsRecordDialog
      v-model:open="dialogOpen"
      :title="`学生详情 · ${selected?.name ?? ''}`"
      :record="selected"
      :fields="detailFields"
      :loading="detailLoading"
      :can-edit="canEdit"
      :saving="saving"
      :error="detailError"
      @save="saveRecord"
    />
  </div>
</template>
