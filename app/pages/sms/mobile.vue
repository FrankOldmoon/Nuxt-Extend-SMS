<script setup lang="ts">
definePageMeta({ middleware: 'auth', layout: 'sms' })

interface WorkbenchCard {
  id: string
  title: string
  count: number
  link: string
  icon: string
}

interface Workbench {
  role: string | null
  generatedAt: string
  cards: WorkbenchCard[]
}

interface NotificationRow {
  id: number
  title: string
  body: string | null
  link: string | null
  status: string
  createdAt: string
}

useHead({
  title: 'SMS 移动工作台',
  link: [{ rel: 'manifest', href: '/manifest.webmanifest' }],
  meta: [
    { name: 'theme-color', content: '#0f172a' },
    { name: 'apple-mobile-web-app-capable', content: 'yes' }
  ]
})

const { data, pending, error, refresh } = await useFetch<Workbench>('/api/modules/sms/workbench')
const notifications = ref<NotificationRow[]>([])

const leaveTypes = [
  { label: '病假', value: 'sick' },
  { label: '事假', value: 'personal' },
  { label: '其他', value: 'other' }
]

const leaveForm = reactive({
  studentId: '',
  type: 'sick',
  startAt: '',
  endAt: '',
  reason: ''
})
const leaveSubmitting = ref(false)
const leaveMessage = ref('')
const leaveError = ref('')

const actions = [
  { title: '考勤登记', prompt: '帮我打开今天的班级考勤名单并登记考勤。', icon: 'i-lucide-clipboard-check' },
  { title: '成绩录入', prompt: '帮我查询最近一场考试的录入表。', icon: 'i-lucide-pen-line' },
  { title: '校规咨询', prompt: '学校的请假制度是怎么规定的？', icon: 'i-lucide-book-open' }
]

function openAction(prompt: string): void {
  void navigateTo({ path: '/sms/chat', query: { prompt } })
}

function openCard(card: WorkbenchCard): void {
  void navigateTo(card.link)
}

async function loadNotifications(): Promise<void> {
  try {
    notifications.value = await $fetch<NotificationRow[]>('/api/modules/sms/notifications', {
      query: { status: 'unread', limit: 5 }
    })
  } catch {
    notifications.value = []
  }
}

async function markRead(row: NotificationRow): Promise<void> {
  if (row.status === 'read') return
  try {
    await $fetch('/api/modules/sms/notifications/read', {
      method: 'POST',
      body: { notificationId: row.id }
    })
    row.status = 'read'
    if (row.link) void navigateTo(row.link)
  } catch {
    // 失败时保留未读状态，用户可下拉刷新重试。
  }
}

async function submitLeave(): Promise<void> {
  leaveError.value = ''
  leaveMessage.value = ''
  const studentId = Number(leaveForm.studentId)
  if (!Number.isSafeInteger(studentId) || studentId <= 0) {
    leaveError.value = '请填写学生 ID'
    return
  }
  if (!leaveForm.startAt || !leaveForm.endAt) {
    leaveError.value = '请选择开始与结束时间'
    return
  }
  leaveSubmitting.value = true
  try {
    await $fetch('/api/modules/sms/leave', {
      method: 'POST',
      body: {
        subjectType: 'student',
        studentId,
        type: leaveForm.type,
        startAt: new Date(leaveForm.startAt).toISOString(),
        endAt: new Date(leaveForm.endAt).toISOString(),
        reason: leaveForm.reason || undefined
      }
    })
    leaveMessage.value = '请假申请已提交，等待审批。'
    leaveForm.reason = ''
  } catch (err) {
    leaveError.value = err instanceof Error ? err.message : '提交失败，请稍后重试'
  } finally {
    leaveSubmitting.value = false
  }
}

onMounted(() => {
  void loadNotifications()
  // 仅在移动端页面注册 Service Worker，避免影响后台主应用的缓存策略。
  if (import.meta.client && 'serviceWorker' in navigator) {
    void navigator.serviceWorker.register('/sw.js').catch(() => undefined)
  }
})
</script>

