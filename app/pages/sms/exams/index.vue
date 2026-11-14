<script setup lang="ts">
definePageMeta({ middleware: 'auth', layout: 'sms' })

interface ExamRow {
  id: number
  name: string
  examType: string
  examDate: string
  fullScore: number
  status: string
  classId: number
  className: string | null
  subjectId: number | null
  subjectName: string | null
  termId: number | null
  termName: string | null
}

interface SessionRow {
  id: number
  examId: number
  examName: string | null
  examDate: string
  classId: number
  className: string | null
  subjectName: string | null
  room: string
  startsAt: string
  endsAt: string
  invigilatorUserId: number
  invigilatorName: string | null
  assistantInvigilatorUserId: number | null
  assistantInvigilatorName: string | null
  status: string
}

interface ClassRow { id: number, name: string }
interface SubjectRow { id: number, code: string, name: string }
interface TermRow { id: number, name: string, startDate: string, endDate: string }
interface TeacherRow { userId: number, name: string | null }

const EXAM_TYPES = [
  { label: '平时', value: 'regular' },
  { label: '期中', value: 'midterm' },
  { label: '期末', value: 'final' },
  { label: '小测', value: 'quiz' },
  { label: '其他', value: 'other' }
]
const EXAM_STATUS_LABELS: Record<string, string> = {
  draft: '草稿',
  published: '已发布',
  closed: '已归档'
}
const CONFLICT_LABELS: Record<string, string> = {
  exam: '同一考试时段',
  room: '考场时段',
  invigilator: '监考教师时段'
}

useHead({ title: 'SMS 考试编排' })

const terms = ref<TermRow[]>([])
const classes = ref<ClassRow[]>([])
const subjects = ref<SubjectRow[]>([])
const teachers = ref<TeacherRow[]>([])

const termId = ref('')
const classId = ref('')
const status = ref('')
const exams = ref<ExamRow[]>([])
const sessions = ref<SessionRow[]>([])
const loading = ref(false)
const saving = ref(false)
const error = ref('')
const message = ref('')

const examForm = reactive({
  name: '',
  classId: '',
  subjectId: '',
  termId: '',
  examType: 'regular',
  examDate: '',
  fullScore: '100'
})

