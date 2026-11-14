<script setup lang="ts">
definePageMeta({ middleware: 'auth', layout: 'sms' })

interface EntryRow {
  id: number
  termId: number | null
  termName: string | null
  classId: number
  className: string | null
  subjectId: number | null
  subjectName: string | null
  teacherUserId: number | null
  teacherName: string | null
  weekday: number
  periodNo: number
  room: string | null
  status: string
}

interface SubstitutionRow {
  id: number
  entryId: number
  date: string
  type: string
  classId: number
  className: string | null
  subjectName: string | null
  weekday: number
  periodNo: number
  teacherName: string | null
  substituteUserId: number | null
  substituteName: string | null
  room: string | null
  reason: string | null
  createdAt: string
}

interface ClassRow { id: number, name: string }
interface SubjectRow { id: number, code: string, name: string }
interface TermRow { id: number, name: string, startDate: string, endDate: string }
interface TeacherRow { userId: number, name: string | null }

const WEEKDAYS = ['周一', '周二', '周三', '周四', '周五', '周六', '周日']
const CONFLICT_LABELS: Record<string, string> = {
  class: '班级时段',
  teacher: '教师时段',
  room: '教室时段',
  duplicate: '重复登记'
}

useHead({ title: 'SMS 课表编排' })

const terms = ref<TermRow[]>([])
const classes = ref<ClassRow[]>([])
const subjects = ref<SubjectRow[]>([])
const teachers = ref<TeacherRow[]>([])

const termId = ref('')
const classId = ref('')
const status = ref('')
const childId = ref<number | null>(null)
const entries = ref<EntryRow[]>([])
const substitutions = ref<SubstitutionRow[]>([])
const loading = ref(false)
const saving = ref(false)
const publishing = ref(false)
const error = ref('')
const message = ref('')

const form = reactive({
  termId: '',
  classId: '',
  subjectId: '',
  teacherUserId: '',
  weekday: '1',
  periodNo: '1',
  room: ''
})

const sub = reactive({
  entryId: '',
  date: '',
  type: 'substitute',
  substituteUserId: '',
  room: '',
  reason: ''
})

const termOptions = computed(() => terms.value.map(term => ({
  label: `${term.name}（${term.startDate} ~ ${term.endDate}）`,
  value: String(term.id)
})))
const classOptions = computed(() => classes.value.map(item => ({ label: item.name, value: String(item.id) })))
const subjectOptions = computed(() => subjects.value.map(item => ({ label: `${item.name}（${item.code}）`, value: String(item.id) })))
const teacherOptions = computed(() => teachers.value.map(item => ({
  label: item.name ?? `用户 #${item.userId}`,
  value: String(item.userId)
})))
const weekdayOptions = WEEKDAYS.map((label, index) => ({ label, value: String(index + 1) }))
const periodOptions = Array.from({ length: 12 }, (_, index) => ({ label: `第 ${index + 1} 节`, value: String(index + 1) }))
const typeOptions = [
  { label: '代课', value: 'substitute' },
  { label: '调课', value: 'reschedule' }
]

const entryOptions = computed(() => entries.value.map(entry => ({
  label: `${WEEKDAYS[entry.weekday - 1]} 第${entry.periodNo}节 · ${entry.className ?? '未命名班级'} ${entry.subjectName ?? ''}`.trim(),
  value: String(entry.id)
})))

const periodRows = computed(() => {
  const used = entries.value.map(entry => entry.periodNo)
  const max = Math.min(12, Math.max(8, ...used))
  return Array.from({ length: max }, (_, index) => index + 1)
})

function pad(value: number): string {
  return String(value).padStart(2, '0')
}

function localDate(date = new Date()): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

/** 取下一次该星期的日期，作为代课默认生效日。 */
function nextDateForWeekday(weekday: number): string {
  const now = new Date()
  const current = now.getDay() === 0 ? 7 : now.getDay()
  const diff = (weekday - current + 7) % 7
  return localDate(new Date(now.getFullYear(), now.getMonth(), now.getDate() + diff))
}

