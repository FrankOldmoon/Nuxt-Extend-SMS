<script setup lang="ts">
/**
 * One course: what it is, who is in it, what it is marked on, the marks
 * themselves and the roll — five views of the same enrolment.
 *
 * The page answers "what is this course" in one request (`/api/sms/courses/:id`
 * returns the course, its assessments, its roster, its weekly lessons and the
 * weight check), and the two heavy editors are their own components because the
 * gradebook and the roll sheet each own their own save loop. Writes are only
 * offered where the viewer teaches the course (`canEdit`), which mirrors the
 * server's per-course rule rather than a role-wide one.
 */
import type { Assessment, CourseDetail } from '../../../composables/useSms'

definePageMeta({ layout: 'school' })

const route = useRoute()
const courseId = Number(route.params.id)
const { t } = useI18n()
const { viewer } = useSmsViewer()
const toast = useToast()

const tab = ref<'overview' | 'roster' | 'assessments' | 'gradebook' | 'attendance'>('overview')

const { data, pending, error, refresh } = await useAsyncData(
  `sms:course:${courseId}`,
  () => fetchCourse(courseId)
)

const detail = computed<CourseDetail | null>(() => data.value ?? null)
const course = computed(() => detail.value?.course ?? null)

const canEdit = computed(() =>
  (viewer.value?.admin ?? false)
  || (viewer.value?.teacherId != null
    && (course.value?.teachers ?? []).some(teacher => teacher.teacherId === viewer.value?.teacherId)))

const tabs = computed(() => [
  { value: 'overview' as const, label: t('sms.common.details'), icon: 'i-lucide-info' },
  { value: 'roster' as const, label: t('sms.courses.roster'), icon: 'i-lucide-users-round' },
  { value: 'assessments' as const, label: t('sms.assessments.title'), icon: 'i-lucide-clipboard-list' },
  { value: 'gradebook' as const, label: t('sms.scores.title'), icon: 'i-lucide-pen-line' },
  { value: 'attendance' as const, label: t('sms.attendance.title'), icon: 'i-lucide-clipboard-check' }
])

const courseKinds = ['usual', 'homework', 'quiz', 'midterm', 'final', 'project', 'other'] as const

// ------------------------------------------------------------- roster ----

const { data: studentData } = await useAsyncData('sms:course-students', () => fetchStudents({ pageSize: 200 }))
const selectedToAdd = ref<number[]>([])
const adding = ref(false)

const availableStudents = computed(() =>
  (studentData.value?.items ?? [])
    .filter(student => !(detail.value?.students ?? []).some(enrolled => enrolled.id === student.id))
    .map(student => ({ label: `${student.name} · ${student.rollId}`, value: student.id })))

async function addStudents(): Promise<void> {
  if (!selectedToAdd.value.length) return
  adding.value = true
  try {
    await cPost(`/api/sms/courses/${courseId}/roster`, { add: selectedToAdd.value })
    toast.add({ title: t('sms.messages.enrolledCount', { count: selectedToAdd.value.length }), color: 'success' })
    selectedToAdd.value = []
    await refresh()
  } catch (e: unknown) {
    toast.add({ title: extractErrorMessage(e), color: 'error' })
  } finally {
    adding.value = false
  }
}

async function removeStudent(studentId: number): Promise<void> {
  try {
    await cPost(`/api/sms/courses/${courseId}/roster`, { remove: [studentId] })
    toast.add({ title: t('sms.messages.removed'), color: 'success' })
    await refresh()
  } catch (e: unknown) {
    toast.add({ title: extractErrorMessage(e), color: 'error' })
  }
}

// -------------------------------------------------------- assessments ----

const editorOpen = ref(false)
const savingAssessment = ref(false)
const form = reactive({
  id: null as number | null,
  name: '',
  kind: 'other',
  weight: 0,
  maxScore: 100,
  dueAt: '',
  sortOrder: 0,
  description: ''
})

function openCreate(): void {
  form.id = null
  form.name = ''
  form.kind = 'other'
  form.weight = 0
  form.maxScore = 100
  form.dueAt = ''
  form.sortOrder = (detail.value?.assessments.length ?? 0) + 1
  form.description = ''
  editorOpen.value = true
}

function openEdit(assessment: Assessment): void {
  form.id = assessment.id
  form.name = assessment.name
  form.kind = assessment.kind
  form.weight = assessment.weight
  form.maxScore = assessment.maxScore
  form.dueAt = assessment.dueAt ? assessment.dueAt.slice(0, 16) : ''
  form.sortOrder = assessment.sortOrder
  form.description = assessment.description ?? ''
  editorOpen.value = true
}

