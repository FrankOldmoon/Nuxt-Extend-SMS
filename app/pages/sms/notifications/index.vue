<script setup lang="ts">
definePageMeta({ middleware: 'auth', layout: 'sms' })

interface NotificationRow {
  id: number
  category: string
  title: string
  body: string | null
  link: string | null
  status: string
  requiresAck: boolean
  acknowledgedAt: string | null
  createdAt: string
}

interface NotificationResponse {
  rows: NotificationRow[]
  unread: number
}

const LABELS: Record<string, string> = {
  attendance: '考勤',
  leave: '请假',
  finance: '财务',
  approval: '审批',
  academic: '教学',
  system: '系统'
}

const CATEGORY_COLORS: Record<string, 'primary' | 'success' | 'warning' | 'error' | 'neutral'> = {
  attendance: 'warning',
  leave: 'primary',
  finance: 'success',
  approval: 'error',
  academic: 'primary',
  system: 'neutral'
}

useHead({ title: 'SMS 通知中心' })

const PAGE_SIZE = 50
const status = ref<'unread' | 'all' | 'ack'>('unread')
const category = ref('all')
const rows = ref<NotificationRow[]>([])
const unread = ref(0)
const cursor = ref<number | null>(null)
const hasMore = ref(false)
const loading = ref(false)
const initialized = ref(false)
const error = ref('')

const categoryOptions = computed(() => [
  { label: '全部分类', value: 'all' },
  ...Object.entries(LABELS).map(([value, label]) => ({ label, value }))
])

async function load(reset = false): Promise<void> {
  if (loading.value) return
  loading.value = true
  error.value = ''
  try {
    if (reset) {
      cursor.value = null
      rows.value = []
    }
    const response = await $fetch<NotificationResponse>('/api/modules/sms/notifications', {
      query: {
        status: status.value === 'unread' ? 'unread' : 'all',
        ack: status.value === 'ack' ? 'pending' : undefined,
        category: category.value === 'all' ? undefined : category.value,
        cursor: cursor.value ?? undefined,
        limit: PAGE_SIZE
      }
    })
    rows.value = reset ? response.rows : [...rows.value, ...response.rows]
    unread.value = response.unread
    cursor.value = response.rows.length > 0 ? response.rows[response.rows.length - 1]!.id : null
    hasMore.value = response.rows.length === PAGE_SIZE
  } catch (err) {
    error.value = err instanceof Error ? err.message : '通知加载失败'
  } finally {
    loading.value = false
    initialized.value = true
  }
}

async function markAllRead(): Promise<void> {
  try {
    await $fetch('/api/modules/sms/notifications/read', { method: 'POST', body: {} })
    await load(true)
  } catch (err) {
    error.value = err instanceof Error ? err.message : '操作失败'
  }
}

async function acknowledge(row: NotificationRow): Promise<void> {
  try {
    const response = await $fetch<{ acknowledgedAt: string }>('/api/modules/sms/notifications/ack', {
      method: 'POST',
      body: { notificationId: row.id }
    })
    row.status = 'acknowledged'
    row.acknowledgedAt = response.acknowledgedAt
    if (status.value === 'ack') await load(true)
  } catch (err) {
    error.value = err instanceof Error ? err.message : '签收失败'
  }
}

async function open(row: NotificationRow): Promise<void> {
  if (row.status === 'unread') {
    try {
      await $fetch('/api/modules/sms/notifications/read', {
        method: 'POST',
        body: { notificationId: row.id }
      })
      row.status = 'read'
      unread.value = Math.max(0, unread.value - 1)
    } catch {
      // 标记失败不阻断跳转，下次进入仍会显示未读。
    }
  }
  if (row.link && row.link.startsWith('/') && !row.link.startsWith('//')) {
    void navigateTo(row.link)
  }
}

watch([status, category], () => void load(true))

onMounted(() => void load(true))
</script>

