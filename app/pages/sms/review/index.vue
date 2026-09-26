<script setup lang="ts">
/**
 * The review queue — teacher submissions waiting for an administrator.
 *
 * Approving and rejecting are an administrator's decision and only apply to a
 * `pending` batch; withdrawing is the submitter taking their own batch back,
 * which is what re-opens the course's marks for editing. A student or guardian
 * sees an empty page (the server returns none), and staff-only messaging tells
 * them why.
 */
import type { Submission } from '../../../composables/useSms'

definePageMeta({ layout: 'school' })

const { t } = useI18n()
const { viewer } = useSmsViewer()
const toast = useToast()

const ANY = 'any'
const page = ref(1)
const pageSize = 20
const status = ref(ANY)
const kind = ref(ANY)
const mine = ref(false)

const isAdmin = computed(() => viewer.value?.admin ?? false)
const isStaff = computed(() => viewer.value?.isStaff ?? false)

const params = computed(() => ({
  page: page.value,
  pageSize,
  status: status.value === ANY ? undefined : status.value,
  kind: kind.value === ANY ? undefined : kind.value,
  mine: mine.value ? 1 : undefined
}))

const { data, pending, error, refresh } = await useAsyncData(
  'sms:submissions',
  () => (isStaff.value ? fetchSubmissions(params.value) : Promise.resolve(null)),
  { watch: [params, isStaff] }
)

const submissions = computed(() => data.value?.items ?? [])
const total = computed(() => data.value?.total ?? 0)

watch([status, kind, mine], () => {
  page.value = 1
})

const statusItems = computed(() => [
  { label: t('sms.common.all'), value: ANY },
  { label: t('sms.review.pending'), value: 'pending' },
  { label: t('sms.review.approved'), value: 'approved' },
  { label: t('sms.review.rejected'), value: 'rejected' },
  { label: t('sms.review.withdrawn'), value: 'withdrawn' }
])
const kindItems = computed(() => [
  { label: t('sms.common.all'), value: ANY },
  { label: t('sms.review.kindScores'), value: 'scores' },
  { label: t('sms.review.kindAttendance'), value: 'attendance' },
  { label: t('sms.review.kindConduct'), value: 'conduct' }
])

function kindLabel(value: string): string {
  if (value === 'scores') return t('sms.review.kindScores')
  if (value === 'attendance') return t('sms.review.kindAttendance')
  return t('sms.review.kindConduct')
}

async function review(submission: Submission, action: 'approve' | 'withdraw', note?: string): Promise<void> {
  try {
    await cPost(`/api/sms/submissions/${submission.id}`, { action, note })
    toast.add({
      title: action === 'approve' ? t('sms.messages.approved') : t('sms.messages.withdrawn'),
      color: 'success'
    })
    await refresh()
  } catch (e: unknown) {
    toast.add({ title: extractErrorMessage(e), color: 'error' })
  }
}

const rejectOpen = ref(false)
const rejectTarget = ref<Submission | null>(null)
const rejectNote = ref('')
const rejecting = ref(false)

function openReject(submission: Submission): void {
  rejectTarget.value = submission
  rejectNote.value = ''
  rejectOpen.value = true
}

async function confirmReject(): Promise<void> {
  const target = rejectTarget.value
  if (!target) return
  rejecting.value = true
  try {
    await cPost(`/api/sms/submissions/${target.id}`, { action: 'reject', note: rejectNote.value || undefined })
    toast.add({ title: t('sms.messages.rejected'), color: 'success' })
    rejectOpen.value = false
    await refresh()
  } catch (e: unknown) {
    toast.add({ title: extractErrorMessage(e), color: 'error' })
  } finally {
    rejecting.value = false
  }
}
</script>