function cellEntries(weekday: number, period: number): EntryRow[] {
  return entries.value.filter(entry => entry.weekday === weekday && entry.periodNo === period)
}

function errorText(value: unknown): string {
  let raw = ''
  if (value && typeof value === 'object') {
    const data = (value as { data?: { message?: unknown } }).data
    if (data && typeof data.message === 'string') raw = data.message
    else {
      const direct = (value as { message?: unknown }).message
      if (typeof direct === 'string') raw = direct
    }
  }
  if (!raw) return '操作失败，请稍后重试'
  const conflict = /conflict: (.+)$/.exec(raw)
  if (conflict?.[1]) {
    return `冲突：${conflict[1].split(',').map(item => CONFLICT_LABELS[item.trim()] ?? item.trim()).join('、')}`
  }
  return raw
}

async function loadOptions(): Promise<void> {
  const [termRows, classRows, subjectRows, teacherPage] = await Promise.all([
    $fetch<TermRow[]>('/api/modules/sms/terms', { query: { limit: 100 } }).catch(() => []),
    $fetch<ClassRow[]>('/api/modules/sms/classes', { query: { limit: 200 } }).catch(() => []),
    $fetch<SubjectRow[]>('/api/modules/sms/subjects', { query: { limit: 200 } }).catch(() => []),
    $fetch<{ items: TeacherRow[] }>('/api/dashboard/data/teachers', { query: { pageSize: 100 } }).catch(() => ({ items: [] }))
  ])
  terms.value = termRows
  classes.value = classRows
  subjects.value = subjectRows
  teachers.value = Array.isArray(teacherPage.items) ? teacherPage.items : []
  if (!termId.value && termRows.length > 0) {
    termId.value = String(termRows[termRows.length - 1]!.id)
    form.termId = termId.value
  }
}

async function loadEntries(): Promise<void> {
  loading.value = true
  error.value = ''
  try {
    entries.value = await $fetch<EntryRow[]>('/api/modules/sms/timetable', {
      query: {
        termId: termId.value || undefined,
        classId: classId.value || undefined,
        studentId: childId.value ?? undefined,
        status: status.value || undefined,
        limit: 400
      }
    })
  } catch (value) {
    error.value = errorText(value)
    entries.value = []
  } finally {
    loading.value = false
  }
}

async function loadSubstitutions(): Promise<void> {
  try {
    substitutions.value = await $fetch<SubstitutionRow[]>('/api/modules/sms/timetable/substitutions', {
      query: {
        classId: classId.value || undefined,
        limit: 100
      }
    })
  } catch {
    substitutions.value = []
  }
}

async function addEntry(): Promise<void> {
  error.value = ''
  message.value = ''
  if (!form.classId) {
    error.value = '请选择班级'
    return
  }
  saving.value = true
  try {
    await $fetch('/api/modules/sms/timetable', {
      method: 'POST',
      body: {
        termId: form.termId ? Number(form.termId) : undefined,
        classId: Number(form.classId),
        subjectId: form.subjectId ? Number(form.subjectId) : undefined,
        teacherUserId: form.teacherUserId ? Number(form.teacherUserId) : undefined,
        weekday: Number(form.weekday),
        periodNo: Number(form.periodNo),
        room: form.room.trim() || undefined
      }
    })
    message.value = '已新增课表条目；发布后学生与家长可见。'
    await loadEntries()
    await loadSubstitutions()
  } catch (value) {
    error.value = errorText(value)
  } finally {
    saving.value = false
  }
}

async function publish(): Promise<void> {
  error.value = ''
  message.value = ''
  publishing.value = true
  try {
    const result = await $fetch<{ published: number }>('/api/modules/sms/timetable/publish', {
      method: 'POST',
      body: {
        termId: termId.value ? Number(termId.value) : undefined,
        classId: classId.value ? Number(classId.value) : undefined
      }
    })
    message.value = `已发布 ${result.published} 条课表`
    await loadEntries()
  } catch (value) {
    error.value = errorText(value)
  } finally {
    publishing.value = false
  }
}

