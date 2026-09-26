<script setup lang="ts">
/**
 * The roll sheet for one course, one date and (optionally) one period.
 *
 * Every enrolled student appears, pre-filled `present` when there is no record
 * yet — an empty sheet cannot be told apart from an unsaved one, and "everyone
 * is here" is the common case. A null `periodId` means the whole day; a period
 * makes it "was late to 3rd period".
 *
 * The API locks a date that belongs to an approved attendance batch, so the
 * editor disappears rather than failing on submit.
 */
import type { AttendanceSheet } from '../../../composables/useSms'

const props = defineProps<{ courseId: number }>()
const { t } = useI18n()
const toast = useToast()
const { reference } = useSmsReference()

const statuses: string[] = ['present', 'late', 'absent', 'leave', 'excused']

const date = ref(todayISO())
const periodId = ref(0)

const periodItems = computed(() => [
  { label: t('sms.common.all'), value: 0 },
  ...(reference.value?.periods ?? []).map(period => ({ label: period.name, value: period.id }))
])

const params = computed(() => ({
  date: date.value,
  periodId: periodId.value || undefined
}))

const { data, pending, error, refresh } = await useAsyncData(
  `sms:attendance:${props.courseId}`,
  () => fetchAttendanceSheet(props.courseId, params.value),
  { watch: [params] }
)

const sheet = computed<AttendanceSheet | null>(() => data.value ?? null)
const canEdit = computed(() => sheet.value?.canEdit ?? false)
const locked = computed(() => sheet.value?.submission?.status === 'approved')
const editable = computed(() => canEdit.value && !locked.value)

interface Draft { status: string, minutesLate: string }
const drafts = reactive<Record<number, Draft>>({})

watch(sheet, (value) => {
  for (const key of Object.keys(drafts)) {
    Reflect.deleteProperty(drafts, key)
  }
  for (const row of value?.rows ?? []) {
    drafts[row.studentId] = {
      status: row.status,
      minutesLate: row.minutesLate == null ? '' : String(row.minutesLate)
    }
  }
}, { immediate: true })

const summaryByStudent = computed(() => {
  const map = new Map<number, { rate: number | null, minutesLate: number }>()
  for (const entry of sheet.value?.summary ?? []) {
    map.set(entry.studentId, { rate: entry.stats.rate, minutesLate: entry.stats.minutesLate })
  }
  return map
})

function markAllPresent(): void {
  for (const row of sheet.value?.rows ?? []) {
    drafts[row.studentId] = { status: 'present', minutesLate: '' }
  }
}

function setStatus(studentId: number, value: unknown): void {
  const draft = drafts[studentId]
  if (draft) draft.status = String(value)
}

function setMinutesLate(studentId: number, value: unknown): void {
  const draft = drafts[studentId]
  if (draft) draft.minutesLate = String(value)
}

function draftOf(studentId: number): Draft {
  return drafts[studentId] ?? { status: 'present', minutesLate: '' }
}

const saving = ref(false)

async function save(): Promise<void> {
  const current = sheet.value
  if (!current) return
  saving.value = true
  try {
    await cPost(`/api/sms/courses/${props.courseId}/attendance`, {
      date: date.value,
      periodId: periodId.value || null,
      records: current.rows.map(row => ({
        studentId: row.studentId,
        status: drafts[row.studentId]?.status ?? 'present',
        minutesLate: drafts[row.studentId]?.minutesLate || null,
        note: row.note
      }))
    })
    toast.add({ title: t('sms.messages.saved'), color: 'success' })
    await refresh()
  } catch (e: unknown) {
    toast.add({ title: extractErrorMessage(e), color: 'error' })
  } finally {
    saving.value = false
  }
}

async function submitForReview(): Promise<void> {
  try {
    await cPost('/api/sms/submissions', { kind: 'attendance', courseId: props.courseId })
    toast.add({ title: t('sms.messages.submitted'), color: 'success' })
    await refresh()
  } catch (e: unknown) {
    toast.add({ title: extractErrorMessage(e), color: 'error' })
  }
}

