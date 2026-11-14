<script setup lang="ts">
/**
 * Chat component `sms.attendance-roster`.
 *
 * Loads a class roster from the module API and lets permitted users mark the
 * whole class in one batch. The model only supplies class/date/session; rows
 * always come from the server.
 */
type Session = 'full_day' | 'morning' | 'afternoon' | 'period'
type Status = 'present' | 'late' | 'absent' | 'excused' | 'leave'

interface RosterRow {
  studentId: number
  studentName: string
  studentNo: string
  recordId: number | null
  status: string | null
  remark: string | null
}

interface RosterResponse {
  classId: number
  className: string
  date: string
  session: Session
  rows: RosterRow[]
}

const props = defineProps<{
  classId?: number
  date?: string
  session?: Session
}>()

const { can } = useSmsPermission()
const canEdit = computed(() => can('attendance', 'update'))

const STATUS_OPTIONS: Array<{ value: Status, label: string }> = [
  { value: 'present', label: '出勤' },
  { value: 'late', label: '迟到' },
  { value: 'absent', label: '缺勤' },
  { value: 'excused', label: '准假' },
  { value: 'leave', label: '请假' }
]
const SESSION_OPTIONS: Array<{ value: Session, label: string }> = [
  { value: 'full_day', label: '全天' },
  { value: 'morning', label: '上午' },
  { value: 'afternoon', label: '下午' },
  { value: 'period', label: '按节次' }
]

const loading = ref(true)
const error = ref('')
const saving = ref(false)
const notice = ref('')
const roster = ref<RosterResponse | null>(null)
const classId = ref<number | undefined>(props.classId)
const date = ref<string>(props.date ?? new Date().toISOString().slice(0, 10))
const session = ref<Session>(props.session ?? 'full_day')
const drafts = ref<Record<number, Status>>({})
const classes = ref<Array<{ id: number, name: string }>>([])
const classesLoaded = ref(false)

function statusOf(value: unknown): number | undefined {
  if (!value || typeof value !== 'object') return undefined
  const response = (value as { response?: { status?: unknown } }).response
  return typeof response?.status === 'number' ? response.status : undefined
}

function errorMessage(value: unknown): string {
  if (statusOf(value) === 403) return '没有权限操作考勤，请在 Apps 中确认角色权限。'
  if (value && typeof value === 'object') {
    const data = (value as { data?: { message?: unknown } }).data
    if (data && typeof data.message === 'string') return data.message
    const message = (value as { message?: unknown }).message
    if (typeof message === 'string') return message
  }
  return '加载考勤名单失败'
}

async function load(): Promise<void> {
  loading.value = true
  error.value = ''
  notice.value = ''
  try {
    const data = await $fetch<RosterResponse>('/api/modules/sms/attendance/roster', {
      query: { classId: classId.value, date: date.value, session: session.value }
    })
    roster.value = data
    classId.value = data.classId
    const next: Record<number, Status> = {}
    for (const row of data.rows) {
      if (row.status) next[row.studentId] = row.status as Status
    }
    drafts.value = next
  } catch (value) {
    error.value = errorMessage(value)
    roster.value = null
  } finally {
    loading.value = false
  }
}

async function ensureClasses(): Promise<void> {
  if (!canEdit.value || classesLoaded.value) return
  try {
    const response = await $fetch<{ items: Array<{ id: number, name: string }> }>('/api/dashboard/data/classes', {
      query: { pageSize: 100 }
    })
    classes.value = (response.items ?? []).map(item => ({ id: Number(item.id), name: String(item.name) }))
    classesLoaded.value = true
  } catch {
    // Keep the current class; the selector simply stays empty.
  }
}

onMounted(() => {
  void ensureClasses()
  void load()
})
watch([classId, date, session], () => {
  void load()
})

function markAll(status: Status): void {
  if (!roster.value) return
  const next: Record<number, Status> = {}
  for (const row of roster.value.rows) next[row.studentId] = status
  drafts.value = next
}

const pending = computed(() => {
  if (!roster.value) return 0
  return roster.value.rows.filter(row => drafts.value[row.studentId] && drafts.value[row.studentId] !== row.status).length
})

