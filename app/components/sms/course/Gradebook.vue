<script setup lang="ts">
/**
 * The marking grid — one row per enrolled student, one column per assessment.
 *
 * The whole grid is edited at once and saved per assessment: the API's save is
 * `(assessmentId, scores[])`, so the page groups the differences by column and
 * fires one request per changed assessment rather than one per cell. A null mark
 * is a real edit (it clears the cell back to "not marked"), which is why the
 * input is kept as a string and empty means null rather than zero.
 *
 * `canEdit` and the locking submission both come from the server, so the editor
 * only ever appears where the API would accept the write.
 */
import type { Gradebook, GradebookStudentRow } from '../../../composables/useSms'

const props = defineProps<{ courseId: number }>()
const { t } = useI18n()
const toast = useToast()

const { data, pending, error, refresh } = await useAsyncData(
  `sms:gradebook:${props.courseId}`,
  () => fetchGradebook(props.courseId)
)

const gradebook = computed<Gradebook | null>(() => data.value ?? null)
const canEdit = computed(() => gradebook.value?.canEdit ?? false)
const locked = computed(() => gradebook.value?.submission?.status === 'approved')
const editable = computed(() => canEdit.value && !locked.value)

const saving = ref(false)
const edits = reactive<Record<string, string>>({})

function cellKey(studentId: number, assessmentId: number): string {
  return `${studentId}:${assessmentId}`
}

watch(gradebook, (value) => {
  for (const existing of Object.keys(edits)) {
    Reflect.deleteProperty(edits, existing)
  }
  if (!value) return
  for (const row of value.rows) {
    for (const cell of row.scores) {
      edits[cellKey(row.studentId, cell.assessmentId)] = cell.score == null ? '' : String(cell.score)
    }
  }
}, { immediate: true })

function cellScore(row: GradebookStudentRow, assessmentId: number): number | null {
  return row.scores.find(cell => cell.assessmentId === assessmentId)?.score ?? null
}

async function save(): Promise<void> {
  const board = gradebook.value
  if (!board) return
  saving.value = true
  try {
    let saved = 0
    for (const assessment of board.assessments) {
      const changed: Array<{ studentId: number, score: number | null }> = []
      for (const row of board.rows) {
        const raw = edits[cellKey(row.studentId, assessment.id)] ?? ''
        const original = cellScore(row, assessment.id)
        const parsed = raw === '' ? null : Number(raw)
        if (raw !== '' && !Number.isFinite(parsed)) continue
        if (parsed !== original) changed.push({ studentId: row.studentId, score: parsed })
      }
      if (changed.length) {
        await cPost(`/api/sms/courses/${props.courseId}/gradebook`, { assessmentId: assessment.id, scores: changed })
        saved += changed.length
      }
    }
    toast.add({
      title: saved === 0 ? t('sms.messages.nothingToSave') : t('sms.scores.saved'),
      color: saved === 0 ? 'neutral' : 'success'
    })
    await refresh()
  } catch (e: unknown) {
    toast.add({ title: extractErrorMessage(e), color: 'error' })
  } finally {
    saving.value = false
  }
}

async function submitForReview(): Promise<void> {
  try {
    await cPost('/api/sms/submissions', { kind: 'scores', courseId: props.courseId })
    toast.add({ title: t('sms.messages.submitted'), color: 'success' })
    await refresh()
  } catch (e: unknown) {
    toast.add({ title: extractErrorMessage(e), color: 'error' })
  }
}

async function withdraw(): Promise<void> {
  const id = gradebook.value?.submission?.id
  if (!id) return
  try {
    await cPost(`/api/sms/submissions/${id}`, { action: 'withdraw' })
    toast.add({ title: t('sms.messages.withdrawn'), color: 'success' })
    await refresh()
  } catch (e: unknown) {
    toast.add({ title: extractErrorMessage(e), color: 'error' })
  }
}
</script>

