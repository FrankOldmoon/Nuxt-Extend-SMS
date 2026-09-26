<script setup lang="ts">
/**
 * A student's report card — a document someone hands to a parent.
 *
 * It is assembled entirely server-side from the marking model, so a course with
 * nothing marked reports no total rather than a zero, and the coverage figure
 * says how much of the grade the total actually rests on. Printing matters more
 * here than anywhere else in the module: the shell hides its chrome with
 * `print:hidden`, and this page keeps a plain black-on-white layout so the
 * browser's print dialogue produces a usable PDF.
 */
import type { ReportCard } from '../../../../composables/useSms'

definePageMeta({ layout: 'school' })

const route = useRoute()
const studentId = Number(route.params.id)
const { t } = useI18n()
const { settings, schoolName } = useSmsSettings()
const { reference } = useSmsReference()

const semesterId = ref(0)

const params = computed(() => ({
  semesterId: semesterId.value || undefined
}))

const { data, pending, error } = await useAsyncData(
  `sms:report-card:${studentId}`,
  () => fetchReportCard(studentId, params.value),
  { watch: [params] }
)

const card = computed<ReportCard | null>(() => data.value ?? null)

const semesterItems = computed(() => [
  { label: t('sms.organization.current'), value: 0 },
  ...(reference.value?.semesters ?? []).map(semester => ({ label: semester.name, value: semester.id }))
])

// Default the picker to the school's current term once settings are known.
watch(settings, (value) => {
  if (value && semesterId.value === 0 && value.currentSemesterId) semesterId.value = value.currentSemesterId
}, { immediate: true })

function print(): void {
  if (import.meta.client) window.print()
}
</script>

