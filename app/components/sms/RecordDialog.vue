<script setup lang="ts">
import type { SmsRecordField } from '../../composables/useSmsRecord'
import { formatSmsRecordValue } from '../../composables/useSmsRecord'

/**
 * Detail dialog for chat table rows.
 *
 * The record is always fetched by the owning table component through the
 * permission-checked CRUD API; this dialog only renders it and, when the
 * viewer has the update permission, collects the editable fields.
 */
const props = defineProps<{
  open: boolean
  title: string
  record: Record<string, unknown> | null
  fields: SmsRecordField[]
  loading?: boolean
  canEdit?: boolean
  saving?: boolean
  error?: string
}>()

const emit = defineEmits<{
  'update:open': [boolean]
  'save': [payload: Record<string, unknown>]
}>()

const editing = ref(false)
const validation = ref('')
const values = reactive<Record<string, string>>({})

function resetValues(): void {
  for (const field of props.fields) {
    const raw = props.record?.[field.key]
    values[field.key] = raw === null || raw === undefined ? '' : String(raw)
  }
}

watch(() => props.open, () => {
  editing.value = false
  validation.value = ''
  resetValues()
})

// A successful save replaces the record object: leave edit mode and show it.
watch(() => props.record, () => {
  editing.value = false
  validation.value = ''
  resetValues()
})

function close(): void {
  emit('update:open', false)
}

function display(field: SmsRecordField): string {
  return formatSmsRecordValue(field, props.record?.[field.key])
}

function startEdit(): void {
  resetValues()
  validation.value = ''
  editing.value = true
}

function submit(): void {
  const payload: Record<string, unknown> = {}
  for (const field of props.fields) {
    if (field.editable === false) continue
    const raw = values[field.key] ?? ''
    if (field.type === 'select') {
      if (raw === '') {
        if (field.required) {
          validation.value = `请选择${field.label}`
          return
        }
        payload[field.key] = null
        continue
      }
      const option = field.options?.find(item => String(item.value) === raw)
      payload[field.key] = option ? option.value : raw
      continue
    }
    const text = raw.trim()
    if (!text) {
      if (field.required) {
        validation.value = `请填写${field.label}`
        return
      }
      continue
    }
    payload[field.key] = field.type === 'number' ? Number(text) : text
  }
  validation.value = ''
  emit('save', payload)
}
</script>

<template>
  <UModal
    :open="open"
    :title="title"
    @update:open="emit('update:open', $event)"
  >
    <template #body>
      <p
        v-if="loading"
        class="flex items-center gap-1.5 text-sm text-muted"
      >
        <UIcon
          name="i-lucide-loader-circle"
          class="size-4 animate-spin"
        />
        正在加载详情…
      </p>

      <p
        v-else-if="!record && error"
        class="rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700 dark:bg-red-950/40 dark:text-red-300"
      >
        {{ error }}
      </p>

      <template v-else-if="record">
        <p
          v-if="error"
          class="mb-3 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700 dark:bg-red-950/40 dark:text-red-300"
        >
          {{ error }}
        </p>

        <dl
          v-if="!editing"
          class="space-y-2 text-sm"
        >
          <div
            v-for="field in fields"
            :key="field.key"
            class="flex gap-3"
          >
            <dt class="w-20 shrink-0 text-muted">
              {{ field.label }}
            </dt>
            <dd class="min-w-0 flex-1 break-words text-highlighted">
              {{ display(field) }}
            </dd>
          </div>
        </dl>

        <form
          v-else
          class="space-y-3"
          @submit.prevent="submit"
        >
          <div
            v-for="field in fields"
            :key="field.key"
          >
            <label
              :for="`record-${field.key}`"
              class="mb-1 block text-xs font-medium text-toned"
            >
              {{ field.label }}
              <span
                v-if="field.required"
                class="text-red-500"
              >*</span>
            </label>

            <template v-if="field.editable === false">
              <p class="text-sm text-highlighted">
                {{ display(field) }}
              </p>
            </template>

            <select
              v-else-if="field.type === 'select'"
              :id="`record-${field.key}`"
              v-model="values[field.key]"
              class="w-full rounded-lg border border-default bg-default px-2.5 py-1.5 text-sm text-highlighted outline-none focus:border-primary"
            >
              <option
                v-for="option in field.options ?? []"
                :key="String(option.value)"
                :value="String(option.value ?? '')"
              >
                {{ option.label }}
              </option>
            </select>

            <input
              v-else
              :id="`record-${field.key}`"
              v-model="values[field.key]"
              :type="field.type === 'number' ? 'number' : 'text'"
              class="w-full rounded-lg border border-default bg-default px-2.5 py-1.5 text-sm text-highlighted outline-none focus:border-primary"
            >
          </div>
        </form>

        <p
          v-if="validation"
          class="mt-2 text-xs text-red-500"
        >
          {{ validation }}
        </p>
      </template>

      <div class="mt-5 flex justify-end gap-2">
        <template v-if="!editing">
          <UButton
            color="neutral"
            variant="ghost"
            size="sm"
            @click="close"
          >
            关闭
          </UButton>
          <UButton
            v-if="canEdit && record"
            icon="i-lucide-pencil"
            size="sm"
            :disabled="loading"
            @click="startEdit"
          >
            编辑
          </UButton>
        </template>
        <template v-else>
          <UButton
            color="neutral"
            variant="ghost"
            size="sm"
            :disabled="saving"
            @click="editing = false; validation = ''"
          >
            取消
          </UButton>
          <UButton
            size="sm"
            :loading="saving"
            @click="submit"
          >
            保存
          </UButton>
        </template>
      </div>
    </template>
  </UModal>
</template>
