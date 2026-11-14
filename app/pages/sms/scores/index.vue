<script setup lang="ts">
definePageMeta({ middleware: 'auth', layout: 'sms' })

interface ExamRow {
  id: number
  name: string
  className: string | null
  examDate: string
  status: string
}

interface ClassRow {
  id: number
  name: string
}

interface ScoreRow {
  id: number
  examId: number
  examName: string
  examDate: string
  fullScore: number
  examStatus: string
  className: string | null
  subjectName: string | null
  studentId: number
  studentName: string | null
  studentNo: string | null
  score: number | null
  absent: boolean
  remark: string | null
}

useHead({ title: 'SMS 成绩查询' })

const route = useRoute()
const exams = ref<ExamRow[]>([])
const classes = ref<ClassRow[]>([])
const rows = ref<ScoreRow[]>([])
const examId = ref('')
const classId = ref('')
const childId = ref<number | null>(null)
const search = ref(typeof route.query.q === 'string' ? route.query.q : '')
const loading = ref(false)
const initialized = ref(false)
const error = ref('')

const examOptions = computed(() => [
  { label: '全部考试', value: '' },
  ...exams.value.map(exam => ({
    label: `${exam.name} · ${exam.className ?? ''} · ${exam.examDate}`,
    value: String(exam.id)
  }))
])

const classOptions = computed(() => [
  { label: '全部班级', value: '' },
  ...classes.value.map(item => ({ label: item.name, value: String(item.id) }))
])

function csvCell(value: string): string {
  const guarded = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value
  return /[",\n]/.test(guarded) ? `"${guarded.replace(/"/g, '""')}"` : guarded
}

async function loadOptions(): Promise<void> {
  const [examRows, classRows] = await Promise.all([
    $fetch<ExamRow[]>('/api/modules/sms/exams', { query: { limit: 200 } }).catch(() => []),
    $fetch<ClassRow[]>('/api/modules/sms/classes', { query: { limit: 200 } }).catch(() => [])
  ])
  exams.value = examRows
  classes.value = classRows
}

async function load(): Promise<void> {
  loading.value = true
  error.value = ''
  try {
    rows.value = await $fetch<ScoreRow[]>('/api/modules/sms/scores', {
      query: {
        examId: examId.value || undefined,
        classId: classId.value || undefined,
        studentId: childId.value ?? undefined,
        q: search.value.trim() || undefined,
        limit: 200
      }
    })
  } catch (err) {
    error.value = err instanceof Error ? err.message : '成绩列表加载失败'
  } finally {
    loading.value = false
    initialized.value = true
  }
}

function formatScore(row: ScoreRow): string {
  if (row.absent) return '缺考'
  return row.score === null ? '未录入' : `${row.score} / ${row.fullScore}`
}

function exportCsv(): void {
  if (rows.value.length === 0) return
  const header = 'examDate,examName,className,subjectName,studentNo,studentName,score,fullScore,absent'
  const body = rows.value.map(row => [
    row.examDate,
    row.examName,
    row.className ?? '',
    row.subjectName ?? '',
    row.studentNo ?? '',
    row.studentName ?? '',
    row.score === null ? '' : String(row.score),
    String(row.fullScore),
    row.absent ? '1' : '0'
  ].map(csvCell).join(','))
  const blob = new Blob([`\uFEFF${[header, ...body].join('\n')}`], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = `scores-${new Date().toISOString().slice(0, 10)}.csv`
  link.click()
  URL.revokeObjectURL(url)
}

let debounce: ReturnType<typeof setTimeout> | null = null
watch([examId, classId, childId], () => void load())
watch(search, () => {
  if (debounce) clearTimeout(debounce)
  debounce = setTimeout(() => void load(), 300)
})

onMounted(async () => {
  await loadOptions()
  await load()
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
            成绩查询
          </h1>
          <p class="mt-1 text-xs text-muted">
            仅展示当前用户可见班级与已发布考试（教师可见草稿）。
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
            @click="load()"
          >
            刷新
          </UButton>
          <UButton
            size="xs"
            variant="soft"
            icon="i-lucide-upload"
            to="/sms/scores/import"
          >
            成绩导入
          </UButton>
        </div>
      </header>

      <div class="flex flex-wrap items-center gap-2">
        <UInput
          v-model="search"
          icon="i-lucide-search"
          placeholder="搜索学生姓名或学号"
          class="w-64"
        />
        <USelect
          v-model="examId"
          :items="examOptions"
          value-key="value"
          class="w-72"
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
        没有符合条件的成绩记录
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
                班级
              </th>
              <th class="px-3 py-2">
                学生
              </th>
              <th class="px-3 py-2">
                学号
              </th>
              <th class="px-3 py-2 text-right">
                成绩
              </th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="row in rows"
              :key="row.id"
              class="border-t border-default"
            >
              <td class="px-3 py-2">
                <p class="text-highlighted">
                  {{ row.examName }}
                </p>
                <p class="text-xs text-muted">
                  {{ row.examDate }} · {{ row.subjectName ?? '—' }}
                </p>
              </td>
              <td class="px-3 py-2 text-toned">
                {{ row.className ?? '—' }}
              </td>
              <td class="px-3 py-2 text-highlighted">
                {{ row.studentName ?? `#${row.studentId}` }}
              </td>
              <td class="px-3 py-2 font-mono text-xs text-toned">
                {{ row.studentNo ?? '—' }}
              </td>
              <td class="px-3 py-2 text-right">
                <UBadge
                  :color="row.absent ? 'warning' : row.score === null ? 'neutral' : 'primary'"
                  variant="soft"
                  size="sm"
                >
                  {{ formatScore(row) }}
                </UBadge>
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <p class="text-center text-xs text-muted">
        共 {{ rows.length }} 条（单次最多 200 条）
      </p>
    </div>
  </div>
</template>
