<script setup lang="ts">
import type { SmsRecordField } from '../../composables/useSmsRecord'
import type { SmsToolTable } from '../../composables/useSmsChat'
import { exportSmsRowsCsv } from '../../composables/useSmsRecord'

/**
 * Chat component `sms.teacher-table`.
 *
 * Rows come from the permission-checked generic CRUD API, which supports
 * server-side search, sorting and pagination. The model only supplies a query;
 * clicking a name opens the detail dialog, with inline editing for
 * `sms.teachers.update`.
 */
interface TeacherRow {
  id: number
  userId: number
  name: string | null
  employeeNo: string | null
}

interface TeacherPage {
  items: TeacherRow[]
  pagination: { page: number, pageSize: number, total: number, totalPages: number }
}

const props = defineProps<{
  query?: string
  limit?: number
}>()

const { can } = useSmsPermission()
const canEdit = computed(() => can('teachers', 'update'))

const teachers = ref<TeacherRow[]>([])
const loading = ref(true)
const error = ref('')
const search = ref(props.query ?? '')
const sortKey = ref<'name' | 'employeeNo'>('name')
const sortAsc = ref(true)
const page = ref(1)
const total = ref(0)
const pageCount = ref(1)
const selectedIds = ref<Set<string>>(new Set())

const pageSize = computed(() => Math.min(Math.max(props.limit ?? 10, 5), 100))

function statusOf(value: unknown): number | undefined {
  if (!value || typeof value !== 'object') return undefined
  const direct = (value as { statusCode?: unknown }).statusCode
  if (typeof direct === 'number') return direct
  const status = (value as { status?: unknown }).status
  if (typeof status === 'number') return status
  const response = (value as { response?: { status?: unknown } }).response
  return typeof response?.status === 'number' ? response.status : undefined
}

function errorMessage(value: unknown): string {
  if (statusOf(value) === 403) return '没有权限查看教师名单，请在 Apps 中确认角色权限。'
  if (value && typeof value === 'object') {
    const data = (value as { data?: { message?: unknown } }).data
    if (data && typeof data.message === 'string') return data.message
    const message = (value as { message?: unknown }).message
    if (typeof message === 'string') return message
  }
  return '加载教师失败'
}

async function load(): Promise<void> {
  loading.value = true
  error.value = ''
  try {
    const clean = search.value.trim()
    const response = await $fetch<TeacherPage>('/api/dashboard/data/teachers', {
      query: {
        page: page.value,
        pageSize: pageSize.value,
        sort: sortKey.value,
        order: sortAsc.value ? 'asc' : 'desc',
        ...(clean ? { search: clean } : {})
      }
    })
    teachers.value = Array.isArray(response.items) ? response.items : []
    total.value = response.pagination?.total ?? teachers.value.length
    pageCount.value = response.pagination?.totalPages ?? Math.max(1, Math.ceil(total.value / pageSize.value))
  } catch (value) {
    error.value = errorMessage(value)
    teachers.value = []
    total.value = 0
    pageCount.value = 1
  } finally {
    loading.value = false
  }
}

onMounted(load)
watch(() => props.query, (value) => {
  search.value = value ?? ''
  page.value = 1
  void load()
})

let searchTimer: ReturnType<typeof setTimeout> | undefined
watch(search, () => {
  if (searchTimer) clearTimeout(searchTimer)
  searchTimer = setTimeout(() => {
    page.value = 1
    void load()
  }, 300)
})
onBeforeUnmount(() => {
  if (searchTimer) clearTimeout(searchTimer)
})

watch([sortKey, sortAsc], () => {
  page.value = 1
  void load()
})

function goPage(next: number): void {
  if (next < 1 || next > pageCount.value) return
  page.value = next
  void load()
}

const table = computed<SmsToolTable>(() => ({
  columns: [
    { key: 'name', label: '姓名' },
    { key: 'employeeNo', label: '工号' },
    { key: 'userId', label: '用户 ID', format: 'number' }
  ],
  rows: teachers.value as unknown as Array<Record<string, unknown>>,
  total: total.value
}))

const selectedRows = computed(() => teachers.value.filter(row => selectedIds.value.has(String(row.id))))

function toggleRow(id: string): void {
  const next = new Set(selectedIds.value)
  if (next.has(id)) next.delete(id)
  else next.add(id)
  selectedIds.value = next
}

function exportSelected(): void {
  if (selectedRows.value.length === 0) return
  exportSmsRowsCsv(
    `teachers-${new Date().toISOString().slice(0, 10)}.csv`,
    table.value.columns,
    selectedRows.value as unknown as Array<Record<string, unknown>>
  )
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
  table: 'teachers',
  fallbackError: '加载教师详情失败',
  onSaved: (item) => {
    const index = teachers.value.findIndex(row => String(row.id) === String(item.id))
    if (index < 0) return
    teachers.value[index] = {
      ...teachers.value[index]!,
      name: typeof item.name === 'string' ? item.name : null,
      employeeNo: typeof item.employeeNo === 'string' ? item.employeeNo : null
    }
  }
})

const detailFields = computed<SmsRecordField[]>(() => [
  { key: 'name', label: '姓名' },
  { key: 'employeeNo', label: '工号' },
  { key: 'userId', label: '用户 ID', type: 'number', editable: false, mask: true }
])

function handleRowClick(row: Record<string, unknown>): void {
  void openRecord(Number(row.id))
}
</script>

<template>
  <div class="mt-2">
    <div class="mb-1.5 flex flex-wrap items-center gap-1.5">
      <input
        v-model="search"
        type="search"
        placeholder="搜索姓名或工号"
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
        <option value="employeeNo">
          按工号
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
      aria-label="正在加载教师"
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
          to="/dashboard/teachers"
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
            @click="goPage(page - 1)"
          >
            上一页
          </UButton>
          <UButton
            color="neutral"
            variant="ghost"
            size="xs"
            :disabled="page >= pageCount"
            @click="goPage(page + 1)"
          >
            下一页
          </UButton>
        </div>
      </div>
    </template>

    <SmsRecordDialog
      v-model:open="dialogOpen"
      :title="`教师详情 · ${selected?.name ?? ''}`"
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
