<script setup lang="ts">
/**
 * Feedback — a signed-in user's problem report or suggestion, and the staff
 * queue that handles them.
 *
 * One route answers both audiences: staff read the whole queue and may move an
 * item through open / in progress / closed with a reply; everyone else reads
 * only their own (which the server enforces by `userId`). Sending requires a
 * session, because a report with no owner is not actionable.
 */
import type { Feedback } from '../../../composables/useSms'

definePageMeta({ layout: 'school' })

const { t } = useI18n()
const { viewer } = useSmsViewer()
const toast = useToast()

const isStaff = computed(() => viewer.value?.isStaff ?? false)
const signedIn = computed(() => viewer.value?.signedIn ?? false)

const ANY = 'any'
const page = ref(1)
const pageSize = 20
const status = ref(ANY)
const kind = ref(ANY)
const q = ref('')

const params = computed(() => ({
  page: page.value,
  pageSize,
  status: status.value === ANY ? undefined : status.value,
  kind: kind.value === ANY ? undefined : kind.value,
  q: q.value.trim() || undefined
}))

const { data, pending, error, refresh } = await useAsyncData(
  'sms:feedback',
  () => fetchFeedback(params.value),
  { watch: [params] }
)

const items = computed(() => data.value?.items ?? [])
const total = computed(() => data.value?.total ?? 0)

watch([status, kind, q], () => {
  page.value = 1
})

const kindItems = computed(() => [
  { label: t('sms.common.all'), value: ANY },
  { label: t('sms.feedback.bug'), value: 'bug' },
  { label: t('sms.feedback.suggestion'), value: 'suggestion' },
  { label: t('sms.feedback.other'), value: 'other' }
])
const statusItems = computed(() => [
  { label: t('sms.common.all'), value: ANY },
  { label: t('sms.feedback.open'), value: 'open' },
  { label: t('sms.feedback.inProgress'), value: 'in_progress' },
  { label: t('sms.feedback.closed'), value: 'closed' }
])

function kindLabel(value: string): string {
  if (value === 'bug') return t('sms.feedback.bug')
  if (value === 'suggestion') return t('sms.feedback.suggestion')
  return t('sms.feedback.other')
}

function statusLabel(value: string): string {
  if (value === 'in_progress') return t('sms.feedback.inProgress')
  if (value === 'closed') return t('sms.feedback.closed')
  return t('sms.feedback.open')
}

function statusColor(value: string): 'success' | 'warning' | 'neutral' {
  if (value === 'closed') return 'success'
  if (value === 'in_progress') return 'warning'
  return 'neutral'
}

// --------------------------------------------------------------- send ----

const form = reactive({ kind: 'bug', title: '', body: '' })
const sending = ref(false)

async function send(): Promise<void> {
  if (!form.title.trim()) return
  sending.value = true
  try {
    await cPost('/api/sms/feedback', {
      kind: form.kind,
      title: form.title.trim(),
      body: form.body || undefined
    })
    toast.add({ title: t('sms.messages.sent'), color: 'success' })
    form.title = ''
    form.body = ''
    await refresh()
  } catch (e: unknown) {
    toast.add({ title: extractErrorMessage(e), color: 'error' })
  } finally {
    sending.value = false
  }
}

// ------------------------------------------------------------- handle ----

const handleOpen = ref(false)
const target = ref<Feedback | null>(null)
const replyStatus = ref('open')
const reply = ref('')
const savingReply = ref(false)

function openHandle(item: Feedback): void {
  target.value = item
  replyStatus.value = item.status
  reply.value = item.reply ?? ''
  handleOpen.value = true
}

async function saveHandle(): Promise<void> {
  const item = target.value
  if (!item) return
  savingReply.value = true
  try {
    await cPost(`/api/sms/feedback/${item.id}`, { status: replyStatus.value, reply: reply.value })
    toast.add({ title: t('sms.messages.replied'), color: 'success' })
    handleOpen.value = false
    await refresh()
  } catch (e: unknown) {
    toast.add({ title: extractErrorMessage(e), color: 'error' })
  } finally {
    savingReply.value = false
  }
}
</script>

