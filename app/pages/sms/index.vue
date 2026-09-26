<script setup lang="ts">
/**
 * The school's public home page — and the site root while `SMS_ENABLED` is on.
 *
 * `index.ts` mounts this very file at `/`, so it has to work for someone who has
 * never seen the school: the counters, the notice board, the latest articles and
 * what is coming up, all from one request (`/api/sms/home`). Everything deeper is
 * one click away, and a signed-out visitor is invited to sign in rather than
 * shown an empty portal.
 */
definePageMeta({ layout: 'school' })

const { t } = useI18n()
const { viewer } = useSmsViewer()

const { data, error } = await useAsyncData('sms:home', () => fetchSchoolHome())
const home = computed(() => data.value ?? null)

const stats = computed(() => {
  const counts = home.value?.stats
  return [
    { key: 'students', icon: 'i-lucide-graduation-cap', value: counts?.students ?? 0, to: '/sms/students' },
    { key: 'teachers', icon: 'i-lucide-user-check', value: counts?.teachers ?? 0, to: '/sms/teachers' },
    { key: 'classes', icon: 'i-lucide-users-round', value: counts?.classes ?? 0, to: '/sms/classes' },
    { key: 'courses', icon: 'i-lucide-book-open', value: counts?.courses ?? 0, to: '/sms/courses' }
  ]
})
</script>

<template>
  <div class="space-y-10">
    <section class="rounded-2xl border border-default bg-elevated/40 p-6 sm:p-8">
      <h1 class="text-2xl font-semibold text-highlighted sm:text-3xl">
        {{ t('sms.home.welcome', { school: home?.schoolName ?? 'School' }) }}
      </h1>
      <p class="mt-2 max-w-2xl text-muted">
        {{ t('sms.home.lead') }}
      </p>
      <div class="mt-4 flex flex-wrap items-center gap-3">
        <UButton
          v-if="viewer?.linked"
          to="/sms/dashboard"
          icon="i-lucide-layout-dashboard"
          :label="t('sms.home.goToPortal')"
        />
        <template v-else>
          <UButton
            to="/login"
            icon="i-lucide-log-in"
            :label="t('sms.actions.signIn')"
          />
          <span class="text-sm text-muted">{{ t('sms.home.signInHint') }}</span>
        </template>
      </div>
    </section>

    <UAlert
      v-if="error"
      color="error"
      variant="subtle"
      :description="t('sms.messages.loadFailed')"
    />

    <section
      v-else
      class="grid grid-cols-2 gap-3 sm:grid-cols-4"
    >
      <SmsStatCard
        v-for="item in stats"
        :key="item.key"
        :label="t(`sms.home.${item.key}`)"
        :value="item.value"
        :icon="item.icon"
        :to="item.to"
      />
    </section>

    <section
      v-if="home?.notices.length"
      class="space-y-3"
    >
      <div class="flex items-center justify-between">
        <h2 class="text-lg font-semibold text-highlighted">
          {{ t('sms.home.latestNotices') }}
        </h2>
        <UButton
          to="/sms/notices"
          variant="link"
          size="sm"
          :label="t('sms.home.viewAll')"
        />
      </div>
      <div class="grid gap-3 lg:grid-cols-2">
        <SmsNoticeItem
          v-for="notice in home.notices"
          :key="notice.id"
          :notice="notice"
        />
      </div>
    </section>

    <section
      v-if="home?.articles.length"
      class="space-y-3"
    >
      <div class="flex items-center justify-between">
        <h2 class="text-lg font-semibold text-highlighted">
          {{ t('sms.home.latestArticles') }}
        </h2>
        <UButton
          to="/sms/articles"
          variant="link"
          size="sm"
          :label="t('sms.home.viewAll')"
        />
      </div>
      <div class="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <SmsArticleItem
          v-for="article in home.articles"
          :key="article.id"
          :article="article"
        />
      </div>
    </section>

    <section
      v-if="home?.activities.length"
      class="space-y-3"
    >
      <div class="flex items-center justify-between">
        <h2 class="text-lg font-semibold text-highlighted">
          {{ t('sms.home.upcomingActivities') }}
        </h2>
        <UButton
          to="/sms/activities"
          variant="link"
          size="sm"
          :label="t('sms.home.viewAll')"
        />
      </div>
      <div class="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <SmsActivityItem
          v-for="activity in home.activities"
          :key="activity.id"
          :activity="activity"
        />
      </div>
    </section>
  </div>
</template>
