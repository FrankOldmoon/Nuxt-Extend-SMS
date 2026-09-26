<script setup lang="ts">
/**
 * The conduct ledger — commendations and discipline in one list, with the rule
 * book beside it.
 *
 * The ledger is scoped by the server (a student sees their own, a guardian their
 * wards', staff everyone), so the page is the same for every role. Writing is
 * staff-level rather than course-level: any teacher who saw something happen can
 * record it, and the record copies the rule's points and direction so editing a
 * rule later never rewrites history.
 */
definePageMeta({ layout: 'school' })

const { t } = useI18n()
const { viewer } = useSmsViewer()
const toast = useToast()

const ANY = 'any'
const page = ref(1)
const pageSize = 20
const kind = ref(ANY)
const q = ref('')

const params = computed(() => ({
  page: page.value,
  pageSize,
  kind: kind.value === ANY ? undefined : kind.value,
  q: q.value.trim() || undefined
}))

const { data, pending, error, refresh } = await useAsyncData(
  'sms:conduct',
  () => fetchConduct(params.value),
  { watch: [params] }
)

const records = computed(() => data.value?.items ?? [])
const total = computed(() => data.value?.total ?? 0)

watch([kind, q], () => {
  page.value = 1
})

const kindItems = computed(() => [
  { label: t('sms.common.all'), value: ANY },
  { label: t('sms.conduct.merit'), value: 'merit' },
  { label: t('sms.conduct.demerit'), value: 'demerit' }
])

// -------------------------------------------------------- rule book ----

const { data: categoryData } = await useAsyncData('sms:conduct-categories', () => fetchConductCategories())
const { data: ruleData } = await useAsyncData('sms:conduct-rules', () => fetchConductRules())
const categories = computed(() => categoryData.value?.items ?? [])
const rules = computed(() => ruleData.value?.items ?? [])

function rulesFor(categoryId: number) {
  return rules.value.filter(rule => rule.categoryId === categoryId)
}

// ------------------------------------------------------- record form ----

const isStaff = computed(() => viewer.value?.isStaff ?? false)

const { data: studentData } = await useAsyncData(
  'sms:conduct-students',
  () => (isStaff.value ? fetchStudents({ pageSize: 200 }) : Promise.resolve(null)),
  { watch: [isStaff] }
)

const studentItems = computed(() =>
  (studentData.value?.items ?? []).map(student => ({ label: `${student.name} · ${student.rollId}`, value: student.id })))
const ruleItems = computed(() =>
  rules.value.map(rule => ({
    label: `${rule.name} (${rule.categoryKind === 'merit' ? '+' : '−'}${rule.points})`,
    value: rule.id
  })))

const recordOpen = ref(false)
const saving = ref(false)
const form = reactive({
  studentId: null as number | null,
  ruleId: null as number | null,
  date: todayISO(),
  description: ''
})

function openRecord(): void {
  form.studentId = null
  form.ruleId = null
  form.date = todayISO()
  form.description = ''
  recordOpen.value = true
}

async function saveRecord(): Promise<void> {
  if (!form.studentId || !form.ruleId) return
  saving.value = true
  try {
    await cPost('/api/sms/conduct/records', {
      studentId: form.studentId,
      ruleId: form.ruleId,
      date: form.date,
      description: form.description || undefined
    })
    toast.add({ title: t('sms.messages.recorded'), color: 'success' })
    recordOpen.value = false
    await refresh()
  } catch (e: unknown) {
    toast.add({ title: extractErrorMessage(e), color: 'error' })
  } finally {
    saving.value = false
  }
}

async function removeRecord(id: number): Promise<void> {
  try {
    await cDelete(`/api/sms/conduct/records/${id}`)
    toast.add({ title: t('sms.messages.deleted'), color: 'success' })
    await refresh()
  } catch (e: unknown) {
    toast.add({ title: extractErrorMessage(e), color: 'error' })
  }
}
</script>

