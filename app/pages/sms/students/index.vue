<script setup lang="ts">
/**
 * The student directory.
 *
 * The read scope is applied by the server (a teacher and admin see everyone, a
 * student sees themselves, a guardian their wards, a visitor nothing), so this
 * page is the same for every role — a visitor simply gets an empty result.
 */
definePageMeta({ layout: 'school' })

const { t } = useI18n()
const { reference } = useSmsReference()

const ANY = 0
const STATUS_ANY = 'any'

const page = ref(1)
const pageSize = 20
const q = ref('')
const classId = ref(ANY)
const gradeId = ref(ANY)
const status = ref(STATUS_ANY)

const params = computed(() => ({
  page: page.value,
  pageSize,
  q: q.value.trim() || undefined,
  classId: classId.value || undefined,
  gradeId: gradeId.value || undefined,
  status: status.value === STATUS_ANY ? undefined : status.value
}))

const { data, pending, error } = await useAsyncData(
  'sms:students',
  () => fetchStudents(params.value),
  { watch: [params] }
)

const { data: classData } = await useAsyncData('sms:students-classes', () => fetchClasses({ pageSize: 200 }))

const students = computed(() => data.value?.items ?? [])
const total = computed(() => data.value?.total ?? 0)

watch([q, classId, gradeId, status], () => {
  page.value = 1
})

const classItems = computed(() => [
  { label: t('sms.common.all'), value: ANY },
  ...(classData.value?.items ?? []).map(item => ({ label: item.name, value: item.id }))
])
const gradeItems = computed(() => [
  { label: t('sms.common.all'), value: ANY },
  ...(reference.value?.grades ?? []).map(grade => ({ label: grade.name, value: grade.id }))
])
const statusItems = computed(() => [
  { label: t('sms.common.all'), value: STATUS_ANY },
  { label: t('sms.students.enrolled'), value: 'enrolled' },
  { label: t('sms.students.graduated'), value: 'graduated' },
  { label: t('sms.students.left'), value: 'left' },
  { label: t('sms.students.suspended'), value: 'suspended' }
])
</script>

<template>
  <div class="space-y-6">
    <SmsPageHeader
      :title="t('sms.students.title')"
      :subtitle="t('sms.students.subtitle')"
      icon="i-lucide-graduation-cap"
    />

    <div class="flex flex-wrap items-center gap-2">
      <UInput
        v-model="q"
        icon="i-lucide-search"
        :placeholder="t('sms.common.search')"
        class="w-56"
      />
      <USelect
        v-model="classId"
        :items="classItems"
        class="w-40"
      />
      <USelect
        v-model="gradeId"
        :items="gradeItems"
        class="w-36"
      />
      <USelect
        v-model="status"
        :items="statusItems"
        class="w-40"
      />
      <span class="ml-auto text-xs text-muted">
        {{ t('sms.common.showing', { count: students.length, total }) }}
      </span>
    </div>

    <UAlert
      v-if="error"
      color="error"
      variant="subtle"
      :description="t('sms.messages.loadFailed')"
    />

    <div
      v-else-if="pending && !students.length"
      class="py-12 text-center text-sm text-muted"
    >
      {{ t('sms.common.loading') }}
    </div>

    <div
      v-else-if="students.length"
      class="overflow-x-auto rounded-xl border border-default"
    >
      <table class="w-full border-collapse text-sm">
        <thead>
          <tr class="bg-elevated/60">
            <th class="border-b border-default px-3 py-2 text-left text-xs font-medium text-muted">
              {{ t('sms.students.rollId') }}
            </th>
            <th class="border-b border-l border-default px-3 py-2 text-left text-xs font-medium text-muted">
              {{ t('sms.common.name') }}
            </th>
            <th class="border-b border-l border-default px-3 py-2 text-left text-xs font-medium text-muted">
              {{ t('sms.courses.class') }}
            </th>
            <th class="border-b border-l border-default px-3 py-2 text-left text-xs font-medium text-muted">
              {{ t('sms.classes.grade') }}
            </th>
            <th class="border-b border-l border-default px-3 py-2 text-left text-xs font-medium text-muted">
              {{ t('sms.students.gender') }}
            </th>
            <th class="border-b border-l border-default px-3 py-2 text-center text-xs font-medium text-muted">
              {{ t('sms.students.status') }}
            </th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="student in students"
            :key="student.id"
          >
            <td class="border-b border-default px-3 py-2 text-muted">
              {{ student.rollId }}
            </td>
            <td class="border-b border-l border-default px-3 py-2">
              <NuxtLink
                :to="`/sms/students/${student.id}`"
                class="font-medium text-highlighted hover:text-primary"
              >
                {{ student.name }}
              </NuxtLink>
            </td>
            <td class="border-b border-l border-default px-3 py-2 text-muted">
              {{ student.className ?? '—' }}
            </td>
            <td class="border-b border-l border-default px-3 py-2 text-muted">
              {{ student.gradeName ?? '—' }}
            </td>
            <td class="border-b border-l border-default px-3 py-2 text-muted">
              {{ student.gender ? t(`sms.students.${student.gender}`) : '—' }}
            </td>
            <td class="border-b border-l border-default px-3 py-2 text-center">
              <UBadge
                color="neutral"
                variant="subtle"
                size="sm"
                :label="t(`sms.students.${student.status}`)"
              />
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <SmsEmptyState
      v-else
      icon="i-lucide-graduation-cap"
      :title="t('sms.students.empty')"
      :description="t('sms.students.emptyHint')"
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
