<script setup lang="ts">
definePageMeta({ middleware: 'auth', layout: 'sms' })

interface StudentOption {
  id: number
  name: string
  studentNo: string
  status: string
  className: string | null
}

interface ClassRow {
  id: number
  name: string
}

interface MovementRow {
  id: number
  studentId: number
  studentName: string | null
  studentNo: string | null
  type: string
  fromClassName: string | null
  toClassName: string | null
  effectiveDate: string
  reason: string | null
  createdAt: string
}

const STATUS_LABELS: Record<string, string> = {
  active: '在读',
  suspended: '休学',
  transferred: '已转出',
  graduated: '已毕业'
}

const TYPE_META: Record<string, { label: string, color: 'primary' | 'warning' | 'error' | 'neutral' | 'success' }> = {
  transfer_in: { label: '转入', color: 'success' },
  transfer_out: { label: '转出', color: 'neutral' },
  suspend: { label: '休学', color: 'warning' },
  resume: { label: '复学', color: 'primary' },
  graduate: { label: '毕业', color: 'success' }
}

const TRANSITIONS: Record<string, string[]> = {
  active: ['suspend', 'transfer_out', 'graduate'],
  suspended: ['resume', 'transfer_out'],
  transferred: ['transfer_in'],
  graduated: []
}

const route = useRoute()
useHead({ title: 'SMS 学籍异动' })

const studentQuery = ref('')
const studentResults = ref<StudentOption[]>([])
const selectedStudent = ref<StudentOption | null>(null)
const classes = ref<ClassRow[]>([])
const movements = ref<MovementRow[]>([])
const type = ref('')
const toClassId = ref('')
const effectiveDate = ref(new Date(Date.now() + 8 * 3_600_000).toISOString().slice(0, 10))
const reason = ref('')
const loading = ref(false)
const submitting = ref(false)
const error = ref('')
const message = ref('')

const classOptions = computed(() => classes.value.map(item => ({ label: item.name, value: String(item.id) })))
const typeOptions = computed(() => {
  const allowed = selectedStudent.value ? TRANSITIONS[selectedStudent.value.status] ?? [] : Object.keys(TYPE_META)
  return allowed.map(value => ({ label: TYPE_META[value]?.label ?? value, value }))
})

let debounce: ReturnType<typeof setTimeout> | null = null
watch(studentQuery, () => {
  if (debounce) clearTimeout(debounce)
  const text = studentQuery.value.trim()
  if (!text) {
    studentResults.value = []
    return
  }
  debounce = setTimeout(() => void searchStudents(text), 250)
})

async function searchStudents(text: string): Promise<void> {
  try {
    studentResults.value = await $fetch<StudentOption[]>('/api/modules/sms/students', {
      query: { q: text, limit: 8 }
    })
  } catch {
    studentResults.value = []
  }
}

function chooseStudent(student: StudentOption): void {
  selectedStudent.value = student
  studentQuery.value = ''
  studentResults.value = []
  type.value = TRANSITIONS[student.status]?.[0] ?? ''
  void loadMovements(student.id)
}

function clearStudent(): void {
  selectedStudent.value = null
  type.value = ''
  void loadMovements()
}

async function loadClasses(): Promise<void> {
  try {
    classes.value = await $fetch<ClassRow[]>('/api/modules/sms/classes', { query: { limit: 200 } })
  } catch {
    classes.value = []
  }
}

async function loadMovements(studentId?: number): Promise<void> {
  loading.value = true
  error.value = ''
  try {
    movements.value = await $fetch<MovementRow[]>('/api/modules/sms/students/movements', {
      query: { studentId, limit: 100 }
    })
  } catch (err) {
    error.value = err instanceof Error ? err.message : '异动记录加载失败'
  } finally {
    loading.value = false
  }
}