<template>
  <div class="space-y-8">
    <SmsPageHeader
      :title="t('sms.conduct.title')"
      :subtitle="t('sms.conduct.subtitle')"
      icon="i-lucide-scale"
    >
      <template #actions>
        <UButton
          v-if="isStaff"
          icon="i-lucide-plus"
          :label="t('sms.actions.recordConduct')"
          @click="openRecord"
        />
      </template>
    </SmsPageHeader>

    <section class="space-y-4">
      <div class="flex flex-wrap items-center gap-2">
        <UInput
          v-model="q"
          icon="i-lucide-search"
          :placeholder="t('sms.common.search')"
          class="w-56"
        />
        <USelect
          v-model="kind"
          :items="kindItems"
          class="w-40"
        />
        <span class="ml-auto text-xs text-muted">
          {{ t('sms.common.showing', { count: records.length, total }) }}
        </span>
      </div>

      <UAlert
        v-if="error"
        color="error"
        variant="subtle"
        :description="t('sms.messages.loadFailed')"
      />

      <div
        v-else-if="pending && !records.length"
        class="py-12 text-center text-sm text-muted"
      >
        {{ t('sms.common.loading') }}
      </div>

      <div
        v-else-if="records.length"
        class="overflow-x-auto rounded-xl border border-default"
      >
        <table class="w-full border-collapse text-sm">
          <thead>
            <tr class="bg-elevated/60">
              <th class="border-b border-default px-3 py-2 text-left text-xs font-medium text-muted">
                {{ t('sms.common.date') }}
              </th>
              <th class="border-b border-l border-default px-3 py-2 text-left text-xs font-medium text-muted">
                {{ t('sms.scores.student') }}
              </th>
              <th class="border-b border-l border-default px-3 py-2 text-left text-xs font-medium text-muted">
                {{ t('sms.conduct.rule') }}
              </th>
              <th class="border-b border-l border-default px-3 py-2 text-center text-xs font-medium text-muted">
                {{ t('sms.conduct.kind') }}
              </th>
              <th class="border-b border-l border-default px-3 py-2 text-center text-xs font-medium text-muted">
                {{ t('sms.conduct.points') }}
              </th>
              <th class="border-b border-l border-default px-3 py-2 text-left text-xs font-medium text-muted">
                {{ t('sms.conduct.recordedBy') }}
              </th>
              <th
                v-if="isStaff"
                class="border-b border-l border-default px-3 py-2 text-right text-xs font-medium text-muted"
              >
                {{ t('sms.common.actions') }}
              </th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="record in records"
              :key="record.id"
            >
              <td class="border-b border-default px-3 py-2 text-muted">
                {{ formatDate(record.date) }}
              </td>
              <td class="border-b border-l border-default px-3 py-2">
                <NuxtLink
                  :to="`/sms/students/${record.studentId}`"
                  class="font-medium text-highlighted hover:text-primary"
                >
                  {{ record.studentName }}
                </NuxtLink>
                <span class="block text-[11px] text-dimmed">{{ record.className ?? '—' }}</span>
              </td>
              <td class="border-b border-l border-default px-3 py-2 text-muted">
                {{ record.ruleName ?? record.description ?? '—' }}
              </td>
              <td class="border-b border-l border-default px-3 py-2 text-center">
                <UBadge
                  :color="record.kind === 'merit' ? 'success' : 'error'"
                  variant="subtle"
                  size="sm"
                  :label="record.kind === 'merit' ? t('sms.conduct.merit') : t('sms.conduct.demerit')"
                />
              </td>
              <td class="border-b border-l border-default px-3 py-2 text-center text-muted">
                {{ record.kind === 'merit' ? '+' : '−' }}{{ record.points }}
              </td>
              <td class="border-b border-l border-default px-3 py-2 text-muted">
                {{ record.recorderName ?? '—' }}
              </td>
              <td
                v-if="isStaff"
                class="border-b border-l border-default px-3 py-2 text-right"
              >
                <UButton
                  icon="i-lucide-trash-2"
                  color="error"
                  variant="ghost"
                  size="xs"
                  @click="removeRecord(record.id)"
                />
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <SmsEmptyState
        v-else
        icon="i-lucide-scale"
        :title="t('sms.conduct.empty')"
        :description="t('sms.conduct.emptyHint')"
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
    </section>

    <!-- Rule book -->
    <section class="space-y-4">
      <div class="flex items-center gap-2">
        <h2 class="text-lg font-semibold text-highlighted">
          {{ t('sms.conduct.rules') }}
        </h2>
        <span class="text-xs text-muted">{{ t('sms.conduct.pointsHint') }}</span>
      </div>

      <div class="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <div
          v-for="category in categories"
          :key="category.id"
          class="rounded-xl border border-default bg-elevated/40 p-4"
        >
          <div class="flex items-center justify-between gap-2">
            <h3 class="font-medium text-highlighted">
              {{ category.name }}
            </h3>
            <UBadge
              :color="category.kind === 'merit' ? 'success' : 'error'"
              variant="subtle"
              size="sm"
              :label="category.kind === 'merit' ? t('sms.conduct.merit') : t('sms.conduct.demerit')"
            />
          </div>
          <ul
            v-if="rulesFor(category.id).length"
            class="mt-2 space-y-1 text-sm"
          >
            <li
              v-for="rule in rulesFor(category.id)"
              :key="rule.id"
              class="flex items-center justify-between text-muted"
            >
              <span>{{ rule.name }}</span>
              <span class="text-xs">{{ category.kind === 'merit' ? '+' : '−' }}{{ rule.points }}</span>
            </li>
          </ul>
          <p
            v-else
            class="mt-2 text-xs text-muted"
          >
            {{ t('sms.common.empty') }}
          </p>
        </div>
      </div>
    </section>

    <UModal
      v-model:open="recordOpen"
      :title="t('sms.actions.recordConduct')"
    >
      <template #body>
        <div class="space-y-3">
          <UFormField :label="t('sms.scores.student')">
            <USelectMenu
              v-model="form.studentId"
              :items="studentItems"
              value-key="value"
              class="w-full"
            />
          </UFormField>
          <UFormField :label="t('sms.conduct.rule')">
            <USelectMenu
              v-model="form.ruleId"
              :items="ruleItems"
              value-key="value"
              class="w-full"
            />
          </UFormField>
          <UFormField :label="t('sms.common.date')">
            <UInput
              v-model="form.date"
              type="date"
              class="w-full"
            />
          </UFormField>
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
            @click="recordOpen = false"
          />
          <UButton
            :label="t('sms.common.save')"
            :loading="saving"
            :disabled="!form.studentId || !form.ruleId"
            @click="saveRecord"
          />
        </div>
      </template>
    </UModal>
  </div>
</template>
