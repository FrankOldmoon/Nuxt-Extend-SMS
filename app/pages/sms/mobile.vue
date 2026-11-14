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

useHead({
  title: 'SMS 移动工作台',
  link: [{ rel: 'manifest', href: '/manifest.webmanifest' }],
  meta: [
    { name: 'theme-color', content: '#0f172a' },
    { name: 'apple-mobile-web-app-capable', content: 'yes' }
  ]
})

const { data, pending, error, refresh } = await useFetch<Workbench>('/api/modules/sms/workbench')

const actions = [
  { title: '请假申请', prompt: '我要为学生提交一条请假申请，请帮我选择学生和日期。', icon: 'i-lucide-calendar-plus' },
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
