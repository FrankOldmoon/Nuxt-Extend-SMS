<script setup lang="ts">
/**
 * One notice on the board.
 *
 * The body is clamped until asked for: a notice board is scanned, not read, so
 * the first thing a visitor sees is the set of headlines and the pinned ones
 * float to the top (the API already ordered them). The audience badge is shown
 * because a teacher and a parent see different boards from the same list.
 */
import type { Notice } from '../../composables/useSms'

const props = defineProps<{ notice: Notice }>()
const { t } = useI18n()

const expanded = ref(false)

const audienceLabel = computed(() => {
  const key = props.notice.audience
  return t(`sms.notices.audience${key.charAt(0).toUpperCase()}${key.slice(1)}`)
})
</script>

<template>
  <article class="rounded-xl border border-default bg-elevated/40 p-4">
    <div class="flex flex-wrap items-center gap-2">
      <UBadge
        v-if="props.notice.isPinned"
        color="primary"
        variant="subtle"
        size="sm"
        icon="i-lucide-pin"
        :label="t('sms.notices.pinned')"
      />
      <UBadge
        color="neutral"
        variant="subtle"
        size="sm"
        :label="audienceLabel"
      />
      <span
        v-if="props.notice.publishedAt"
        class="ml-auto text-xs text-muted"
      >
        {{ formatDateTime(props.notice.publishedAt) }}
      </span>
    </div>

    <h3 class="mt-2 text-base font-semibold text-highlighted">
      {{ props.notice.title }}
    </h3>
    <p
      v-if="props.notice.body"
      class="mt-1 whitespace-pre-wrap text-sm text-muted"
      :class="expanded ? '' : 'line-clamp-3'"
    >
      {{ props.notice.body }}
    </p>
    <button
      v-if="props.notice.body && props.notice.body.length > 120"
      type="button"
      class="mt-1 text-xs font-medium text-primary hover:underline"
      @click="expanded = !expanded"
    >
      {{ expanded ? t('sms.common.close') : t('sms.common.more') }}
    </button>

    <p
      v-if="props.notice.authorName"
      class="mt-2 text-xs text-dimmed"
    >
      {{ props.notice.authorName }}
    </p>
  </article>
</template>
