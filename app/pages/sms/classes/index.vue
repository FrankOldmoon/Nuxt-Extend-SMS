<script setup lang="ts">
/**
 * The class directory — the teaching groups.
 *
 * Graduated cohorts are hidden by default (they stay for history); the toggle
 * brings them back for the archive. Filtering is server-side so the paging total
 * reflects what the reader can reach.
 */
definePageMeta({ layout: 'school' })

const { t } = useI18n()
const { reference } = useSmsReference()

const ANY = 0
const page = ref(1)
const pageSize = 12
const q = ref('')
const gradeId = ref(ANY)
const departmentId = ref(ANY)
const includeGraduated = ref(false)

const params = computed(() => ({
  page: page.value,
  pageSize,
  q: q.value.trim() || undefined,
  gradeId: gradeId.value || undefined,
  departmentId: departmentId.value || undefined,
  includeGraduated: includeGraduated.value ? 1 : undefined
}))

const { data, pending, error } = await useAsyncData(
  'sms:classes',
  () => fetchClasses(params.value),
  { watch: [params] }
)

const classes = computed(() => data.value?.items ?? [])
const total = computed(() => data.value?.total ?? 0)

watch([q, gradeId, departmentId, includeGraduated], () => {
  page.value = 1
})

const gradeItems = computed(() => [
  { label: t('sms.common.all'), value: ANY },
  ...(reference.value?.grades ?? []).map(grade => ({ label: grade.name, value: grade.id }))
])
const departmentItems = computed(() => [
  { label: t('sms.common.all'), value: ANY },
  ...(reference.value?.departments ?? []).map(department => ({ label: department.name, value: department.id }))
])
</script>

<template>
  <div class="space-y-6">
    <SmsPageHeader
      :title="t('sms.classes.title')"
      :subtitle="t('sms.classes.subtitle')"
      icon="i-lucide-users-round"
    />

    <div class="flex flex-wrap items-center gap-2">
      <UInput
        v-model="q"
        icon="i-lucide-search"
        :placeholder="t('sms.common.search')"
        class="w-56"
      />
      <USelect
        v-model="gradeId"
        :items="gradeItems"
        class="w-40"
      />
      <USelect
        v-model="departmentId"
        :items="departmentItems"
        class="w-44"
      />
      <UButton
        :color="includeGraduated ? 'primary' : 'neutral'"
        :variant="includeGraduated ? 'soft' : 'ghost'"
        size="sm"
        icon="i-lucide-graduation-cap"
        :label="t('sms.classes.graduated')"
        @click="includeGraduated = !includeGraduated"
      />
      <span class="ml-auto text-xs text-muted">
        {{ t('sms.common.showing', { count: classes.length, total }) }}
      </span>
    </div>

    <UAlert
      v-if="error"
      color="error"
      variant="subtle"
      :description="t('sms.messages.loadFailed')"
    />

    <div
      v-else-if="pending && !classes.length"
      class="py-12 text-center text-sm text-muted"
    >
      {{ t('sms.common.loading') }}
    </div>

    <div
      v-else-if="classes.length"
      class="grid gap-3 sm:grid-cols-2 lg:grid-cols-3"
    >
      <NuxtLink
        v-for="item in classes"
        :key="item.id"
        :to="`/sms/classes/${item.id}`"
        class="flex flex-col rounded-xl border border-default bg-elevated/40 p-4 transition hover:border-primary"
      >
        <div class="flex items-start justify-between gap-2">
          <h3 class="text-base font-semibold text-highlighted">
            {{ item.name }}
          </h3>
          <UBadge
            v-if="item.isGraduated"
            color="neutral"
            variant="subtle"
            size="sm"
            :label="t('sms.classes.graduated')"
          />
        </div>
        <p
          v-if="item.code"
          class="text-xs text-dimmed"
        >
          {{ item.code }}
        </p>

        <dl class="mt-3 space-y-1 text-xs text-muted">
          <div
            v-if="item.gradeName"
            class="flex items-center gap-1"
          >
            <UIcon
              name="i-lucide-layers"
              class="size-3.5"
            />
            <span>{{ item.gradeName }}</span>
          </div>
          <div
            v-if="item.departmentName"
            class="flex items-center gap-1"
          >
            <UIcon
              name="i-lucide-building-2"
              class="size-3.5"
            />
            <span>{{ item.departmentName }}</span>
          </div>
          <div
            v-if="item.headTeacherName"
            class="flex items-center gap-1"
          >
            <UIcon
              name="i-lucide-user-check"
              class="size-3.5"
            />
            <span>{{ item.headTeacherName }}</span>
          </div>
          <div
            v-if="item.classroomName"
            class="flex items-center gap-1"
          >
            <UIcon
              name="i-lucide-door-open"
              class="size-3.5"
            />
            <span>{{ item.classroomName }}</span>
          </div>
        </dl>

        <div class="mt-auto flex items-center gap-4 pt-3 text-xs text-dimmed">
          <span class="inline-flex items-center gap-1">
            <UIcon
              name="i-lucide-graduation-cap"
              class="size-3.5"
            />
            {{ item.studentCount }}
            <template v-if="item.capacity">/ {{ item.capacity }}</template>
          </span>
        </div>
      </NuxtLink>
    </div>

    <SmsEmptyState
      v-else
      icon="i-lucide-users-round"
      :title="t('sms.classes.empty')"
      :description="t('sms.classes.emptyHint')"
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
