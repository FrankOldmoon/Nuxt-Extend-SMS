<script setup lang="ts">
import type { TableMetaWithOptions } from '~/types/dashboard'
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
const values = ref<Record<string, unknown>>({})
const fieldErrors = ref<Record<string, string>>({})
const meta = computed<TableMetaWithOptions>(() => ({
  table: 'sms-record', label: props.title, icon: 'i-lucide-file-text', custom: false,
  features: { softDelete: false, search: [] },
  fields: props.fields.map(field => ({
    key: field.key, label: field.label, type: field.type ?? 'text',
    nullable: !field.required, editable: field.editable !== false,
    showInForm: field.editable !== false, showInTable: false, showInDetail: true,
    validation: field.editable === false ? undefined : { required: field.required },
    options: field.options
  })),
  relationOptions: Object.fromEntries(props.fields.filter(f => f.options).map(f => [f.key, f.options!]))
}))

function resetValues(): void {
  values.value = Object.fromEntries(props.fields.map(field => [field.key, props.record?.[field.key] ?? null]))
  fieldErrors.value = {}
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
  fieldErrors.value = validateForm(meta.value, values.value, 'update')
  if (Object.keys(fieldErrors.value).length) return
  const payload: Record<string, unknown> = {}
  for (const field of props.fields) {
    if (field.editable === false) continue
    const raw = String(values.value[field.key] ?? '')
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

        <DashboardCrudDetail
          v-if="!editing"
          :meta="meta"
          :item="record"
        >
          <template
            v-for="field in fields"
            :key="field.key"
            #[`detail-${field.key}`]
          >
            {{ display(field) }}
          </template>
        </DashboardCrudDetail>
        <form
          v-else
          @submit.prevent="submit"
        >
          <DashboardCrudForm
            v-model="values"
            :meta="meta"
            mode="update"
            :errors="fieldErrors"
          />
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
