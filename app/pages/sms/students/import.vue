<script setup lang="ts">
definePageMeta({ middleware: 'auth', layout: 'sms' })

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

interface QueuedResult {
  queued: true
  jobId: number
}

useHead({ title: 'SMS 学生导入' })

const rawCsv = ref('')
const parsedRows = ref<string[][]>([])
const headers = ref<string[]>([])
const nameIndex = ref('')
const studentNoIndex = ref('')
const classIndex = ref('')
const step = ref<1 | 2 | 3>(1)
const running = ref(false)
const defer = ref(false)
const error = ref('')
const preview = ref<ImportResult | null>(null)
const result = ref<ImportResult | null>(null)
const queuedJobId = ref<number | null>(null)

const columnOptions = computed(() => headers.value.map((header, index) => ({
  label: `${header || `第 ${index + 1} 列`}（第 ${index + 1} 列）`,
  value: String(index)
})))

const nameColumn = computed(() => Number(nameIndex.value))
const studentNoColumn = computed(() => Number(studentNoIndex.value))
const classColumn = computed(() => Number(classIndex.value))
const canPreview = computed(() => [nameColumn.value, studentNoColumn.value, classColumn.value]
  .every(index => Number.isSafeInteger(index) && index >= 0))

function parseCsv(text: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let inQuotes = false
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index]
    if (inQuotes) {
      if (char === '"') {
        if (text[index + 1] === '"') {
          field += '"'
          index += 1
        } else {
          inQuotes = false
        }
      } else {
        field += char
      }
      continue
    }
    if (char === '"') inQuotes = true
    else if (char === ',') {
      row.push(field)
      field = ''
    } else if (char === '\n') {
      row.push(field)
      rows.push(row)
      row = []
      field = ''
    } else if (char !== '\r') field += char
  }
  if (field !== '' || row.length > 0) {
    row.push(field)
    rows.push(row)
  }
  return rows.filter(cells => cells.some(cell => cell.trim() !== ''))
}

