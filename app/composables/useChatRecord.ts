/**
 * Shared detail/edit lifecycle for chat table components.
 *
 * Detail and update always go through the permission-checked generic CRUD API
 * (`/api/dashboard/data/<table>/<id>`), which also writes `audit_logs`. Saves
 * check the record's update stamp first so a stale dialog cannot silently
 * overwrite someone else's edit.
 */
export interface UseChatRecordOptions {
  table: string
  fallbackError: string
  onSaved?: (item: Record<string, unknown>) => void
}

function errorMessage(value: unknown, fallback: string): string {
  if (value && typeof value === 'object') {
    const data = (value as { data?: { message?: unknown, statusMessage?: unknown } }).data
    if (data) {
      if (typeof data.message === 'string' && data.message) return data.message
      if (typeof data.statusMessage === 'string' && data.statusMessage) return data.statusMessage
      if (typeof (data as { statusCode?: unknown }).statusCode === 'number') {
        return (data as { statusCode: number }).statusCode === 403
          ? '没有权限执行此操作'
          : fallback
      }
    }
    const message = (value as { message?: unknown }).message
    if (typeof message === 'string' && message) return message
  }
  return fallback
}

function updateStamp(record: Record<string, unknown> | null | undefined): string {
  if (!record) return ''
  const value = record.updatedAt ?? record.updated_at
  return value === null || value === undefined ? '' : String(value)
}

export function useChatRecord(options: UseChatRecordOptions) {
  const dialogOpen = ref(false)
  const selected = ref<Record<string, unknown> | null>(null)
  const detailLoading = ref(false)
  const detailError = ref('')
  const saving = ref(false)

  async function open(id: number): Promise<void> {
    dialogOpen.value = true
    selected.value = null
    detailError.value = ''
    detailLoading.value = true
    try {
      const response = await $fetch<{ item: Record<string, unknown> }>(
        `/api/dashboard/data/${options.table}/${id}`
      )
      selected.value = response.item
    } catch (value) {
      detailError.value = errorMessage(value, options.fallbackError)
    } finally {
      detailLoading.value = false
    }
  }

  async function save(payload: Record<string, unknown>): Promise<void> {
    const id = selected.value?.id
    if (id === undefined || id === null) return
    saving.value = true
    detailError.value = ''
    try {
      // Optimistic concurrency: refuse to overwrite a row changed elsewhere.
      const before = updateStamp(selected.value)
      if (before) {
        const latest = await $fetch<{ item: Record<string, unknown> }>(
          `/api/dashboard/data/${options.table}/${String(id)}`
        )
        if (updateStamp(latest.item) && updateStamp(latest.item) !== before) {
          detailError.value = '记录已被他人修改，请关闭弹窗后重新打开再试。'
          return
        }
      }

      const response = await $fetch<{ item: Record<string, unknown> }>(
        `/api/dashboard/data/${options.table}/${String(id)}`,
        { method: 'PUT', body: payload }
      )
      selected.value = response.item
      options.onSaved?.(response.item)
    } catch (value) {
      detailError.value = errorMessage(value, options.fallbackError)
    } finally {
      saving.value = false
    }
  }

  return { dialogOpen, selected, detailLoading, detailError, saving, open, save }
}
