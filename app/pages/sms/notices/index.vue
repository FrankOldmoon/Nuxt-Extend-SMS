<script setup lang="ts">
/**
 * The notice board.
 *
 * Public, and filtered server-side: the API only ever returns what has been
 * published and has not expired, so the paging total is honest. The audience
 * filter is a staff convenience — a visitor's board is already scoped by the
 * server to the audiences they belong to.
 */
definePageMeta({ layout: 'school' })

const { t } = useI18n()

/** `USelect` rejects an empty value, so "no filter" is a named sentinel. */
const ANY = 'any'

const page = ref(1)
const pageSize = 20
const q = ref('')
const audience = ref(ANY)

const params = computed(() => ({
  page: page.value,
  pageSize,
  q: q.value.trim() || undefined,
  audience: audience.value === ANY ? undefined : audience.value
}))

const { data, pending, error } = await useAsyncData(
  'sms:notices',
  () => fetchNotices(params.value),
  { watch: [params] }
)

const notices = computed(() => data.value?.items ?? [])
const total = computed(() => data.value?.total ?? 0)

watch([q, audience], () => {
  page.value = 1
})

const audienceItems = computed(() => [
  { label: t('sms.common.all'), value: ANY },
  { label: t('sms.notices.audienceAll'), value: 'all' },
  { label: t('sms.notices.audienceTeachers'), value: 'teachers' },
  { label: t('sms.notices.audienceStudents'), value: 'students' },
  { label: t('sms.notices.audienceGuardians'), value: 'guardians' }
])
</script>

<template>
  <div class="space-y-6">
    <SmsPageHeader
      :title="t('sms.notices.title')"
      :subtitle="t('sms.notices.subtitle')"
      icon="i-lucide-megaphone"
    />

    <div class="flex flex-wrap items-center gap-2">
      <UInput
        v-model="q"
        icon="i-lucide-search"
        :placeholder="t('sms.common.search')"
        class="w-64"
      />
      <USelect
        v-model="audience"
        :items="audienceItems"
        class="w-40"
      />
      <span class="ml-auto text-xs text-muted">
        {{ t('sms.common.showing', { count: notices.length, total }) }}
      </span>
    </div>

    <UAlert
      v-if="error"
      color="error"
      variant="subtle"
      :description="t('sms.messages.loadFailed')"
    />

    <div
      v-else-if="pending && !notices.length"
      class="py-12 text-center text-sm text-muted"
    >
      {{ t('sms.common.loading') }}
    </div>

    <div
      v-else-if="notices.length"
      class="grid gap-3 lg:grid-cols-2"
    >
      <SmsNoticeItem
        v-for="notice in notices"
        :key="notice.id"
        :notice="notice"
      />
    </div>

    <SmsEmptyState
      v-else
      icon="i-lucide-megaphone"
      :title="t('sms.notices.empty')"
      :description="t('sms.notices.emptyHint')"
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
  </div>
</template>
