<script setup lang="ts">
import type { SmsToolCall } from '../../composables/useSmsChat'

const props = defineProps<{
  card: SmsToolCall
  /** The message already renders an interactive component for this result. */
  hideTable?: boolean
}>()

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
  <div class="mt-2 rounded-lg border border-default bg-elevated/60 text-xs">
    <div class="flex items-center gap-2 px-2.5 py-1.5">
      <UIcon
        :name="statusIcon"
        class="size-3.5 shrink-0"
        :class="statusClass"
      />
      <span class="shrink-0 font-medium text-highlighted">{{ card.title }}</span>
      <span class="min-w-0 flex-1 truncate text-muted">{{ card.summary }}</span>
    </div>

    <!-- Fixed, server-defined table for read capabilities. Hidden when the
         message's interactive component already displays the same rows. -->
    <SmsResultTable
      v-if="card.table && !hideTable"
      :table="card.table"
      class="mx-2.5 mb-2.5 mt-0"
    />

    <details
      v-if="hasArguments"
      class="group border-t border-default"
    >
      <summary class="flex cursor-pointer list-none items-center gap-1 px-2.5 py-1 text-[11px] text-muted">
        <UIcon
          name="i-lucide-chevron-right"
          class="size-3 transition-transform group-open:rotate-90"
        />
        调用参数
      </summary>
      <pre class="max-h-48 overflow-auto whitespace-pre-wrap break-all border-t border-default px-2.5 py-2 font-mono text-[11px] text-toned">{{ JSON.stringify(card.arguments, null, 2) }}</pre>
    </details>
  </div>
</template>
