<script setup lang="ts">
/**
 * One number from the school's dashboards.
 *
 * Rendered as a link when it has a destination (`data-link`, the attribute the
 * school's pages key the click handler on) and as a plain tile otherwise — so
 * the home page's "Students: 412" can also be the door to the directory.
 */
const props = defineProps<{
  label: string
  value: string | number
  icon?: string
  to?: string
}>()
</script>

<template>
  <component
    :is="props.to ? 'NuxtLink' : 'div'"
    :to="props.to"
    class="flex items-center gap-3 rounded-xl border border-default bg-elevated/40 p-4 transition"
    :class="props.to ? 'hover:border-primary' : ''"
  >
    <span
      v-if="props.icon"
      class="flex size-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary"
    >
      <UIcon
        :name="props.icon"
        class="size-5"
      />
    </span>
    <span class="min-w-0">
      <span class="block text-xs uppercase tracking-wide text-muted">{{ props.label }}</span>
      <span class="block text-xl font-semibold text-highlighted">{{ props.value }}</span>
    </span>
  </component>
</template>