<template>
  <div class="space-y-6">
    <SmsPageHeader
      :title="t('sms.feedback.title')"
      :subtitle="t('sms.feedback.subtitle')"
      icon="i-lucide-message-square-warning"
    />

    <!-- Send -->
    <section class="rounded-xl border border-default bg-elevated/40 p-4">
      <div
        v-if="signedIn"
        class="space-y-3"
      >
        <div class="flex flex-wrap items-center gap-2">
          <USelect
            v-model="form.kind"
            :items="[
              { label: t('sms.feedback.bug'), value: 'bug' },
              { label: t('sms.feedback.suggestion'), value: 'suggestion' },
              { label: t('sms.feedback.other'), value: 'other' }
            ]"
            class="w-40"
          />
          <UInput
            v-model="form.title"
            :placeholder="t('sms.common.name')"
            class="min-w-64 flex-1"
          />
        </div>
        <UTextarea
          v-model="form.body"
          :rows="3"
          :placeholder="t('sms.feedback.body')"
          class="w-full"
        />
        <div class="flex justify-end">
          <UButton
            icon="i-lucide-send"
            :label="t('sms.actions.send')"
            :loading="sending"
            :disabled="!form.title.trim()"
            @click="send"
          />
        </div>
      </div>
      <p
        v-else
        class="text-sm text-muted"
      >
        {{ t('sms.messages.notSignedIn') }}
        <NuxtLink
          to="/login"
          class="text-primary hover:underline"
        >
          {{ t('sms.actions.signIn') }}
        </NuxtLink>
      </p>
    </section>

    <!-- Filters -->
    <div
      v-if="signedIn"
      class="flex flex-wrap items-center gap-2"
    >
      <UInput
        v-if="isStaff"
        v-model="q"
        icon="i-lucide-search"
        :placeholder="t('sms.common.search')"
        class="w-56"
      />
      <USelect
        v-if="isStaff"
        v-model="status"
        :items="statusItems"
        class="w-40"
      />
      <USelect
        v-model="kind"
        :items="kindItems"
        class="w-40"
      />
      <span class="ml-auto text-xs text-muted">
        {{ t('sms.common.showing', { count: items.length, total }) }}
      </span>
    </div>

    <UAlert
      v-if="error"
      color="error"
      variant="subtle"
      :description="t('sms.messages.loadFailed')"
    />

    <div
      v-else-if="pending && !items.length"
      class="py-12 text-center text-sm text-muted"
    >
      {{ t('sms.common.loading') }}
    </div>

    <div
      v-else-if="items.length"
      class="space-y-3"
    >
      <article
        v-for="item in items"
        :key="item.id"
        class="rounded-xl border border-default bg-elevated/40 p-4"
      >
        <div class="flex flex-wrap items-center gap-2">
          <UBadge
            :color="statusColor(item.status)"
            variant="subtle"
            size="sm"
            :label="statusLabel(item.status)"
          />
          <UBadge
            color="neutral"
            variant="subtle"
            size="sm"
            :label="kindLabel(item.kind)"
          />
          <span class="font-medium text-highlighted">{{ item.title }}</span>
          <span class="ml-auto text-xs text-muted">
            {{ formatDateTime(item.createdAt) }}
          </span>
        </div>

        <p
          v-if="item.userName"
          class="mt-1 text-xs text-muted"
        >
          {{ item.userName }}
        </p>
        <p
          v-if="item.body"
          class="mt-2 whitespace-pre-wrap text-sm text-default"
        >
          {{ item.body }}
        </p>

        <div
          v-if="item.reply"
          class="mt-3 rounded-lg bg-default px-3 py-2 text-sm"
        >
          <p class="text-xs font-medium text-muted">
            {{ t('sms.feedback.reply') }}
          </p>
          <p class="mt-0.5 whitespace-pre-wrap text-default">
            {{ item.reply }}
          </p>
        </div>

        <div
          v-if="isStaff"
          class="mt-3 flex justify-end"
        >
          <UButton
            icon="i-lucide-reply"
            color="neutral"
            variant="soft"
            size="sm"
            :label="t('sms.actions.reply')"
            @click="openHandle(item)"
          />
        </div>
      </article>
    </div>

    <SmsEmptyState
      v-else
      icon="i-lucide-message-square-warning"
      :title="t('sms.feedback.empty')"
      :description="isStaff ? t('sms.feedback.emptyHintStaff') : t('sms.feedback.emptyHint')"
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

    <UModal
      v-model:open="handleOpen"
      :title="t('sms.actions.reply')"
    >
      <template #body>
        <div class="space-y-3">
          <UFormField :label="t('sms.common.status')">
            <USelect
              v-model="replyStatus"
              :items="[
                { label: t('sms.feedback.open'), value: 'open' },
                { label: t('sms.feedback.inProgress'), value: 'in_progress' },
                { label: t('sms.feedback.closed'), value: 'closed' }
              ]"
              class="w-full"
            />
          </UFormField>
          <UFormField :label="t('sms.feedback.reply')">
            <UTextarea
              v-model="reply"
              :rows="4"
              class="w-full"
            />
          </UFormField>
        </div>
      </template>
      <template #footer>
        <div class="flex justify-end gap-2">
          <UButton
            color="neutral"
            variant="soft"
            :label="t('sms.common.cancel')"
            @click="handleOpen = false"
          />
          <UButton
            :label="t('sms.common.save')"
            :loading="savingReply"
            @click="saveHandle"
          />
        </div>
      </template>
    </UModal>
  </div>
</template>