<template>
  <div class="space-y-4">
    <div class="flex flex-wrap items-center gap-2">
      <SmsSubmissionBadge
        v-if="gradebook?.submission"
        :status="gradebook.submission.status"
      />
      <UAlert
        v-if="gradebook && !gradebook.weights.valid"
        color="warning"
        variant="subtle"
        class="py-1"
        :description="t('sms.assessments.weightsInvalid', { sum: gradebook.weights.sum })"
      />
      <span
        v-if="locked"
        class="text-xs text-warning"
      >
        {{ t('sms.review.lockedHint') }}
      </span>
      <div class="ml-auto flex flex-wrap items-center gap-2">
        <UButton
          v-if="editable"
          icon="i-lucide-save"
          :label="t('sms.scores.saveAll')"
          :loading="saving"
          @click="save"
        />
        <UButton
          v-if="canEdit && gradebook?.submission?.status !== 'pending'"
          icon="i-lucide-send"
          color="neutral"
          variant="soft"
          :label="t('sms.actions.submit')"
          @click="submitForReview"
        />
        <UButton
          v-if="canEdit && gradebook?.submission && gradebook.submission.status !== 'withdrawn'"
          icon="i-lucide-undo-2"
          color="neutral"
          variant="soft"
          :label="t('sms.actions.withdraw')"
          @click="withdraw"
        />
      </div>
    </div>

    <UAlert
      v-if="error"
      color="error"
      variant="subtle"
      :description="t('sms.messages.loadFailed')"
    />

    <div
      v-else-if="pending && !gradebook"
      class="py-12 text-center text-sm text-muted"
    >
      {{ t('sms.common.loading') }}
    </div>

    <SmsEmptyState
      v-else-if="!gradebook?.assessments.length"
      icon="i-lucide-clipboard-list"
      :title="t('sms.scores.empty')"
      :description="t('sms.scores.emptyHint')"
    />

    <div
      v-else-if="gradebook"
      class="overflow-x-auto rounded-xl border border-default"
    >
      <table class="w-full border-collapse text-sm">
        <thead>
          <tr class="bg-elevated/60">
            <th class="sticky left-0 z-10 border-b border-default bg-elevated/60 px-3 py-2 text-left text-xs font-medium text-muted">
              {{ t('sms.scores.student') }}
            </th>
            <th
              v-for="assessment in gradebook.assessments"
              :key="assessment.id"
              class="border-b border-l border-default px-2 py-2 text-center text-xs font-medium text-muted"
            >
              <span class="block text-highlighted">{{ assessment.name }}</span>
              <span class="block text-[11px]">{{ assessment.weight }}% · /{{ assessment.maxScore }}</span>
            </th>
            <th class="border-b border-l border-default px-2 py-2 text-center text-xs font-medium text-muted">
              {{ t('sms.scores.total') }}
            </th>
            <th class="border-b border-l border-default px-2 py-2 text-center text-xs font-medium text-muted">
              {{ t('sms.scores.letter') }}
            </th>
            <th class="border-b border-l border-default px-2 py-2 text-center text-xs font-medium text-muted">
              {{ t('sms.scores.rank') }}
            </th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="row in gradebook.rows"
            :key="row.studentId"
          >
            <th class="sticky left-0 z-10 border-b border-default bg-default px-3 py-2 text-left font-normal">
              <NuxtLink
                :to="`/sms/students/${row.studentId}`"
                class="text-sm font-medium text-highlighted hover:text-primary"
              >
                {{ row.studentName }}
              </NuxtLink>
              <span class="block text-[11px] text-dimmed">{{ row.rollId }}</span>
            </th>
            <td
              v-for="assessment in gradebook.assessments"
              :key="assessment.id"
              class="border-b border-l border-default px-2 py-1 text-center"
            >
              <UInput
                v-if="editable"
                :model-value="edits[cellKey(row.studentId, assessment.id)]"
                type="number"
                size="xs"
                class="mx-auto w-20"
                @update:model-value="edits[cellKey(row.studentId, assessment.id)] = String($event)"
              />
              <SmsMarkBadge
                v-else
                :mark="cellScore(row, assessment.id)"
                :pass-mark="gradebook.passMark"
              />
            </td>
            <td class="border-b border-l border-default px-2 py-2 text-center">
              <span class="font-medium text-highlighted">{{ formatMark(row.total) }}</span>
              <span
                v-if="row.coverage < 1"
                class="block text-[11px] text-dimmed"
              >
                {{ t('sms.scores.coverageShort', { percent: Math.round(row.coverage * 100) }) }}
              </span>
            </td>
            <td class="border-b border-l border-default px-2 py-2 text-center">
              <UBadge
                color="neutral"
                variant="subtle"
                size="sm"
                :label="row.letter ?? '—'"
              />
            </td>
            <td class="border-b border-l border-default px-2 py-2 text-center text-muted">
              {{ row.rank ?? '—' }}
            </td>
          </tr>
          <tr v-if="!gradebook.rows.length">
            <td
              :colspan="gradebook.assessments.length + 4"
              class="px-3 py-8 text-center text-sm text-muted"
            >
              {{ t('sms.courses.roster') }}: {{ t('sms.common.empty') }}
            </td>
          </tr>
        </tbody>
        <tfoot v-if="gradebook.rows.length">
          <tr class="bg-elevated/40">
            <th class="sticky left-0 z-10 bg-elevated/40 px-3 py-2 text-left text-xs font-medium text-muted">
              {{ t('sms.scores.classAverage') }}
            </th>
            <td
              v-for="stat in gradebook.statistics"
              :key="stat.assessmentId"
              class="border-l border-default px-2 py-2 text-center text-xs text-muted"
            >
              {{ stat.average ?? '—' }}
            </td>
            <td
              colspan="3"
              class="border-l border-default"
            />
          </tr>
        </tfoot>
      </table>
    </div>
  </div>
</template>
