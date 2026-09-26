<script setup lang="ts">
/**
 * One activity.
 *
 * An activity happens at a moment and in a place, so both are shown and the card
 * is marked "past" once the end (or the start, when there is no end) has gone —
 * the archive and the "what's on" strip share this component and differ only in
 * the query they were fetched with.
 */
import type { Activity } from '../../composables/useSms'

const props = defineProps<{ activity: Activity }>()
const { t } = useI18n()

const isPast = computed(() => {
  const moment = props.activity.endAt ?? props.activity.startAt
  return moment != null && new Date(moment) < new Date()
})
</script>

<template>
  <article class="flex flex-col overflow-hidden rounded-xl border border-default bg-elevated/40">
    <img
      v-if="props.activity.cover"
      :src="props.activity.cover"
      :alt="props.activity.name"
      class="h-40 w-full object-cover"
    >
    <div class="flex flex-1 flex-col p-4">
      <div class="flex flex-wrap items-center gap-2">
        <UBadge
          :color="isPast ? 'neutral' : 'success'"
          variant="subtle"
          size="sm"
          :label="isPast ? t('sms.activities.past') : t('sms.activities.upcoming')"
        />
        <UBadge
          v-if="props.activity.semesterName"
          color="neutral"
          variant="subtle"
          size="sm"
          :label="props.activity.semesterName"
        />
      </div>

      <h3 class="mt-2 text-base font-semibold text-highlighted">
        {{ props.activity.name }}
      </h3>

      <dl class="mt-2 space-y-1 text-xs text-muted">
        <div
          v-if="props.activity.startAt"
          class="flex items-center gap-1"
        >
          <UIcon
            name="i-lucide-calendar-clock"
            class="size-3.5"
          />
          <span>{{ formatDateTime(props.activity.startAt) }}</span>
          <span v-if="props.activity.endAt">– {{ formatDateTime(props.activity.endAt) }}</span>
        </div>
        <div
          v-if="props.activity.location"
          class="flex items-center gap-1"
        >
          <UIcon
            name="i-lucide-map-pin"
            class="size-3.5"
          />
          <span>{{ props.activity.location }}</span>
        </div>
      </dl>

      <p
        v-if="props.activity.description"
        class="mt-2 line-clamp-3 text-sm text-muted"
      >
        {{ props.activity.description }}
      </p>
    </div>
  </article>
</template>
