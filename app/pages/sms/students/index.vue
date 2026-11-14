<script setup lang="ts">
definePageMeta({ middleware: 'auth', layout: 'sms' })

interface StudentRow {
  id: number
  name: string
  studentNo: string
  status: string
  classId: number | null
  className: string | null
}

const STATUS_META: Record<string, { label: string, color: 'success' | 'warning' | 'error' | 'neutral' }> = {
  active: { label: '在读', color: 'success' },
  suspended: { label: '休学', color: 'warning' },
  transferred: { label: '已转出', color: 'neutral' },
  graduated: { label: '已毕业', color: 'neutral' }
}

interface ClassRow {
  id: number
  name: string
}

useHead({ title: 'SMS 学生管理' })

const route = useRoute()
const PAGE_SIZE = 50

const search = ref(typeof route.query.q === 'string' ? route.query.q : '')
const classId = ref('')
const childId = ref<number | null>(null)
const classes = ref<ClassRow[]>([])
const rows = ref<StudentRow[]>([])
const cursor = ref<number | null>(null)
const hasMore = ref(false)
const loading = ref(false)
const initialized = ref(false)
const error = ref('')
const selected = ref<number[]>([])

const classOptions = computed(() => [
  { label: '全部班级', value: '' },
  ...classes.value.map(item => ({ label: item.name, value: String(item.id) }))
])

const selectedIds = computed(() => new Set(selected.value))
const allSelected = computed(() => rows.value.length > 0 && rows.value.every(row => selectedIds.value.has(row.id)))