async function saveAssessment(): Promise<void> {
  if (!form.name.trim()) return
  savingAssessment.value = true
  try {
    await cPost(`/api/sms/courses/${courseId}/assessments`, {
      id: form.id ?? undefined,
      name: form.name.trim(),
      kind: form.kind,
      weight: form.weight,
      maxScore: form.maxScore,
      dueAt: form.dueAt || undefined,
      sortOrder: form.sortOrder,
      description: form.description || undefined
    })
    toast.add({ title: t('sms.messages.saved'), color: 'success' })
    editorOpen.value = false
    await refresh()
  } catch (e: unknown) {
    toast.add({ title: extractErrorMessage(e), color: 'error' })
  } finally {
    savingAssessment.value = false
  }
}

async function removeAssessment(assessment: Assessment): Promise<void> {
  try {
    await cDelete(`/api/sms/courses/${courseId}/assessments/${assessment.id}`)
    toast.add({ title: t('sms.messages.deleted'), color: 'success' })
    await refresh()
  } catch (e: unknown) {
    toast.add({ title: extractErrorMessage(e), color: 'error' })
  }
}
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

    <template v-else-if="course && detail">
      <SmsPageHeader
        :title="course.name"
        :subtitle="[course.subjectName, course.className, course.semesterName].filter(Boolean).join(' · ')"
        icon="i-lucide-book-open"
        back-to="/sms/courses"
      >
        <template #actions>
          <UBadge
            v-if="!course.isGraded"
            color="neutral"
            variant="subtle"
            :label="t('sms.courses.notGraded')"
          />
          <UButton
            v-if="canEdit"
            :to="`/sms/timetable?classId=${course.classId ?? ''}`"
            icon="i-lucide-calendar-clock"
            color="neutral"
            variant="soft"
            size="sm"
            :label="t('sms.timetable.title')"
          />
        </template>
      </SmsPageHeader>

      <!-- Tabs -->
      <div class="flex flex-wrap items-center gap-2 border-b border-default pb-3">
        <UButton
          v-for="item in tabs"
          :key="item.value"
          :color="tab === item.value ? 'primary' : 'neutral'"
          :variant="tab === item.value ? 'soft' : 'ghost'"
          size="sm"
          :icon="item.icon"
          :label="item.label"
          @click="tab = item.value"
        />
      </div>

      <!-- Overview -->
      <div
        v-if="tab === 'overview'"
        class="grid gap-4 lg:grid-cols-3"
      >
        <div class="space-y-3 rounded-xl border border-default bg-elevated/40 p-4 lg:col-span-2">
          <p
            v-if="course.description"
            class="whitespace-pre-wrap text-sm text-default"
          >
            {{ course.description }}
          </p>

          <dl class="grid grid-cols-2 gap-3 text-sm">
            <div>
              <dt class="text-xs text-muted">
                {{ t('sms.courses.subject') }}
              </dt>
              <dd class="text-highlighted">
                {{ course.subjectName ?? '—' }}
              </dd>
            </div>
            <div>
              <dt class="text-xs text-muted">
                {{ t('sms.courses.class') }}
              </dt>
              <dd class="text-highlighted">
                {{ course.className ?? '—' }}
              </dd>
            </div>
            <div>
              <dt class="text-xs text-muted">
                {{ t('sms.courses.semester') }}
              </dt>
              <dd class="text-highlighted">
                {{ course.semesterName ?? '—' }}
              </dd>
            </div>
            <div>
              <dt class="text-xs text-muted">
                {{ t('sms.courses.classroom') }}
              </dt>
              <dd class="text-highlighted">
                {{ course.classroomName ?? '—' }}
              </dd>
            </div>
            <div>
              <dt class="text-xs text-muted">
                {{ t('sms.courses.credits') }}
              </dt>
              <dd class="text-highlighted">
                {{ course.credits }}
              </dd>
            </div>
            <div>
              <dt class="text-xs text-muted">
                {{ t('sms.courses.students') }}
              </dt>
              <dd class="text-highlighted">
                {{ course.studentCount }}
              </dd>
            </div>
          </dl>

          <UAlert
            :color="detail.weights.valid ? 'success' : 'warning'"
            variant="subtle"
            :description="detail.weights.valid
              ? t('sms.assessments.weightsValid')
              : t('sms.assessments.weightsInvalid', { sum: detail.weights.sum })"
          />
        </div>

        <div class="space-y-3 rounded-xl border border-default bg-elevated/40 p-4">
          <h3 class="text-sm font-medium text-muted">
            {{ t('sms.courses.staff') }}
          </h3>
          <ul
            v-if="course.teachers.length"
            class="space-y-1 text-sm"
          >
            <li
              v-for="teacher in course.teachers"
              :key="teacher.teacherId"
              class="flex items-center justify-between"
            >
              <span class="text-highlighted">{{ teacher.name }}</span>
              <UBadge
                color="neutral"
                variant="subtle"
                size="sm"
                :label="teacher.role === 'lead' ? t('sms.courses.lead') : t('sms.courses.assistant')"
              />
            </li>
          </ul>
          <p
            v-else
            class="text-sm text-muted"
          >
            {{ t('sms.common.notSet') }}
          </p>

          <h3 class="pt-2 text-sm font-medium text-muted">
            {{ t('sms.courses.lessons') }}
          </h3>
          <ul
            v-if="detail.lessons.length"
            class="space-y-1 text-sm"
          >
            <li
              v-for="lesson in detail.lessons"
              :key="lesson.id"
              class="flex items-center justify-between"
            >
              <span class="text-highlighted">{{ t(`sms.timetable.weekday${lesson.weekday}`) }} · {{ lesson.periodName }}</span>
              <span class="text-xs text-muted">{{ lesson.classroomName ?? '—' }}</span>
            </li>
          </ul>
          <p
            v-else
            class="text-sm text-muted"
          >
            {{ t('sms.courses.noLessons') }}
          </p>
        </div>
      </div>

      <!-- Roster -->
      <div
        v-else-if="tab === 'roster'"
        class="space-y-4"
      >
        <div
          v-if="canEdit"
          class="flex flex-wrap items-end gap-2"
        >
          <USelectMenu
            v-model="selectedToAdd"
            :items="availableStudents"
            multiple
            value-key="value"
            :placeholder="t('sms.actions.enroll')"
            class="w-80"
          />
          <UButton
            icon="i-lucide-user-plus"
            :label="t('sms.actions.enroll')"
            :loading="adding"
            :disabled="!selectedToAdd.length"
            @click="addStudents"
          />
        </div>

        <div
          v-if="detail.students.length"
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
                  {{ t('sms.students.title') }}
                </th>
                <th
                  v-if="canEdit"
                  class="border-b border-l border-default px-3 py-2 text-right text-xs font-medium text-muted"
                >
                  {{ t('sms.common.actions') }}
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
                <td class="border-b border-l border-default px-3 py-2 text-muted">
                  {{ student.className ?? '—' }}
                </td>
                <td
                  v-if="canEdit"
                  class="border-b border-l border-default px-3 py-2 text-right"
                >
                  <UButton
                    icon="i-lucide-x"
                    color="error"
                    variant="ghost"
                    size="xs"
                    :title="t('sms.actions.unenroll')"
                    @click="removeStudent(student.id)"
                  />
                </td>
              </tr>
            </tbody>
          </table>
        </div>

        <SmsEmptyState
          v-else
          icon="i-lucide-users-round"
          :title="t('sms.courses.roster')"
          :description="t('sms.common.emptyHint')"
        />
      </div>

      <!-- Assessments -->
      <div
        v-else-if="tab === 'assessments'"
        class="space-y-4"
      >
        <div
          v-if="canEdit"
          class="flex justify-end"
        >
          <UButton
            icon="i-lucide-plus"
            :label="t('sms.actions.addAssessment')"
            @click="openCreate"
          />
        </div>

        <div
          v-if="detail.assessments.length"
          class="overflow-x-auto rounded-xl border border-default"
        >
          <table class="w-full border-collapse text-sm">
            <thead>
              <tr class="bg-elevated/60">
                <th class="border-b border-default px-3 py-2 text-left text-xs font-medium text-muted">
                  {{ t('sms.common.name') }}
                </th>
                <th class="border-b border-l border-default px-3 py-2 text-left text-xs font-medium text-muted">
                  {{ t('sms.assessments.kind') }}
                </th>
                <th class="border-b border-l border-default px-3 py-2 text-center text-xs font-medium text-muted">
                  {{ t('sms.assessments.weight') }}
                </th>
                <th class="border-b border-l border-default px-3 py-2 text-center text-xs font-medium text-muted">
                  {{ t('sms.assessments.maxScore') }}
                </th>
                <th class="border-b border-l border-default px-3 py-2 text-left text-xs font-medium text-muted">
                  {{ t('sms.assessments.dueAt') }}
                </th>
                <th class="border-b border-l border-default px-3 py-2 text-center text-xs font-medium text-muted">
                  {{ t('sms.assessments.marked') }}
                </th>
                <th
                  v-if="canEdit"
                  class="border-b border-l border-default px-3 py-2 text-right text-xs font-medium text-muted"
                >
                  {{ t('sms.common.actions') }}
                </th>
              </tr>
            </thead>
            <tbody>
              <tr
                v-for="assessment in detail.assessments"
                :key="assessment.id"
              >
                <td class="border-b border-default px-3 py-2 font-medium text-highlighted">
                  {{ assessment.name }}
                </td>
                <td class="border-b border-l border-default px-3 py-2 text-muted">
                  {{ t(`sms.assessments.kind${assessment.kind.charAt(0).toUpperCase()}${assessment.kind.slice(1)}`) }}
                </td>
                <td class="border-b border-l border-default px-3 py-2 text-center text-muted">
                  {{ assessment.weight }}%
                </td>
                <td class="border-b border-l border-default px-3 py-2 text-center text-muted">
                  {{ assessment.maxScore }}
                </td>
                <td class="border-b border-l border-default px-3 py-2 text-muted">
                  {{ assessment.dueAt ? formatDateTime(assessment.dueAt) : '—' }}
                </td>
                <td class="border-b border-l border-default px-3 py-2 text-center text-muted">
                  {{ assessment.markedCount }} / {{ assessment.studentCount }}
                </td>
                <td
                  v-if="canEdit"
                  class="border-b border-l border-default px-3 py-2 text-right"
                >
                  <UButton
                    icon="i-lucide-pencil"
                    color="neutral"
                    variant="ghost"
                    size="xs"
                    @click="openEdit(assessment)"
                  />
                  <UButton
                    icon="i-lucide-trash-2"
                    color="error"
                    variant="ghost"
                    size="xs"
                    @click="removeAssessment(assessment)"
                  />
                </td>
              </tr>
            </tbody>
          </table>
        </div>

        <SmsEmptyState
          v-else
          icon="i-lucide-clipboard-list"
          :title="t('sms.assessments.empty')"
          :description="t('sms.assessments.emptyHint')"
        />
      </div>

      <!-- Gradebook -->
      <SmsCourseGradebook
        v-else-if="tab === 'gradebook'"
        :course-id="courseId"
      />

      <!-- Attendance -->
      <SmsCourseAttendanceSheet
        v-else
        :course-id="courseId"
      />
    </template>

    <UModal
      v-model:open="editorOpen"
      :title="form.id ? t('sms.assessments.title') : t('sms.actions.addAssessment')"
    >
      <template #body>
        <div class="space-y-3">
          <UFormField :label="t('sms.common.name')">
            <UInput
              v-model="form.name"
              class="w-full"
            />
          </UFormField>
          <div class="grid grid-cols-2 gap-3">
            <UFormField :label="t('sms.assessments.kind')">
              <USelect
                v-model="form.kind"
                :items="courseKinds.map(kind => ({
                  label: t(`sms.assessments.kind${kind.charAt(0).toUpperCase()}${kind.slice(1)}`),
                  value: kind
                }))"
                class="w-full"
              />
            </UFormField>
            <UFormField :label="t('sms.assessments.dueAt')">
              <UInput
                v-model="form.dueAt"
                type="datetime-local"
                class="w-full"
              />
            </UFormField>
            <UFormField :label="t('sms.assessments.weight')">
              <UInput
                v-model.number="form.weight"
                type="number"
                class="w-full"
              />
            </UFormField>
            <UFormField :label="t('sms.assessments.maxScore')">
              <UInput
                v-model.number="form.maxScore"
                type="number"
                class="w-full"
              />
            </UFormField>
          </div>
          <UFormField :label="t('sms.common.description')">
            <UTextarea
              v-model="form.description"
              :rows="3"
              class="w-full"
            />
          </UFormField>
        </div>
      </template>
      <template #footer>
        <div class="flex justify-end gap-2">
          <UButton
            color="neutral"
            variant="soft"
            :label="t('sms.common.cancel')"
            @click="editorOpen = false"
          />
          <UButton
            :label="t('sms.common.save')"
            :loading="savingAssessment"
            :disabled="!form.name.trim()"
            @click="saveAssessment"
          />
        </div>
      </template>
    </UModal>
  </div>
</template>
