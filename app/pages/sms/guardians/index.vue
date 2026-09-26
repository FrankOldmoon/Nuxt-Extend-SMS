<script setup lang="ts">
/**
 * The guardian directory — the adults a school needs to be able to reach.
 *
 * A guardian is kept separate from the host user because a guardian may have no
 * account at all, so `accountLinked` is shown rather than assumed. The children
 * are attached through the `studentGuardians` pivot and hydrated by the API, so
 * this page is a read of one table plus one join.
 */
definePageMeta({ layout: 'school' })

const { t } = useI18n()

const page = ref(1)
const pageSize = 20
const q = ref('')

const params = computed(() => ({
  page: page.value,
  pageSize,
  q: q.value.trim() || undefined
}))

const { data, pending, error } = await useAsyncData(
  'sms:guardians',
  () => fetchGuardians(params.value),
  { watch: [params] }
)

const guardians = computed(() => data.value?.items ?? [])
const total = computed(() => data.value?.total ?? 0)

watch(q, () => {
  page.value = 1
})
</script>

<template>
  <div class="space-y-6">
    <SmsPageHeader
      :title="t('sms.guardians.title')"
      :subtitle="t('sms.guardians.subtitle')"
      icon="i-lucide-user-round"
    />

    <div class="flex flex-wrap items-center gap-2">
      <UInput
        v-model="q"
        icon="i-lucide-search"
        :placeholder="t('sms.common.search')"
        class="w-56"
      />
      <span class="ml-auto text-xs text-muted">
        {{ t('sms.common.showing', { count: guardians.length, total }) }}
      </span>
    </div>

    <UAlert
      v-if="error"
      color="error"
      variant="subtle"
      :description="t('sms.messages.loadFailed')"
    />

    <div
      v-else-if="pending && !guardians.length"
      class="py-12 text-center text-sm text-muted"
    >
      {{ t('sms.common.loading') }}
    </div>

    <div
      v-else-if="guardians.length"
      class="overflow-x-auto rounded-xl border border-default"
    >
      <table class="w-full border-collapse text-sm">
        <thead>
          <tr class="bg-elevated/60">
            <th class="border-b border-default px-3 py-2 text-left text-xs font-medium text-muted">
              {{ t('sms.common.name') }}
            </th>
            <th class="border-b border-l border-default px-3 py-2 text-left text-xs font-medium text-muted">
              {{ t('sms.guardians.relation') }}
            </th>
            <th class="border-b border-l border-default px-3 py-2 text-left text-xs font-medium text-muted">
              {{ t('sms.guardians.phone') }}
            </th>
            <th class="border-b border-l border-default px-3 py-2 text-left text-xs font-medium text-muted">
              {{ t('sms.guardians.email') }}
            </th>
            <th class="border-b border-l border-default px-3 py-2 text-left text-xs font-medium text-muted">
              {{ t('sms.guardians.children') }}
            </th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="guardian in guardians"
            :key="guardian.id"
          >
            <td class="border-b border-default px-3 py-2">
              <span class="font-medium text-highlighted">{{ guardian.name }}</span>
              <UBadge
                v-if="guardian.userId != null"
                color="info"
                variant="subtle"
                size="sm"
                class="ml-1"
                :label="t('sms.guardians.accountLinked')"
              />
            </td>
            <td class="border-b border-l border-default px-3 py-2 text-muted">
              {{ guardian.relation ? t(`sms.guardians.${relationKey(guardian.relation)}`) : '—' }}
            </td>
            <td class="border-b border-l border-default px-3 py-2 text-muted">
              {{ guardian.phone ?? '—' }}
            </td>
            <td class="border-b border-l border-default px-3 py-2 text-muted">
              {{ guardian.email ?? '—' }}
            </td>
            <td class="border-b border-l border-default px-3 py-2">
              <div
                v-if="guardian.students.length"
                class="flex flex-wrap gap-1"
              >
                <NuxtLink
                  v-for="child in guardian.students"
                  :key="child.id"
                  :to="`/sms/students/${child.id}`"
                  class="inline-flex items-center gap-1 rounded-full bg-elevated px-2 py-0.5 text-xs hover:text-primary"
                >
                  {{ child.name }}
                  <UIcon
                    v-if="child.isPrimary"
                    name="i-lucide-star"
                    class="size-3 text-primary"
                  />
                </NuxtLink>
              </div>
              <span
                v-else
                class="text-xs text-muted"
              >—</span>
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <SmsEmptyState
      v-else
      icon="i-lucide-user-round"
      :title="t('sms.guardians.empty')"
      :description="t('sms.guardians.emptyHint')"
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
