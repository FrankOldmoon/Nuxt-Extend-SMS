<script setup lang="ts">
/**
 * The teaching-staff directory.
 *
 * Read-only from the portal: a teacher record is a role a host user holds, so
 * creating one means linking a user — which the back office (the generic CRUD)
 * is where you do it. What this page adds is the timetable shortcut, which is
 * the thing a school actually looks up a teacher for.
 */
definePageMeta({ layout: 'school' })

const { t } = useI18n()
const { reference } = useSmsReference()

const ANY = 0
const page = ref(1)
const pageSize = 20
const q = ref('')
const departmentId = ref(ANY)

const params = computed(() => ({
  page: page.value,
  pageSize,
  q: q.value.trim() || undefined,
  departmentId: departmentId.value || undefined
}))

const { data, pending, error } = await useAsyncData(
  'sms:teachers',
  () => fetchTeachers(params.value),
  { watch: [params] }
)

const teachers = computed(() => data.value?.items ?? [])
const total = computed(() => data.value?.total ?? 0)

watch([q, departmentId], () => {
  page.value = 1
})

const departmentItems = computed(() => [
  { label: t('sms.common.all'), value: ANY },
  ...(reference.value?.departments ?? []).map(department => ({ label: department.name, value: department.id }))
])
</script>

<template>
  <div class="space-y-6">
    <SmsPageHeader
      :title="t('sms.teachers.title')"
      :subtitle="t('sms.teachers.subtitle')"
      icon="i-lucide-user-check"
    />

    <div class="flex flex-wrap items-center gap-2">
      <UInput
        v-model="q"
        icon="i-lucide-search"
        :placeholder="t('sms.common.search')"
        class="w-56"
      />
      <USelect
        v-model="departmentId"
        :items="departmentItems"
        class="w-44"
      />
      <span class="ml-auto text-xs text-muted">
        {{ t('sms.common.showing', { count: teachers.length, total }) }}
      </span>
    </div>

    <UAlert
      v-if="error"
      color="error"
      variant="subtle"
      :description="t('sms.messages.loadFailed')"
    />

    <div
      v-else-if="pending && !teachers.length"
      class="py-12 text-center text-sm text-muted"
    >
      {{ t('sms.common.loading') }}
    </div>

    <div
      v-else-if="teachers.length"
      class="overflow-x-auto rounded-xl border border-default"
    >
      <table class="w-full border-collapse text-sm">
        <thead>
          <tr class="bg-elevated/60">
            <th class="border-b border-default px-3 py-2 text-left text-xs font-medium text-muted">
              {{ t('sms.teachers.employeeNo') }}
            </th>
            <th class="border-b border-l border-default px-3 py-2 text-left text-xs font-medium text-muted">
              {{ t('sms.common.name') }}
            </th>
            <th class="border-b border-l border-default px-3 py-2 text-left text-xs font-medium text-muted">
              {{ t('sms.teachers.jobTitle') }}
            </th>
            <th class="border-b border-l border-default px-3 py-2 text-left text-xs font-medium text-muted">
              {{ t('sms.teachers.department') }}
            </th>
            <th class="border-b border-l border-default px-3 py-2 text-center text-xs font-medium text-muted">
              {{ t('sms.teachers.courses') }}
            </th>
            <th class="border-b border-l border-default px-3 py-2 text-right text-xs font-medium text-muted">
              {{ t('sms.common.actions') }}
            </th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="teacher in teachers"
            :key="teacher.id"
          >
            <td class="border-b border-default px-3 py-2 text-muted">
              {{ teacher.employeeNo ?? '—' }}
            </td>
            <td class="border-b border-l border-default px-3 py-2 font-medium text-highlighted">
              {{ teacher.name }}
              <UBadge
                v-if="teacher.isForeign"
                color="info"
                variant="subtle"
                size="sm"
                class="ml-1"
                :label="t('sms.teachers.isForeign')"
              />
            </td>
            <td class="border-b border-l border-default px-3 py-2 text-muted">
              {{ teacher.title ?? '—' }}
            </td>
            <td class="border-b border-l border-default px-3 py-2 text-muted">
              {{ teacher.departmentName ?? '—' }}
            </td>
            <td class="border-b border-l border-default px-3 py-2 text-center text-muted">
              {{ teacher.courseCount }}
            </td>
            <td class="border-b border-l border-default px-3 py-2 text-right">
              <UButton
                :to="`/sms/timetable?teacherId=${teacher.id}`"
                icon="i-lucide-calendar-clock"
                color="neutral"
                variant="ghost"
                size="xs"
                :label="t('sms.timetable.title')"
              />
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <SmsEmptyState
      v-else
      icon="i-lucide-user-check"
      :title="t('sms.teachers.empty')"
      :description="t('sms.teachers.emptyHint')"
    />

    <div
      v-if="total > pageSize"
      class="flex justify-end"
    >
      <UPagination
        :page="page"
        :total="total"
        :items-per-page="pageSize"
        size="sm"
        @update:page="page = $event"
      />
    </div>
  </div>
</template>