async function submit(): Promise<void> {
  error.value = ''
  message.value = ''
  if (!selectedStudent.value) {
    error.value = '请先选择学生'
    return
  }
  if (!type.value) {
    error.value = '请选择异动类型'
    return
  }
  if (type.value === 'transfer_in' && !toClassId.value) {
    error.value = '转入必须选择目标班级'
    return
  }
  submitting.value = true
  try {
    const result = await $fetch<{ studentId: number, status: string, movementId: number }>(
      '/api/modules/sms/students/movements',
      {
        method: 'POST',
        body: {
          studentId: selectedStudent.value.id,
          type: type.value,
          toClassId: type.value === 'transfer_in' ? Number(toClassId.value) : undefined,
          effectiveDate: effectiveDate.value,
          reason: reason.value || undefined
        }
      }
    )
    message.value = `异动已登记（#${result.movementId}），当前状态：${STATUS_LABELS[result.status] ?? result.status}`
    selectedStudent.value = { ...selectedStudent.value, status: result.status, className: type.value === 'transfer_in' ? classes.value.find(item => String(item.id) === toClassId.value)?.name ?? selectedStudent.value.className : selectedStudent.value.className }
    type.value = TRANSITIONS[result.status]?.[0] ?? ''
    reason.value = ''
    await loadMovements(result.studentId)
  } catch (err) {
    error.value = err instanceof Error ? err.message : '异动登记失败'
  } finally {
    submitting.value = false
  }
}

onMounted(async () => {
  await loadClasses()
  const initialId = Number(route.query.studentId)
  if (Number.isSafeInteger(initialId) && initialId > 0) {
    try {
      const [student] = await $fetch<StudentOption[]>('/api/modules/sms/students', {
        query: { studentId: initialId, limit: 1 }
      })
      if (student) chooseStudent(student)
    } catch {
      // 回填失败时退回全部流水。
    }
  }
  if (!selectedStudent.value) await loadMovements()
})
onBeforeUnmount(() => {
  if (debounce) clearTimeout(debounce)
})
</script>