<template>
  <div class="min-h-0 flex-1 overflow-y-auto p-4">
    <div class="mx-auto max-w-xl space-y-4">
      <header class="flex items-center justify-between">
        <div>
          <h1 class="text-lg font-semibold text-highlighted">
            移动工作台
          </h1>
          <p class="mt-1 text-xs text-muted">
            当前角色：{{ data?.role ?? '—' }}
          </p>
        </div>
        <UButton
          size="xs"
          variant="soft"
          icon="i-lucide-refresh-cw"
          :loading="pending"
          @click="refresh()"
        >
          刷新
        </UButton>
      </header>

      <p
        v-if="error"
        class="rounded-lg border border-error/40 bg-error/10 p-3 text-xs text-error"
      >
        工作台加载失败，请稍后重试。
      </p>

      <section class="grid grid-cols-2 gap-3">
        <button
          v-for="card in data?.cards ?? []"
          :key="card.id"
          type="button"
          class="rounded-xl border border-default bg-default p-4 text-left"
          @click="openCard(card)"
        >
          <UIcon
            :name="card.icon"
            class="size-4 text-primary"
          />
          <p class="mt-3 text-2xl font-semibold text-highlighted">
            {{ card.count }}
          </p>
          <p class="mt-1 text-xs text-muted">
            {{ card.title }}
          </p>
        </button>
      </section>

      <section class="space-y-2">
        <div class="flex items-center justify-between">
          <h2 class="text-sm font-medium text-highlighted">
            未读通知
          </h2>
          <UButton
            size="xs"
            variant="ghost"
            icon="i-lucide-refresh-cw"
            @click="loadNotifications()"
          >
            刷新
          </UButton>
        </div>
        <p
          v-if="notifications.length === 0"
          class="rounded-xl border border-default bg-default p-4 text-xs text-muted"
        >
          暂无未读通知
        </p>
        <button
          v-for="row in notifications"
          :key="row.id"
          type="button"
          class="w-full rounded-xl border border-default bg-default p-4 text-left"
          @click="markRead(row)"
        >
          <p class="text-sm font-medium text-highlighted">
            {{ row.title }}
          </p>
          <p
            v-if="row.body"
            class="mt-1 text-xs text-muted"
          >
            {{ row.body }}
          </p>
        </button>
      </section>

      <section class="space-y-3 rounded-xl border border-default bg-default p-4">
        <h2 class="text-sm font-medium text-highlighted">
          请假申请
        </h2>
        <div class="grid grid-cols-2 gap-2">
          <UInput
            v-model="leaveForm.studentId"
            placeholder="学生 ID"
            inputmode="numeric"
          />
          <USelect
            v-model="leaveForm.type"
            :items="leaveTypes"
            value-key="value"
          />
          <UInput
            v-model="leaveForm.startAt"
            type="datetime-local"
          />
          <UInput
            v-model="leaveForm.endAt"
            type="datetime-local"
          />
        </div>
        <UTextarea
          v-model="leaveForm.reason"
          placeholder="请假事由（可选）"
          :rows="2"
          class="w-full"
        />
        <p
          v-if="leaveError"
          class="text-xs text-error"
        >
          {{ leaveError }}
        </p>
        <p
          v-if="leaveMessage"
          class="text-xs text-success"
        >
          {{ leaveMessage }}
        </p>
        <UButton
          block
          :loading="leaveSubmitting"
          @click="submitLeave()"
        >
          提交请假
        </UButton>
      </section>

      <section class="space-y-2">
        <h2 class="text-sm font-medium text-highlighted">
          快捷办理
        </h2>
        <button
          v-for="action in actions"
          :key="action.title"
          type="button"
          class="flex w-full items-center gap-3 rounded-xl border border-default bg-default p-4 text-left"
          @click="openAction(action.prompt)"
        >
          <div class="flex size-9 items-center justify-center rounded-lg bg-primary/10">
            <UIcon
              :name="action.icon"
              class="size-4 text-primary"
            />
          </div>
          <span class="text-sm text-highlighted">{{ action.title }}</span>
        </button>
      </section>

      <p class="pb-6 text-center text-[11px] text-muted">
        数据范围与审批仍由服务端权限决定
      </p>
    </div>
  </div>
</template>
