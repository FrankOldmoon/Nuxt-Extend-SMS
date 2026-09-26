<script setup lang="ts">
/**
 * The timetable, drawn from whichever angle the viewer is allowed to see it.
 *
 * Staff can look at the whole school, one class, one teacher or one room; a
 * student is pinned to their own class and a guardian picks which child's class
 * to view — the server refuses a scope a viewer does not belong to, so the
 * selectors here only ever offer what the API would accept. The grid and the
 * clash list come from the same response, so the red cell and the message below
 * can never disagree.
 */
definePageMeta({ layout: 'school' })

const { t } = useI18n()
const { viewer } = useSmsViewer()
const { reference } = useSmsReference()

const isStaff = computed(() => viewer.value?.isStaff ?? false)
const signedIn = computed(() => viewer.value?.signedIn ?? false)
const isGuardian = computed(() =>
  signedIn.value && !isStaff.value && !viewer.value?.studentId && (viewer.value?.guardianIds.length ?? 0) > 0)

const scope = ref<'all' | 'class' | 'teacher' | 'room'>('all')
const classId = ref<number | null>(null)
const teacherId = ref<number | null>(null)
const roomId = ref<number | null>(null)
const wardClassId = ref<number | null>(null)

// Deep links (`?classId=` / `?teacherId=` / `?roomId=`) open the grid already
// scoped, so a class or teacher page can link straight to "their" week.
const route = useRoute()
if (route.query.classId) {
  scope.value = 'class'
  classId.value = Number(route.query.classId) || null
} else if (route.query.teacherId) {
  scope.value = 'teacher'
  teacherId.value = Number(route.query.teacherId) || null
} else if (route.query.roomId) {
  scope.value = 'room'
  roomId.value = Number(route.query.roomId) || null
}

// Option sources: the big lists only for staff, the wards only for a guardian.
const { data: classData } = await useAsyncData(
  'sms:tt-classes',
  () => (isStaff.value ? fetchClasses({ pageSize: 200 }) : Promise.resolve(null)),
  { watch: [isStaff] }
)
const { data: teacherData } = await useAsyncData(
  'sms:tt-teachers',
  () => (isStaff.value ? fetchTeachers({ pageSize: 200 }) : Promise.resolve(null)),
  { watch: [isStaff] }
)
const { data: wardData } = await useAsyncData(
  'sms:tt-wards',
  () => (isGuardian.value ? fetchStudents({ pageSize: 200 }) : Promise.resolve(null)),
  { watch: [isGuardian] }
)

const classItems = computed(() => (classData.value?.items ?? []).map(item => ({ label: item.name, value: item.id })))
const teacherItems = computed(() => (teacherData.value?.items ?? []).map(item => ({ label: item.name, value: item.id })))
const roomItems = computed(() => (reference.value?.classrooms ?? []).map(item => ({ label: item.name, value: item.id })))
const wardItems = computed(() =>
  (wardData.value?.items ?? [])
    .filter(child => child.classId != null)
    .map(child => ({ label: `${child.name} · ${child.className ?? ''}`, value: child.classId as number })))

const params = computed<Record<string, unknown>>(() => {
  if (isStaff.value) {
    if (scope.value === 'class' && classId.value) return { classId: classId.value }
    if (scope.value === 'teacher' && teacherId.value) return { teacherId: teacherId.value }
    if (scope.value === 'room' && roomId.value) return { roomId: roomId.value }
    return {}
  }
  const id = viewer.value?.classId ?? wardClassId.value
  return id ? { classId: id } : {}
})

const canLoad = computed(() => {
  if (!signedIn.value) return false
  if (isStaff.value) {
    if (scope.value === 'all') return true
    if (scope.value === 'class') return classId.value != null
    if (scope.value === 'teacher') return teacherId.value != null
    return roomId.value != null
  }
  return (viewer.value?.classId ?? wardClassId.value) != null
})

const { data, pending, error } = await useAsyncData(
  'sms:timetable',
  () => (canLoad.value ? fetchTimetable(params.value) : Promise.resolve(null)),
  { watch: [params, canLoad] }
)

const timetable = computed(() => data.value ?? null)

const scopeOptions = computed(() => [
  { value: 'all' as const, label: t('sms.common.all'), icon: 'i-lucide-layout-grid' },
  { value: 'class' as const, label: t('sms.timetable.byClass'), icon: 'i-lucide-users-round' },
  { value: 'teacher' as const, label: t('sms.timetable.byTeacher'), icon: 'i-lucide-user-check' },
  { value: 'room' as const, label: t('sms.timetable.byRoom'), icon: 'i-lucide-door-open' }
])

