<script setup lang="ts">
definePageMeta({ middleware: 'auth', layout: 'sms' })

type InboxStatus = 'pending' | 'approved' | 'rejected' | 'cancelled'

interface ApprovalItem {
  kind: 'leave' | 'refund'
  taskId: number | null
  subjectId: number
  step: number
  title: string
  assigneeUserId: number | null
  dueAt: string | null
  overdue: boolean
  status: InboxStatus
  comment: string | null
  decidedAt: string | null
  link: string
}

useHead({ title: 'SMS 审批收件箱' })

const kind = ref<'all' | 'leave' | 'refund'>('all')
const status = ref<'pending' | 'approved' | 'rejected' | 'cancelled' | 'all'>('pending')
const query = computed(() => ({
  kind: kind.value === 'all' ? undefined : kind.value,
  status: status.value,
  limit: 100
}))

const { data, pending, error, refresh } = await useFetch<ApprovalItem[]>('/api/modules/sms/approvals', { query })

const selected = ref<string[]>([])
const comment = ref('')
const submitting = ref(false)
const actionError = ref('')
const actionMessage = ref('')
const detail = ref<ApprovalItem | null>(null)
const now = ref(Date.now())

let ticker: ReturnType<typeof setInterval> | null = null

const statusOptions = [
  { label: '待办', value: 'pending' },
  { label: '已通过', value: 'approved' },
  { label: '已驳回', value: 'rejected' },
  { label: '已取消', value: 'cancelled' },
  { label: '全部', value: 'all' }
]

const STATUS_LABELS: Record<InboxStatus, string> = {
  pending: '待办',
  approved: '已通过',
  rejected: '已驳回',
  cancelled: '已取消'
}

function itemKey(item: ApprovalItem): string {
  return `${item.kind}-${item.subjectId}`
}

const selectableItems = computed(() => (data.value ?? []).filter(item => item.status === 'pending'))
const selectedItems = computed(() => selectableItems.value.filter(item => selected.value.includes(itemKey(item))))
const allSelected = computed(() => selectableItems.value.length > 0
  && selectableItems.value.every(item => selected.value.includes(itemKey(item))))

function toggleAll(): void {
  selected.value = allSelected.value ? [] : selectableItems.value.map(itemKey)
}

function toggle(item: ApprovalItem): void {
  if (item.status !== 'pending') return
  const key = itemKey(item)
  selected.value = selected.value.includes(key)
    ? selected.value.filter(value => value !== key)
    : [...selected.value, key]
}

function switchKind(value: 'all' | 'leave' | 'refund'): void {
  kind.value = value
  selected.value = []
}

async function decide(decision: 'approve' | 'reject'): Promise<void> {
  actionError.value = ''
  actionMessage.value = ''
  if (selectedItems.value.length === 0) {
    actionError.value = '请先选择待办审批'
    return
  }
  submitting.value = true
  try {
    const result = await $fetch<{ total: number, succeeded: number, failed: number, results: Array<{ ok: boolean, message?: string }> }>(
      '/api/modules/sms/approvals/decide',
      {
        method: 'POST',
        body: {
          decision,
          comment: comment.value || undefined,
          items: selectedItems.value.map(item => ({ kind: item.kind, subjectId: item.subjectId }))
        }
      }
    )
    actionMessage.value = `已提交 ${result.total} 条：成功 ${result.succeeded}，失败 ${result.failed}`
    const failed = result.results.filter(item => !item.ok && item.message)
    if (failed.length > 0) {
      actionError.value = failed.slice(0, 3).map(item => item.message).join('；')
    }
    selected.value = []
    comment.value = ''
    await refresh()
  } catch (err) {
    actionError.value = err instanceof Error ? err.message : '审批提交失败'
  } finally {
    submitting.value = false
  }
}

function formatRemaining(dueAt: string | null): { text: string, overdue: boolean } {
  if (!dueAt) return { text: '未设置 SLA', overdue: false }
  const diff = new Date(dueAt).getTime() - now.value
  const overdue = diff < 0
  const absolute = Math.abs(diff)
  const hours = Math.floor(absolute / 3_600_000)
  const minutes = Math.floor((absolute % 3_600_000) / 60_000)
  const value = hours > 0 ? `${hours} 小时 ${minutes} 分` : `${minutes} 分`
  return { text: overdue ? `已超时 ${value}` : `剩余 ${value}`, overdue }
}

