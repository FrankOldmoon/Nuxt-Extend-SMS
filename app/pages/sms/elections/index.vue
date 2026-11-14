<script setup lang="ts">
definePageMeta({ middleware: 'auth', layout: 'sms' })

interface StudentOption {
  id: number
  name: string
  studentNo: string
  className: string | null
  status: string
}

interface TermRow {
  id: number
  name: string
  startDate: string
  endDate: string
}

interface SubjectRow {
  id: number
  code: string
  name: string
  capacity: number | null
}

interface ElectionRow {
  id: number
  studentId: number
  studentName: string | null
  studentNo: string | null
  subjectId: number
  subjectName: string | null
  subjectCapacity: number | null
  termId: number
  termName: string | null
  status: string
  electedAt: string
}

const route = useRoute()
useHead({ title: 'SMS 选科管理' })

const terms = ref<TermRow[]>([])
const subjects = ref<SubjectRow[]>([])
const termId = ref('')
const studentQuery = ref('')
const studentResults = ref<StudentOption[]>([])
const selectedStudent = ref<StudentOption | null>(null)
const childId = ref<number | null>(null)
const selectedSubjectIds = ref<number[]>([])
const elections = ref<ElectionRow[]>([])
const loading = ref(false)
const saving = ref(false)
const error = ref('')
const message = ref('')

const termOptions = computed(() => terms.value.map(term => ({
  label: `${term.name}（${term.startDate} ~ ${term.endDate}）`,
  value: String(term.id)
})))

const selectedSet = computed(() => new Set(selectedSubjectIds.value))

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
watch(termId, () => void loadElections())

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
  void loadElections()
}

function clearStudent(): void {
  selectedStudent.value = null
  selectedSubjectIds.value = []
  void loadElections()
}

/** 家长切换子女时直接带入该子女，选科读写仍由服务端按 guardianStudentIds 校验。 */
function onChildSelect(child: StudentOption | null): void {
  if (!child) return
  selectedStudent.value = child
  void loadElections()
}

function toggleSubject(subjectId: number): void {
  selectedSubjectIds.value = selectedSet.value.has(subjectId)
    ? selectedSubjectIds.value.filter(id => id !== subjectId)
    : [...selectedSubjectIds.value, subjectId]
}

async function loadOptions(): Promise<void> {
  const [termRows, subjectRows] = await Promise.all([
    $fetch<TermRow[]>('/api/modules/sms/terms', { query: { limit: 100 } }).catch(() => []),
    $fetch<SubjectRow[]>('/api/modules/sms/subjects', { query: { limit: 200 } }).catch(() => [])
  ])
  terms.value = termRows
  subjects.value = subjectRows
  if (!termId.value && termRows.length > 0) termId.value = String(termRows[termRows.length - 1]!.id)
}

async function loadElections(): Promise<void> {
  loading.value = true
  error.value = ''
  try {
    const rows = await $fetch<ElectionRow[]>('/api/modules/sms/elections', {
      query: {
        studentId: selectedStudent.value?.id,
        termId: termId.value || undefined,
        status: 'selected',
        limit: 300
      }
    })
    elections.value = rows
    if (selectedStudent.value) {
      selectedSubjectIds.value = rows
        .filter(row => row.studentId === selectedStudent.value!.id)
        .map(row => row.subjectId)
    }
  } catch (err) {
    error.value = err instanceof Error ? err.message : '选科数据加载失败'
  } finally {
    loading.value = false
  }
}

async function save(): Promise<void> {
  error.value = ''
  message.value = ''
  if (!selectedStudent.value) {
    error.value = '请先选择学生'
    return
  }
  if (!termId.value) {
    error.value = '请选择学期'
    return
  }
  saving.value = true
  try {
    const result = await $fetch<{ selected: number, dropped: number }>('/api/modules/sms/elections/batch', {
      method: 'POST',
      body: {
        studentId: selectedStudent.value.id,
        termId: Number(termId.value),
        subjectIds: selectedSubjectIds.value
      }
    })
    message.value = `已保存：选入 ${result.selected} 门，退课 ${result.dropped} 门`
    await loadElections()
  } catch (err) {
    error.value = err instanceof Error ? err.message : '保存失败'
  } finally {
    saving.value = false
  }
}

