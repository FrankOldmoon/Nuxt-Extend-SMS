<script setup lang="ts">
/**
 * SMS 全局搜索命令面板（⌘K / Ctrl+K）。
 * 结果全部来自 `/api/modules/sms/search`，权限与数据范围由服务端决定。
 */
interface SearchItem {
  type: 'student' | 'class' | 'knowledge' | 'notification'
  id: number
  title: string
  subtitle: string | null
  link: string
}

const open = defineModel<boolean>('open', { default: false })

const TYPE_META: Record<SearchItem['type'], { label: string, icon: string }> = {
  student: { label: '学生', icon: 'i-lucide-user' },
  class: { label: '班级', icon: 'i-lucide-school' },
  knowledge: { label: '知识库', icon: 'i-lucide-book-open' },
  notification: { label: '通知', icon: 'i-lucide-bell' }
}

const query = ref('')
const items = ref<SearchItem[]>([])
const loading = ref(false)
const error = ref('')
const activeIndex = ref(0)
const inputRef = ref<HTMLInputElement | null>(null)

let debounceTimer: ReturnType<typeof setTimeout> | null = null
let requestId = 0

function scheduleSearch(): void {
  if (debounceTimer) clearTimeout(debounceTimer)
  debounceTimer = setTimeout(() => void runSearch(), 250)
}

async function runSearch(): Promise<void> {
  const text = query.value.trim()
  error.value = ''
  if (!text) {
    items.value = []
    loading.value = false
    return
  }
  const current = ++requestId
  loading.value = true
  try {
    const rows = await $fetch<SearchItem[]>('/api/modules/sms/search', {
      query: { q: text, limit: 5 }
    })
    if (current !== requestId) return
    items.value = rows
    activeIndex.value = 0
  } catch {
    if (current === requestId) {
      items.value = []
      error.value = '搜索失败，请稍后重试'
    }
  } finally {
    if (current === requestId) loading.value = false
  }
}

function close(): void {
  open.value = false
}

function choose(item: SearchItem | undefined): void {
  if (!item) return
  open.value = false
  void navigateTo(item.link)
}

function move(delta: number): void {
  if (items.value.length === 0) return
  activeIndex.value = (activeIndex.value + delta + items.value.length) % items.value.length
}

function onKeydown(event: KeyboardEvent): void {
  if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
    event.preventDefault()
    open.value = !open.value
    return
  }
  if (!open.value) return
  if (event.key === 'Escape') {
    event.preventDefault()
    close()
  } else if (event.key === 'ArrowDown') {
    event.preventDefault()
    move(1)
  } else if (event.key === 'ArrowUp') {
    event.preventDefault()
    move(-1)
  } else if (event.key === 'Enter') {
    event.preventDefault()
    choose(items.value[activeIndex.value])
  }
}

watch(query, () => {
  activeIndex.value = 0
  scheduleSearch()
})

watch(open, async (value) => {
  if (value) {
    await nextTick()
    inputRef.value?.focus()
    if (query.value.trim()) void runSearch()
  } else {
    requestId += 1
    query.value = ''
    items.value = []
    error.value = ''
  }
})

onMounted(() => window.addEventListener('keydown', onKeydown))
onBeforeUnmount(() => {
  window.removeEventListener('keydown', onKeydown)
  if (debounceTimer) clearTimeout(debounceTimer)
})
</script>

<template>
  <Teleport to="body">
    <div
      v-if="open"
      class="fixed inset-0 z-50 flex items-start justify-center bg-black/40 px-4 pt-[12vh]"
      @click.self="close"
    >
      <div class="w-full max-w-xl overflow-hidden rounded-xl border border-default bg-default shadow-xl">
        <div class="flex items-center gap-2 border-b border-default px-3 py-2">
          <UIcon
            name="i-lucide-search"
            class="size-4 text-muted"
          />
          <input
            ref="inputRef"
            v-model="query"
            type="search"
            placeholder="搜索学生、班级、知识库、通知…"
            class="w-full bg-transparent text-sm text-highlighted outline-none placeholder:text-muted"
          >
          <kbd class="rounded border border-default px-1 text-[10px] text-muted">Esc</kbd>
        </div>

        <div class="max-h-[55vh] overflow-y-auto">
          <p
            v-if="error"
            class="p-4 text-xs text-error"
          >
            {{ error }}
          </p>
          <p
            v-else-if="loading"
            class="p-4 text-xs text-muted"
          >
            搜索中…
          </p>
          <p
            v-else-if="query.trim() && items.length === 0"
            class="p-4 text-xs text-muted"
          >
            没有匹配结果
          </p>
          <p
            v-else-if="!query.trim()"
            class="p-4 text-xs text-muted"
          >
            输入关键词开始搜索，↑↓ 选择，回车打开。
          </p>

          <ul v-if="items.length > 0">
            <li
              v-for="(item, index) in items"
              :key="`${item.type}-${item.id}`"
            >
              <button
                type="button"
                class="flex w-full items-center gap-3 px-3 py-2 text-left"
                :class="index === activeIndex ? 'bg-primary/10' : 'hover:bg-elevated'"
                @mouseenter="activeIndex = index"
                @click="choose(item)"
              >
                <UIcon
                  :name="TYPE_META[item.type].icon"
                  class="size-4 shrink-0 text-primary"
                />
                <span class="min-w-0 flex-1">
                  <span class="block truncate text-sm text-highlighted">{{ item.title }}</span>
                  <span
                    v-if="item.subtitle"
                    class="block truncate text-xs text-muted"
                  >{{ item.subtitle }}</span>
                </span>
                <UBadge
                  size="sm"
                  variant="soft"
                  color="neutral"
                >
                  {{ TYPE_META[item.type].label }}
                </UBadge>
              </button>
            </li>
          </ul>
        </div>
      </div>
    </div>
  </Teleport>
</template>
