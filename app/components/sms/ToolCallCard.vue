<script setup lang="ts">
import type { SmsToolCall } from '../../composables/useSmsChat'

const props = defineProps<{ card: SmsToolCall }>()

const hasArguments = computed(() => {
  const args = props.card.arguments
  return !!args && typeof args === 'object' && Object.keys(args as Record<string, unknown>).length > 0
})

const statusClass = computed(() => props.card.status === 'success'
  ? 'text-emerald-600 dark:text-emerald-400'
  : 'text-red-500')

const statusIcon = computed(() => props.card.status === 'success'
  ? 'i-lucide-circle-check'
  : 'i-lucide-circle-x')
</script>

<template>
  <details class="group mt-2 rounded-lg border border-default bg-elevated/60 text-xs">
    <summary class="flex cursor-pointer list-none items-center gap-2 px-2.5 py-1.5">
      <UIcon
        :name="statusIcon"
        class="size-3.5 shrink-0"
        :class="statusClass"
      />
      <span class="font-medium text-highlighted">{{ card.title }}</span>
      <span class="min-w-0 flex-1 truncate text-muted">{{ card.summary }}</span>
      <UIcon
        name="i-lucide-chevron-right"
        class="size-3.5 shrink-0 text-muted transition-transform group-open:rotate-90"
      />
    </summary>
    <div class="border-t border-default px-2.5 py-2">
      <p class="mb-1 font-mono text-[11px] text-muted">
        {{ card.name }}
      </p>
      <pre
        v-if="hasArguments"
        class="max-h-48 overflow-auto whitespace-pre-wrap break-all rounded bg-default p-2 font-mono text-[11px] text-toned"
      >{{ JSON.stringify(card.arguments, null, 2) }}</pre>
      <p
        v-else
        class="text-[11px] text-muted"
      >
        无参数
      </p>
    </div>
  </details>
</template>