function conflictKindLabel(kind: string): string {
  if (kind === 'classroom') return t('sms.timetable.room')
  if (kind === 'teacher') return t('sms.timetable.teacher')
  return t('sms.timetable.class')
}

function conflictMessage(conflict: { kind: string, label: string | null }): string {
  const name = conflict.label ?? '—'
  const key = `conflict${conflict.kind.charAt(0).toUpperCase()}${conflict.kind.slice(1)}`
  return t(`sms.timetable.${key}`, { name })
}
</script>

<template>
  <div class="space-y-6">
    <SmsPageHeader
      :title="t('sms.timetable.title')"
      :subtitle="timetable?.scope.name ?? t('sms.timetable.subtitle')"
      icon="i-lucide-calendar-clock"
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

    <template v-else>
      <!-- Staff scope controls -->
      <div
        v-if="isStaff"
        class="flex flex-wrap items-center gap-2"
      >
        <UButton
          v-for="option in scopeOptions"
          :key="option.value"
          :color="scope === option.value ? 'primary' : 'neutral'"
          :variant="scope === option.value ? 'soft' : 'ghost'"
          size="sm"
          :icon="option.icon"
          :label="option.label"
          @click="scope = option.value"
        />
        <USelect
          v-if="scope === 'class'"
          v-model="classId"
          :items="classItems"
          :placeholder="t('sms.timetable.byClass')"
          class="w-56"
        />
        <USelect
          v-if="scope === 'teacher'"
          v-model="teacherId"
          :items="teacherItems"
          :placeholder="t('sms.timetable.byTeacher')"
          class="w-56"
        />
        <USelect
          v-if="scope === 'room'"
          v-model="roomId"
          :items="roomItems"
          :placeholder="t('sms.timetable.byRoom')"
          class="w-56"
        />
      </div>

      <!-- Guardian: choose which child's class -->
      <div
        v-else-if="isGuardian"
        class="flex flex-wrap items-center gap-2"
      >
        <USelect
          v-model="wardClassId"
          :items="wardItems"
          :placeholder="t('sms.portal.myChildren')"
          class="w-64"
        />
      </div>

      <UAlert
        v-if="error"
        color="error"
        variant="subtle"
        :description="t('sms.messages.loadFailed')"
      />

      <div
        v-else-if="pending && !timetable"
        class="py-16 text-center text-sm text-muted"
      >
        {{ t('sms.common.loading') }}
      </div>

      <SmsEmptyState
        v-else-if="!canLoad"
        icon="i-lucide-calendar-clock"
        :title="t('sms.timetable.noLessons')"
        :description="t('sms.timetable.noLessonsHint')"
      />

      <SmsEmptyState
        v-else-if="!timetable?.entries.length"
        icon="i-lucide-calendar-clock"
        :title="t('sms.timetable.noLessons')"
        :description="t('sms.timetable.noLessonsHint')"
      />

      <template v-else-if="timetable">
        <SmsTimetableGrid :timetable="timetable" />

        <section class="space-y-2">
          <h2 class="flex items-center gap-2 text-sm font-medium text-muted">
            <UIcon
              name="i-lucide-triangle-alert"
              class="size-4"
            />
            {{ t('sms.timetable.conflicts') }}
          </h2>
          <UAlert
            v-if="timetable.conflicts.length"
            color="error"
            variant="subtle"
            :description="t('sms.messages.conflictsFound', { count: timetable.conflicts.length })"
          />
          <ul
            v-if="timetable.conflicts.length"
            class="space-y-1 text-sm"
          >
            <li
              v-for="(conflict, index) in timetable.conflicts"
              :key="`${conflict.kind}:${conflict.key}:${conflict.weekday}:${conflict.periodId}:${index}`"
              class="flex items-center gap-2 rounded-lg border border-error/30 bg-error/5 px-3 py-2"
            >
              <UBadge
                color="error"
                variant="subtle"
                size="sm"
                :label="conflictKindLabel(conflict.kind)"
              />
              <span class="text-default">{{ conflictMessage(conflict) }}</span>
              <span class="ml-auto text-xs text-muted">
                {{ t(`sms.timetable.weekday${conflict.weekday}`) }}
              </span>
            </li>
          </ul>
          <p
            v-else
            class="inline-flex items-center gap-1 text-sm text-success"
          >
            <UIcon
              name="i-lucide-check"
              class="size-4"
            />
            {{ t('sms.timetable.noConflicts') }}
          </p>
        </section>
      </template>
    </template>
  </div>
</template>