<template>
  <div class="min-h-0 flex-1 overflow-y-auto p-4">
    <div class="mx-auto max-w-3xl space-y-4">
      <header class="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 class="text-lg font-semibold text-highlighted">
            通知中心
          </h1>
          <p class="mt-1 text-xs text-muted">
            未读 {{ unread }} 条；静音分类请到通知偏好设置。
          </p>
        </div>
        <div class="flex items-center gap-2">
          <UButton
            size="xs"
            variant="soft"
            icon="i-lucide-check-check"
            :disabled="unread === 0"
            @click="markAllRead()"
          >
            全部已读
          </UButton>
          <UButton
            size="xs"
            variant="ghost"
            icon="i-lucide-settings"
            to="/sms/notifications/preferences"
          >
            偏好
          </UButton>
          <UButton
            size="xs"
            variant="ghost"
            icon="i-lucide-refresh-cw"
            :loading="loading"
            @click="load(true)"
          >
            刷新
          </UButton>
        </div>
      </header>

      <div class="flex flex-wrap items-center gap-2">
        <UButton
          size="xs"
          :variant="status === 'unread' ? 'solid' : 'soft'"
          @click="status = 'unread'"
        >
          未读
        </UButton>
        <UButton
          size="xs"
          :variant="status === 'all' ? 'solid' : 'soft'"
          @click="status = 'all'"
        >
          全部
        </UButton>
        <UButton
          size="xs"
          :variant="status === 'ack' ? 'solid' : 'soft'"
          @click="status = 'ack'"
        >
          待签收
        </UButton>
        <USelect
          v-model="category"
          :items="categoryOptions"
          value-key="value"
          class="ml-auto w-36"
        />
      </div>

      <p
        v-if="error"
        class="rounded-lg border border-error/40 bg-error/10 p-3 text-xs text-error"
      >
        {{ error }}
      </p>

      <div
        v-if="!initialized || (loading && rows.length === 0)"
        class="space-y-2"
      >
        <div
          v-for="index in 5"
          :key="index"
          class="h-16 animate-pulse rounded-xl border border-default bg-elevated/60"
        />
      </div>

      <p
        v-else-if="rows.length === 0"
        class="rounded-xl border border-default bg-default p-6 text-center text-sm text-muted"
      >
        暂无通知
      </p>

      <ul
        v-else
        class="space-y-2"
      >
        <li
          v-for="row in rows"
          :key="row.id"
        >
          <div
            role="button"
            tabindex="0"
            class="w-full cursor-pointer rounded-xl border border-default bg-default p-4 text-left transition-colors hover:border-primary/40"
            @click="open(row)"
            @keydown.enter="open(row)"
          >
            <div class="flex flex-wrap items-center gap-2">
              <UBadge
                :color="CATEGORY_COLORS[row.category] ?? 'neutral'"
                variant="soft"
                size="sm"
              >
                {{ LABELS[row.category] ?? row.category }}
              </UBadge>
              <UBadge
                v-if="row.requiresAck && !row.acknowledgedAt"
                color="warning"
                variant="soft"
                size="sm"
              >
                待签收
              </UBadge>
              <UBadge
                v-else-if="row.acknowledgedAt"
                color="success"
                variant="soft"
                size="sm"
              >
                已签收
              </UBadge>
              <span
                v-if="row.status === 'unread'"
                class="size-2 rounded-full bg-primary"
                aria-label="未读"
              />
              <UButton
                v-if="row.requiresAck && !row.acknowledgedAt"
                size="xs"
                color="warning"
                variant="soft"
                class="ml-auto"
                @click.stop="acknowledge(row)"
              >
                确认签收
              </UButton>
              <span
                :class="row.requiresAck && !row.acknowledgedAt ? '' : 'ml-auto'"
                class="text-[11px] text-muted"
              >
                {{ new Date(row.createdAt).toLocaleString() }}
              </span>
            </div>
            <p
              class="mt-2 text-sm"
              :class="row.status === 'unread' ? 'font-medium text-highlighted' : 'text-toned'"
            >
              {{ row.title }}
            </p>
            <p
              v-if="row.body"
              class="mt-1 line-clamp-2 text-xs text-muted"
            >
              {{ row.body }}
            </p>
          </div>
        </li>
      </ul>

      <div
        v-if="hasMore"
        class="flex justify-center"
      >
        <UButton
          size="xs"
          variant="soft"
          :loading="loading"
          @click="load(false)"
        >
          加载更多
        </UButton>
      </div>
    </div>
  </div>
</template>
