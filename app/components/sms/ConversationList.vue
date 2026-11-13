<script setup lang="ts">
import { useSmsConversations, type SmsConversationSummary } from '../../composables/useSmsChat'

const route = useRoute()
const { items, loading, refresh, remove, rename } = useSmsConversations()

const editingId = ref<number | null>(null)
const draftTitle = ref('')

onMounted(refresh)
watch(() => route.fullPath, () => void refresh())

function isActive(item: SmsConversationSummary): boolean {
  return String(item.id) === String(route.params.id ?? '')
}

function startEdit(item: SmsConversationSummary): void {
  editingId.value = item.id
  draftTitle.value = item.title
}

async function saveEdit(item: SmsConversationSummary): Promise<void> {
  const title = draftTitle.value.trim()
  editingId.value = null
  if (!title || title === item.title) return
  try {
    await rename(item.id, title)
  } catch {
    await refresh()
  }
}

async function removeItem(item: SmsConversationSummary): Promise<void> {
  if (import.meta.client && !window.confirm(`删除对话「${item.title}」？`)) return
  try {
    await remove(item.id)
    if (isActive(item)) await navigateTo('/sms/chat')
  } catch {
    await refresh()
  }
}

function formatDate(value: string): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  return date.toLocaleDateString('zh-CN', { month: '2-digit', day: '2-digit' })
}
</script>

<template>
  <div class="flex min-h-0 flex-1 flex-col">
    <div class="flex items-center justify-between px-3 pb-2 pt-4">
      <p class="text-[11px] font-medium uppercase tracking-wide text-muted">
        对话
      </p>
      <button
        type="button"
        class="flex items-center gap-1 rounded px-1.5 py-1 text-[11px] text-muted transition-colors hover:bg-elevated hover:text-highlighted"
        @click="navigateTo('/sms/chat')"
      >
        <UIcon
          name="i-lucide-square-pen"
          class="size-3.5"
        />
        新建
      </button>
    </div>

    <div class="min-h-0 flex-1 space-y-0.5 overflow-y-auto px-2 pb-4">
      <p
        v-if="loading && items.length === 0"
        class="px-2 py-2 text-xs text-muted"
      >
        加载中…
      </p>
      <p
        v-else-if="items.length === 0"
        class="px-2 py-2 text-xs text-muted"
      >
        还没有对话，点击「新建」开始。
      </p>

      <div
        v-for="item in items"
        :key="item.id"
        class="group flex items-center gap-1 rounded-lg px-2 py-1.5 text-sm transition-colors"
        :class="isActive(item) ? 'bg-primary/10 text-primary' : 'text-toned hover:bg-elevated'"
      >
        <template v-if="editingId === item.id">
          <input
            v-model="draftTitle"
            class="min-w-0 flex-1 rounded border border-primary bg-default px-1.5 py-0.5 text-xs outline-none"
            autofocus
            @keyup.enter="saveEdit(item)"
            @keyup.esc="editingId = null"
            @blur="saveEdit(item)"
          >
        </template>
        <template v-else>
          <NuxtLink
            :to="`/sms/chat/${item.id}`"
            class="min-w-0 flex-1 truncate"
            :title="item.title"
          >
            {{ item.title }}
          </NuxtLink>
          <span class="shrink-0 text-[10px] text-muted group-hover:hidden">{{ formatDate(item.updatedAt) }}</span>
          <button
            type="button"
            class="hidden shrink-0 rounded p-0.5 text-muted hover:text-highlighted group-hover:block"
            title="重命名"
            @click.stop="startEdit(item)"
          >
            <UIcon
              name="i-lucide-pencil"
              class="size-3.5"
            />
          </button>
          <button
            type="button"
            class="hidden shrink-0 rounded p-0.5 text-muted hover:text-red-500 group-hover:block"
            title="删除"
            @click.stop="removeItem(item)"
          >
            <UIcon
              name="i-lucide-trash-2"
              class="size-3.5"
            />
          </button>
        </template>
      </div>
    </div>
  </div>
</template>
