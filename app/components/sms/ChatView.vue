<script setup lang="ts">
const props = defineProps<{
  conversationId?: number | null
  initialPrompt?: string
}>()

const idRef = computed(() => props.conversationId ?? null)
const {
  messages,
  currentId,
  title,
  loading,
  submitting,
  error,
  pendingForm,
  pendingApproval,
  latestToolCalls,
  init,
  send,
  decide,
  submitDraft,
  cancelDraft
} = useSmsChat(idRef)

const input = ref('')
const scroller = ref<HTMLElement | null>(null)

const examples = [
  '查一下七年级 A 班的学生',
  '把张三加到七年级 A 班',
  '这学期有哪些选课记录？'
]

onMounted(async () => {
  if (idRef.value) await init()
  if (props.initialPrompt) input.value = props.initialPrompt
  await nextTick()
  scrollToBottom()
})

watch(() => messages.value.length, async () => {
  await nextTick()
  scrollToBottom()
})

function scrollToBottom(): void {
  const element = scroller.value
  if (element) element.scrollTop = element.scrollHeight
}

async function submitMessage(): Promise<void> {
  const text = input.value.trim()
  if (!text || loading.value) return
  const wasNew = !idRef.value
  input.value = ''
  await send(text)
  if (wasNew && currentId.value) {
    await navigateTo(`/sms/chat/${currentId.value}`, { replace: true })
  }
}

function onKeydown(event: KeyboardEvent): void {
  if (event.key === 'Enter' && !event.shiftKey) {
    event.preventDefault()
    void submitMessage()
  }
}

function useExample(text: string): void {
  input.value = text
}
</script>

<template>
  <div class="flex min-h-0 flex-1">
    <section class="flex min-w-0 flex-1 flex-col">
      <header class="flex items-center gap-3 border-b border-default px-4 py-3">
        <div class="min-w-0 flex-1">
          <h1 class="truncate text-sm font-semibold text-highlighted">
            {{ title }}
          </h1>
          <p class="text-[11px] text-muted">
            基于当前角色与数据范围的 SMS 助手
          </p>
        </div>
      </header>

      <div
        ref="scroller"
        class="min-h-0 flex-1 overflow-y-auto px-4 py-4"
      >
        <div
          v-if="messages.length === 0 && !loading"
          class="mx-auto max-w-xl py-10 text-center"
        >
          <div class="mx-auto mb-3 flex size-10 items-center justify-center rounded-full bg-primary/10">
            <UIcon
              name="i-lucide-sparkles"
              class="size-5 text-primary"
            />
          </div>
          <h2 class="text-lg font-semibold text-highlighted">
            我可以帮你管理学校数据
          </h2>
          <p class="mt-1 text-sm text-muted">
            查询学生、班级、选课与监护人；写入操作会先显示表单，确认后再执行。
          </p>
          <div class="mt-5 flex flex-wrap justify-center gap-2">
            <button
              v-for="example in examples"
              :key="example"
              type="button"
              class="rounded-full border border-default bg-default px-3 py-1.5 text-xs text-toned transition-colors hover:border-primary hover:text-primary"
              @click="useExample(example)"
            >
              {{ example }}
            </button>
          </div>
        </div>

        <SmsMessageList
          v-else
          :messages="messages"
          :pending-form-id="pendingForm?.draftId ?? null"
          :pending-approval-batch="pendingApproval?.batchId ?? null"
          :submitting="submitting"
          @submit-draft="(draftId, payload) => submitDraft(draftId, payload)"
          @cancel-draft="cancelDraft"
          @decide="decide"
        />

        <div
          v-if="loading"
          class="mt-3 flex items-center gap-2 text-xs text-muted"
        >
          <UIcon
            name="i-lucide-loader-circle"
            class="size-3.5 animate-spin"
          />
          正在处理…
        </div>
      </div>

      <div class="border-t border-default px-4 py-3">
        <p
          v-if="error"
          class="mb-2 rounded-lg bg-red-50 px-2.5 py-1.5 text-xs text-red-700 dark:bg-red-950/40 dark:text-red-300"
        >
          {{ error }}
        </p>

        <div class="flex items-end gap-2 rounded-xl border border-default bg-default px-3 py-2 focus-within:border-primary">
          <textarea
            v-model="input"
            rows="1"
            placeholder="描述你要查询或办理的事情…（Enter 发送，Shift+Enter 换行）"
            class="max-h-40 min-h-6 flex-1 resize-none bg-transparent text-sm text-highlighted outline-none placeholder:text-muted"
            :disabled="loading"
            @keydown="onKeydown"
          />
          <UButton
            size="sm"
            :loading="loading"
            :disabled="!input.trim()"
            @click="submitMessage"
          >
            <UIcon
              name="i-lucide-send"
              class="size-4"
            />
          </UButton>
        </div>
      </div>
    </section>

    <aside class="hidden w-72 shrink-0 border-l border-default bg-elevated/40 xl:block">
      <SmsContextPanel
        :title="title"
        :tool-calls="latestToolCalls"
        :pending-form="pendingForm"
      />
    </aside>
  </div>
</template>