onMounted(async () => {
  await loadOptions()
  const initialId = Number(route.query.studentId)
  if (Number.isSafeInteger(initialId) && initialId > 0) {
    try {
      const [student] = await $fetch<StudentOption[]>('/api/modules/sms/students', {
        query: { studentId: initialId, limit: 1 }
      })
      if (student) selectedStudent.value = student
    } catch {
      // 回填失败时保持未选择状态。
    }
  }
  await loadElections()
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
            选科管理
          </h1>
          <p class="mt-1 text-xs text-muted">
            按学期维护学生选科；提交后未包含的已选科目会自动退课，容量不足会阻止保存。
          </p>
        </div>
        <UButton
          size="xs"
          variant="ghost"
          icon="i-lucide-refresh-cw"
          :loading="loading"
          @click="loadElections()"
        >
          刷新
        </UButton>
      </header>
      <SmsChildSwitcher
        v-model="childId"
        @select="onChildSelect"
      />

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
        <div class="grid gap-3 sm:grid-cols-2">
          <label class="space-y-1 text-xs text-muted">
            <span>学期</span>
            <USelect
              v-model="termId"
              :items="termOptions"
              value-key="value"
              placeholder="选择学期"
            />
          </label>
          <div class="relative space-y-1 text-xs text-muted">
            <span>学生</span>
            <div
              v-if="selectedStudent"
              class="flex items-center justify-between gap-2 rounded-lg border border-primary/40 bg-primary/5 px-2 py-2"
            >
              <div class="min-w-0">
                <p class="truncate text-sm text-highlighted">
                  {{ selectedStudent.name }}
                  <span class="ml-1 font-mono text-xs text-muted">{{ selectedStudent.studentNo }}</span>
                </p>
                <p class="text-xs text-muted">
                  {{ selectedStudent.className ?? '未分班' }}
                </p>
              </div>
              <UButton
                size="xs"
                variant="ghost"
                @click="clearStudent()"
              >
                重选
              </UButton>
            </div>
            <UInput
              v-else
              v-model="studentQuery"
              icon="i-lucide-search"
              placeholder="搜索姓名或学号"
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
                  <span class="text-muted">{{ student.className ?? '未分班' }}</span>
                </button>
              </li>
            </ul>
          </div>
        </div>

        <div
          v-if="selectedStudent"
          class="space-y-2 border-t border-default pt-3"
        >
          <p class="text-xs text-muted">
            可选科目（已选 {{ selectedSubjectIds.length }} 门）
          </p>
          <div class="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            <button
              v-for="subject in subjects"
              :key="subject.id"
              type="button"
              class="flex items-center justify-between gap-2 rounded-lg border px-3 py-2 text-left text-sm transition-colors"
              :class="selectedSet.has(subject.id) ? 'border-primary/60 bg-primary/10' : 'border-default hover:border-primary/30'"
              @click="toggleSubject(subject.id)"
            >
              <span class="min-w-0">
                <span class="block truncate text-highlighted">{{ subject.name }}</span>
                <span class="text-xs text-muted">{{ subject.code }}</span>
              </span>
              <span class="flex items-center gap-2">
                <span class="text-[11px] text-muted">
                  {{ subject.capacity === null ? '不限容量' : `容量 ${subject.capacity}` }}
                </span>
                <UIcon
                  v-if="selectedSet.has(subject.id)"
                  name="i-lucide-check"
                  class="size-4 text-primary"
                />
              </span>
            </button>
          </div>
          <p
            v-if="subjects.length === 0"
            class="text-xs text-muted"
          >
            当前组织还没有可选科目
          </p>
          <div class="flex items-center gap-2 pt-2">
            <UButton
              :loading="saving"
              :disabled="!termId"
              @click="save()"
            >
              保存选科
            </UButton>
            <span class="text-xs text-muted">
              保存后以当前勾选为准
            </span>
          </div>
        </div>
        <p
          v-else
          class="text-xs text-muted"
        >
          先选择学生，再勾选科目。
        </p>
      </section>

      <section class="space-y-2">
        <h2 class="text-sm font-medium text-highlighted">
          当前选科
        </h2>
        <div
          v-if="loading && elections.length === 0"
          class="space-y-2"
        >
          <div
            v-for="index in 4"
            :key="index"
            class="h-12 animate-pulse rounded-lg border border-default bg-elevated/60"
          />
        </div>
        <p
          v-else-if="elections.length === 0"
          class="rounded-xl border border-default bg-default p-6 text-center text-sm text-muted"
        >
          该学期暂无选科记录
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
                  科目
                </th>
                <th class="px-3 py-2">
                  学期
                </th>
                <th class="px-3 py-2">
                  状态
                </th>
                <th class="px-3 py-2">
                  选课时间
                </th>
              </tr>
            </thead>
            <tbody>
              <tr
                v-for="row in elections"
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
                <td class="px-3 py-2 text-toned">
                  {{ row.subjectName ?? `#${row.subjectId}` }}
                </td>
                <td class="px-3 py-2 text-xs text-toned">
                  {{ row.termName ?? `#${row.termId}` }}
                </td>
                <td class="px-3 py-2">
                  <UBadge
                    color="success"
                    variant="soft"
                    size="sm"
                  >
                    {{ row.status === 'selected' ? '已选' : '已退' }}
                  </UBadge>
                </td>
                <td class="px-3 py-2 text-xs text-muted">
                  {{ new Date(row.electedAt).toLocaleString() }}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>
    </div>
  </div>
</template>
