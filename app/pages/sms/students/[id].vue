<script setup lang="ts">
/**
 * One student's record: who they are, their attendance, their guardians and
 * their conduct history — with the report card one click away.
 *
 * The server answers 404 (not 403) for a student outside the viewer's reach, so
 * a guardian asking about someone else's child sees "not available" rather than
 * a confirmation that the child exists.
 */
import type { StudentProfile } from '../../../composables/useSms'

definePageMeta({ layout: 'school' })

const route = useRoute()
const studentId = Number(route.params.id)
const { t } = useI18n()

const { data, pending, error } = await useAsyncData(
  `sms:student:${studentId}`,
  () => fetchStudent(studentId)
)
const profile = computed<StudentProfile | null>(() => data.value ?? null)
const student = computed(() => profile.value?.student ?? null)
</script>

<template>
  <div class="space-y-6">
    <UAlert
      v-if="error"
      color="error"
      variant="subtle"
      :description="t('sms.messages.notVisible')"
    />

    <div
      v-else-if="pending && !profile"
      class="py-16 text-center text-sm text-muted"
    >
      {{ t('sms.common.loading') }}
    </div>

    <template v-else-if="student && profile">
      <SmsPageHeader
        :title="student.name"
        :subtitle="[student.className, student.rollId].filter(Boolean).join(' · ')"
        icon="i-lucide-graduation-cap"
        back-to="/sms/students"
      >
        <template #actions>
          <UBadge
            color="neutral"
            variant="subtle"
            :label="t(`sms.students.${student.status}`)"
          />
          <UButton
            :to="`/sms/students/${studentId}/report-card`"
            icon="i-lucide-file-text"
            :label="t('sms.report.title')"
          />
        </template>
      </SmsPageHeader>

      <!-- Attendance -->
      <section class="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <SmsStatCard
          :label="t('sms.attendance.rate')"
          :value="formatPercent(profile.attendance.rate)"
          icon="i-lucide-calendar-check"
        />
        <SmsStatCard
          :label="t('sms.attendance.attended')"
          :value="profile.attendance.attended"
          icon="i-lucide-user-check"
        />
        <SmsStatCard
          :label="t('sms.attendance.absent')"
          :value="profile.attendance.absent"
          icon="i-lucide-user-x"
        />
        <SmsStatCard
          :label="t('sms.attendance.minutesLate')"
          :value="profile.attendance.minutesLate"
          icon="i-lucide-clock"
        />
      </section>

      <div class="grid gap-4 lg:grid-cols-3">
        <!-- Profile -->
        <section class="space-y-3 rounded-xl border border-default bg-elevated/40 p-4">
          <h2 class="text-sm font-medium text-muted">
            {{ t('sms.students.profile') }}
          </h2>
          <dl class="space-y-2 text-sm">
            <div class="flex justify-between gap-2">
              <dt class="text-muted">
                {{ t('sms.students.gender') }}
              </dt>
              <dd class="text-highlighted">
                {{ student.gender ? t(`sms.students.${student.gender}`) : '—' }}
              </dd>
            </div>
            <div class="flex justify-between gap-2">
              <dt class="text-muted">
                {{ t('sms.students.birthday') }}
              </dt>
              <dd class="text-highlighted">
                {{ formatDate(student.birthday) }}
                <span
                  v-if="ageFrom(student.birthday) != null"
                  class="text-xs text-muted"
                >({{ ageFrom(student.birthday) }})</span>
              </dd>
            </div>
            <div class="flex justify-between gap-2">
              <dt class="text-muted">
                {{ t('sms.students.enrolledAt') }}
              </dt>
              <dd class="text-highlighted">
                {{ formatDate(student.enrolledAt) }}
              </dd>
            </div>
            <div class="flex justify-between gap-2">
              <dt class="text-muted">
                {{ t('sms.classes.grade') }}
              </dt>
              <dd class="text-highlighted">
                {{ student.gradeName ?? '—' }}
              </dd>
            </div>
            <div
              v-if="student.address"
              class="flex justify-between gap-2"
            >
              <dt class="text-muted">
                {{ t('sms.students.address') }}
              </dt>
              <dd class="text-right text-highlighted">
                {{ student.address }}
              </dd>
            </div>
          </dl>
          <p
            v-if="student.note"
            class="whitespace-pre-wrap border-t border-default pt-3 text-sm text-muted"
          >
            {{ student.note }}
          </p>
        </section>

        <!-- Guardians -->
        <section class="space-y-3 rounded-xl border border-default bg-elevated/40 p-4">
          <h2 class="text-sm font-medium text-muted">
            {{ t('sms.students.guardians') }}
          </h2>
          <ul
            v-if="profile.guardians.length"
            class="space-y-3 text-sm"
          >
            <li
              v-for="guardian in profile.guardians"
              :key="guardian.id"
            >
              <p class="font-medium text-highlighted">
                {{ guardian.name }}
                <UBadge
                  v-if="guardian.students.some(link => link.id === studentId && link.isPrimary)"
                  color="primary"
                  variant="subtle"
                  size="sm"
                  class="ml-1"
                  :label="t('sms.guardians.primary')"
                />
              </p>
              <p class="text-xs text-muted">
                {{ guardian.relation ? t(`sms.guardians.${relationKey(guardian.relation)}`) : '—' }}
              </p>
              <p
                v-if="guardian.phone"
                class="text-xs text-muted"
              >
                {{ guardian.phone }}
              </p>
              <p
                v-if="guardian.email"
                class="text-xs text-muted"
              >
                {{ guardian.email }}
              </p>
            </li>
          </ul>
          <p
            v-else
            class="text-sm text-muted"
          >
            {{ t('sms.guardians.empty') }}
          </p>
        </section>

        <!-- Conduct -->
        <section class="space-y-3 rounded-xl border border-default bg-elevated/40 p-4">
          <h2 class="text-sm font-medium text-muted">
            {{ t('sms.conduct.title') }}
          </h2>
          <ul
            v-if="profile.conduct.length"
            class="space-y-2 text-sm"
          >
            <li
              v-for="record in profile.conduct"
              :key="record.id"
              class="flex items-start justify-between gap-2"
            >
              <span class="min-w-0">
                <span class="block text-highlighted">{{ record.ruleName ?? record.description ?? t('sms.common.details') }}</span>
                <span class="block text-xs text-muted">{{ formatDate(record.date) }}</span>
              </span>
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
        </section>
      </div>
    </template>
  </div>
</template>
