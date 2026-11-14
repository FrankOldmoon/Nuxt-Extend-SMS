<script setup lang="ts">
definePageMeta({ middleware: 'auth', layout: 'sms' })

interface ExamRow {
  id: number
  name: string
  className: string | null
  examDate: string
  status: string
}

interface ImportRow {
  line: number
  status: string
  message?: string
  studentNo?: string
  name?: string
}

interface ImportResult {
  batchId: string
  total: number
  valid: number
  invalid: number
  imported: number
  skipped: number
  dryRun: boolean
  rows: ImportRow[]
  errorsCsv: string
}

useHead({ title: 'SMS 成绩导入' })

const exams = ref<ExamRow[]>([])
const examId = ref('')
const csv = ref('')
const dryRun = ref(true)
const running = ref(false)
const error = ref('')
const result = ref<ImportResult | null>(null)

async function loadExams(): Promise<void> {
  try {
    exams.value = await $fetch<ExamRow[]>('/api/modules/sms/exams', { query: { limit: 200 } })
  } catch (err) {
    error.value = err instanceof Error ? err.message : '考试列表加载失败'
  }
}

async function onFile(event: Event): Promise<void> {
  const file = (event.target as HTMLInputElement).files?.[0]
  if (!file) return
  csv.value = await file.text()
}

async function submitImport(): Promise<void> {
  error.value = ''
  result.value = null
  const id = Number(examId.value)
  if (!Number.isSafeInteger(id) || id <= 0) {
    error.value = '请选择考试'
    return
  }
  if (!csv.value.trim()) {
    error.value = '请粘贴或上传 CSV'
    return
  }
  running.value = true
  try {
    result.value = await $fetch<ImportResult>('/api/modules/sms/scores/import', {
      method: 'POST',
      body: { examId: id, csv: csv.value, dryRun: dryRun.value }
    })
  } catch (err) {
    error.value = err instanceof Error ? err.message : '导入失败'
  } finally {
    running.value = false
  }
}

function downloadErrors(): void {
  if (!result.value?.errorsCsv) return
  const blob = new Blob([result.value.errorsCsv], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = `scores-errors-${result.value.batchId}.csv`
  link.click()
  URL.revokeObjectURL(url)
}

onMounted(loadExams)
</script>

<template>
  <div class="p-4">
    <div class="mx-auto max-w-4xl space-y-4">
      <header>
        <h1 class="text-lg font-semibold text-highlighted">
          成绩导入
        </h1>
        <p class="mt-1 text-xs text-muted">
          CSV 表头：studentNo,score。建议先干跑预览，确认无误后再正式写入。
        </p>
      </header>

      <p v-if="error" class="rounded-lg border border-error/40 bg-error/10 p-3 text-xs text-error">
        {{ error }}
      </p>

      <section class="space-y-3 rounded-xl border border-default bg-default p-4">
        <div class="grid gap-3 sm:grid-cols-2">
          <USelect
            v-model="examId"
            :items="exams.map(exam => ({ label: `${exam.name} · ${exam.className ?? ''} · ${exam.examDate}`, value: String(exam.id) }))"
            placeholder="选择考试"
            value-key="value"
          />
          <div class="flex items-center gap-3">
            <UCheckbox v-model="dryRun" label="仅预览（不写入）" />
            <input type="file" accept=".csv,text/csv" class="text-xs" @change="onFile">
          </div>
        </div>
        <UTextarea v-model="csv" placeholder="studentNo,score&#10;S001,92.5" :rows="6" class="w-full font-mono" />
        <UButton :loading="running" @click="submitImport()">
          {{ dryRun ? '预览导入' : '正式导入' }}
        </UButton>
      </section>

      <section v-if="result" class="space-y-3 rounded-xl border border-default bg-default p-4">
        <div class="flex flex-wrap items-center justify-between gap-2">
          <h2 class="text-sm font-medium text-highlighted">
            导入结果 · {{ result.dryRun ? '预览' : '已写入' }}
          </h2>
          <UButton
            v-if="result.invalid > 0"
            size="xs"
            variant="soft"
            icon="i-lucide-download"
            @click="downloadErrors()"
          >
            下载错误 CSV
          </UButton>
        </div>
        <p class="text-xs text-muted">
          共 {{ result.total }} 行，有效 {{ result.valid }}，无效 {{ result.invalid }}，
          已写入 {{ result.imported }}，跳过 {{ result.skipped }}。
        </p>
        <div class="max-h-80 overflow-y-auto">
          <table class="w-full text-left text-xs">
            <thead class="text-muted">
              <tr>
                <th class="py-1 pr-2">
                  行
                </th>
                <th class="py-1 pr-2">
                  学号
                </th>
                <th class="py-1 pr-2">
                  状态
                </th>
                <th class="py-1">
                  说明
                </th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="row in result.rows" :key="row.line" class="border-t border-default">
                <td class="py-1 pr-2">
                  {{ row.line }}
                </td>
                <td class="py-1 pr-2">
                  {{ row.studentNo ?? '—' }}
                </td>
                <td class="py-1 pr-2">
                  {{ row.status }}
                </td>
                <td class="py-1">
                  {{ row.message ?? '' }}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>
    </div>
  </div>
</template>