<template>
  <div class="mx-auto max-w-4xl space-y-6 print:max-w-none">
    <div class="flex flex-wrap items-center gap-2 print:hidden">
      <UButton
        to="/sms/students"
        icon="i-lucide-arrow-left"
        color="neutral"
        variant="soft"
        size="sm"
        :label="t('sms.common.back')"
      />
      <USelect
        v-model="semesterId"
        :items="semesterItems"
        class="w-48"
      />
      <UButton
        icon="i-lucide-printer"
        class="ml-auto"
        :label="t('sms.report.print')"
        @click="print"
      />
    </div>

    <UAlert
      v-if="error || !card"
      color="error"
      variant="subtle"
      :description="t('sms.messages.notVisible')"
    />

    <div
      v-else-if="pending"
      class="py-16 text-center text-sm text-muted"
    >
      {{ t('sms.common.loading') }}
    </div>

    <article
      v-else
      class="space-y-6 rounded-xl border border-default bg-default p-6 print:border-0 print:p-0"
    >
      <header class="flex flex-wrap items-start justify-between gap-4 border-b border-default pb-4">
        <div>
          <p class="text-xs uppercase tracking-[0.2em] text-muted">
            {{ schoolName }}
          </p>
          <h1 class="mt-1 text-2xl font-semibold text-highlighted">
            {{ t('sms.report.title') }}
          </h1>
        </div>
        <dl class="text-right text-sm">
          <dt class="text-xs text-muted">
            {{ t('sms.report.student') }}
          </dt>
          <dd class="font-medium text-highlighted">
            {{ card.student.name }}
          </dd>
          <dt class="mt-1 text-xs text-muted">
            {{ t('sms.report.class') }}
          </dt>
          <dd class="text-highlighted">
            {{ card.student.className ?? '—' }}
          </dd>
          <dt class="mt-1 text-xs text-muted">
            {{ t('sms.report.semester') }}
          </dt>
          <dd class="text-highlighted">
            {{ card.semester?.name ?? '—' }}
          </dd>
        </dl>
      </header>

      <!-- Headline summary -->
      <section class="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <div>
          <p class="text-xs text-muted">
            {{ t('sms.report.average') }}
          </p>
          <p class="text-xl font-semibold text-highlighted">
            {{ formatMark(card.summary.average) }}
          </p>
        </div>
        <div>
          <p class="text-xs text-muted">
            {{ t('sms.scores.classRank') }}
          </p>
          <p class="text-xl font-semibold text-highlighted">
            {{ card.rank.position ?? '—' }}<span class="text-sm text-muted"> / {{ card.rank.of }}</span>
          </p>
        </div>
        <div>
          <p class="text-xs text-muted">
            {{ t('sms.report.passed') }} / {{ t('sms.report.failed') }}
          </p>
          <p class="text-xl font-semibold text-highlighted">
            {{ card.summary.passed }} / {{ card.summary.failed }}
          </p>
        </div>
        <div>
          <p class="text-xs text-muted">
            {{ t('sms.conduct.balance') }}
          </p>
          <p class="text-xl font-semibold text-highlighted">
            {{ card.summary.merits }} / {{ card.summary.demerits }}
          </p>
        </div>
      </section>

      <!-- Course rows -->
      <section>
        <div
          v-if="!card.rows.length"
          class="rounded-lg border border-dashed border-default px-4 py-8 text-center text-sm text-muted"
        >
          <p class="font-medium">
            {{ t('sms.report.noMarks') }}
          </p>
          <p class="mt-1 text-xs">
            {{ t('sms.report.noMarksHint') }}
          </p>
        </div>

        <table
          v-else
          class="w-full border-collapse text-sm"
        >
          <thead>
            <tr class="border-b border-default">
              <th class="px-2 py-2 text-left text-xs font-medium text-muted">
                {{ t('sms.report.course') }}
              </th>
              <th class="px-2 py-2 text-left text-xs font-medium text-muted">
                {{ t('sms.timetable.teacher') }}
              </th>
              <th class="px-2 py-2 text-center text-xs font-medium text-muted">
                {{ t('sms.report.total') }}
              </th>
              <th class="px-2 py-2 text-center text-xs font-medium text-muted">
                {{ t('sms.report.letter') }}
              </th>
            </tr>
          </thead>
          <tbody>
            <template
              v-for="row in card.rows"
              :key="row.courseId"
            >
              <tr class="border-b border-default">
                <td class="px-2 py-2">
                  <span class="font-medium text-highlighted">{{ row.courseName }}</span>
                  <span
                    v-if="row.subjectName"
                    class="ml-1 text-xs text-muted"
                  >· {{ row.subjectName }}</span>
                </td>
                <td class="px-2 py-2 text-xs text-muted">
                  {{ row.teachers.join(', ') || '—' }}
                </td>
                <td class="px-2 py-2 text-center font-medium text-highlighted">
                  {{ formatMark(row.total) }}
                </td>
                <td class="px-2 py-2 text-center">
                  <span
                    class="inline-flex size-6 items-center justify-center rounded-full text-xs font-semibold"
                    :class="passesMark(row.total, card.passMark) ? 'bg-success/15 text-success' : 'bg-error/15 text-error'"
                  >
                    {{ row.letter ?? '—' }}
                  </span>
                </td>
              </tr>
              <tr
                v-if="row.assessments.length"
                class="border-b border-default bg-elevated/30"
              >
                <td
                  colspan="4"
                  class="px-2 py-1.5 text-[11px] text-muted"
                >
                  <span
                    v-for="(assessment, index) in row.assessments"
                    :key="assessment.id"
                  >
                    <span v-if="index > 0"> · </span>
                    {{ assessment.name }}:
                    <span class="text-highlighted">{{ assessment.score ?? '—' }}</span>/{{ assessment.maxScore }}
                    ({{ assessment.weight }}%)
                  </span>
                </td>
              </tr>
            </template>
          </tbody>
        </table>

        <p
          v-if="card.rows.length"
          class="mt-2 text-[11px] text-muted"
        >
          {{ t('sms.report.coverage', { percent: Math.round((card.rows.reduce((sum, row) => sum + row.coverage, 0) / card.rows.length) * 100) }) }}
        </p>
      </section>

      <!-- Conduct and attendance -->
      <section class="grid gap-4 sm:grid-cols-2">
        <div>
          <h2 class="mb-2 text-sm font-medium text-muted">
            {{ t('sms.report.conduct') }}
          </h2>
          <ul
            v-if="card.conduct.length"
            class="space-y-1 text-sm"
          >
            <li
              v-for="record in card.conduct"
              :key="record.id"
              class="flex items-center justify-between"
            >
              <span class="text-default">{{ record.ruleName ?? record.description ?? '—' }}</span>
              <span
                class="text-xs"
                :class="record.kind === 'merit' ? 'text-success' : 'text-error'"
              >
                {{ record.kind === 'merit' ? '+' : '−' }}{{ record.points }}
              </span>
            </li>
          </ul>
          <p
            v-else
            class="text-sm text-muted"
          >
            {{ t('sms.conduct.empty') }}
          </p>
        </div>

        <div>
          <h2 class="mb-2 text-sm font-medium text-muted">
            {{ t('sms.attendance.title') }}
          </h2>
          <dl class="space-y-1 text-sm">
            <div class="flex justify-between">
              <dt class="text-muted">
                {{ t('sms.attendance.rate') }}
              </dt>
              <dd class="text-highlighted">
                {{ formatPercent(card.attendance.rate) }}
              </dd>
            </div>
            <div class="flex justify-between">
              <dt class="text-muted">
                {{ t('sms.attendance.sessions') }}
              </dt>
              <dd class="text-highlighted">
                {{ card.attendance.sessions }}
              </dd>
            </div>
            <div class="flex justify-between">
              <dt class="text-muted">
                {{ t('sms.attendance.late') }}
              </dt>
              <dd class="text-highlighted">
                {{ card.attendance.late }}
              </dd>
            </div>
            <div class="flex justify-between">
              <dt class="text-muted">
                {{ t('sms.attendance.absent') }}
              </dt>
              <dd class="text-highlighted">
                {{ card.attendance.absent }}
              </dd>
            </div>
          </dl>
        </div>
      </section>

      <footer class="flex flex-wrap items-end justify-between gap-4 border-t border-default pt-4 text-xs text-muted">
        <span>{{ t('sms.report.generatedAt', { date: formatDateTime(card.generatedAt) }) }}</span>
        <div class="flex gap-10">
          <span class="border-t border-default pt-1">{{ t('sms.report.signature') }}</span>
          <span class="border-t border-default pt-1">{{ t('sms.report.principal') }}</span>
        </div>
      </footer>
    </article>
  </div>
</template>
