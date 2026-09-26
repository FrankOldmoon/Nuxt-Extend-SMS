<script setup lang="ts">
/**
 * The school's organisation — the reference tables the rest of the module leans
 * on: departments, grades, subjects, terms, rooms and the bell schedule.
 *
 * Read-only on purpose: editing them is a back-office job (they are registered
 * in the generic CRUD), and this page exists so staff can see the shape of the
 * school in one place rather than opening six tables. It is staff-only because
 * it is an operational view, not part of the public site.
 */
definePageMeta({ layout: 'school' })

const { t } = useI18n()
const { viewer } = useSmsViewer()
const { reference, refresh } = useSmsReference()

const isStaff = computed(() => viewer.value?.isStaff ?? false)
</script>

<template>
  <div class="space-y-8">
    <SmsPageHeader
      :title="t('sms.organization.departments')"
      :subtitle="t('sms.organization.semesterHint')"
      icon="i-lucide-building-2"
    >
      <template #actions>
        <UButton
          icon="i-lucide-refresh-cw"
          color="neutral"
          variant="soft"
          size="sm"
          :label="t('sms.common.retry')"
          @click="refresh()"
        />
      </template>
    </SmsPageHeader>

    <UAlert
      v-if="!isStaff"
      color="warning"
      variant="subtle"
      :title="t('sms.messages.notStaff')"
    />

    <template v-else>
      <!-- Departments -->
      <section class="space-y-3">
        <h2 class="text-lg font-semibold text-highlighted">
          {{ t('sms.organization.departments') }}
        </h2>
        <div class="overflow-x-auto rounded-xl border border-default">
          <table class="w-full border-collapse text-sm">
            <thead>
              <tr class="bg-elevated/60">
                <th class="border-b border-default px-3 py-2 text-left text-xs font-medium text-muted">
                  {{ t('sms.common.name') }}
                </th>
                <th class="border-b border-l border-default px-3 py-2 text-left text-xs font-medium text-muted">
                  {{ t('sms.common.code') }}
                </th>
                <th class="border-b border-l border-default px-3 py-2 text-center text-xs font-medium text-muted">
                  {{ t('sms.classes.grade') }}
                </th>
                <th class="border-b border-l border-default px-3 py-2 text-center text-xs font-medium text-muted">
                  {{ t('sms.teachers.title') }}
                </th>
              </tr>
            </thead>
            <tbody>
              <tr
                v-for="department in reference?.departments ?? []"
                :key="department.id"
              >
                <td class="border-b border-default px-3 py-2 font-medium text-highlighted">
                  {{ department.name }}
                </td>
                <td class="border-b border-l border-default px-3 py-2 text-muted">
                  {{ department.code ?? '—' }}
                </td>
                <td class="border-b border-l border-default px-3 py-2 text-center text-muted">
                  {{ department.gradeCount }}
                </td>
                <td class="border-b border-l border-default px-3 py-2 text-center text-muted">
                  {{ department.teacherCount }}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      <!-- Grades + Subjects -->
      <section class="grid gap-4 lg:grid-cols-2">
        <div class="space-y-3">
          <h2 class="text-lg font-semibold text-highlighted">
            {{ t('sms.organization.grades') }}
          </h2>
          <div class="overflow-hidden rounded-xl border border-default">
            <table class="w-full border-collapse text-sm">
              <tbody>
                <tr
                  v-for="grade in reference?.grades ?? []"
                  :key="grade.id"
                >
                  <td class="border-b border-default px-3 py-2 font-medium text-highlighted">
                    {{ grade.name }}
                  </td>
                  <td class="border-b border-l border-default px-3 py-2 text-muted">
                    {{ grade.departmentName ?? '—' }}
                  </td>
                  <td class="border-b border-l border-default px-3 py-2 text-center text-muted">
                    {{ grade.classCount }} / {{ grade.studentCount }}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>

        <div class="space-y-3">
          <h2 class="text-lg font-semibold text-highlighted">
            {{ t('sms.organization.subjects') }}
          </h2>
          <div class="overflow-hidden rounded-xl border border-default">
            <table class="w-full border-collapse text-sm">
              <tbody>
                <tr
                  v-for="subject in reference?.subjects ?? []"
                  :key="subject.id"
                >
                  <td class="border-b border-default px-3 py-2 font-medium text-highlighted">
                    {{ subject.name }}
                  </td>
                  <td class="border-b border-l border-default px-3 py-2 text-muted">
                    {{ subject.code ?? '—' }}
                  </td>
                  <td class="border-b border-l border-default px-3 py-2 text-center text-muted">
                    {{ subject.courseCount }}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      </section>

      <!-- Terms -->
      <section class="space-y-3">
        <h2 class="text-lg font-semibold text-highlighted">
          {{ t('sms.organization.semesters') }}
        </h2>
        <div class="overflow-x-auto rounded-xl border border-default">
          <table class="w-full border-collapse text-sm">
            <thead>
              <tr class="bg-elevated/60">
                <th class="border-b border-default px-3 py-2 text-left text-xs font-medium text-muted">
                  {{ t('sms.common.name') }}
                </th>
                <th class="border-b border-l border-default px-3 py-2 text-left text-xs font-medium text-muted">
                  {{ t('sms.organization.startDate') }}
                </th>
                <th class="border-b border-l border-default px-3 py-2 text-left text-xs font-medium text-muted">
                  {{ t('sms.organization.endDate') }}
                </th>
                <th class="border-b border-l border-default px-3 py-2 text-center text-xs font-medium text-muted">
                  {{ t('sms.organization.current') }}
                </th>
                <th class="border-b border-l border-default px-3 py-2 text-center text-xs font-medium text-muted">
                  {{ t('sms.courses.title') }}
                </th>
              </tr>
            </thead>
            <tbody>
              <tr
                v-for="semester in reference?.semesters ?? []"
                :key="semester.id"
              >
                <td class="border-b border-default px-3 py-2 font-medium text-highlighted">
                  {{ semester.name }}
                </td>
                <td class="border-b border-l border-default px-3 py-2 text-muted">
                  {{ formatDate(semester.startDate) }}
                </td>
                <td class="border-b border-l border-default px-3 py-2 text-muted">
                  {{ formatDate(semester.endDate) }}
                </td>
                <td class="border-b border-l border-default px-3 py-2 text-center">
                  <UIcon
                    v-if="semester.isCurrent"
                    name="i-lucide-check"
                    class="size-4 text-success"
                  />
                  <span v-else>—</span>
                </td>
                <td class="border-b border-l border-default px-3 py-2 text-center text-muted">
                  {{ semester.courseCount }}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      <!-- Rooms + Periods -->
      <section class="grid gap-4 lg:grid-cols-2">
        <div class="space-y-3">
          <h2 class="text-lg font-semibold text-highlighted">
            {{ t('sms.organization.classrooms') }}
          </h2>
          <div class="overflow-hidden rounded-xl border border-default">
            <table class="w-full border-collapse text-sm">
              <tbody>
                <tr
                  v-for="room in reference?.classrooms ?? []"
                  :key="room.id"
                >
                  <td class="border-b border-default px-3 py-2 font-medium text-highlighted">
                    {{ room.name }}
                  </td>
                  <td class="border-b border-l border-default px-3 py-2 text-muted">
                    {{ room.building ?? '—' }}
                  </td>
                  <td class="border-b border-l border-default px-3 py-2 text-center text-muted">
                    {{ room.seats ?? '—' }}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>

        <div class="space-y-3">
          <h2 class="text-lg font-semibold text-highlighted">
            {{ t('sms.period.title') }}
          </h2>
          <div class="overflow-hidden rounded-xl border border-default">
            <table class="w-full border-collapse text-sm">
              <tbody>
                <tr
                  v-for="period in reference?.periods ?? []"
                  :key="period.id"
                >
                  <td class="border-b border-default px-3 py-2 font-medium text-highlighted">
                    {{ period.name }}
                  </td>
                  <td class="border-b border-l border-default px-3 py-2 text-muted">
                    {{ period.startTime }}–{{ period.endTime }}
                  </td>
                  <td class="border-b border-l border-default px-3 py-2 text-center">
                    <UBadge
                      :color="period.kind === 'break' ? 'neutral' : 'primary'"
                      variant="subtle"
                      size="sm"
                      :label="period.kind === 'break' ? t('sms.period.break') : t('sms.period.class')"
                    />
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      </section>
    </template>
  </div>
</template>