async function save(): Promise<void> {
  if (!roster.value || !canEdit.value) return
  const entries = roster.value.rows
    .filter(row => drafts.value[row.studentId])
    .map(row => ({
      studentId: row.studentId,
      status: drafts.value[row.studentId],
      remark: row.remark ?? undefined
    }))
  if (entries.length === 0) {
    error.value = '请先勾选至少一名学生的考勤状态'
    return
  }
  saving.value = true
  error.value = ''
  try {
    const result = await $fetch<{ created: number, corrected: number }>('/api/modules/sms/attendance/batch', {
      method: 'POST',
      body: { classId: roster.value.classId, date: date.value, session: session.value, entries }
    })
    notice.value = `已保存：新增 ${result.created} 条，更正 ${result.corrected} 条`
    await load()
  } catch (value) {
    error.value = errorMessage(value)
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <div class="mt-2">
    <div class="mb-1.5 flex flex-wrap items-center gap-1.5">
      <select
        v-model.number="classId"
        class="h-7 rounded-md border border-default bg-default px-1.5 text-xs text-toned outline-none focus:border-primary"
        aria-label="班级"
      >
        <option
          v-for="item in classes"
          :key="item.id"
          :value="item.id"
        >
          {{ item.name }}
        </option>
        <option
          v-if="classes.length === 0 && roster"
          :value="roster.classId"
        >
          {{ roster.className }}
        </option>
      </select>
      <input
        v-model="date"
        type="date"
        class="h-7 rounded-md border border-default bg-default px-1.5 text-xs text-toned outline-none focus:border-primary"
        aria-label="考勤日期"
      >
      <select
        v-model="session"
        class="h-7 rounded-md border border-default bg-default px-1.5 text-xs text-toned outline-none focus:border-primary"
        aria-label="考勤时段"
      >
        <option
          v-for="option in SESSION_OPTIONS"
          :key="option.value"
          :value="option.value"
        >
          {{ option.label }}
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
      aria-label="正在加载考勤名单"
    >
      <div
        v-for="n in 4"
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

    <template v-else-if="roster">
      <p class="mb-1 text-[11px] text-muted">
        {{ roster.className }} · {{ roster.date }} · 共 {{ roster.rows.length }} 人
        <span v-if="canEdit"> · 已修改 {{ pending }} 人</span>
      </p>

      <div
        v-if="canEdit"
        class="mb-1.5 flex flex-wrap items-center gap-1.5"
      >
        <UButton
          color="neutral"
          variant="soft"
          size="xs"
          @click="markAll('present')"
        >
          全部出勤
        </UButton>
        <UButton
          color="neutral"
          variant="soft"
          size="xs"
          @click="markAll('absent')"
        >
          全部缺勤
        </UButton>
        <UButton
          color="primary"
          size="xs"
          icon="i-lucide-save"
          :loading="saving"
          @click="save"
        >
          保存考勤
        </UButton>
      </div>

      <p
        v-if="notice"
        class="mb-1 text-[11px] text-emerald-600 dark:text-emerald-400"
      >
        {{ notice }}
      </p>

      <div class="overflow-hidden rounded-lg border border-default">
        <div
          v-for="row in roster.rows"
          :key="row.studentId"
          class="flex items-center gap-2 border-b border-default/60 px-2.5 py-1.5 last:border-b-0"
        >
          <div class="min-w-0 flex-1">
            <p class="truncate text-xs text-highlighted">
              {{ row.studentName }}
              <span class="text-muted">· {{ row.studentNo }}</span>
            </p>
          </div>
          <select
            v-if="canEdit"
            v-model="drafts[row.studentId]"
            class="h-7 rounded-md border border-default bg-default px-1.5 text-xs text-toned outline-none focus:border-primary"
            :aria-label="`${row.studentName} 的考勤状态`"
          >
            <option :value="undefined">
              未记录
            </option>
            <option
              v-for="option in STATUS_OPTIONS"
              :key="option.value"
              :value="option.value"
            >
              {{ option.label }}
            </option>
          </select>
          <span
            v-else
            class="text-xs text-toned"
          >
            {{ STATUS_OPTIONS.find(option => option.value === row.status)?.label ?? '未记录' }}
          </span>
        </div>
      </div>
    </template>
  </div>
</template>