<template>
  <div class="min-h-0 flex-1 overflow-y-auto p-4">
    <div class="mx-auto max-w-4xl space-y-4">
      <header class="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 class="text-lg font-semibold text-highlighted">
            学籍异动
          </h1>
          <p class="mt-1 text-xs text-muted">
            转入、转出、休学、复学、毕业都会写入不可覆盖的异动流水。
          </p>
        </div>
        <UButton
          size="xs"
          variant="ghost"
          icon="i-lucide-arrow-left"
          to="/sms/students"
        >
          返回学生列表
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
        <div class="relative">
          <div
            v-if="selectedStudent"
            class="flex flex-wrap items-center gap-2 rounded-lg border border-primary/40 bg-primary/5 p-2"
          >
            <div class="min-w-0 flex-1">
              <p class="text-sm text-highlighted">
                {{ selectedStudent.name }}
                <span class="ml-1 font-mono text-xs text-muted">{{ selectedStudent.studentNo }}</span>
              </p>
              <p class="mt-0.5 text-xs text-muted">
                {{ selectedStudent.className ?? '未分班' }} ·
                {{ STATUS_LABELS[selectedStudent.status] ?? selectedStudent.status }}
              </p>
            </div>
            <UButton
              size="xs"
              variant="ghost"
              @click="clearStudent()"
            >
              重新选择
            </UButton>
          </div>
          <UInput
            v-else
            v-model="studentQuery"
            icon="i-lucide-search"
            placeholder="搜索学生姓名或学号"
            class="w-full"
          />
          <ul
            v-if="!selectedStudent && studentResults.length > 0"
            class="absolute z-20 mt-1 max-h-56 w-full overflow-y-auto rounded-lg border border-default bg-default shadow-lg"
          >
            <li
              v-for="student in studentResults"
              :key="student.id"
            >
              <button
                type="button"
                class="flex w-full items-center justify-between px-3 py-2 text-left text-xs hover:bg-elevated"
                @click="chooseStudent(student)"
              >
                <span>
                  <span class="text-sm text-highlighted">{{ student.name }}</span>
                  <span class="ml-2 font-mono text-muted">{{ student.studentNo }}</span>
                </span>
                <span class="text-muted">{{ STATUS_LABELS[student.status] ?? student.status }}</span>
              </button>
            </li>
          </ul>
        </div>

        <div
          v-if="selectedStudent"
          class="grid gap-3 sm:grid-cols-2"
        >
          <label class="space-y-1 text-xs text-muted">
            <span>异动类型</span>
            <USelect
              v-model="type"
              :items="typeOptions"
              value-key="value"
              placeholder="选择类型"
            />
          </label>
          <label class="space-y-1 text-xs text-muted">
            <span>生效日期</span>
            <UInput
              v-model="effectiveDate"
              type="date"
            />
          </label>
          <label
            v-if="type === 'transfer_in'"
            class="space-y-1 text-xs text-muted"
          >
            <span>目标班级</span>
            <USelect
              v-model="toClassId"
              :items="classOptions"
              value-key="value"
              placeholder="选择班级"
            />
          </label>
          <label class="space-y-1 text-xs text-muted sm:col-span-2">
            <span>原因/备注</span>
            <UInput
              v-model="reason"
              placeholder="可选，最多 500 字"
            />
          </label>
        </div>

        <div
          v-if="selectedStudent"
          class="flex items-center gap-2"
        >
          <UButton
            :loading="submitting"
            :disabled="typeOptions.length === 0"
            @click="submit()"
          >
            登记异动
          </UButton>
          <span
            v-if="typeOptions.length === 0"
            class="text-xs text-muted"
          >
            该学生当前状态没有可执行的异动
          </span>
        </div>
        <p
          v-else
          class="text-xs text-muted"
        >
          先搜索并选择一名学生，再进行异动登记。
        </p>
      </section>

      <section class="space-y-2">
        <div class="flex items-center justify-between">
          <h2 class="text-sm font-medium text-highlighted">
            异动记录
          </h2>
          <UButton
            size="xs"
            variant="ghost"
            icon="i-lucide-refresh-cw"
            :loading="loading"
            @click="loadMovements(selectedStudent?.id)"
          >
            刷新
          </UButton>
        </div>

        <div
          v-if="loading && movements.length === 0"
          class="space-y-2"
        >
          <div
            v-for="index in 4"
            :key="index"
            class="h-12 animate-pulse rounded-lg border border-default bg-elevated/60"
          />
        </div>

        <p
          v-else-if="movements.length === 0"
          class="rounded-xl border border-default bg-default p-6 text-center text-sm text-muted"
        >
          暂无学籍异动记录
        </p>

        <div
          v-else
          class="overflow-x-auto rounded-xl border border-default"
        >
          <table class="w-full text-left text-sm">
            <thead class="bg-elevated/50 text-xs text-muted">
              <tr>
                <th class="px-3 py-2">
                  学生
                </th>
                <th class="px-3 py-2">
                  类型
                </th>
                <th class="px-3 py-2">
                  班级变化
                </th>
                <th class="px-3 py-2">
                  生效日期
                </th>
                <th class="px-3 py-2">
                  原因
                </th>
              </tr>
            </thead>
            <tbody>
              <tr
                v-for="row in movements"
                :key="row.id"
                class="border-t border-default"
              >
                <td class="px-3 py-2">
                  <p class="text-highlighted">
                    {{ row.studentName ?? `#${row.studentId}` }}
                  </p>
                  <p class="font-mono text-xs text-muted">
                    {{ row.studentNo ?? '—' }}
                  </p>
                </td>
                <td class="px-3 py-2">
                  <UBadge
                    :color="TYPE_META[row.type]?.color ?? 'neutral'"
                    variant="soft"
                    size="sm"
                  >
                    {{ TYPE_META[row.type]?.label ?? row.type }}
                  </UBadge>
                </td>
                <td class="px-3 py-2 text-xs text-toned">
                  {{ row.fromClassName ?? '—' }}
                  <span class="mx-1 text-muted">→</span>
                  {{ row.toClassName ?? '—' }}
                </td>
                <td class="px-3 py-2 text-xs text-toned">
                  {{ row.effectiveDate }}
                </td>
                <td class="max-w-48 truncate px-3 py-2 text-xs text-muted">
                  {{ row.reason ?? '—' }}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>
    </div>
  </div>
</template>
