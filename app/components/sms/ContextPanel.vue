<script setup lang="ts">
import type { SmsFormUi, SmsToolCall } from '../../composables/useSmsChat'

defineProps<{
  title: string
  toolCalls: SmsToolCall[]
  pendingForm?: SmsFormUi | null
}>()
</script>

<template>
  <div class="space-y-4 p-4 text-xs">
    <div>
      <p class="text-[11px] font-medium uppercase tracking-wide text-muted">
        当前会话
      </p>
      <p class="mt-1 truncate text-sm font-medium text-highlighted">
        {{ title }}
      </p>
    </div>

    <div v-if="pendingForm">
      <p class="text-[11px] font-medium uppercase tracking-wide text-muted">
        待确认
      </p>
      <div class="mt-1 rounded-lg border border-primary/30 bg-primary/5 px-2.5 py-2">
        <p class="font-medium text-highlighted">
          {{ pendingForm.title }}
        </p>
        <p class="mt-0.5 text-muted">
          {{ pendingForm.preview?.summary || '填写表单后提交' }}
        </p>
      </div>
    </div>

    <div v-if="toolCalls.length">
      <p class="text-[11px] font-medium uppercase tracking-wide text-muted">
        最近调用
      </p>
      <ul class="mt-1 space-y-1.5">
        <li
          v-for="call in toolCalls.slice(-5).reverse()"
          :key="call.id"
          class="flex items-start gap-1.5"
        >
          <UIcon
            :name="call.status === 'success' ? 'i-lucide-circle-check' : 'i-lucide-circle-x'"
            class="mt-0.5 size-3.5 shrink-0"
            :class="call.status === 'success' ? 'text-emerald-500' : 'text-red-500'"
          />
          <div class="min-w-0">
            <p class="text-highlighted">
              {{ call.title }}
            </p>
            <p class="truncate text-muted">
              {{ call.summary || call.name }}
            </p>
          </div>
        </li>
      </ul>
    </div>

    <p class="rounded-lg bg-elevated px-2.5 py-2 leading-relaxed text-muted">
      数据范围、组织与权限由服务端判定；写操作必须经过表单确认或审批。
    </p>
  </div>
</template>
