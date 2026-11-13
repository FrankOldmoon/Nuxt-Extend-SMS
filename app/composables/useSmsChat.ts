/**
 * SMS chat client state. All business writes go through the server draft
 * endpoint; this composable only tracks messages, the pending form/approval
 * and submit calls.
 */

export interface SmsFormOption {
  label: string
  value: string | number | boolean
}

export interface SmsFormField {
  key: string
  label: string
  type: 'text' | 'textarea' | 'number' | 'select' | 'boolean' | 'date' | 'datetime'
  required?: boolean
  readonly?: boolean
  placeholder?: string
  help?: string
  options?: SmsFormOption[]
  validation?: { min?: number, max?: number, pattern?: string, message?: string }
}

export interface SmsFormDescriptor {
  fields: SmsFormField[]
  submitLabel?: string
  cancelLabel?: string
  layout?: 'single-column' | 'two-column'
}

export interface SmsToolCall {
  id: string
  name: string
  title: string
  status: 'success' | 'failure' | 'denied'
  summary?: string
  arguments?: unknown
  error?: string
}

export interface SmsFormUi {
  kind: 'form'
  capabilityId: string
  title: string
  draftId: number
  form: SmsFormDescriptor
  initial?: Record<string, unknown>
  preview?: { summary?: string, warnings?: string[], impact?: number }
}

export interface SmsApprovalCall {
  id: string
  name: string
  title?: string
  riskLevel?: 'low' | 'medium' | 'high'
}

export interface SmsApprovalUi {
  kind: 'approval'
  batchId: string
  calls: SmsApprovalCall[]
}

export interface SmsResultUi {
  kind: 'result'
  capabilityId: string
  title: string
  summary: string
}

export interface SmsToolsUi {
  kind: 'tools'
  cards: SmsToolCall[]
}

export type SmsChatUi = SmsFormUi | SmsApprovalUi | SmsResultUi | SmsToolsUi

export interface SmsChatMessage {
  id?: number
  role: 'user' | 'assistant'
  content: string
  toolCalls?: SmsToolCall[]
  ui?: SmsChatUi
}

export interface SmsConversationSummary {
  id: number
  title: string
  status: 'active' | 'archived'
  createdAt: string
  updatedAt: string
}

export interface SmsChatResponse {
  conversationId: number
  status: 'completed' | 'pending_confirmation' | 'pending_form' | 'failed'
  message: { role: 'assistant', content: string }
  toolCalls: SmsToolCall[]
  pendingApproval?: { batchId: string, calls: SmsApprovalCall[] }
  ui?: SmsChatUi
  error?: string
}

function errorMessage(error: unknown): string {
  if (error && typeof error === 'object') {
    const data = (error as { data?: { message?: unknown } }).data
    if (data && typeof data.message === 'string') return data.message
    const message = (error as { message?: unknown }).message
    if (typeof message === 'string') return message
  }
  return '请求失败，请稍后重试'
}

