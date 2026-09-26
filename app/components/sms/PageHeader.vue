<script setup lang="ts">
/**
 * The heading every school page shares: a title, an optional subtitle, an
 * optional back link and a slot for the page's actions.
 *
 * Keeping it in one place is what makes the pages look like one product —
 * and it means "where does the back link go" is answered once, not per page.
 */
const props = defineProps<{
  title: string
  subtitle?: string
  icon?: string
  backTo?: string
}>()

const { t } = useI18n()
</script>

<template>
  <header class="flex flex-wrap items-end justify-between gap-4">
    <div class="min-w-0">
      <NuxtLink
        v-if="props.backTo"
        :to="props.backTo"
        class="mb-1 inline-flex items-center gap-1 text-xs text-muted hover:text-primary"
      >
        <UIcon
          name="i-lucide-arrow-left"
          class="size-3.5"
        />
        {{ t('sms.common.back') }}
      </NuxtLink>
      <h1 class="flex items-center gap-2 text-2xl font-semibold text-highlighted">
        <UIcon
          v-if="props.icon"
          :name="props.icon"
          class="size-6 shrink-0 text-primary"
        />
        <span class="truncate">{{ props.title }}</span>
      </h1>
      <p
        v-if="props.subtitle"
        class="mt-1 text-sm text-muted"
      >
        {{ props.subtitle }}
      </p>
    </div>
    <div
      v-if="$slots.actions"
      class="flex flex-wrap items-center gap-2"
    >
      <slot name="actions" />
    </div>
  </header>
</template>
