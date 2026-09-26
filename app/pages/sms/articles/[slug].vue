<script setup lang="ts">
/**
 * One article, by its public slug.
 *
 * Drafts answer 404 for everyone but staff (the server enforces it), so this
 * page treats a failed fetch as "not found" rather than trying to reason about
 * why. The read counter is bumped server-side and is not the reader's concern.
 */
definePageMeta({ layout: 'school' })

const route = useRoute()
const { t } = useI18n()
const slug = String(route.params.slug ?? '')

const { data, error } = await useAsyncData(
  `sms:article:${slug}`,
  () => fetchArticle(slug)
)
const article = computed(() => data.value?.article ?? null)
</script>

<template>
  <div class="mx-auto max-w-3xl space-y-6">
    <UAlert
      v-if="error || !article"
      color="error"
      variant="subtle"
      :description="t('sms.messages.notVisible')"
    />

    <article
      v-else
      class="space-y-6"
    >
      <SmsPageHeader
        :title="article.title"
        :subtitle="article.summary ?? undefined"
        back-to="/sms/articles"
      />

      <div class="flex flex-wrap items-center gap-3 text-xs text-muted">
        <span
          v-if="article.authorName"
          class="inline-flex items-center gap-1"
        >
          <UIcon
            name="i-lucide-user"
            class="size-3.5"
          />
          {{ article.authorName }}
        </span>
        <span
          v-if="article.publishedAt"
          class="inline-flex items-center gap-1"
        >
          <UIcon
            name="i-lucide-calendar"
            class="size-3.5"
          />
          {{ formatDateTime(article.publishedAt) }}
        </span>
        <span class="inline-flex items-center gap-1">
          <UIcon
            name="i-lucide-eye"
            class="size-3.5"
          />
          {{ t('sms.articles.readCount', { count: article.readCount }) }}
        </span>
      </div>

      <img
        v-if="article.cover"
        :src="article.cover"
        :alt="article.title"
        class="w-full rounded-xl border border-default object-cover"
      >

      <div
        v-if="article.body"
        class="whitespace-pre-wrap text-[15px] leading-relaxed text-default"
      >
        {{ article.body }}
      </div>

      <NuxtLink
        to="/sms/articles"
        class="inline-flex items-center gap-1 text-sm text-primary hover:underline"
      >
        <UIcon
          name="i-lucide-arrow-left"
          class="size-4"
        />
        {{ t('sms.common.back') }}
      </NuxtLink>
    </article>
  </div>
</template>
