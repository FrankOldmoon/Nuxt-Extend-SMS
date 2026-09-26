<script setup lang="ts">
/**
 * The activities board.
 *
 * Two readings of the same table, chosen by a toggle: `upcoming=1` is "what's
 * on" (soonest first, past events dropped) and the default is the archive
 * (most recent first). The server does the filtering so the total is the number
 * of rows the reader can actually reach.
 */
definePageMeta({ layout: 'school' })

const { t } = useI18n()
const { viewer } = useSmsViewer()
const toast = useToast()

const page = ref(1)
const pageSize = 12
const upcomingOnly = ref(true)

const params = computed(() => ({
  page: page.value,
  pageSize,
  upcoming: upcomingOnly.value ? 1 : undefined
}))

const { data, pending, error, refresh } = await useAsyncData(
  'sms:activities',
  () => fetchActivities(params.value),
  { watch: [params] }
)

const activities = computed(() => data.value?.items ?? [])
const total = computed(() => data.value?.total ?? 0)

watch(upcomingOnly, () => {
  page.value = 1
})

// ------------------------------------------------------------- editor ----

const editorOpen = ref(false)
const saving = ref(false)
const form = reactive({ name: '', location: '', description: '', startAt: '', endAt: '' })

function openCreate(): void {
  form.name = ''
  form.location = ''
  form.description = ''
  form.startAt = ''
  form.endAt = ''
  editorOpen.value = true
}

async function save(): Promise<void> {
  if (!form.name.trim()) return
  saving.value = true
  try {
    await cPost('/api/sms/activities', {
      name: form.name.trim(),
      location: form.location.trim() || undefined,
      description: form.description || undefined,
      startAt: form.startAt || undefined,
      endAt: form.endAt || undefined
    })
    toast.add({ title: t('sms.messages.saved'), color: 'success' })
    editorOpen.value = false
    await refresh()
  } catch (e: unknown) {
    toast.add({ title: extractErrorMessage(e), color: 'error' })
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <div class="space-y-6">
    <SmsPageHeader
      :title="t('sms.activities.title')"
      :subtitle="t('sms.activities.subtitle')"
      icon="i-lucide-calendar-heart"
    >
      <template #actions>
        <UButton
          v-if="viewer?.isStaff"
          icon="i-lucide-plus"
          :label="t('sms.actions.newActivity')"
          @click="openCreate"
        />
      </template>
    </SmsPageHeader>

    <div class="flex flex-wrap items-center gap-2">
      <UButton
        :color="upcomingOnly ? 'primary' : 'neutral'"
        :variant="upcomingOnly ? 'soft' : 'ghost'"
        size="sm"
        icon="i-lucide-calendar-clock"
        :label="t('sms.activities.upcoming')"
        @click="upcomingOnly = true"
      />
      <UButton
        :color="!upcomingOnly ? 'primary' : 'neutral'"
        :variant="!upcomingOnly ? 'soft' : 'ghost'"
        size="sm"
        icon="i-lucide-history"
        :label="t('sms.activities.past')"
        @click="upcomingOnly = false"
      />
      <span class="ml-auto text-xs text-muted">
        {{ t('sms.common.showing', { count: activities.length, total }) }}
      </span>
    </div>

    <UAlert
      v-if="error"
      color="error"
      variant="subtle"
      :description="t('sms.messages.loadFailed')"
    />

    <div
      v-else-if="pending && !activities.length"
      class="py-12 text-center text-sm text-muted"
    >
      {{ t('sms.common.loading') }}
    </div>

    <div
      v-else-if="activities.length"
      class="grid gap-4 sm:grid-cols-2 lg:grid-cols-4"
    >
      <SmsActivityItem
        v-for="activity in activities"
        :key="activity.id"
        :activity="activity"
      />
    </div>

    <SmsEmptyState
      v-else
      icon="i-lucide-calendar-heart"
      :title="t('sms.activities.empty')"
      :description="t('sms.activities.emptyHint')"
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
      v-model:open="editorOpen"
      :title="t('sms.actions.newActivity')"
    >
      <template #body>
        <div class="space-y-3">
          <UFormField :label="t('sms.common.name')">
            <UInput
              v-model="form.name"
              class="w-full"
            />
          </UFormField>
          <UFormField :label="t('sms.activities.location')">
            <UInput
              v-model="form.location"
              class="w-full"
            />
          </UFormField>
          <div class="grid grid-cols-2 gap-3">
            <UFormField :label="t('sms.activities.startAt')">
              <UInput
                v-model="form.startAt"
                type="datetime-local"
                class="w-full"
              />
            </UFormField>
            <UFormField :label="t('sms.activities.endAt')">
              <UInput
                v-model="form.endAt"
                type="datetime-local"
                class="w-full"
              />
            </UFormField>
          </div>
          <UFormField :label="t('sms.common.description')">
            <UTextarea
              v-model="form.description"
              :rows="5"
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
            @click="editorOpen = false"
          />
          <UButton
            :label="t('sms.common.save')"
            :loading="saving"
            :disabled="!form.name.trim()"
            @click="save"
          />
        </div>
      </template>
    </UModal>
  </div>
</template>
