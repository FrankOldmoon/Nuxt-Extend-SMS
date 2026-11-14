<script setup lang="ts">
/**
 * Chat component `sms.timetable-grid`.
 *
 * Read-only weekly grid; creating/publishing remains in the chat capability so
 * conflict checks always run server-side. The model only supplies filters.
 */
interface Entry {
  id: number
  classId: number
  className: string | null
  subjectName: string | null
  teacherName: string | null
  weekday: number
  periodNo: number
  room: string | null
  status: string
}

const props = defineProps<{
  classId?: number
  termId?: number
  status?: 'draft' | 'published'
}>()

const WEEKDAYS = ['周一', '周二', '周三', '周四', '周五', '周六', '周日']

const loading = ref(true)
const error = ref('')
const entries = ref<Entry[]>([])
const classId = ref<number | undefined>(props.classId)
const termId = ref<number | undefined>(props.termId)
const status = ref<'draft' | 'published' | ''>(props.status ?? '')
const classes = ref<Array<{ id: number, name: string }>>([])

function statusOf(value: unknown): number | undefined {
  if (!value || typeof value !== 'object') return undefined
  const response = (value as { response?: { status?: unknown } }).response
  return typeof response?.status === 'number' ? response.status : undefined
}

function errorMessage(value: unknown): string {
  if (statusOf(value) === 403) return '没有权限查看课表，请在 Apps 中确认角色权限。'
  if (value && typeof value === 'object') {
    const data = (value as { data?: { message?: unknown } }).data
    if (data && typeof data.message === 'string') return data.message
    const message = (value as { message?: unknown }).message
    if (typeof message === 'string') return message
  }
  return '加载课表失败'
}

async function loadClasses(): Promise<void> {
  try {
    const response = await $fetch<{ items: Array<{ id: number, name: string }> }>('/api/dashboard/data/classes', {
      query: { pageSize: 100 }
    })
    classes.value = (response.items ?? []).map(item => ({ id: Number(item.id), name: String(item.name) }))
  } catch {
    // The selector stays hidden; the server still scopes the default view.
  }
}

async function load(): Promise<void> {
  loading.value = true
  error.value = ''
  try {
    const data = await $fetch<Entry[]>('/api/modules/sms/timetable', {
      query: {
        classId: classId.value,
        termId: termId.value,
        status: status.value || undefined,
        limit: 400
      }
    })
    entries.value = Array.isArray(data) ? data : []
  } catch (value) {
    error.value = errorMessage(value)
    entries.value = []
  } finally {
    loading.value = false
  }
}

onMounted(() => {
  void loadClasses()
  void load()
})
watch([classId, termId, status], () => {
  void load()
})

const days = computed(() => {
  const result = WEEKDAYS.map(label => ({
    label,
    slots: [] as Array<{ period: number, entries: Entry[] }>
  }))
  for (const entry of entries.value) {
    const day = result[entry.weekday - 1]
    if (!day) continue
    let slot = day.slots.find(item => item.period === entry.periodNo)
    if (!slot) {
      slot = { period: entry.periodNo, entries: [] }
      day.slots.push(slot)
    }
    slot.entries.push(entry)
  }
  for (const day of result) day.slots.sort((a, b) => a.period - b.period)
  return result
})
</script>

<template>
  <div class="mt-2">
    <div class="mb-1.5 flex flex-wrap items-center gap-1.5">
      <select
        v-if="classes.length > 0"
        v-model.number="classId"
        class="h-7 rounded-md border border-default bg-default px-1.5 text-xs text-toned outline-none focus:border-primary"
        aria-label="班级"
      >
        <option :value="undefined">
          全部可见班级
        </option>
        <option
          v-for="item in classes"
          :key="item.id"
          :value="item.id"
        >
          {{ item.name }}
        </option>
      </select>
      <select
        v-model="status"
        class="h-7 rounded-md border border-default bg-default px-1.5 text-xs text-toned outline-none focus:border-primary"
        aria-label="课表状态"
      >
        <option value="">
          全部状态
        </option>
        <option value="draft">
          草稿
        </option>
        <option value="published">
          已发布
        </option>
      </select>
      <UButton
        color="neutral"
        variant="ghost"
        size="xs"
        icon="i-lucide-refresh-cw"
        :loading="loading"
        @click="load"
      >
        刷新
      </UButton>
    </div>

    <div
      v-if="loading"
      class="space-y-1.5 rounded-lg border border-default p-2"
      aria-busy="true"
      aria-label="正在加载课表"
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
      <button
        type="button"
        class="mt-1 text-primary hover:underline"
        @click="load"
      >
        重试
      </button>
    </div>

    <div
      v-else-if="entries.length === 0"
      class="rounded-lg border border-dashed border-default px-3 py-3 text-center text-xs text-muted"
    >
      暂无课表
    </div>

    <div
      v-else
      class="overflow-hidden rounded-lg border border-default"
    >
      <div
        v-for="day in days"
        :key="day.label"
        class="border-b border-default/60 px-2.5 py-1.5 last:border-b-0"
      >
        <p class="text-[11px] font-medium text-muted">
          {{ day.label }}
        </p>
        <div
          v-for="slot in day.slots"
          :key="`${day.label}-${slot.period}`"
          class="mt-1 flex items-start gap-2 text-xs"
        >
          <span class="w-10 shrink-0 text-muted">第{{ slot.period }}节</span>
          <div class="min-w-0 flex-1">
            <p class="truncate text-highlighted">
              {{ slot.entries.map(entry => entry.className ?? '').filter(Boolean).join('、') }}
            </p>
            <p class="truncate text-muted">
              {{ slot.entries.map(entry => entry.subjectName ?? '未命名课程').join('、') }}
              <span v-if="slot.entries[0]?.teacherName"> · {{ slot.entries[0]?.teacherName }}</span>
              <span v-if="slot.entries[0]?.room"> · {{ slot.entries[0]?.room }}</span>
            </p>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
