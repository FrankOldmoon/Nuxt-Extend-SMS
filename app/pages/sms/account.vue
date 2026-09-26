<script setup lang="ts">
/**
 * My account — how the school sees the signed-in user.
 *
 * The host already owns the profile page (name, avatar, password); what is worth
 * showing here is the school-specific half: which role the portal treats you as,
 * and which student / teacher / guardian record your account is linked to. That
 * link is what turns "signed in" into "a student's timetable" or "a parent's
 * children", so `notLinked` is a real, actionable state.
 */
definePageMeta({ layout: 'school' })

const { t } = useI18n()
const { viewer } = useSmsViewer()
const { user } = useAuth()

const signedIn = computed(() => viewer.value?.signedIn ?? false)
const role = computed(() => viewer.value?.role ?? 'anonymous')

const linkedEntries = computed(() => {
  const current = viewer.value
  if (!current) return []
  const entries: Array<{ label: string, value: string, to?: string }> = []
  if (current.teacherId) {
    entries.push({ label: t('sms.account.linkedTeacher'), value: String(current.teacherId) })
  }
  if (current.studentId) {
    entries.push({
      label: t('sms.account.linkedStudent'),
      value: String(current.studentId),
      to: `/sms/students/${current.studentId}`
    })
  }
  if (current.guardianIds.length) {
    entries.push({ label: t('sms.account.linkedGuardian'), value: current.guardianIds.join(', ') })
  }
  return entries
})
</script>

<template>
  <div class="mx-auto max-w-2xl space-y-6">
    <SmsPageHeader
      :title="t('sms.account.profile')"
      icon="i-lucide-user-round"
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
      <section class="flex items-center gap-4 rounded-xl border border-default bg-elevated/40 p-4">
        <UAvatar
          :src="user?.avatarPath ? `/api/files/serve/${user.avatarPath}` : undefined"
          :alt="user?.name ?? user?.username ?? ''"
          size="lg"
        />
        <div class="min-w-0">
          <p class="text-lg font-semibold text-highlighted">
            {{ user?.name || user?.username || '—' }}
          </p>
          <p
            v-if="user?.email"
            class="text-sm text-muted"
          >
            {{ user.email }}
          </p>
          <div class="mt-1 flex items-center gap-2">
            <SmsSchoolRoleBadge :role="role" />
            <span
              v-if="!viewer?.linked"
              class="text-xs text-warning"
            >
              {{ t('sms.account.notLinked') }}
            </span>
          </div>
        </div>
      </section>

      <section class="rounded-xl border border-default bg-elevated/40 p-4">
        <h2 class="mb-3 text-sm font-medium text-muted">
          {{ t('sms.account.role') }}
        </h2>
        <dl
          v-if="linkedEntries.length"
          class="space-y-2 text-sm"
        >
          <div
            v-for="entry in linkedEntries"
            :key="entry.label"
            class="flex items-center justify-between gap-3"
          >
            <dt class="text-muted">
              {{ entry.label }}
            </dt>
            <dd>
              <NuxtLink
                v-if="entry.to"
                :to="entry.to"
                class="text-primary hover:underline"
              >
                {{ entry.value }}
              </NuxtLink>
              <span
                v-else
                class="text-highlighted"
              >{{ entry.value }}</span>
            </dd>
          </div>
        </dl>
        <p
          v-else
          class="text-sm text-muted"
        >
          {{ t('sms.portal.notLinkedHint') }}
        </p>
      </section>

      <div class="flex flex-wrap gap-2">
        <UButton
          to="/sms/dashboard"
          icon="i-lucide-layout-dashboard"
          :label="t('sms.portal.title')"
        />
        <UButton
          to="/profile"
          icon="i-lucide-settings"
          color="neutral"
          variant="soft"
          :label="t('sms.account.profile')"
        />
      </div>
    </template>
  </div>
</template>
