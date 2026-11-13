<script setup lang="ts">
const route = useRoute()

useHead({ meta: [{ name: 'robots', content: 'noindex, nofollow' }] })

const navItems = [
  { label: 'Chat', to: '/sms/chat', icon: 'i-lucide-messages-square' },
  { label: 'Apps', to: '/sms/apps', icon: 'i-lucide-layout-grid' },
  { label: 'Agents', to: '/sms/agents', icon: 'i-lucide-bot' }
]

function isActive(to: string): boolean {
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

      <nav class="space-y-1 px-2">
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
      <header class="flex items-center gap-3 border-b border-default px-3 py-2 md:hidden">
        <NuxtLink
          v-for="item in navItems"
          :key="item.to"
          :to="item.to"
          class="rounded-lg px-2.5 py-1.5 text-xs"
          :class="isActive(item.to) ? 'bg-primary/10 font-medium text-primary' : 'text-toned'"
        >
          {{ item.label }}
        </NuxtLink>
        <NuxtLink
          to="/sms/chat"
          class="ml-auto rounded-lg px-2 py-1 text-xs text-primary"
        >
          新建对话
        </NuxtLink>
      </header>

      <slot />
    </div>
  </div>
</template>