function openInChat(item: ApprovalItem): void {
  const prompt = item.kind === 'leave'
    ? `打开请假审批任务 #${item.subjectId}，帮我确认是否通过。`
    : `打开退费审批任务 #${item.subjectId}，帮我核对金额后审批。`
  void navigateTo({ path: '/sms/chat', query: { prompt } })
}

onMounted(() => {
  ticker = setInterval(() => {
    now.value = Date.now()
  }, 60_000)
})
onBeforeUnmount(() => {
  if (ticker) clearInterval(ticker)
})
</script>

<template>
  <div class="min-h-0 flex-1 overflow-y-auto p-4">
    <div class="mx-auto max-w-4xl space-y-4">
      <header class="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 class="text-lg font-semibold text-highlighted">
            审批收件箱
          </h1>
          <p class="mt-1 text-xs text-muted">
            请假与退费统一入口；已选 {{ selectedItems.length }} 条待办。
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

      <USelect
        v-model="status"
        :items="statusOptions"
        value-key="value"
        class="w-36"
        @update:model-value="selected = []"
      />

      <p
        v-if="error"
        class="rounded-lg border border-error/40 bg-error/10 p-3 text-xs text-error"
      >
        审批收件箱加载失败，请稍后重试。
      </p>

      <div
        v-if="status === 'pending' && selectableItems.length > 0"
        class="flex flex-wrap items-center gap-2 rounded-xl border border-default bg-elevated/40 p-3"
      >
        <UButton
          size="xs"
          variant="soft"
          @click="toggleAll()"
        >
          {{ allSelected ? '取消全选' : '全选待办' }}
        </UButton>
        <UInput
          v-model="comment"
          placeholder="审批意见（可选）"
          class="min-w-48 flex-1"
        />
        <UButton
          size="xs"
          color="success"
          icon="i-lucide-check"
          :loading="submitting"
          :disabled="selectedItems.length === 0"
          @click="decide('approve')"
        >
          批量同意
        </UButton>
        <UButton
          size="xs"
          color="error"
          icon="i-lucide-x"
          :loading="submitting"
          :disabled="selectedItems.length === 0"
          @click="decide('reject')"
        >
          批量驳回
        </UButton>
      </div>

      <p
        v-if="actionError"
        class="rounded-lg border border-error/40 bg-error/10 p-3 text-xs text-error"
      >
        {{ actionError }}
      </p>
      <p
        v-if="actionMessage"
        class="rounded-lg border border-success/40 bg-success/10 p-3 text-xs text-success"
      >
        {{ actionMessage }}
      </p>

      <p
        v-if="!pending && (data?.length ?? 0) === 0"
        class="rounded-xl border border-default bg-default p-6 text-center text-sm text-muted"
      >
        当前筛选下没有审批记录
      </p>

      <ul class="space-y-2">
        <li
          v-for="item in data ?? []"
          :key="itemKey(item)"
          class="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-default bg-default p-4"
          :class="selected.includes(itemKey(item)) ? 'border-primary/50' : ''"
        >
          <div class="flex min-w-0 items-start gap-3">
            <input
              v-if="item.status === 'pending'"
              type="checkbox"
              class="mt-1"
              :checked="selected.includes(itemKey(item))"
              :aria-label="`选择 ${item.title}`"
              @change="toggle(item)"
            >
            <div class="min-w-0">
              <div class="flex flex-wrap items-center gap-2">
                <UBadge
                  :color="item.kind === 'leave' ? 'primary' : 'warning'"
                  variant="soft"
                  size="sm"
                >
                  {{ item.kind === 'leave' ? '请假' : '退费' }}
                </UBadge>
                <UBadge
                  :color="item.status === 'pending' ? 'neutral' : item.status === 'approved' ? 'success' : 'error'"
                  variant="soft"
                  size="sm"
                >
                  {{ STATUS_LABELS[item.status] }}
                </UBadge>
                <UBadge
                  v-if="item.status === 'pending' && formatRemaining(item.dueAt).overdue"
                  color="error"
                  variant="soft"
                  size="sm"
                >
                  {{ formatRemaining(item.dueAt).text }}
                </UBadge>
              </div>
              <p class="mt-2 truncate text-sm text-highlighted">
                {{ item.title }}
              </p>
              <p class="mt-1 text-xs text-muted">
                第 {{ item.step }} 步 ·
                截止 {{ item.dueAt ? new Date(item.dueAt).toLocaleString() : '未设置' }}
                <template v-if="item.status === 'pending'">
                  · {{ formatRemaining(item.dueAt).text }}
                </template>
              </p>
            </div>
          </div>
          <div class="flex items-center gap-2">
            <UButton
              size="xs"
              variant="ghost"
              icon="i-lucide-eye"
              @click="detail = item"
            >
              详情
            </UButton>
            <UButton
              v-if="item.status === 'pending'"
              size="xs"
              variant="soft"
              icon="i-lucide-message-square"
              @click="openInChat(item)"
            >
              去处理
            </UButton>
          </div>
        </li>
      </ul>
    </div>

    <Teleport to="body">
      <div
        v-if="detail"
        class="fixed inset-0 z-50 flex justify-end bg-black/40"
        @click.self="detail = null"
      >
        <aside class="flex h-full w-full max-w-md flex-col overflow-y-auto border-l border-default bg-default p-4">
          <header class="flex items-center justify-between">
            <h2 class="text-sm font-semibold text-highlighted">
              审批详情
            </h2>
            <UButton
              size="xs"
              variant="ghost"
              icon="i-lucide-x"
              aria-label="关闭"
              @click="detail = null"
            />
          </header>
          <dl class="mt-4 space-y-3 text-sm">
            <div>
              <dt class="text-xs text-muted">
                标题
              </dt>
              <dd class="mt-0.5 text-highlighted">
                {{ detail.title }}
              </dd>
            </div>
            <div class="grid grid-cols-2 gap-3">
              <div>
                <dt class="text-xs text-muted">
                  类型
                </dt>
                <dd class="mt-0.5">
                  {{ detail.kind === 'leave' ? '请假' : '退费' }}
                </dd>
              </div>
              <div>
                <dt class="text-xs text-muted">
                  状态
                </dt>
                <dd class="mt-0.5">
                  {{ STATUS_LABELS[detail.status] }}
                </dd>
              </div>
              <div>
                <dt class="text-xs text-muted">
                  步骤
                </dt>
                <dd class="mt-0.5">
                  {{ detail.step }}
                </dd>
              </div>
              <div>
                <dt class="text-xs text-muted">
                  SLA
                </dt>
                <dd
                  class="mt-0.5"
                  :class="formatRemaining(detail.dueAt).overdue && detail.status === 'pending' ? 'text-error' : ''"
                >
                  {{ formatRemaining(detail.dueAt).text }}
                </dd>
              </div>
              <div>
                <dt class="text-xs text-muted">
                  截止时间
                </dt>
                <dd class="mt-0.5">
                  {{ detail.dueAt ? new Date(detail.dueAt).toLocaleString() : '—' }}
                </dd>
              </div>
              <div>
                <dt class="text-xs text-muted">
                  审批时间
                </dt>
                <dd class="mt-0.5">
                  {{ detail.decidedAt ? new Date(detail.decidedAt).toLocaleString() : '—' }}
                </dd>
              </div>
            </div>
            <div>
              <dt class="text-xs text-muted">
                审批意见
              </dt>
              <dd class="mt-0.5 text-toned">
                {{ detail.comment || '—' }}
              </dd>
            </div>
          </dl>
          <div class="mt-auto pt-6">
            <UButton
              block
              variant="soft"
              icon="i-lucide-message-square"
              @click="openInChat(detail)"
            >
              去聊天处理
            </UButton>
          </div>
        </aside>
      </div>
    </Teleport>
  </div>
</template>