function escapeCell(value: string): string {
  return /[",\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value
}

function detectColumn(aliases: string[]): string {
  const index = headers.value.findIndex(header => aliases.includes(header.trim().toLowerCase().replace(/\s+/g, '')))
  return index >= 0 ? String(index) : ''
}

function analyzeCsv(): void {
  error.value = ''
  preview.value = null
  result.value = null
  queuedJobId.value = null
  const rows = parseCsv(rawCsv.value)
  if (rows.length < 2) {
    error.value = 'CSV 至少需要表头和一行数据'
    return
  }
  parsedRows.value = rows
  headers.value = rows[0]!
  nameIndex.value = detectColumn(['name', '姓名', '学生姓名'])
  studentNoIndex.value = detectColumn(['studentno', 'student_no', '学号'])
  classIndex.value = detectColumn(['classid', 'class_id', '班级id', '班级'])
  step.value = 2
}

async function onFile(event: Event): Promise<void> {
  const file = (event.target as HTMLInputElement).files?.[0]
  if (!file) return
  rawCsv.value = await file.text()
  analyzeCsv()
}

function buildCanonicalCsv(): string {
  const body = parsedRows.value.slice(1).map(row => [
    (row[nameColumn.value] ?? '').trim(),
    (row[studentNoColumn.value] ?? '').trim(),
    (row[classColumn.value] ?? '').trim()
  ].map(escapeCell).join(','))
  return ['name,studentNo,classId', ...body].join('\n')
}

async function submit(dryRun: boolean): Promise<void> {
  error.value = ''
  if (!canPreview.value) {
    error.value = '请完成字段映射'
    return
  }
  running.value = true
  try {
    const response = await $fetch<ImportResult | QueuedResult>('/api/modules/sms/students/import', {
      method: 'POST',
      body: { csv: buildCanonicalCsv(), dryRun, defer: !dryRun && defer.value }
    })
    if ('queued' in response) {
      queuedJobId.value = response.jobId
      step.value = 3
      return
    }
    if (dryRun) {
      preview.value = response
    } else {
      result.value = response
      step.value = 3
    }
  } catch (err) {
    error.value = err instanceof Error ? err.message : '导入失败'
  } finally {
    running.value = false
  }
}

function downloadErrors(source: ImportResult | null): void {
  if (!source?.errorsCsv) return
  const blob = new Blob([source.errorsCsv], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = `students-errors-${source.batchId}.csv`
  link.click()
  URL.revokeObjectURL(url)
}

function restart(): void {
  step.value = 1
  rawCsv.value = ''
  parsedRows.value = []
  headers.value = []
  nameIndex.value = ''
  studentNoIndex.value = ''
  classIndex.value = ''
  preview.value = null
  result.value = null
  queuedJobId.value = null
  error.value = ''
}
</script>

<template>
  <div class="min-h-0 flex-1 overflow-y-auto p-4">
    <div class="mx-auto max-w-4xl space-y-4">
      <header>
        <h1 class="text-lg font-semibold text-highlighted">
          学生导入
        </h1>
        <p class="mt-1 text-xs text-muted">
          上传 → 字段映射/干跑预览 → 确认写入；班级 ID 必须在你的数据范围内。
        </p>
      </header>

      <ol class="flex items-center gap-2 text-xs text-muted">
        <li :class="step >= 1 ? 'text-primary' : ''">
          1. 上传
        </li>
        <li>→</li>
        <li :class="step >= 2 ? 'text-primary' : ''">
          2. 映射与预览
        </li>
        <li>→</li>
        <li :class="step >= 3 ? 'text-primary' : ''">
          3. 完成
        </li>
      </ol>

      <p
        v-if="error"
        class="rounded-lg border border-error/40 bg-error/10 p-3 text-xs text-error"
      >
        {{ error }}
      </p>

      <section
        v-if="step === 1"
        class="space-y-3 rounded-xl border border-default bg-default p-4"
      >
        <div class="flex flex-wrap items-center gap-3">
          <input
            type="file"
            accept=".csv,text/csv"
            class="text-xs"
            @change="onFile"
          >
          <span class="text-xs text-muted">或直接粘贴 CSV</span>
        </div>
        <UTextarea
          v-model="rawCsv"
          placeholder="name,studentNo,classId&#10;张三,S001,12"
          :rows="6"
          class="w-full font-mono"
        />
        <UButton
          :disabled="!rawCsv.trim()"
          @click="analyzeCsv()"
        >
          解析并进入映射
        </UButton>
      </section>

      <section
        v-if="step >= 2 && step < 3"
        class="space-y-3 rounded-xl border border-default bg-default p-4"
      >
        <div class="grid gap-3 sm:grid-cols-3">
          <label class="space-y-1 text-xs text-muted">
            <span>姓名列</span>
            <USelect
              v-model="nameIndex"
              :items="columnOptions"
              value-key="value"
              placeholder="选择列"
            />
          </label>
          <label class="space-y-1 text-xs text-muted">
            <span>学号列</span>
            <USelect
              v-model="studentNoIndex"
              :items="columnOptions"
              value-key="value"
              placeholder="选择列"
            />
          </label>
          <label class="space-y-1 text-xs text-muted">
            <span>班级 ID 列</span>
            <USelect
              v-model="classIndex"
              :items="columnOptions"
              value-key="value"
              placeholder="选择列"
            />
          </label>
        </div>

        <div class="flex flex-wrap items-center gap-3">
          <UButton
            variant="soft"
            :loading="running"
            :disabled="!canPreview"
            @click="submit(true)"
          >
            干跑预览
          </UButton>
          <UButton
            color="success"
            :loading="running"
            :disabled="!canPreview || !preview || preview.valid === 0"
            @click="submit(false)"
          >
            确认导入
          </UButton>
          <UCheckbox
            v-model="defer"
            label="后台执行（大文件）"
          />
          <UButton
            variant="ghost"
            @click="restart()"
          >
            重新上传
          </UButton>
        </div>

        <div
          v-if="preview"
          class="space-y-2 border-t border-default pt-3"
        >
          <div class="flex flex-wrap items-center justify-between gap-2">
            <p class="text-xs text-muted">
              预览：共 {{ preview.total }} 行，有效 {{ preview.valid }}，无效 {{ preview.invalid }}。
            </p>
            <UButton
              v-if="preview.invalid > 0"
              size="xs"
              variant="soft"
              icon="i-lucide-download"
              @click="downloadErrors(preview)"
            >
              下载错误 CSV
            </UButton>
          </div>
          <div class="max-h-64 overflow-y-auto">
            <table class="w-full text-left text-xs">
              <thead class="text-muted">
                <tr>
                  <th class="py-1 pr-2">
                    行
                  </th>
                  <th class="py-1 pr-2">
                    姓名
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
                <tr
                  v-for="row in preview.rows"
                  :key="row.line"
                  class="border-t border-default"
                >
                  <td class="py-1 pr-2">
                    {{ row.line }}
                  </td>
                  <td class="py-1 pr-2">
                    {{ row.name ?? '—' }}
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
        </div>
      </section>

      <section
        v-if="step === 3"
        class="space-y-3 rounded-xl border border-default bg-default p-4"
      >
        <h2 class="text-sm font-medium text-highlighted">
          导入已提交
        </h2>
        <p
          v-if="queuedJobId"
          class="text-xs text-muted"
        >
          已进入后台队列（任务 #{{ queuedJobId }}），可稍后在 Agent 任务或审计中查看结果。
        </p>
        <template v-else-if="result">
          <div class="flex flex-wrap items-center justify-between gap-2">
            <p class="text-xs text-muted">
              共 {{ result.total }} 行，有效 {{ result.valid }}，无效 {{ result.invalid }}，
              已写入 {{ result.imported }}，跳过 {{ result.skipped }}。
            </p>
            <UButton
              v-if="result.invalid > 0"
              size="xs"
              variant="soft"
              icon="i-lucide-download"
              @click="downloadErrors(result)"
            >
              下载错误 CSV
            </UButton>
          </div>
        </template>
        <UButton
          variant="soft"
          @click="restart()"
        >
          再导入一批
        </UButton>
      </section>
    </div>
  </div>
</template>
