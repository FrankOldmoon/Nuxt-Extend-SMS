<script setup lang="ts">
/**
 * The portal — the same URL, shaped by the role that opens it.
 *
 * The API returns one block per role the viewer actually holds (a teacher can
 * also be a parent) and leaves the rest null, so this page renders whatever is
 * there rather than switching on a single role string. A signed-out visitor gets
 * an invitation; a signed-in user with no student/teacher/guardian record gets
 * the "not linked yet" state, which is the honest answer to why every block is
 * empty.
 */
definePageMeta({ layout: 'school' })

const { t } = useI18n()
const { viewer } = useSmsViewer()

const signedIn = computed(() => viewer.value?.signedIn ?? false)
const linked = computed(() => viewer.value?.linked ?? false)

const { data, pending, error } = await useAsyncData(
  'sms:portal',
  () => (signedIn.value ? fetchPortal() : Promise.resolve(null)),
  { watch: [signedIn] }
)

const portal = computed(() => data.value ?? null)

const adminStats = computed(() => {
  const admin = portal.value?.admin
  if (!admin) return []
  return [
    { label: t('sms.portal.pendingReview'), icon: 'i-lucide-clipboard-check', value: admin.pendingSubmissions, to: '/sms/review' },
    { label: t('sms.home.students'), icon: 'i-lucide-graduation-cap', value: admin.counts.students, to: '/sms/students' },
    { label: t('sms.home.teachers'), icon: 'i-lucide-user-check', value: admin.counts.teachers, to: '/sms/teachers' },
    { label: t('sms.guardians.title'), icon: 'i-lucide-user-round', value: admin.counts.guardians, to: '/sms/guardians' },
    { label: t('sms.home.courses'), icon: 'i-lucide-book-open', value: admin.counts.courses, to: '/sms/courses' },
    { label: t('sms.home.classes'), icon: 'i-lucide-users-round', value: admin.counts.classes, to: '/sms/classes' }
  ]
})
</script>