function csvCell(value: string): string {
  const guarded = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value
  return /[",\n]/.test(guarded) ? `"${guarded.replace(/"/g, '""')}"` : guarded
}

async function loadClasses(): Promise<void> {
  try {
    classes.value = await $fetch<ClassRow[]>('/api/modules/sms/classes', { query: { limit: 200 } })
  } catch {
    classes.value = []
  }
}

async function load(reset = false): Promise<void> {
  if (loading.value) return
  loading.value = true
  error.value = ''
  try {
    if (reset) {
      cursor.value = null
      rows.value = []
      selected.value = []
    }
    const data = await $fetch<StudentRow[]>('/api/modules/sms/students', {
      query: {
        q: search.value.trim() || undefined,
        classId: classId.value || undefined,
        studentId: childId.value ?? undefined,
        cursor: cursor.value ?? undefined,
        limit: PAGE_SIZE
      }
    })
    rows.value = reset ? data : [...rows.value, ...data]
    cursor.value = data.length > 0 ? data[data.length - 1]!.id : null
    hasMore.value = data.length === PAGE_SIZE
  } catch (err) {
    error.value = err instanceof Error ? err.message : '学生列表加载失败'
  } finally {
    loading.value = false
    initialized.value = true
  }
}

function toggleAll(): void {
  selected.value = allSelected.value ? [] : rows.value.map(row => row.id)
}

function toggle(id: number): void {
  selected.value = selectedIds.value.has(id)
    ? selected.value.filter(item => item !== id)
    : [...selected.value, id]
}

function exportCsv(): void {
  const exportRows = selected.value.length > 0
    ? rows.value.filter(row => selectedIds.value.has(row.id))
    : rows.value
  if (exportRows.length === 0) return
  const header = 'id,name,studentNo,status,className'
  const body = exportRows.map(row => [
    String(row.id),
    row.name,
    row.studentNo,
    row.status,
    row.className ?? ''
  ].map(csvCell).join(','))
  const blob = new Blob([`\uFEFF${[header, ...body].join('\n')}`], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = `students-${new Date().toISOString().slice(0, 10)}.csv`
  link.click()
  URL.revokeObjectURL(url)
}

let debounce: ReturnType<typeof setTimeout> | null = null
watch(search, () => {
  if (debounce) clearTimeout(debounce)
  debounce = setTimeout(() => void load(true), 300)
})
watch(classId, () => void load(true))
watch(childId, () => void load(true))

onMounted(async () => {
  await loadClasses()
  await load(true)
})
onBeforeUnmount(() => {
  if (debounce) clearTimeout(debounce)
})
</script>

<template>
  <div class="min-h-0 flex-1 overflow-y-auto p-4">
    <div class="mx-auto max-w-5xl space-y-4">
      <header class="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 class="text-lg font-semibold text-highlighted">
            学生管理
          </h1>
          <p class="mt-1 text-xs text-muted">
            名单按你的班级/监护人范围返回；已选 {{ selected.length }} 人。
          </p>
        </div>
        <div class="flex items-center gap-2">
          <UButton
            size="xs"
            variant="soft"
            icon="i-lucide-download"
            :disabled="rows.length === 0"
            @click="exportCsv()"
          >
            导出 CSV
          </UButton>
          <UButton
            size="xs"
            variant="ghost"
            icon="i-lucide-refresh-cw"
            :loading="loading"
            @click="load(true)"
          >
            刷新
          </UButton>
          <UButton
            size="xs"
            variant="soft"
            icon="i-lucide-upload"
            to="/sms/students/import"
          >
            批量导入
          </UButton>
          <UButton
            size="xs"
            variant="soft"
            icon="i-lucide-arrow-left-right"
            to="/sms/students/movements"
          >
            学籍异动
          </UButton>
        </div>
      </header>

      <div class="flex flex-wrap items-center gap-2">
        <UInput
          v-model="search"
          icon="i-lucide-search"
          placeholder="搜索姓名或学号"
          class="w-64"
        />
        <USelect
          v-model="classId"
          :items="classOptions"
          value-key="value"
          class="w-44"
        />
        <SmsChildSwitcher v-model="childId" />
      </div>

      <p
        v-if="error"
        class="rounded-lg border border-error/40 bg-error/10 p-3 text-xs text-error"
      >
        {{ error }}
      </p>

      <div
        v-if="!initialized || (loading && rows.length === 0)"
        class="space-y-2"
      >
        <div
          v-for="index in 6"
          :key="index"
          class="h-12 animate-pulse rounded-lg border border-default bg-elevated/60"
        />
      </div>

      <p
        v-else-if="rows.length === 0"
        class="rounded-xl border border-default bg-default p-6 text-center text-sm text-muted"
      >
        没有符合条件的学生
      </p>

      <div
        v-else
        class="overflow-hidden rounded-xl border border-default"
      >
        <table class="w-full text-left text-sm">
          <thead class="bg-elevated/50 text-xs text-muted">
            <tr>
              <th class="w-10 px-3 py-2">
                <input
                  type="checkbox"
                  :checked="allSelected"
                  aria-label="全选"
                  @change="toggleAll"
                >
              </th>
              <th class="px-3 py-2">
                姓名
              </th>
              <th class="px-3 py-2">
                学号
              </th>
              <th class="px-3 py-2">
                班级
              </th>
              <th class="px-3 py-2">
                状态
              </th>
              <th class="px-3 py-2 text-right">
                操作
              </th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="row in rows"
              :key="row.id"
              class="border-t border-default"
              :class="selectedIds.has(row.id) ? 'bg-primary/5' : ''"
            >
              <td class="px-3 py-2">
                <input
                  type="checkbox"
                  :checked="selectedIds.has(row.id)"
                  :aria-label="`选择 ${row.name}`"
                  @change="toggle(row.id)"
                >
              </td>
              <td class="px-3 py-2 text-highlighted">
                {{ row.name }}
              </td>
              <td class="px-3 py-2 font-mono text-xs text-toned">
                {{ row.studentNo }}
              </td>
              <td class="px-3 py-2 text-toned">
                {{ row.className ?? '未分班' }}
              </td>
              <td class="px-3 py-2">
                <UBadge
                  :color="STATUS_META[row.status]?.color ?? 'neutral'"
                  variant="soft"
                  size="sm"
                >
                  {{ STATUS_META[row.status]?.label ?? row.status }}
                </UBadge>
              </td>
              <td class="px-3 py-2 text-right">
                <UButton
                  size="xs"
                  variant="ghost"
                  :to="`/sms/students/movements?studentId=${row.id}`"
                >
                  异动
                </UButton>
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <div
        v-if="hasMore"
        class="flex justify-center"
      >
        <UButton
          size="xs"
          variant="soft"
          :loading="loading"
          @click="load(false)"
        >
          加载更多
        </UButton>
      </div>
    </div>
  </div>
</template>