async function createSubstitution(): Promise<void> {
  error.value = ''
  message.value = ''
  if (!sub.entryId) {
    error.value = '请选择要调整的课表条目'
    return
  }
  if (!sub.date) {
    error.value = '请选择生效日期'
    return
  }
  if (sub.type === 'substitute' && !sub.substituteUserId) {
    error.value = '代课必须选择代课教师'
    return
  }
  saving.value = true
  try {
    await $fetch('/api/modules/sms/timetable/substitutions', {
      method: 'POST',
      body: {
        entryId: Number(sub.entryId),
        date: sub.date,
        type: sub.type,
        substituteUserId: sub.substituteUserId ? Number(sub.substituteUserId) : undefined,
        room: sub.room.trim() || undefined,
        reason: sub.reason.trim() || undefined
      }
    })
    message.value = '已登记调课/代课记录'
    sub.room = ''
    sub.reason = ''
    await loadSubstitutions()
  } catch (value) {
    error.value = errorText(value)
  } finally {
    saving.value = false
  }
}

watch([termId, classId, status], () => {
  void loadEntries()
  void loadSubstitutions()
})
watch(childId, () => void loadEntries())

watch(() => sub.entryId, () => {
  const entry = entries.value.find(item => String(item.id) === sub.entryId)
  if (entry) sub.date = nextDateForWeekday(entry.weekday)
})

onMounted(async () => {
  await loadOptions()
  if (!sub.date) sub.date = localDate()
  await Promise.all([loadEntries(), loadSubstitutions()])
})
</script>