<template>
  <div class="space-y-8">
    <SmsPageHeader
      :title="t('sms.portal.title')"
      :subtitle="portal?.semester?.name ?? undefined"
      icon="i-lucide-layout-dashboard"
    />

    <UAlert
      v-if="!signedIn"
      color="warning"
      variant="subtle"
      :title="t('sms.messages.notSignedIn')"
      :description="t('sms.account.signInToPortal')"
    >
      <template #actions>
        <UButton
          to="/login"
          size="sm"
          :label="t('sms.actions.signIn')"
        />
      </template>
    </UAlert>

    <UAlert
      v-else-if="!linked"
      color="warning"
      variant="subtle"
      :title="t('sms.portal.notLinkedTitle')"
      :description="t('sms.portal.notLinkedHint')"
    />

    <UAlert
      v-else-if="error"
      color="error"
      variant="subtle"
      :description="t('sms.messages.loadFailed')"
    />

    <div
      v-else-if="pending && !portal"
      class="py-16 text-center text-sm text-muted"
    >
      {{ t('sms.common.loading') }}
    </div>

    <template v-else-if="portal">
      <p
        v-if="portal.viewer.name"
        class="text-sm text-muted"
      >
        {{ t('sms.portal.welcomeBack', { name: portal.viewer.name }) }}
      </p>

      <!-- Administrator -->
      <section
        v-if="portal.admin"
        class="space-y-3"
      >
        <h2 class="text-lg font-semibold text-highlighted">
          {{ t('sms.role.admin') }}
        </h2>
        <div class="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
          <SmsStatCard
            v-for="item in adminStats"
            :key="item.to"
            :label="item.label"
            :value="item.value"
            :icon="item.icon"
            :to="item.to"
          />
        </div>
      </section>

      <!-- Teacher -->
      <section
        v-if="portal.teacher"
        class="space-y-4"
      >
        <h2 class="text-lg font-semibold text-highlighted">
          {{ t('sms.role.teacher') }}
        </h2>

        <div class="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <SmsStatCard
            :label="t('sms.portal.myCourses')"
            :value="portal.teacher.courses.length"
            icon="i-lucide-book-open"
            to="/sms/courses?mine=1"
          />
          <SmsStatCard
            :label="t('sms.portal.myClasses')"
            :value="portal.teacher.classes.length"
            icon="i-lucide-users-round"
            to="/sms/classes"
          />
          <SmsStatCard
            :label="t('sms.portal.pendingReview')"
            :value="portal.teacher.pendingSubmissions"
            icon="i-lucide-clipboard-check"
            to="/sms/review"
          />
        </div>

        <div>
          <h3 class="mb-2 text-sm font-medium text-muted">
            {{ t('sms.portal.todaySchedule') }}
          </h3>
          <div
            v-if="portal.teacher.todayLessons.length"
            class="flex flex-wrap gap-2"
          >
            <div
              v-for="lesson in portal.teacher.todayLessons"
              :key="lesson.id"
              class="rounded-lg border border-default bg-elevated/40 px-3 py-2 text-sm"
            >
              <span class="font-medium text-highlighted">{{ lesson.courseName }}</span>
              <span class="ml-2 text-xs text-muted">{{ lesson.periodName }} · {{ lesson.className ?? '—' }}</span>
            </div>
          </div>
          <p
            v-else
            class="text-sm text-muted"
          >
            {{ t('sms.portal.noToday') }}
          </p>
        </div>
      </section>

      <!-- Student -->
      <section
        v-if="portal.student"
        class="space-y-4"
      >
        <h2 class="text-lg font-semibold text-highlighted">
          {{ t('sms.role.student') }}
        </h2>

        <div class="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <SmsStatCard
            :label="t('sms.portal.average')"
            :value="formatMark(portal.student.average)"
            icon="i-lucide-trending-up"
          />
          <SmsStatCard
            :label="t('sms.portal.attendanceRate')"
            :value="formatPercent(portal.student.attendance.rate)"
            icon="i-lucide-calendar-check"
          />
          <SmsStatCard
            :label="t('sms.portal.myCourses')"
            :value="portal.student.courses.length"
            icon="i-lucide-book-open"
            to="/sms/courses"
          />
        </div>

        <div class="grid gap-4 lg:grid-cols-2">
          <div class="rounded-xl border border-default bg-elevated/40 p-4">
            <h3 class="mb-2 text-sm font-medium text-muted">
              {{ t('sms.portal.todaySchedule') }}
            </h3>
            <ul
              v-if="portal.student.todayLessons.length"
              class="space-y-1 text-sm"
            >
              <li
                v-for="lesson in portal.student.todayLessons"
                :key="lesson.id"
                class="flex items-center justify-between"
              >
                <span class="text-highlighted">{{ lesson.courseName }}</span>
                <span class="text-xs text-muted">{{ lesson.periodName }} · {{ lesson.classroomName ?? '—' }}</span>
              </li>
            </ul>
            <p
              v-else
              class="text-sm text-muted"
            >
              {{ t('sms.portal.noToday') }}
            </p>
          </div>

          <div class="rounded-xl border border-default bg-elevated/40 p-4">
            <h3 class="mb-2 text-sm font-medium text-muted">
              {{ t('sms.portal.recentConduct') }}
            </h3>
            <ul
              v-if="portal.student.recentConduct.length"
              class="space-y-1 text-sm"
            >
              <li
                v-for="record in portal.student.recentConduct"
                :key="record.id"
                class="flex items-center justify-between"
              >
                <span class="text-highlighted">{{ record.ruleName ?? record.description ?? t('sms.common.details') }}</span>
                <UBadge
                  :color="record.kind === 'merit' ? 'success' : 'error'"
                  variant="subtle"
                  size="sm"
                  :label="`${record.kind === 'merit' ? '+' : '−'}${record.points}`"
                />
              </li>
            </ul>
            <p
              v-else
              class="text-sm text-muted"
            >
              {{ t('sms.conduct.empty') }}
            </p>
          </div>
        </div>

        <div v-if="portal.student.pendingHomework.length">
          <h3 class="mb-2 text-sm font-medium text-muted">
            {{ t('sms.assessments.title') }}
          </h3>
          <ul class="space-y-1 text-sm">
            <li
              v-for="work in portal.student.pendingHomework"
              :key="work.id"
              class="flex items-center justify-between rounded-lg border border-default bg-elevated/40 px-3 py-2"
            >
              <span class="text-highlighted">{{ work.name }}</span>
              <span class="text-xs text-muted">{{ formatDateTime(work.dueAt) }}</span>
            </li>
          </ul>
        </div>
      </section>

      <!-- Guardian -->
      <section
        v-if="portal.guardian"
        class="space-y-4"
      >
        <h2 class="text-lg font-semibold text-highlighted">
          {{ t('sms.portal.myChildren') }}
        </h2>
        <div class="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <NuxtLink
            v-for="child in portal.guardian.children"
            :key="child.student.id"
            :to="`/sms/students/${child.student.id}`"
            class="rounded-xl border border-default bg-elevated/40 p-4 transition hover:border-primary"
          >
            <p class="text-base font-semibold text-highlighted">
              {{ child.student.name }}
            </p>
            <p class="text-xs text-muted">
              {{ child.student.className ?? '—' }} · {{ child.student.rollId }}
            </p>
            <div class="mt-3 flex flex-wrap items-center gap-3 text-sm">
              <span class="inline-flex items-center gap-1">
                <UIcon
                  name="i-lucide-trending-up"
                  class="size-4 text-muted"
                />
                {{ formatMark(child.average) }}
              </span>
              <span class="inline-flex items-center gap-1">
                <UIcon
                  name="i-lucide-calendar-check"
                  class="size-4 text-muted"
                />
                {{ formatPercent(child.attendance.rate) }}
              </span>
              <UBadge
                color="success"
                variant="subtle"
                size="sm"
                :label="`${t('sms.conduct.merit')} ${child.merits}`"
              />
              <UBadge
                color="error"
                variant="subtle"
                size="sm"
                :label="`${t('sms.conduct.demerit')} ${child.demerits}`"
              />
            </div>
          </NuxtLink>
        </div>
      </section>

      <!-- Notices -->
      <section
        v-if="portal.notices.length"
        class="space-y-3"
      >
        <h2 class="text-lg font-semibold text-highlighted">
          {{ t('sms.home.latestNotices') }}
        </h2>
        <div class="grid gap-3 lg:grid-cols-2">
          <SmsNoticeItem
            v-for="notice in portal.notices"
            :key="notice.id"
            :notice="notice"
          />
        </div>
      </section>
    </template>
  </div>
</template>
