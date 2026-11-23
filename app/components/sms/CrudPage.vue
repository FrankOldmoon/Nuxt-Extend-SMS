<script setup lang="ts">
import type { TableMetaWithOptions } from '~/types/dashboard'

// SMS only supplies metadata and school-specific slots; the host owns CRUD behavior.
const props = defineProps<{ table: string }>()
const route = useRoute()
const localePath = useLocalePath()
const { can } = useSmsPermission()
const { data: meta, error, pending, refresh } = await useAsyncData(
  () => 'sms:crud-meta:' + props.table,
  () => cGet<TableMetaWithOptions>('/api/dashboard/meta/' + props.table)
)
const initialFilters = { search: typeof route.query.q === 'string' ? route.query.q : '' }
const classOptions = computed(() => [
  { label: '全部班级', value: 'all' },
  ...(meta.value?.relationOptions?.classId ?? []).filter(o => o.value !== null).map(o => ({ label: o.label, value: String(o.value) }))
])
</script>

<template>
  <div class="min-h-0 flex-1 overflow-y-auto">
    <div
      v-if="error"
      class="p-5"
    >
      <UAlert
        color="error"
        title="无法加载此管理页面"
        :description="extractErrorMessage(error, '请检查访问权限或重试')"
      />
      <UButton
        class="mt-3"
        variant="soft"
        @click="refresh()"
      >
        重试
      </UButton>
    </div>
    <div
      v-else-if="pending || !meta"
      class="p-5 text-muted"
    >
      正在加载…
    </div>
    <DashboardCrudPage
      v-else
      :key="table"
      :meta="meta"
      compact
      :initial-filters="initialFilters"
      :allow-seed="false"
      :allow-import="table !== 'students'"
    >
      <template
        v-if="table === 'students'"
        #toolbar-append
      >
        <UButton
          v-if="can('students', 'create')"
          variant="soft"
          icon="i-lucide-upload"
          :to="localePath('/sms/students/import')"
        >
          批量导入
        </UButton>
        <UButton
          v-if="can('students', 'update')"
          variant="soft"
          icon="i-lucide-arrow-left-right"
          :to="localePath('/sms/students/movements')"
        >
          学籍异动
        </UButton>
      </template>
      <template
        v-if="table === 'students'"
        #filters="{ filters, set }"
      >
        <USelect
          :model-value="filters.classId || 'all'"
          :items="classOptions"
          class="w-44"
          aria-label="班级"
          @update:model-value="set('classId', $event === 'all' ? undefined : String($event))"
        />
        <SmsChildSwitcher
          :model-value="filters.id ? Number(filters.id) : null"
          @update:model-value="set('id', $event ?? undefined)"
        />
      </template>
      <template
        v-if="table === 'students'"
        #table-actions-prepend="{ item }"
      >
        <UButton
          v-if="can('students', 'update')"
          size="xs"
          variant="ghost"
          :to="localePath('/sms/students/movements?studentId=' + item.id)"
        >
          异动
        </UButton>
      </template>
    </DashboardCrudPage>
  </div>
</template>
