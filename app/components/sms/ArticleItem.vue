<script setup lang="ts">
/**
 * One article in the archive. The whole tile is the link — an article is read,
 * not actioned — and drafts (published in the future, only visible to staff) are
 * labelled so a staff member does not mistake one for live content.
 */
import type { Article } from '../../composables/useSms'

const props = defineProps<{ article: Article }>()
const { t } = useI18n()

const isDraft = computed(() =>
  props.article.publishedAt == null || new Date(props.article.publishedAt) > new Date())
</script>

<template>
  <NuxtLink
    :to="`/sms/articles/${props.article.slug}`"
    class="group flex flex-col overflow-hidden rounded-xl border border-default bg-elevated/40 transition hover:border-primary"
  >
    <img
      v-if="props.article.cover"
      :src="props.article.cover"
      :alt="props.article.title"
      class="h-40 w-full object-cover"
    >
    <div class="flex flex-1 flex-col p-4">
      <div class="flex items-center gap-2">
        <UBadge
          v-if="isDraft"
          color="warning"
          variant="subtle"
          size="sm"
          :label="t('sms.common.status')"
        />
        <span
          v-if="props.article.publishedAt"
          class="text-xs text-muted"
        >
          {{ formatDateTime(props.article.publishedAt) }}
        </span>
      </div>
      <h3 class="mt-2 text-base font-semibold text-highlighted group-hover:text-primary">
        {{ props.article.title }}
      </h3>
      <p
        v-if="props.article.summary"
        class="mt-1 line-clamp-3 text-sm text-muted"
      >
        {{ props.article.summary }}
      </p>
      <div class="mt-auto flex items-center gap-3 pt-3 text-xs text-dimmed">
        <span
          v-if="props.article.authorName"
          class="inline-flex items-center gap-1"
        >
          <UIcon
            name="i-lucide-user"
            class="size-3.5"
          />
          {{ props.article.authorName }}
        </span>
        <span class="inline-flex items-center gap-1">
          <UIcon
            name="i-lucide-eye"
            class="size-3.5"
          />
          {{ t('sms.articles.readCount', { count: props.article.readCount }) }}
        </span>
      </div>
    </div>
  </NuxtLink>
</template>
