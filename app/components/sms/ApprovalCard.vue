<script setup lang="ts">
import type { SmsApprovalUi } from '../../composables/useSmsChat'

defineProps<{
  approval: SmsApprovalUi
  submitting?: boolean
}>()

const emit = defineEmits<{
  decide: [decision: 'approve' | 'reject']
}>()

const riskClass = (risk?: string) => {
  if (risk === 'high') return 'bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300'
  if (risk === 'medium') return 'bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300'
  return 'bg-elevated text-toned'
}
</script>

<template>
  <div class="mt-2 overflow-hidden rounded-xl border border-amber-300 bg-amber-50/60 dark:border-amber-900 dark:bg-amber-950/30">
    <div class="flex items-center gap-2 border-b border-amber-200 px-3 py-2 dark:border-amber-900">
      <UIcon
        name="i-lucide-shield-alert"
        class="size-4 shrink-0 text-amber-600"
      />
      <p class="flex-1 text-xs font-medium text-amber-900 dark:text-amber-200">
        高风险操作需要确认
      </p>
    </div>

    <div class="space-y-2 p-3">
      <ul class="space-y-1.5">
        <li
          v-for="call in approval.calls"
          :key="call.id"
          class="flex items-center gap-2 text-xs"
        >
          <span class="flex-1 text-highlighted">{{ call.title || call.name }}</span>
          <span
            class="rounded px-1.5 py-0.5 text-[10px] font-medium"
            :class="riskClass(call.riskLevel)"
          >
            {{ call.riskLevel || 'medium' }}
          </span>
        </li>
      </ul>

      <div class="flex justify-end gap-2 pt-1">
        <UButton
          color="neutral"
          variant="ghost"
          size="sm"
          :disabled="submitting"
          @click="emit('decide', 'reject')"
        >
          拒绝
        </UButton>
        <UButton
          color="error"
          size="sm"
          :loading="submitting"
          @click="emit('decide', 'approve')"
        >
          批准执行
        </UButton>
      </div>
    </div>
  </div>
</template>
