<script setup lang="ts">
definePageMeta({ middleware: 'auth', layout: 'sms' })

interface ApprovalItem {
  kind: 'leave' | 'refund'
  taskId: number | null
  subjectId: number
  step: number
  title: string
  assigneeUserId: number | null
  dueAt: string | null
  overdue: boolean
  link: string
}

useHead({ title: 'SMS 审批收件箱' })

const kind = ref<'all' | 'leave' | 'refund'>('all')
const { data, pending, error, refresh } = await useFetch<ApprovalItem[]>('/api/modules/sms/approvals', {
  query: { kind: kind.value === 'all' ? undefined : kind.value }
})

function switchKind(value: 'all' | 'leave' | 'refund'): void {
  kind.value = value
  void refresh()
}

function openInChat(item: ApprovalItem): void {
  const prompt = item.kind === 'leave'
    ? `打开请假审批任务 #${item.subjectId}，帮我确认是否通过。`
    : `打开退费审批任务 #${item.subjectId}，帮我核对金额后审批。`
  void navigateTo({ path: '/sms/chat', query: { prompt } })
}
</script>

<template>
  <div class="p-4">
    <div class="mx-auto max-w-4xl space-y-4">
      <header class="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 class="text-lg font-semibold text-highlighted">
            审批收件箱
          </h1>
          <p class="mt-1 text-xs text-muted">
            请假与退费统一入口，超时任务会标记 SLA。
          </p>
        </div>
        <div class="flex items-center gap-2">
          <UButton
            v-for="option in [{ value: 'all', label: '全部' }, { value: 'leave', label: '请假' }, { value: 'refund', label: '退费' }] as const"
            :key="option.value"
            size="xs"
            :variant="kind === option.value ? 'solid' : 'soft'"
            @click="switchKind(option.value)"
          >
            {{ option.label }}
          </UButton>
          <UButton
            size="xs"
            variant="ghost"
            icon="i-lucide-refresh-cw"
            :loading="pending"
            @click="refresh()"
          >
            刷新
          </UButton>
        </div>
      </header>

      <p
        v-if="error"
        class="rounded-lg border border-error/40 bg-error/10 p-3 text-xs text-error"
      >
        审批收件箱加载失败，请稍后重试。
      </p>

      <p
        v-if="!pending && (data?.length ?? 0) === 0"
        class="rounded-xl border border-default bg-default p-6 text-center text-sm text-muted"
      >
        暂无待办审批
      </p>

      <ul class="space-y-2">
        <li
          v-for="item in data ?? []"
          :key="`${item.kind}-${item.subjectId}-${item.step}`"
          class="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-default bg-default p-4"
        >
          <div class="min-w-0">
            <div class="flex items-center gap-2">
              <UBadge
                :color="item.kind === 'leave' ? 'primary' : 'warning'"
                variant="soft"
                size="sm"
              >
                {{ item.kind === 'leave' ? '请假' : '退费' }}
              </UBadge>
              <UBadge
                v-if="item.overdue"
                color="error"
                variant="soft"
                size="sm"
              >
                已超时
              </UBadge>
            </div>
            <p class="mt-2 truncate text-sm text-highlighted">
              {{ item.title }}
            </p>
            <p class="mt-1 text-xs text-muted">
              第 {{ item.step }} 步 · 截止 {{ item.dueAt ? new Date(item.dueAt).toLocaleString() : '未设置' }}
            </p>
          </div>
          <UButton
            size="xs"
            variant="soft"
            icon="i-lucide-message-square"
            @click="openInChat(item)"
          >
            去处理
          </UButton>
        </li>
      </ul>
    </div>
  </div>
</template>
