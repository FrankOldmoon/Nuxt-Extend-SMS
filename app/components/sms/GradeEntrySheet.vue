<script setup lang="ts">
/**
 * Chat component `sms.grade-entry-sheet`.
 *
 * Rows always come from the module API; the model only supplies `examId`.
 * Editing is limited to draft exams and requires `sms.scores.update`.
 */
interface SheetRow {
  studentId: number
  studentName: string
  studentNo: string
  scoreId: number | null
  score: number | null
  absent: boolean
  remark: string | null
}

interface SheetExam {
  id: number
  name: string
  className: string | null
  subjectName: string | null
  examDate: string
  fullScore: number
  status: string
}

interface SheetResponse {
  exam: SheetExam
  rows: SheetRow[]
}

const props = defineProps<{ examId: number }>()

const { can } = useSmsPermission()
const canEdit = computed(() => can('scores', 'update'))

const loading = ref(true)
const saving = ref(false)
const error = ref('')
const notice = ref('')
const exam = ref<SheetExam | null>(null)
const rows = ref<SheetRow[]>([])
const drafts = ref<Record<number, { score: string, absent: boolean }>>({})

function statusOf(value: unknown): number | undefined {
  if (!value || typeof value !== 'object') return undefined
  const response = (value as { response?: { status?: unknown } }).response
  return typeof response?.status === 'number' ? response.status : undefined
}

function errorMessage(value: unknown): string {
  if (statusOf(value) === 403) return '没有权限查看或录入成绩，请在 Apps 中确认角色权限。'
  if (value && typeof value === 'object') {
    const data = (value as { data?: { message?: unknown } }).data
    if (data && typeof data.message === 'string') return data.message
    const message = (value as { message?: unknown }).message
    if (typeof message === 'string') return message
  }
  return '加载成绩单失败'
}

async function load(): Promise<void> {
  loading.value = true
  error.value = ''
  notice.value = ''
  try {
    const data = await $fetch<SheetResponse>('/api/modules/sms/scores/sheet', {
      query: { examId: props.examId }
    })
    exam.value = data.exam
    rows.value = data.rows
    const next: Record<number, { score: string, absent: boolean }> = {}
    for (const row of data.rows) {
      next[row.studentId] = {
        score: row.score === null ? '' : String(row.score),
        absent: row.absent
      }
    }
    drafts.value = next
  } catch (value) {
    error.value = errorMessage(value)
    rows.value = []
  } finally {
    loading.value = false
  }
}

onMounted(load)
watch(() => props.examId, () => {
  void load()
})

const editable = computed(() => canEdit.value && exam.value?.status === 'draft')

interface SaveEntry {
  studentId: number
  score: number | null
  absent: boolean
  remark?: string
}

async function save(): Promise<void> {
  if (!exam.value || !editable.value) return
  const entries: SaveEntry[] = []
  for (const row of rows.value) {
    const draft = drafts.value[row.studentId]
    if (!draft) continue
    const absent = draft.absent
    const score = absent || draft.score === '' ? null : Number(draft.score)
    const unchanged = row.absent === absent && (row.score ?? null) === score
    if (unchanged) continue
    entries.push({ studentId: row.studentId, score, absent, remark: row.remark ?? undefined })
  }

  if (entries.length === 0) {
    notice.value = '没有需要保存的改动'
    return
  }

  saving.value = true
  error.value = ''
  try {
    const result = await $fetch<{ created: number, corrected: number }>('/api/modules/sms/scores', {
      method: 'POST',
      body: { examId: props.examId, entries }
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
    <div
      v-if="loading"
      class="space-y-1.5 rounded-lg border border-default p-2"
      aria-busy="true"
      aria-label="正在加载成绩单"
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

    <template v-else-if="exam">
      <p class="mb-1 text-[11px] text-muted">
        {{ exam.name }} · {{ exam.className ?? '—' }}
        <span v-if="exam.subjectName"> · {{ exam.subjectName }}</span>
        · 满分 {{ exam.fullScore }} · {{ exam.status === 'draft' ? '草稿' : '已发布' }}
      </p>

      <div
        v-if="editable"
        class="mb-1.5"
      >
        <UButton
          color="primary"
          size="xs"
          icon="i-lucide-save"
          :loading="saving"
          @click="save"
        >
          保存成绩
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
          v-for="row in rows"
          :key="row.studentId"
          class="flex items-center gap-2 border-b border-default/60 px-2.5 py-1.5 last:border-b-0"
        >
          <div class="min-w-0 flex-1">
            <p class="truncate text-xs text-highlighted">
              {{ row.studentName }}
              <span class="text-muted">· {{ row.studentNo }}</span>
            </p>
          </div>
          <template v-if="editable">
            <input
              v-model="drafts[row.studentId]!.score"
              type="number"
              min="0"
              :max="exam.fullScore"
              step="0.5"
              :disabled="drafts[row.studentId]!.absent"
              class="h-7 w-20 rounded-md border border-default bg-default px-1.5 text-xs text-highlighted outline-none focus:border-primary disabled:opacity-50"
              :aria-label="`${row.studentName} 的分数`"
            >
            <label class="flex items-center gap-1 text-[11px] text-toned">
              <input
                v-model="drafts[row.studentId]!.absent"
                type="checkbox"
                class="size-3.5 rounded border-default"
              >
              缺考
            </label>
          </template>
          <span
            v-else
            class="text-xs text-toned"
          >
            {{ row.absent ? '缺考' : row.score ?? '未录入' }}
          </span>
        </div>
      </div>
    </template>
  </div>
</template>
