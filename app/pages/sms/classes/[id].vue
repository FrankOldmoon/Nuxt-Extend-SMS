<script setup lang="ts">
/**
 * One class: its cohort, the courses taught to it, and its week.
 *
 * The roster is scoped by the server (staff see the class, a student only
 * themselves, a guardian only their wards), so this page works for every role
 * without a permission branch of its own. The timetable is only fetched when the
 * viewer is allowed to see it, which keeps a 403 off the page for a student
 * looking at another cohort.
 */
import type { ClassDetail } from '../../../composables/useSms'

definePageMeta({ layout: 'school' })

const route = useRoute()
const classId = Number(route.params.id)
const { t } = useI18n()
const { viewer } = useSmsViewer()

const tab = ref<'students' | 'courses' | 'timetable'>('students')

const { data, pending, error } = await useAsyncData(
  `sms:class:${classId}`,
  () => fetchClassDetail(classId)
)
const detail = computed<ClassDetail | null>(() => data.value ?? null)
const klass = computed(() => detail.value?.class ?? null)

const canSeeTimetable = computed(() =>
  (viewer.value?.isStaff ?? false) || viewer.value?.classId === classId)

const { data: timetableData } = await useAsyncData(
  `sms:class-timetable:${classId}`,
  () => (canSeeTimetable.value ? fetchTimetable({ classId }) : Promise.resolve(null)),
  { watch: [canSeeTimetable] }
)
</script>

<template>
  <div class="space-y-6">
    <UAlert
      v-if="error"
      color="error"
      variant="subtle"
      :description="t('sms.messages.loadFailed')"
    />

    <div
      v-else-if="pending && !detail"
      class="py-16 text-center text-sm text-muted"
    >
      {{ t('sms.common.loading') }}
    </div>

    <template v-else-if="klass">
      <SmsPageHeader
        :title="klass.name"
        :subtitle="[klass.gradeName, klass.departmentName].filter(Boolean).join(' · ')"
        icon="i-lucide-users-round"
        back-to="/sms/classes"
      >
        <template #actions>
          <UBadge
            v-if="klass.isGraduated"
            color="neutral"
            variant="subtle"
            :label="t('sms.classes.graduated')"
          />
          <UButton
            v-if="canSeeTimetable"
            :to="`/sms/timetable?classId=${classId}`"
            icon="i-lucide-calendar-clock"
            color="neutral"
            variant="soft"
            size="sm"
            :label="t('sms.classes.timetable')"
          />
        </template>
      </SmsPageHeader>

      <div class="flex flex-wrap items-center gap-2 border-b border-default pb-3">
        <UButton
          :color="tab === 'students' ? 'primary' : 'neutral'"
          :variant="tab === 'students' ? 'soft' : 'ghost'"
          size="sm"
          icon="i-lucide-graduation-cap"
          :label="`${t('sms.classes.students')} (${detail?.students.length ?? 0})`"
          @click="tab = 'students'"
        />
        <UButton
          :color="tab === 'courses' ? 'primary' : 'neutral'"
          :variant="tab === 'courses' ? 'soft' : 'ghost'"
          size="sm"
          icon="i-lucide-book-open"
          :label="`${t('sms.courses.title')} (${detail?.courses.length ?? 0})`"
          @click="tab = 'courses'"
        />
        <UButton
          v-if="canSeeTimetable"
          :color="tab === 'timetable' ? 'primary' : 'neutral'"
          :variant="tab === 'timetable' ? 'soft' : 'ghost'"
          size="sm"
          icon="i-lucide-calendar-clock"
          :label="t('sms.classes.timetable')"
          @click="tab = 'timetable'"
        />
      </div>

      <!-- Students -->
      <div
        v-if="tab === 'students'"
        class="space-y-4"
      >
        <div
          v-if="detail?.students.length"
          class="overflow-x-auto rounded-xl border border-default"
        >
          <table class="w-full border-collapse text-sm">
            <thead>
              <tr class="bg-elevated/60">
                <th class="border-b border-default px-3 py-2 text-left text-xs font-medium text-muted">
                  {{ t('sms.students.rollId') }}
                </th>
                <th class="border-b border-l border-default px-3 py-2 text-left text-xs font-medium text-muted">
                  {{ t('sms.scores.student') }}
                </th>
                <th class="border-b border-l border-default px-3 py-2 text-left text-xs font-medium text-muted">
                  {{ t('sms.students.status') }}
                </th>
              </tr>
            </thead>
            <tbody>
              <tr
                v-for="student in detail.students"
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
                <td class="border-b border-l border-default px-3 py-2">
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
      </div>

      <!-- Courses -->
      <div
        v-else-if="tab === 'courses'"
        class="space-y-4"
      >
        <div
          v-if="detail?.courses.length"
          class="grid gap-3 sm:grid-cols-2 lg:grid-cols-3"
        >
          <NuxtLink
            v-for="course in detail.courses"
            :key="course.id"
            :to="`/sms/courses/${course.id}`"
            class="rounded-xl border border-default bg-elevated/40 p-4 transition hover:border-primary"
          >
            <p class="font-medium text-highlighted">
              {{ course.name }}
            </p>
            <p class="mt-1 text-xs text-muted">
              {{ course.subjectName ?? '—' }} · {{ course.studentCount }} {{ t('sms.courses.students') }}
            </p>
            <p
              v-if="course.teachers.length"
              class="mt-1 text-xs text-dimmed"
            >
              {{ course.teachers.map(teacher => teacher.name).join(', ') }}
            </p>
          </NuxtLink>
        </div>
        <SmsEmptyState
          v-else
          icon="i-lucide-book-open"
          :title="t('sms.courses.empty')"
          :description="t('sms.courses.emptyHint')"
        />
      </div>

      <!-- Timetable -->
      <div v-else>
        <SmsTimetableGrid
          v-if="timetableData"
          :timetable="timetableData"
        />
        <SmsEmptyState
          v-else
          icon="i-lucide-calendar-clock"
          :title="t('sms.timetable.noLessons')"
          :description="t('sms.timetable.noLessonsHint')"
        />
      </div>
    </template>
  </div>
</template>
