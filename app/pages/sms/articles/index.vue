<script setup lang="ts">
/**
 * The article archive.
 *
 * Anonymous visitors see published articles; staff also see their drafts, which
 * is why the "new article" action only appears for staff. Editing writes through
 * the same `POST /api/sms/articles` route (the presence of `id` decides create
 * vs update), and the slug is derived server-side from the title.
 */
definePageMeta({ layout: 'school' })

const { t } = useI18n()
const { viewer } = useSmsViewer()
const toast = useToast()

const page = ref(1)
const pageSize = 12
const q = ref('')

const params = computed(() => ({
  page: page.value,
  pageSize,
  q: q.value.trim() || undefined
}))

const { data, pending, error, refresh } = await useAsyncData(
  'sms:articles',
  () => fetchArticles(params.value),
  { watch: [params] }
)

const articles = computed(() => data.value?.items ?? [])
const total = computed(() => data.value?.total ?? 0)

watch(q, () => {
  page.value = 1
})

// ------------------------------------------------------------- editor ----

const editorOpen = ref(false)
const saving = ref(false)
const form = reactive({ id: null as number | null, title: '', summary: '', cover: '', body: '' })

function openCreate(): void {
  form.id = null
  form.title = ''
  form.summary = ''
  form.cover = ''
  form.body = ''
  editorOpen.value = true
}

async function save(): Promise<void> {
  if (!form.title.trim()) return
  saving.value = true
  try {
    await cPost('/api/sms/articles', {
      id: form.id ?? undefined,
      title: form.title.trim(),
      summary: form.summary.trim() || undefined,
      cover: form.cover.trim() || undefined,
      body: form.body || undefined
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
      :title="t('sms.articles.title')"
      :subtitle="t('sms.articles.subtitle')"
      icon="i-lucide-newspaper"
    >
      <template #actions>
        <UButton
          v-if="viewer?.isStaff"
          icon="i-lucide-plus"
          :label="t('sms.actions.newArticle')"
          @click="openCreate"
        />
      </template>
    </SmsPageHeader>

    <div class="flex flex-wrap items-center gap-2">
      <UInput
        v-model="q"
        icon="i-lucide-search"
        :placeholder="t('sms.common.search')"
        class="w-64"
      />
      <span class="ml-auto text-xs text-muted">
        {{ t('sms.common.showing', { count: articles.length, total }) }}
      </span>
    </div>

    <UAlert
      v-if="error"
      color="error"
      variant="subtle"
      :description="t('sms.messages.loadFailed')"
    />

    <div
      v-else-if="pending && !articles.length"
      class="py-12 text-center text-sm text-muted"
    >
      {{ t('sms.common.loading') }}
    </div>

    <div
      v-else-if="articles.length"
      class="grid gap-4 sm:grid-cols-2 lg:grid-cols-4"
    >
      <SmsArticleItem
        v-for="article in articles"
        :key="article.id"
        :article="article"
      />
    </div>

    <SmsEmptyState
      v-else
      icon="i-lucide-newspaper"
      :title="t('sms.articles.empty')"
      :description="t('sms.articles.emptyHint')"
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
      :title="t('sms.actions.newArticle')"
    >
      <template #body>
        <div class="space-y-3">
          <UFormField :label="t('sms.common.name')">
            <UInput
              v-model="form.title"
              class="w-full"
            />
          </UFormField>
          <UFormField :label="t('sms.articles.summary')">
            <UInput
              v-model="form.summary"
              class="w-full"
            />
          </UFormField>
          <UFormField :label="t('sms.articles.cover')">
            <UInput
              v-model="form.cover"
              placeholder="https://…"
              class="w-full"
            />
          </UFormField>
          <UFormField :label="t('sms.common.description')">
            <UTextarea
              v-model="form.body"
              :rows="8"
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
            :disabled="!form.title.trim()"
            @click="save"
          />
        </div>
      </template>
    </UModal>
  </div>
</template>
