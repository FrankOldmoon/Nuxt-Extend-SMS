<script setup lang="ts">
import type { SmsToolTable } from '../../composables/useSmsChat'

/**
 * Chat component `sms.leave-table`.
 *
 * Rows are loaded from the permission-checked module API; the model can only
 * pass a status filter and a page size. Approve/reject buttons are shown only
 * when the viewer holds `sms.leave.approve`.
 */
type LeaveStatus = 'pending' | 'approved' | 'rejected' | 'cancelled'

interface LeaveRow {
  id: number
  studentId: number | null
  studentName: string | null
  studentNo: string | null
  className: string | null
  type: string
  startAt: string
  endAt: string
  days: number
  reason: string | null
  status: LeaveStatus
  decisionNote: string | null
}

const props = defineProps<{
  status?: LeaveStatus
  limit?: number
}>()

const { user } = useAuth()
const canApprove = computed(() => {
  const permissions = user.value?.role?.permissions ?? []
  return user.value?.role?.name === 'admin'
    || permissions.includes('*')
    || permissions.includes('sms.leave.approve')
    || permissions.includes('sms:update')
})

const rows = ref<LeaveRow[]>([])
const loading = ref(true)
const error = ref('')
const status = ref<LeaveStatus | ''>(props.status ?? '')
const search = ref('')
const selected = ref<LeaveRow | null>(null)
const deciding = ref(false)
const decideError = ref('')
const notice = ref('')

const TYPE_LABELS: Record<string, string> = { sick: '病假', personal: '事假', other: '其他' }
const STATUS_LABELS: Record<LeaveStatus, string> = {
  pending: '待审批',
  approved: '已通过',
  rejected: '已驳回',
  cancelled: '已撤销'
}

function statusOf(value: unknown): number | undefined {
  if (!value || typeof value !== 'object') return undefined
  const direct = (value as { statusCode?: unknown, status?: unknown }).statusCode
  if (typeof direct === 'number') return direct
  const status = (value as { status?: unknown }).status
  if (typeof status === 'number') return status
  const response = (value as { response?: { status?: unknown } }).response
  return typeof response?.status === 'number' ? response.status : undefined
}

function errorMessage(value: unknown): string {
  if (statusOf(value) === 403) return '没有权限查看请假列表，请在 Apps 中确认角色权限。'
  if (value && typeof value === 'object') {
    const data = (value as { data?: { message?: unknown } }).data
    if (data && typeof data.message === 'string') return data.message
    const message = (value as { message?: unknown }).message
    if (typeof message === 'string') return message
  }
  return '加载请假列表失败'
}

function formatDate(value: string | null): string {
  return value ? value.slice(0, 10) : '—'
}

async function load(): Promise<void> {
  loading.value = true
  error.value = ''
  try {
    const data = await $fetch<LeaveRow[]>('/api/modules/sms/leave', {
      query: { status: status.value || undefined, limit: props.limit ?? 50 }
    })
    rows.value = Array.isArray(data) ? data : []
    if (selected.value) {
      selected.value = rows.value.find(row => row.id === selected.value?.id) ?? null
    }
  } catch (value) {
    error.value = errorMessage(value)
    rows.value = []
  } finally {
    loading.value = false
  }
}

onMounted(load)
watch([status, () => props.limit], () => {
  void load()
})

const filtered = computed(() => {
  const query = search.value.trim()
  if (!query) return rows.value
  return rows.value.filter(row =>
    (row.studentName ?? '').includes(query) || (row.studentNo ?? '').includes(query)
  )
})

const table = computed<SmsToolTable>(() => ({
  columns: [
    { key: 'studentName', label: '学生' },
    { key: 'className', label: '班级' },
    { key: 'type', label: '类型' },
    { key: 'startAt', label: '开始' },
    { key: 'endAt', label: '结束' },
    { key: 'days', label: '天数', format: 'number' },
    { key: 'status', label: '状态' },
    { key: 'reason', label: '事由' }
  ],
  rows: filtered.value.map(row => ({
    ...row,
    type: TYPE_LABELS[row.type] ?? row.type,
    status: STATUS_LABELS[row.status] ?? row.status
  })) as unknown as Array<Record<string, unknown>>,
  total: filtered.value.length
}))

function openDetail(row: Record<string, unknown>): void {
  selected.value = rows.value.find(item => item.id === Number(row.id)) ?? null
  decideError.value = ''
  notice.value = ''
}