<template>
  <div class="min-h-0 flex-1 overflow-y-auto p-4">
    <div class="mx-auto max-w-6xl space-y-4">
      <header class="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 class="text-lg font-semibold text-highlighted">
            课表编排
          </h1>
          <p class="mt-1 text-xs text-muted">
            同一学期内自动校验班级、教师、教室时间冲突；草案发布后学生与家长可见。
          </p>
        </div>
        <div class="flex items-center gap-2">
          <UButton
            size="xs"
            variant="ghost"
            icon="i-lucide-refresh-cw"
            :loading="loading"
            @click="loadEntries()"
          >
            刷新
          </UButton>
          <UButton
            size="xs"
            icon="i-lucide-upload"
            :loading="publishing"
            @click="publish()"
          >
            发布课表
          </UButton>
        </div>
      </header>

      <p
        v-if="error"
        class="rounded-lg border border-error/40 bg-error/10 p-3 text-xs text-error"
      >
        {{ error }}
      </p>
      <p
        v-if="message"
        class="rounded-lg border border-success/40 bg-success/10 p-3 text-xs text-success"
      >
        {{ message }}
      </p>

      <section class="space-y-3 rounded-xl border border-default bg-default p-4">
        <div class="grid gap-3 sm:grid-cols-3">
          <label class="space-y-1 text-xs text-muted">
            <span>学期</span>
            <USelect
              v-model="termId"
              :items="termOptions"
              value-key="value"
              placeholder="选择学期"
            />
          </label>
          <label class="space-y-1 text-xs text-muted">
            <span>班级</span>
            <USelect
              v-model="classId"
              :items="[{ label: '全部可见班级', value: '' }, ...classOptions]"
              value-key="value"
            />
          </label>
          <label class="space-y-1 text-xs text-muted">
            <span>状态</span>
            <USelect
              v-model="status"
              :items="[
                { label: '全部状态', value: '' },
                { label: '草稿', value: 'draft' },
                { label: '已发布', value: 'published' }
              ]"
              value-key="value"
            />
          </label>
        </div>
        <SmsChildSwitcher v-model="childId" />
      </section>

      <section class="space-y-2">
        <h2 class="text-sm font-medium text-highlighted">
          周课表
        </h2>
        <div
          v-if="loading && entries.length === 0"
          class="space-y-2"
        >
          <div
            v-for="index in 4"
            :key="index"
            class="h-14 animate-pulse rounded-lg border border-default bg-elevated/60"
          />
        </div>
        <p
          v-else-if="entries.length === 0"
          class="rounded-xl border border-default bg-default p-6 text-center text-sm text-muted"
        >
          当前筛选条件下暂无课表
        </p>
        <div
          v-else
          class="overflow-x-auto rounded-xl border border-default"
        >
          <table class="w-full min-w-[720px] text-left text-xs">
            <thead class="bg-elevated/50 text-muted">
              <tr>
                <th class="w-16 px-2 py-2 font-medium">
                  节次
                </th>
                <th
                  v-for="label in WEEKDAYS"
                  :key="label"
                  class="px-2 py-2 font-medium"
                >
                  {{ label }}
                </th>
              </tr>
            </thead>
            <tbody>
              <tr
                v-for="period in periodRows"
                :key="period"
                class="border-t border-default align-top"
              >
                <td class="px-2 py-2 text-muted">
                  第{{ period }}节
                </td>
                <td
                  v-for="weekday in 7"
                  :key="`${weekday}-${period}`"
                  class="min-w-[96px] px-2 py-2"
                >
                  <div
                    v-for="entry in cellEntries(weekday, period)"
                    :key="entry.id"
                    class="rounded-md border px-2 py-1"
                    :class="entry.status === 'published' ? 'border-success/30 bg-success/5' : 'border-default bg-elevated/40'"
                  >
                    <p class="truncate font-medium text-highlighted">
                      {{ entry.subjectName ?? entry.className ?? '未命名课程' }}
                    </p>
                    <p class="truncate text-[11px] text-muted">
                      {{ entry.className ?? '未分班' }}
                      <span v-if="entry.teacherName"> · {{ entry.teacherName }}</span>
                      <span v-if="entry.room"> · {{ entry.room }}</span>
                    </p>
                  </div>
                  <span
                    v-if="cellEntries(weekday, period).length === 0"
                    class="text-[11px] text-muted/60"
                  >—</span>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      <section class="space-y-3 rounded-xl border border-default bg-default p-4">
        <h2 class="text-sm font-medium text-highlighted">
          新增课表条目
        </h2>
        <div class="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <label class="space-y-1 text-xs text-muted">
            <span>学期</span>
            <USelect
              v-model="form.termId"
              :items="termOptions"
              value-key="value"
              placeholder="选择学期"
            />
          </label>
          <label class="space-y-1 text-xs text-muted">
            <span>班级 *</span>
            <USelect
              v-model="form.classId"
              :items="classOptions"
              value-key="value"
              placeholder="选择班级"
            />
          </label>
          <label class="space-y-1 text-xs text-muted">
            <span>科目</span>
            <USelect
              v-model="form.subjectId"
              :items="subjectOptions"
              value-key="value"
              placeholder="选择科目"
            />
          </label>
          <label class="space-y-1 text-xs text-muted">
            <span>任课教师</span>
            <USelect
              v-model="form.teacherUserId"
              :items="teacherOptions"
              value-key="value"
              placeholder="选择教师"
            />
          </label>
          <label class="space-y-1 text-xs text-muted">
            <span>星期</span>
            <USelect
              v-model="form.weekday"
              :items="weekdayOptions"
              value-key="value"
            />
          </label>
          <label class="space-y-1 text-xs text-muted">
            <span>节次</span>
            <USelect
              v-model="form.periodNo"
              :items="periodOptions"
              value-key="value"
            />
          </label>
          <label class="space-y-1 text-xs text-muted">
            <span>教室</span>
            <UInput
              v-model="form.room"
              placeholder="例如 A101"
              class="w-full"
            />
          </label>
          <div class="flex items-end">
            <UButton
              class="w-full"
              :loading="saving"
              icon="i-lucide-plus"
              @click="addEntry()"
            >
              新增课程
            </UButton>
          </div>
        </div>
      </section>

      <section class="space-y-3 rounded-xl border border-default bg-default p-4">
        <div class="flex flex-wrap items-center justify-between gap-2">
          <h2 class="text-sm font-medium text-highlighted">
            调课 / 代课登记
          </h2>
          <span class="text-xs text-muted">
            冲突校验：同一时段代课教师不可重复
          </span>
        </div>
        <div class="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <label class="space-y-1 text-xs text-muted">
            <span>课表条目 *</span>
            <USelect
              v-model="sub.entryId"
              :items="entryOptions"
              value-key="value"
              placeholder="选择课程"
            />
          </label>
          <label class="space-y-1 text-xs text-muted">
            <span>生效日期 *</span>
            <UInput
              v-model="sub.date"
              type="date"
              class="w-full"
            />
          </label>
          <label class="space-y-1 text-xs text-muted">
            <span>类型</span>
            <USelect
              v-model="sub.type"
              :items="typeOptions"
              value-key="value"
            />
          </label>
          <label class="space-y-1 text-xs text-muted">
            <span>代课教师</span>
            <USelect
              v-model="sub.substituteUserId"
              :items="teacherOptions"
              value-key="value"
              placeholder="选择代课教师"
            />
          </label>
          <label class="space-y-1 text-xs text-muted">
            <span>调整教室</span>
            <UInput
              v-model="sub.room"
              placeholder="留空沿用原教室"
              class="w-full"
            />
          </label>
          <label class="space-y-1 text-xs text-muted sm:col-span-2">
            <span>原因</span>
            <UInput
              v-model="sub.reason"
              placeholder="例如 教师公出"
              class="w-full"
            />
          </label>
          <div class="flex items-end">
            <UButton
              class="w-full"
              :loading="saving"
              icon="i-lucide-calendar-clock"
              @click="createSubstitution()"
            >
              登记
            </UButton>
          </div>
        </div>

        <div
          v-if="substitutions.length === 0"
          class="rounded-lg border border-dashed border-default px-3 py-4 text-center text-xs text-muted"
        >
          暂无调课/代课记录
        </div>
        <div
          v-else
          class="overflow-x-auto rounded-lg border border-default"
        >
          <table class="w-full text-left text-sm">
            <thead class="bg-elevated/50 text-xs text-muted">
              <tr>
                <th class="px-3 py-2">
                  日期
                </th>
                <th class="px-3 py-2">
                  课程
                </th>
                <th class="px-3 py-2">
                  类型
                </th>
                <th class="px-3 py-2">
                  原教师
                </th>
                <th class="px-3 py-2">
                  代课教师
                </th>
                <th class="px-3 py-2">
                  教室
                </th>
                <th class="px-3 py-2">
                  原因
                </th>
              </tr>
            </thead>
            <tbody>
              <tr
                v-for="row in substitutions"
                :key="row.id"
                class="border-t border-default"
              >
                <td class="px-3 py-2 text-xs text-toned">
                  {{ row.date }}
                </td>
                <td class="px-3 py-2">
                  <p class="text-highlighted">
                    {{ row.className ?? `#${row.classId}` }} · {{ row.subjectName ?? '未命名课程' }}
                  </p>
                  <p class="text-xs text-muted">
                    {{ WEEKDAYS[row.weekday - 1] }} 第{{ row.periodNo }}节
                  </p>
                </td>
                <td class="px-3 py-2">
                  <UBadge
                    :color="row.type === 'substitute' ? 'primary' : 'warning'"
                    variant="soft"
                    size="sm"
                  >
                    {{ row.type === 'substitute' ? '代课' : '调课' }}
                  </UBadge>
                </td>
                <td class="px-3 py-2 text-xs text-toned">
                  {{ row.teacherName ?? '—' }}
                </td>
                <td class="px-3 py-2 text-xs text-toned">
                  {{ row.substituteName ?? '—' }}
                </td>
                <td class="px-3 py-2 text-xs text-toned">
                  {{ row.room ?? '沿用原教室' }}
                </td>
                <td class="max-w-[180px] px-3 py-2 text-xs text-muted">
                  <span class="line-clamp-2">{{ row.reason ?? '—' }}</span>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>
    </div>
  </div>
</template>