export function useSmsChat(conversationId?: Ref<number | null>) {
  const messages = ref<SmsChatMessage[]>([])
  const currentId = ref<number | null>(conversationId?.value ?? null)
  const title = ref('新对话')
  const loading = ref(false)
  const submitting = ref(false)
  const error = ref('')
  const pendingForm = ref<SmsFormUi | null>(null)
  const pendingApproval = ref<SmsApprovalUi | null>(null)

  const latestToolCalls = computed<SmsToolCall[]>(() => {
    for (let i = messages.value.length - 1; i >= 0; i--) {
      const calls = messages.value[i]?.toolCalls
      if (calls?.length) return calls
    }
    return []
  })

  function restorePending(): void {
    pendingForm.value = null
    pendingApproval.value = null
    for (let i = messages.value.length - 1; i >= 0; i--) {
      const ui = messages.value[i]?.ui
      if (!ui) continue
      if (ui.kind === 'form') pendingForm.value = ui
      else if (ui.kind === 'approval') pendingApproval.value = ui
      return
    }
  }

  function applyResponse(response: SmsChatResponse): void {
    if (response.conversationId) currentId.value = response.conversationId
    messages.value.push({
      role: 'assistant',
      content: response.message?.content ?? '',
      toolCalls: response.toolCalls?.length ? response.toolCalls : undefined,
      ui: response.ui
    })

    if (response.status === 'pending_form' && response.ui?.kind === 'form') {
      pendingForm.value = response.ui
      pendingApproval.value = null
    } else if (response.status === 'pending_confirmation' && response.pendingApproval) {
      pendingApproval.value = {
        kind: 'approval',
        batchId: response.pendingApproval.batchId,
        calls: response.pendingApproval.calls
      }
      pendingForm.value = null
    } else {
      pendingForm.value = null
      pendingApproval.value = null
    }

    if (response.status === 'failed') error.value = response.error ?? ''
  }

  async function init(): Promise<void> {
    if (!currentId.value) return
    await load(currentId.value)
  }

  async function load(id: number): Promise<void> {
    loading.value = true
    error.value = ''
    try {
      const data = await $fetch<{ id: number, title: string, messages: SmsChatMessage[] }>(
        `/api/agent/conversations/${id}`
      )
      currentId.value = data.id
      title.value = data.title
      messages.value = (data.messages ?? []).map(message => ({
        ...message,
        toolCalls: message.toolCalls ?? undefined,
        ui: message.ui ?? undefined
      }))
      restorePending()
    } catch (e) {
      error.value = errorMessage(e)
    } finally {
      loading.value = false
    }
  }

  async function send(text: string): Promise<void> {
    const content = text.trim()
    if (!content || loading.value) return
    error.value = ''
    loading.value = true
    messages.value.push({ role: 'user', content })
    if (title.value === '新对话') title.value = content.slice(0, 30)
    try {
      const response = await $fetch<SmsChatResponse>('/api/agent/chat', {
        method: 'POST',
        body: { conversationId: currentId.value ?? undefined, message: content }
      })
      applyResponse(response)
    } catch (e) {
      error.value = errorMessage(e)
    } finally {
      loading.value = false
    }
  }

  async function decide(batchId: string, decision: 'approve' | 'reject'): Promise<void> {
    if (submitting.value) return
    submitting.value = true
    error.value = ''
    try {
      const response = await $fetch<SmsChatResponse>(`/api/agent/approvals/${batchId}`, {
        method: 'POST',
        body: { decision }
      })
      pendingApproval.value = null
      applyResponse(response)
    } catch (e) {
      error.value = errorMessage(e)
    } finally {
      submitting.value = false
    }
  }

  async function submitDraft(draftId: number, payload: Record<string, unknown>): Promise<void> {
    if (submitting.value) return
    submitting.value = true
    error.value = ''
    try {
      const response = await $fetch<SmsChatResponse>(`/api/agent/drafts/${draftId}/submit`, {
        method: 'POST',
        body: { payload }
      })
      pendingForm.value = null
      applyResponse(response)
    } catch (e) {
      error.value = errorMessage(e)
    } finally {
      submitting.value = false
    }
  }

  async function cancelDraft(draftId: number): Promise<void> {
    pendingForm.value = null
    try {
      await $fetch(`/api/agent/drafts/${draftId}`, { method: 'DELETE' })
    } catch {
      // Cancelling is best-effort; the draft simply stays open server-side.
    }
  }

  function reset(): void {
    messages.value = []
    currentId.value = null
    title.value = '新对话'
    error.value = ''
    pendingForm.value = null
    pendingApproval.value = null
  }

  if (conversationId) {
    watch(conversationId, (id) => {
      if (id && import.meta.client) void load(id)
    })
  }

  return {
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
    load,
    send,
    decide,
    submitDraft,
    cancelDraft,
    reset
  }
}

export function useSmsConversations() {
  const items = ref<SmsConversationSummary[]>([])
  const loading = ref(false)

  async function refresh(): Promise<void> {
    loading.value = true
    try {
      const data = await $fetch<{ items: SmsConversationSummary[] }>('/api/agent/conversations')
      items.value = data.items ?? []
    } catch {
      // Unauthenticated or transient errors leave the previous list intact.
    } finally {
      loading.value = false
    }
  }

  async function remove(id: number): Promise<void> {
    await $fetch(`/api/agent/conversations/${id}`, { method: 'DELETE' })
    items.value = items.value.filter(item => item.id !== id)
  }

  async function rename(id: number, title: string): Promise<void> {
    const row = await $fetch<SmsConversationSummary>(`/api/agent/conversations/${id}`, {
      method: 'PUT',
      body: { title }
    })
    const index = items.value.findIndex(item => item.id === id)
    if (index >= 0) items.value[index] = row
  }

  return { items, loading, refresh, remove, rename }
}