const sessionForm = reactive({
  examId: '',
  room: '',
  startsAt: '',
  endsAt: '',
  invigilatorUserId: '',
  assistantInvigilatorUserId: ''
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
const examOptions = computed(() => exams.value.map(exam => ({
  label: `${exam.examDate} · ${exam.className ?? ''} ${exam.name}`.trim(),
  value: String(exam.id)
})))

function pad(value: number): string {
  return String(value).padStart(2, '0')
}

function localDate(date = new Date()): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

function formatTime(value: string): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleString('zh-CN', { hour12: false })
}

function toIso(value: string): string | undefined {
  if (!value) return undefined
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString()
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
  if (termRows.length > 0 && !termId.value) {
    termId.value = String(termRows[termRows.length - 1]!.id)
  }
  if (!examForm.examDate) examForm.examDate = localDate()
}

async function loadExams(): Promise<void> {
  loading.value = true
  error.value = ''
  try {
    exams.value = await $fetch<ExamRow[]>('/api/modules/sms/exams', {
      query: {
        termId: termId.value || undefined,
        classId: classId.value || undefined,
        status: status.value || undefined,
        limit: 200
      }
    })
  } catch (value) {
    error.value = errorText(value)
    exams.value = []
  } finally {
    loading.value = false
  }
}

async function loadSessions(): Promise<void> {
  try {
    sessions.value = await $fetch<SessionRow[]>('/api/modules/sms/exams/sessions', {
      query: {
        classId: classId.value || undefined,
        status: 'scheduled',
        limit: 200
      }
    })
  } catch {
    sessions.value = []
  }
}

async function createExam(): Promise<void> {
  error.value = ''
  message.value = ''
  if (!examForm.name.trim()) {
    error.value = '请填写考试名称'
    return
  }
  if (!examForm.classId) {
    error.value = '请选择班级'
    return
  }
  saving.value = true
  try {
    await $fetch('/api/modules/sms/exams', {
      method: 'POST',
      body: {
        name: examForm.name.trim(),
        classId: Number(examForm.classId),
        subjectId: examForm.subjectId ? Number(examForm.subjectId) : undefined,
        termId: (examForm.termId || termId.value) ? Number(examForm.termId || termId.value) : undefined,
        examType: examForm.examType,
        examDate: examForm.examDate,
        fullScore: Number(examForm.fullScore) || 100
      }
    })
    message.value = '考试已创建，可继续登记考场与监考'
    examForm.name = ''
    await loadExams()
  } catch (value) {
    error.value = errorText(value)
  } finally {
    saving.value = false
  }
}

async function createSession(): Promise<void> {
  error.value = ''
  message.value = ''
  if (!sessionForm.examId) {
    error.value = '请选择考试'
    return
  }
  if (!sessionForm.room.trim()) {
    error.value = '请填写考场'
    return
  }
  const startsAt = toIso(sessionForm.startsAt)
  const endsAt = toIso(sessionForm.endsAt)
  if (!startsAt || !endsAt) {
    error.value = '请填写完整的开始与结束时间'
    return
  }
  if (!sessionForm.invigilatorUserId) {
    error.value = '请选择主监考教师'
    return
  }
  saving.value = true
  try {
    await $fetch('/api/modules/sms/exams/sessions', {
      method: 'POST',
      body: {
        examId: Number(sessionForm.examId),
        room: sessionForm.room.trim(),
        startsAt,
        endsAt,
        invigilatorUserId: Number(sessionForm.invigilatorUserId),
        assistantInvigilatorUserId: sessionForm.assistantInvigilatorUserId
          ? Number(sessionForm.assistantInvigilatorUserId)
          : undefined
      }
    })
    message.value = '考场与监考已登记'
    sessionForm.room = ''
    await loadSessions()
  } catch (value) {
    error.value = errorText(value)
  } finally {
    saving.value = false
  }
}

async function cancelSession(row: SessionRow): Promise<void> {
  error.value = ''
  message.value = ''
  try {
    await $fetch('/api/modules/sms/exams/sessions/cancel', {
      method: 'POST',
      body: { sessionId: row.id }
    })
    message.value = '已取消该场次'
    await loadSessions()
  } catch (value) {
    error.value = errorText(value)
  }
}

watch([termId, classId, status], () => {
  void loadExams()
  void loadSessions()
})

watch(() => sessionForm.examId, () => {
  const exam = exams.value.find(item => String(item.id) === sessionForm.examId)
  if (!exam) return
  sessionForm.startsAt = `${exam.examDate}T09:00`
  sessionForm.endsAt = `${exam.examDate}T11:00`
})

onMounted(async () => {
  await loadOptions()
  await Promise.all([loadExams(), loadSessions()])
})
</script>

<template>
  <div class="min-h-0 flex-1 overflow-y-auto p-4">
    <div class="mx-auto max-w-6xl space-y-4">
      <header class="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 class="text-lg font-semibold text-highlighted">
            考试编排
          </h1>
          <p class="mt-1 text-xs text-muted">
            维护考试、考场与监考教师；同一考场或监考教师在重叠时段会被拒绝。
          </p>
        </div>
        <UButton
          size="xs"
          variant="ghost"
          icon="i-lucide-refresh-cw"
          :loading="loading"
          @click="loadExams()"
        >
          刷新
        </UButton>
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
              :items="[{ label: '全部学期', value: '' }, ...termOptions]"
              value-key="value"
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
                { label: '已发布', value: 'published' },
                { label: '已归档', value: 'closed' }
              ]"
              value-key="value"
            />
          </label>
        </div>
      </section>

      <section class="space-y-2">
        <h2 class="text-sm font-medium text-highlighted">
          考试列表
        </h2>
        <div
          v-if="loading && exams.length === 0"
          class="space-y-2"
        >
          <div
            v-for="index in 4"
            :key="index"
            class="h-12 animate-pulse rounded-lg border border-default bg-elevated/60"
          />
        </div>
        <p
          v-else-if="exams.length === 0"
          class="rounded-xl border border-default bg-default p-6 text-center text-sm text-muted"
        >
          当前筛选条件下暂无考试
        </p>
        <div
          v-else
          class="overflow-x-auto rounded-xl border border-default"
        >
          <table class="w-full text-left text-sm">
            <thead class="bg-elevated/50 text-xs text-muted">
              <tr>
                <th class="px-3 py-2">
                  考试
                </th>
                <th class="px-3 py-2">
                  班级 / 科目
                </th>
                <th class="px-3 py-2">
                  日期
                </th>
                <th class="px-3 py-2">
                  类型
                </th>
                <th class="px-3 py-2">
                  满分
                </th>
                <th class="px-3 py-2">
                  状态
                </th>
              </tr>
            </thead>
            <tbody>
              <tr
                v-for="exam in exams"
                :key="exam.id"
                class="border-t border-default"
              >
                <td class="px-3 py-2">
                  <p class="text-highlighted">
                    {{ exam.name }}
                  </p>
                  <p class="text-xs text-muted">
                    {{ exam.termName ?? '未关联学期' }}
                  </p>
                </td>
                <td class="px-3 py-2 text-toned">
                  {{ exam.className ?? `#${exam.classId}` }}
                  <span v-if="exam.subjectName"> · {{ exam.subjectName }}</span>
                </td>
                <td class="px-3 py-2 text-xs text-toned">
                  {{ exam.examDate }}
                </td>
                <td class="px-3 py-2 text-xs text-toned">
                  {{ EXAM_TYPES.find(item => item.value === exam.examType)?.label ?? exam.examType }}
                </td>
                <td class="px-3 py-2 text-xs text-toned">
                  {{ exam.fullScore }}
                </td>
                <td class="px-3 py-2">
                  <UBadge
                    :color="exam.status === 'published' ? 'success' : exam.status === 'closed' ? 'neutral' : 'warning'"
                    variant="soft"
                    size="sm"
                  >
                    {{ EXAM_STATUS_LABELS[exam.status] ?? exam.status }}
                  </UBadge>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      <section class="space-y-3 rounded-xl border border-default bg-default p-4">
        <h2 class="text-sm font-medium text-highlighted">
          新建考试
        </h2>
        <div class="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <label class="space-y-1 text-xs text-muted">
            <span>名称 *</span>
            <UInput
              v-model="examForm.name"
              placeholder="例如 2026 春季期中考试"
              class="w-full"
            />
          </label>
          <label class="space-y-1 text-xs text-muted">
            <span>班级 *</span>
            <USelect
              v-model="examForm.classId"
              :items="classOptions"
              value-key="value"
              placeholder="选择班级"
            />
          </label>
          <label class="space-y-1 text-xs text-muted">
            <span>科目</span>
            <USelect
              v-model="examForm.subjectId"
              :items="subjectOptions"
              value-key="value"
              placeholder="选择科目"
            />
          </label>
          <label class="space-y-1 text-xs text-muted">
            <span>学期</span>
            <USelect
              v-model="examForm.termId"
              :items="[{ label: '沿用当前筛选学期', value: '' }, ...termOptions]"
              value-key="value"
            />
          </label>
          <label class="space-y-1 text-xs text-muted">
            <span>类型</span>
            <USelect
              v-model="examForm.examType"
              :items="EXAM_TYPES"
              value-key="value"
            />
          </label>
          <label class="space-y-1 text-xs text-muted">
            <span>考试日期 *</span>
            <UInput
              v-model="examForm.examDate"
              type="date"
              class="w-full"
            />
          </label>
          <label class="space-y-1 text-xs text-muted">
            <span>满分</span>
            <UInput
              v-model="examForm.fullScore"
              type="number"
              min="1"
              class="w-full"
            />
          </label>
          <div class="flex items-end">
            <UButton
              class="w-full"
              :loading="saving"
              icon="i-lucide-plus"
              @click="createExam()"
            >
              创建考试
            </UButton>
          </div>
        </div>
      </section>

      <section class="space-y-3 rounded-xl border border-default bg-default p-4">
        <h2 class="text-sm font-medium text-highlighted">
          考场与监考
        </h2>
        <div class="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <label class="space-y-1 text-xs text-muted">
            <span>考试 *</span>
            <USelect
              v-model="sessionForm.examId"
              :items="examOptions"
              value-key="value"
              placeholder="选择考试"
            />
          </label>
          <label class="space-y-1 text-xs text-muted">
            <span>考场 *</span>
            <UInput
              v-model="sessionForm.room"
              placeholder="例如 A101"
              class="w-full"
            />
          </label>
          <label class="space-y-1 text-xs text-muted">
            <span>开始时间 *</span>
            <UInput
              v-model="sessionForm.startsAt"
              type="datetime-local"
              class="w-full"
            />
          </label>
          <label class="space-y-1 text-xs text-muted">
            <span>结束时间 *</span>
            <UInput
              v-model="sessionForm.endsAt"
              type="datetime-local"
              class="w-full"
            />
          </label>
          <label class="space-y-1 text-xs text-muted">
            <span>主监考 *</span>
            <USelect
              v-model="sessionForm.invigilatorUserId"
              :items="teacherOptions"
              value-key="value"
              placeholder="选择教师"
            />
          </label>
          <label class="space-y-1 text-xs text-muted">
            <span>辅助监考</span>
            <USelect
              v-model="sessionForm.assistantInvigilatorUserId"
              :items="teacherOptions"
              value-key="value"
              placeholder="可选"
            />
          </label>
          <div class="flex items-end sm:col-span-2">
            <UButton
              class="w-full sm:w-auto"
              :loading="saving"
              icon="i-lucide-calendar-plus"
              @click="createSession()"
            >
              登记场次
            </UButton>
          </div>
        </div>

        <div
          v-if="sessions.length === 0"
          class="rounded-lg border border-dashed border-default px-3 py-4 text-center text-xs text-muted"
        >
          暂无待执行的考试场次
        </div>
        <div
          v-else
          class="overflow-x-auto rounded-lg border border-default"
        >
          <table class="w-full text-left text-sm">
            <thead class="bg-elevated/50 text-xs text-muted">
              <tr>
                <th class="px-3 py-2">
                  时间
                </th>
                <th class="px-3 py-2">
                  考试
                </th>
                <th class="px-3 py-2">
                  考场
                </th>
                <th class="px-3 py-2">
                  监考
                </th>
                <th class="px-3 py-2">
                  操作
                </th>
              </tr>
            </thead>
            <tbody>
              <tr
                v-for="row in sessions"
                :key="row.id"
                class="border-t border-default"
              >
                <td class="px-3 py-2 text-xs text-toned">
                  <p>{{ formatTime(row.startsAt) }}</p>
                  <p class="text-muted">
                    至 {{ formatTime(row.endsAt) }}
                  </p>
                </td>
                <td class="px-3 py-2">
                  <p class="text-highlighted">
                    {{ row.examName ?? `#${row.examId}` }}
                  </p>
                  <p class="text-xs text-muted">
                    {{ row.className ?? `#${row.classId}` }}
                    <span v-if="row.subjectName"> · {{ row.subjectName }}</span>
                  </p>
                </td>
                <td class="px-3 py-2 text-toned">
                  {{ row.room }}
                </td>
                <td class="px-3 py-2 text-xs text-toned">
                  <p>{{ row.invigilatorName ?? `#${row.invigilatorUserId}` }}</p>
                  <p
                    v-if="row.assistantInvigilatorName"
                    class="text-muted"
                  >
                    辅助：{{ row.assistantInvigilatorName }}
                  </p>
                </td>
                <td class="px-3 py-2">
                  <UButton
                    size="xs"
                    color="error"
                    variant="ghost"
                    icon="i-lucide-x"
                    @click="cancelSession(row)"
                  >
                    取消
                  </UButton>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>
    </div>
  </div>
</template>
