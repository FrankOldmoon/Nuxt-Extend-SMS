<script setup lang="ts">
/**
 * The course directory — every course taught this term.
 *
 * Filtered server-side by term, subject and class so the paging total is the
 * number of courses the reader can actually reach. `mine=1` is a teacher's own
 * courses; an administrator seeing "mine" gets everything, which is what the
 * API means by it.
 */
definePageMeta({ layout: 'school' })

const route = useRoute()
const { t } = useI18n()
const { reference } = useSmsReference()

/** `USelect` rejects an empty value, so "no filter" is the number zero. */
const ANY = 0

const page = ref(1)
const pageSize = 12
const q = ref('')
const semesterId = ref(ANY)
const subjectId = ref(ANY)
const classId = ref(ANY)
const mine = ref(route.query.mine === '1')

const params = computed(() => ({
  page: page.value,
  pageSize,
  q: q.value.trim() || undefined,
  semesterId: semesterId.value || undefined,
  subjectId: subjectId.value || undefined,
  classId: classId.value || undefined,
  mine: mine.value ? 1 : undefined
}))

const { data, pending, error } = await useAsyncData(
  'sms:courses',
  () => fetchCourses(params.value),
  { watch: [params] }
)

const { data: classData } = await useAsyncData('sms:courses-classes', () => fetchClasses({ pageSize: 200 }))

const courses = computed(() => data.value?.items ?? [])
const total = computed(() => data.value?.total ?? 0)

watch([q, semesterId, subjectId, classId, mine], () => {
  page.value = 1
})

const semesterItems = computed(() => [
  { label: t('sms.common.all'), value: ANY },
  ...(reference.value?.semesters ?? []).map(semester => ({ label: semester.name, value: semester.id }))
])
const subjectItems = computed(() => [
  { label: t('sms.common.all'), value: ANY },
  ...(reference.value?.subjects ?? []).map(subject => ({ label: subject.name, value: subject.id }))
])
const classItems = computed(() => [
  { label: t('sms.common.all'), value: ANY },
  ...(classData.value?.items ?? []).map(item => ({ label: item.name, value: item.id }))
])
</script>

<template>
  <div class="space-y-6">
    <SmsPageHeader
      :title="t('sms.courses.title')"
      :subtitle="t('sms.courses.subtitle')"
      icon="i-lucide-book-open"
    />

    <div class="flex flex-wrap items-center gap-2">
      <UInput
        v-model="q"
        icon="i-lucide-search"
        :placeholder="t('sms.common.search')"
        class="w-56"
      />
      <USelect
        v-model="semesterId"
        :items="semesterItems"
        class="w-40"
      />
      <USelect
        v-model="subjectId"
        :items="subjectItems"
        class="w-40"
      />
      <USelect
        v-model="classId"
        :items="classItems"
        class="w-40"
      />
      <UButton
        :color="mine ? 'primary' : 'neutral'"
        :variant="mine ? 'soft' : 'ghost'"
        size="sm"
        icon="i-lucide-user"
        :label="t('sms.courses.myCourses')"
        @click="mine = !mine"
      />
      <span class="ml-auto text-xs text-muted">
        {{ t('sms.common.showing', { count: courses.length, total }) }}
      </span>
    </div>

    <UAlert
      v-if="error"
      color="error"
      variant="subtle"
      :description="t('sms.messages.loadFailed')"
    />

    <div
      v-else-if="pending && !courses.length"
      class="py-12 text-center text-sm text-muted"
    >
      {{ t('sms.common.loading') }}
    </div>

    <div
      v-else-if="courses.length"
      class="grid gap-3 sm:grid-cols-2 lg:grid-cols-3"
    >
      <NuxtLink
        v-for="course in courses"
        :key="course.id"
        :to="`/sms/courses/${course.id}`"
        class="flex flex-col rounded-xl border border-default bg-elevated/40 p-4 transition hover:border-primary"
      >
        <div class="flex items-start justify-between gap-2">
          <h3 class="text-base font-semibold text-highlighted">
            {{ course.name }}
          </h3>
          <UBadge
            v-if="!course.isGraded"
            color="neutral"
            variant="subtle"
            size="sm"
            :label="t('sms.courses.notGraded')"
          />
        </div>
        <p
          v-if="course.code"
          class="text-xs text-dimmed"
        >
          {{ course.code }}
        </p>

        <dl class="mt-3 space-y-1 text-xs text-muted">
          <div
            v-if="course.subjectName"
            class="flex items-center gap-1"
          >
            <UIcon
              name="i-lucide-book-marked"
              class="size-3.5"
            />
            <span>{{ course.subjectName }}</span>
          </div>
          <div
            v-if="course.className"
            class="flex items-center gap-1"
          >
            <UIcon
              name="i-lucide-users-round"
              class="size-3.5"
            />
            <span>{{ course.className }}</span>
          </div>
          <div
            v-if="course.semesterName"
            class="flex items-center gap-1"
          >
            <UIcon
              name="i-lucide-calendar-range"
              class="size-3.5"
            />
            <span>{{ course.semesterName }}</span>
          </div>
        </dl>

        <p
          v-if="course.teachers.length"
          class="mt-2 text-xs text-muted"
        >
          {{ course.teachers.map(teacher => teacher.name).join(', ') }}
        </p>

        <div class="mt-auto flex items-center gap-4 pt-3 text-xs text-dimmed">
          <span class="inline-flex items-center gap-1">
            <UIcon
              name="i-lucide-graduation-cap"
              class="size-3.5"
            />
            {{ course.studentCount }}
          </span>
          <span class="inline-flex items-center gap-1">
            <UIcon
              name="i-lucide-clipboard-list"
              class="size-3.5"
            />
            {{ course.assessmentCount }}
          </span>
          <span class="inline-flex items-center gap-1">
            <UIcon
              name="i-lucide-award"
              class="size-3.5"
            />
            {{ course.credits }}
          </span>
        </div>
      </NuxtLink>
    </div>

    <SmsEmptyState
      v-else
      icon="i-lucide-book-open"
      :title="t('sms.courses.empty')"
      :description="t('sms.courses.emptyHint')"
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