<template>
  <div class="space-y-6">
    <SmsPageHeader
      :title="t('sms.review.title')"
      :subtitle="t('sms.review.subtitle')"
      icon="i-lucide-clipboard-check"
    />

    <UAlert
      v-if="!isStaff"
      color="warning"
      variant="subtle"
      :title="t('sms.messages.notStaff')"
    />

    <template v-else>
      <div class="flex flex-wrap items-center gap-2">
        <USelect
          v-model="status"
          :items="statusItems"
          class="w-40"
        />
        <USelect
          v-model="kind"
          :items="kindItems"
          class="w-40"
        />
        <UButton
          :color="mine ? 'primary' : 'neutral'"
          :variant="mine ? 'soft' : 'ghost'"
          size="sm"
          icon="i-lucide-user"
          :label="t('sms.review.mine')"
          @click="mine = !mine"
        />
        <span class="ml-auto text-xs text-muted">
          {{ t('sms.common.showing', { count: submissions.length, total }) }}
        </span>
      </div>

      <UAlert
        v-if="error"
        color="error"
        variant="subtle"
        :description="t('sms.messages.loadFailed')"
      />

      <div
        v-else-if="pending && !submissions.length"
        class="py-12 text-center text-sm text-muted"
      >
        {{ t('sms.common.loading') }}
      </div>

      <div
        v-else-if="submissions.length"
        class="space-y-3"
      >
        <div
          v-for="submission in submissions"
          :key="submission.id"
          class="rounded-xl border border-default bg-elevated/40 p-4"
        >
          <div class="flex flex-wrap items-center gap-2">
            <SmsSubmissionBadge :status="submission.status" />
            <UBadge
              color="neutral"
              variant="subtle"
              size="sm"
              :label="kindLabel(submission.kind)"
            />
            <span class="font-medium text-highlighted">
              {{ submission.title ?? submission.courseName ?? '—' }}
            </span>
            <span
              v-if="submission.className"
              class="text-xs text-muted"
            >
              {{ submission.className }}
            </span>
            <span class="ml-auto text-xs text-muted">
              {{ t('sms.review.records', { count: submission.recordCount }) }}
            </span>
          </div>

          <dl class="mt-2 flex flex-wrap gap-x-6 gap-y-1 text-xs text-muted">
            <div class="inline-flex items-center gap-1">
              <dt>{{ t('sms.review.submittedBy') }}:</dt>
              <dd class="text-default">
                {{ submission.submitterName ?? '—' }}
              </dd>
            </div>
            <div class="inline-flex items-center gap-1">
              <dt>{{ t('sms.review.submittedAt') }}:</dt>
              <dd class="text-default">
                {{ formatDateTime(submission.submittedAt) }}
              </dd>
            </div>
            <div
              v-if="submission.semesterName"
              class="inline-flex items-center gap-1"
            >
              <dt>{{ t('sms.courses.semester') }}:</dt>
              <dd class="text-default">
                {{ submission.semesterName }}
              </dd>
            </div>
          </dl>

          <p
            v-if="submission.reviewNote"
            class="mt-2 rounded-lg bg-default px-3 py-2 text-xs text-muted"
          >
            {{ t('sms.review.reviewNote') }}: {{ submission.reviewNote }}
          </p>

          <div class="mt-3 flex flex-wrap items-center gap-2">
            <UButton
              v-if="submission.courseId"
              :to="`/sms/courses/${submission.courseId}`"
              icon="i-lucide-book-open"
              color="neutral"
              variant="ghost"
              size="sm"
              :label="t('sms.courses.title')"
            />
            <template v-if="isAdmin && submission.status === 'pending'">
              <UButton
                icon="i-lucide-check"
                color="success"
                variant="soft"
                size="sm"
                :label="t('sms.actions.approve')"
                @click="review(submission, 'approve')"
              />
              <UButton
                icon="i-lucide-x"
                color="error"
                variant="soft"
                size="sm"
                :label="t('sms.actions.reject')"
                @click="openReject(submission)"
              />
            </template>
            <UButton
              v-if="(isAdmin || submission.submittedBy === viewer?.userId) && submission.status !== 'withdrawn'"
              icon="i-lucide-undo-2"
              color="neutral"
              variant="ghost"
              size="sm"
              :label="t('sms.actions.withdraw')"
              @click="review(submission, 'withdraw')"
            />
          </div>
        </div>
      </div>

      <SmsEmptyState
        v-else
        icon="i-lucide-clipboard-check"
        :title="t('sms.review.empty')"
        :description="t('sms.review.emptyHint')"
      />

      <div
        v-if="total > pageSize"
        class="flex justify-end"
      >
        <UPagination
          :page="page"
          :total="total"
          :items-per-page="pageSize"
          size="sm"
          @update:page="page = $event"
        />
      </div>
    </template>

    <UModal
      v-model:open="rejectOpen"
      :title="t('sms.actions.reject')"
      :description="t('sms.review.confirmReject')"
    >
      <template #body>
        <UFormField :label="t('sms.review.reviewNote')">
          <UTextarea
            v-model="rejectNote"
            :rows="4"
            :placeholder="t('sms.review.notePlaceholder')"
            class="w-full"
          />
        </UFormField>
      </template>
      <template #footer>
        <div class="flex justify-end gap-2">
          <UButton
            color="neutral"
            variant="soft"
            :label="t('sms.common.cancel')"
            @click="rejectOpen = false"
          />
          <UButton
            color="error"
            :label="t('sms.actions.reject')"
            :loading="rejecting"
            @click="confirmReject"
          />
        </div>
      </template>
    </UModal>
  </div>
</template>