async function withdraw(): Promise<void> {
  const id = sheet.value?.submission?.id
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
      <UInput
        v-model="date"
        type="date"
        class="w-40"
      />
      <USelect
        v-model="periodId"
        :items="periodItems"
        class="w-40"
      />
      <UButton
        v-if="editable"
        icon="i-lucide-check-check"
        color="neutral"
        variant="soft"
        size="sm"
        :label="t('sms.actions.markAllPresent')"
        @click="markAllPresent"
      />
      <SmsSubmissionBadge
        v-if="sheet?.submission"
        :status="sheet.submission.status"
      />
      <div class="ml-auto flex flex-wrap items-center gap-2">
        <UButton
          v-if="editable"
          icon="i-lucide-save"
          :label="t('sms.common.save')"
          :loading="saving"
          @click="save"
        />
        <UButton
          v-if="canEdit && sheet?.submission?.status !== 'pending'"
          icon="i-lucide-send"
          color="neutral"
          variant="soft"
          :label="t('sms.actions.submit')"
          @click="submitForReview"
        />
        <UButton
          v-if="canEdit && sheet?.submission && sheet.submission.status !== 'withdrawn'"
          icon="i-lucide-undo-2"
          color="neutral"
          variant="soft"
          :label="t('sms.actions.withdraw')"
          @click="withdraw"
        />
      </div>
    </div>

    <p class="text-xs text-muted">
      {{ t('sms.attendance.rateHint') }}
    </p>

    <UAlert
      v-if="error"
      color="error"
      variant="subtle"
      :description="t('sms.messages.loadFailed')"
    />

    <div
      v-else-if="pending && !sheet"
      class="py-12 text-center text-sm text-muted"
    >
      {{ t('sms.common.loading') }}
    </div>

    <SmsEmptyState
      v-else-if="!sheet?.rows.length"
      icon="i-lucide-clipboard-check"
      :title="t('sms.attendance.empty')"
      :description="t('sms.attendance.emptyHint')"
    />

    <div
      v-else-if="sheet"
      class="overflow-x-auto rounded-xl border border-default"
    >
      <table class="w-full border-collapse text-sm">
        <thead>
          <tr class="bg-elevated/60">
            <th class="border-b border-default px-3 py-2 text-left text-xs font-medium text-muted">
              {{ t('sms.scores.student') }}
            </th>
            <th class="border-b border-l border-default px-3 py-2 text-left text-xs font-medium text-muted">
              {{ t('sms.attendance.status') }}
            </th>
            <th class="border-b border-l border-default px-3 py-2 text-left text-xs font-medium text-muted">
              {{ t('sms.attendance.minutesLate') }}
            </th>
            <th class="border-b border-l border-default px-3 py-2 text-right text-xs font-medium text-muted">
              {{ t('sms.attendance.rate') }}
            </th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="row in sheet.rows"
            :key="row.studentId"
          >
            <th class="border-b border-default px-3 py-2 text-left font-normal">
              <NuxtLink
                :to="`/sms/students/${row.studentId}`"
                class="text-sm font-medium text-highlighted hover:text-primary"
              >
                {{ row.studentName }}
              </NuxtLink>
              <span class="block text-[11px] text-dimmed">{{ row.rollId }}</span>
            </th>
            <td class="border-b border-l border-default px-3 py-2">
              <USelect
                v-if="editable"
                :model-value="draftOf(row.studentId).status"
                :items="statuses.map(status => ({ label: t(`sms.attendance.${status}`), value: status }))"
                size="xs"
                class="w-36"
                @update:model-value="setStatus(row.studentId, $event)"
              />
              <SmsAttendanceBadge
                v-else
                :status="row.status"
              />
            </td>
            <td class="border-b border-l border-default px-3 py-2">
              <UInput
                v-if="editable && draftOf(row.studentId).status === 'late'"
                :model-value="draftOf(row.studentId).minutesLate"
                type="number"
                size="xs"
                class="w-20"
                @update:model-value="setMinutesLate(row.studentId, $event)"
              />
              <span
                v-else
                class="text-muted"
              >{{ row.minutesLate ?? '—' }}</span>
            </td>
            <td class="border-b border-l border-default px-3 py-2 text-right text-muted">
              {{ formatPercent(summaryByStudent.get(row.studentId)?.rate ?? null) }}
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  </div>
</template>
