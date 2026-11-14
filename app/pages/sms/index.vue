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

useHead({ title: 'SMS 工作台' })

const { data, pending, error, refresh } = await useFetch<Workbench>('/api/modules/sms/workbench')

const quickLinks = [
  { label: '开始对话', description: '用自然语言查询或办理业务', to: '/sms/chat', icon: 'i-lucide-messages-square' },
  { label: '学生管理', description: '搜索、筛选与导出学生名单', to: '/sms/students', icon: 'i-lucide-users' },
  { label: '成绩查询', description: '按考试/班级查看成绩', to: '/sms/scores', icon: 'i-lucide-chart-no-axes-column' },
  { label: '审批收件箱', description: '批量处理请假与退费', to: '/sms/approvals', icon: 'i-lucide-check-square' }
]

function openCard(card: WorkbenchCard): void {
  void navigateTo(card.link)
}
</script>

<template>
  <div class="min-h-0 flex-1 overflow-y-auto p-4">
    <div class="mx-auto max-w-5xl space-y-5">
      <header class="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 class="text-lg font-semibold text-highlighted">
            今天要做什么
          </h1>
          <p class="mt-1 text-xs text-muted">
            当前角色：{{ data?.role ?? '—' }} · 卡片数量按你的权限与数据范围统计
          </p>
        </div>
        <UButton
          size="xs"
          variant="ghost"
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

      <section
        v-if="pending && !data"
        class="grid gap-3 sm:grid-cols-2 lg:grid-cols-3"
      >
        <div
          v-for="index in 6"
          :key="index"
          class="h-24 animate-pulse rounded-xl border border-default bg-elevated/60"
        />
      </section>

      <p
        v-else-if="(data?.cards.length ?? 0) === 0"
        class="rounded-xl border border-default bg-default p-6 text-center text-sm text-muted"
      >
        当前没有待办事项，可以开始一次对话或查看学生名单。
      </p>

      <section
        v-else
        class="grid gap-3 sm:grid-cols-2 lg:grid-cols-3"
      >
        <button
          v-for="card in data?.cards ?? []"
          :key="card.id"
          type="button"
          class="group rounded-xl border border-default bg-default p-4 text-left transition-colors hover:border-primary/50 hover:bg-elevated/40"
          @click="openCard(card)"
        >
          <div class="flex items-center justify-between">
            <div class="flex size-9 items-center justify-center rounded-lg bg-primary/10">
              <UIcon
                :name="card.icon"
                class="size-4 text-primary"
              />
            </div>
            <UIcon
              name="i-lucide-arrow-up-right"
              class="size-4 text-muted transition-colors group-hover:text-primary"
            />
          </div>
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
          快捷入口
        </h2>
        <div class="grid gap-3 sm:grid-cols-2">
          <NuxtLink
            v-for="link in quickLinks"
            :key="link.to"
            :to="link.to"
            class="flex items-center gap-3 rounded-xl border border-default bg-default p-4 transition-colors hover:border-primary/50"
          >
            <div class="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary/10">
              <UIcon
                :name="link.icon"
                class="size-4 text-primary"
              />
            </div>
            <div class="min-w-0">
              <p class="text-sm text-highlighted">
                {{ link.label }}
              </p>
              <p class="mt-0.5 truncate text-xs text-muted">
                {{ link.description }}
              </p>
            </div>
          </NuxtLink>
        </div>
      </section>

      <p class="pb-4 text-center text-[11px] text-muted">
        数据范围与审批仍由服务端权限决定 · 生成于 {{ data?.generatedAt ? new Date(data.generatedAt).toLocaleString() : '—' }}
      </p>
    </div>
  </div>
</template>
