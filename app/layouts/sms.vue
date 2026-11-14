<script setup lang="ts">
const route = useRoute()
const paletteOpen = ref(false)

useHead({ meta: [{ name: 'robots', content: 'noindex, nofollow' }] })

const navItems = [
  { label: '工作台', to: '/sms', icon: 'i-lucide-layout-dashboard' },
  { label: 'Chat', to: '/sms/chat', icon: 'i-lucide-messages-square' },
  { label: '学生', to: '/sms/students', icon: 'i-lucide-users' },
  { label: '班级', to: '/sms/classes', icon: 'i-lucide-school' },
  { label: '成绩', to: '/sms/scores', icon: 'i-lucide-chart-no-axes-column' },
  { label: '审批', to: '/sms/approvals', icon: 'i-lucide-check-square' },
  { label: '通知', to: '/sms/notifications', icon: 'i-lucide-bell' },
  { label: 'Apps', to: '/sms/apps', icon: 'i-lucide-layout-grid' },
  { label: 'Agents', to: '/sms/agents', icon: 'i-lucide-bot' },
  { label: 'Mobile', to: '/sms/mobile', icon: 'i-lucide-smartphone' }
]

function isActive(to: string): boolean {
  if (to === '/sms') return route.path === '/sms'
  return route.path === to || route.path.startsWith(`${to}/`)
}
</script>

<template>
  <div class="flex h-dvh overflow-hidden bg-default text-default">
    <aside class="hidden w-64 shrink-0 flex-col border-r border-default bg-elevated/50 md:flex">
      <div class="flex items-center gap-2 px-4 py-4">
        <div class="flex size-8 items-center justify-center rounded-lg bg-primary/10">
          <UIcon
            name="i-lucide-school"
            class="size-4 text-primary"
          />
        </div>
        <div class="min-w-0">
          <p class="truncate text-sm font-semibold text-highlighted">
            SMS 工作台
          </p>
          <p class="text-[10px] text-muted">
            Chat · Apps · Agents
          </p>
        </div>
      </div>

      <div class="px-2 pb-2">
        <button
          type="button"
          class="flex w-full items-center gap-2 rounded-lg border border-default px-2.5 py-2 text-xs text-muted transition-colors hover:border-primary/50 hover:text-highlighted"
          @click="paletteOpen = true"
        >
          <UIcon
            name="i-lucide-search"
            class="size-4"
          />
          搜索学生、班级、通知
          <kbd class="ml-auto rounded border border-default px-1 text-[10px]">⌘K</kbd>
        </button>
      </div>

      <nav class="space-y-1 overflow-y-auto px-2">
        <NuxtLink
          v-for="item in navItems"
          :key="item.to"
          :to="item.to"
          class="flex items-center gap-2 rounded-lg px-2.5 py-2 text-sm transition-colors"
          :class="isActive(item.to) ? 'bg-primary/10 font-medium text-primary' : 'text-toned hover:bg-elevated'"
        >
          <UIcon
            :name="item.icon"
            class="size-4"
          />
          {{ item.label }}
        </NuxtLink>
      </nav>

      <SmsConversationList />
    </aside>

    <div class="flex min-w-0 flex-1 flex-col">
      <header class="flex items-center gap-2 overflow-x-auto border-b border-default px-3 py-2 md:hidden">
        <button
          type="button"
          class="shrink-0 rounded-lg px-2 py-1 text-xs text-toned"
          aria-label="搜索"
          @click="paletteOpen = true"
        >
          <UIcon
            name="i-lucide-search"
            class="size-4"
          />
        </button>
        <NuxtLink
          v-for="item in navItems"
          :key="item.to"
          :to="item.to"
          class="shrink-0 rounded-lg px-2.5 py-1.5 text-xs"
          :class="isActive(item.to) ? 'bg-primary/10 font-medium text-primary' : 'text-toned'"
        >
          {{ item.label }}
        </NuxtLink>
        <NuxtLink
          to="/sms/chat"
          class="ml-auto shrink-0 rounded-lg px-2 py-1 text-xs text-primary"
        >
          新建对话
        </NuxtLink>
      </header>

      <slot />
    </div>

    <SmsCommandPalette v-model:open="paletteOpen" />
  </div>
</template>