async function decide(decision: 'approve' | 'reject'): Promise<void> {
  if (!selected.value) return
  decideError.value = ''
  if (decision === 'reject') {
    const comment = window.prompt('请输入驳回原因（必填）', '')
    if (comment === null) return
    if (!comment.trim()) {
      decideError.value = '驳回必须填写原因'
      return
    }
    await submitDecision(decision, comment.trim())
    return
  }
  await submitDecision(decision, undefined)
}

async function submitDecision(decision: 'approve' | 'reject', comment?: string): Promise<void> {
  if (!selected.value) return
  deciding.value = true
  decideError.value = ''
  try {
    await $fetch('/api/modules/sms/leave/decide', {
      method: 'POST',
      body: { leaveId: selected.value.id, decision, comment }
    })
    notice.value = decision === 'approve' ? '已同意，考勤已按审批结果更新' : '已驳回'
    await load()
  } catch (value) {
    decideError.value = errorMessage(value)
  } finally {
    deciding.value = false
  }
}
</script>

<template>
  <div class="mt-2">
    <div class="mb-1.5 flex flex-wrap items-center gap-1.5">
      <input
        v-model="search"
        type="search"
        placeholder="搜索学生姓名或学号"
        class="h-7 min-w-0 flex-1 rounded-md border border-default bg-default px-2 text-xs text-highlighted outline-none focus:border-primary"
      >
      <select
        v-model="status"
        class="h-7 rounded-md border border-default bg-default px-1.5 text-xs text-toned outline-none focus:border-primary"
        aria-label="请假状态"
      >
        <option value="">
          全部状态
        </option>
        <option value="pending">
          待审批
        </option>
        <option value="approved">
          已通过
        </option>
        <option value="rejected">
          已驳回
        </option>
        <option value="cancelled">
          已撤销
        </option>
      </select>
      <UButton
        color="neutral"
        variant="ghost"
        size="xs"
        icon="i-lucide-refresh-cw"
        :loading="loading"
        @click="load"
      >
        刷新
      </UButton>
    </div>

    <div
      v-if="loading"
      class="space-y-1.5 rounded-lg border border-default p-2"
      aria-busy="true"
      aria-label="正在加载请假列表"
    >
      <div
        v-for="n in 3"
        :key="n"
        class="h-4 animate-pulse rounded bg-elevated"
      />
    </div>

    <div
      v-else-if="error"
      class="rounded-lg bg-red-50 px-2.5 py-1.5 text-xs text-red-700 dark:bg-red-950/40 dark:text-red-300"
    >
      <p>{{ error }}</p>
      <button
        type="button"
        class="mt-1 text-primary hover:underline"
        @click="load"
      >
        重试
      </button>
    </div>

    <template v-else>
      <SmsResultTable
        :table="table"
        link-key="studentName"
        row-clickable
        @row-click="openDetail"
      />

      <div
        v-if="selected"
        class="mt-2 rounded-lg border border-default p-2.5 text-xs"
      >
        <div class="flex items-start justify-between gap-2">
          <div>
            <p class="font-medium text-highlighted">
              {{ selected.studentName ?? `学生 #${selected.studentId}` }}
              <span class="text-muted">· {{ selected.className ?? '未分班' }}</span>
            </p>
            <p class="mt-0.5 text-muted">
              {{ TYPE_LABELS[selected.type] ?? selected.type }}
              · {{ formatDate(selected.startAt) }} 至 {{ formatDate(selected.endAt) }}
              · {{ selected.days }} 天
              · {{ STATUS_LABELS[selected.status] }}
            </p>
            <p
              v-if="selected.reason"
              class="mt-1 text-toned"
            >
              事由：{{ selected.reason }}
            </p>
            <p
              v-if="selected.decisionNote"
              class="mt-1 text-toned"
            >
              审批意见：{{ selected.decisionNote }}
            </p>
          </div>
          <UButton
            color="neutral"
            variant="ghost"
            size="xs"
            icon="i-lucide-x"
            aria-label="关闭详情"
            @click="selected = null"
          />
        </div>

        <p
          v-if="notice"
          class="mt-1.5 text-emerald-600 dark:text-emerald-400"
        >
          {{ notice }}
        </p>
        <p
          v-if="decideError"
          class="mt-1.5 text-red-600 dark:text-red-400"
        >
          {{ decideError }}
        </p>

        <div
          v-if="canApprove && selected.status === 'pending'"
          class="mt-2 flex gap-1.5"
        >
          <UButton
            color="primary"
            size="xs"
            :loading="deciding"
            @click="decide('approve')"
          >
            同意
          </UButton>
          <UButton
            color="error"
            variant="soft"
            size="xs"
            :disabled="deciding"
            @click="decide('reject')"
          >
            驳回
          </UButton>
        </div>
      </div>
    </template>
  </div>
</template>
