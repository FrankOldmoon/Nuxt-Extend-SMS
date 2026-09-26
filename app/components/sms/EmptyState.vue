<script setup lang="ts">
/**
 * The "nothing here" block, shared by every school listing.
 *
 * A dashed border is the signal for "this container is waiting for content",
 * which is deliberately different from an error or a loading spinner. The action
 * is a slot because the useful next step depends on the page.
 */
withDefaults(defineProps<{
  icon?: string
  title?: string
  description?: string
}>(), {
  icon: 'i-lucide-inbox',
  title: undefined,
  description: undefined
})
</script>

<template>
  <div class="flex flex-col items-center justify-center rounded-xl border-2 border-dashed border-default px-6 py-14 text-center">
    <UIcon
      :name="icon"
      class="mb-3 size-10 text-muted"
    />
    <p
      v-if="title"
      class="text-sm font-medium text-highlighted"
    >
      {{ title }}
    </p>
    <p
      v-if="description"
      class="mt-1 max-w-sm text-xs text-muted"
    >
      {{ description }}
    </p>
    <div
      v-if="$slots.action"
      class="mt-4"
    >
      <slot name="action" />
    </div>
  </div>
</template>
