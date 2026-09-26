<script setup lang="ts">
/**
 * The school shell.
 *
 * The site chrome is the host's own (`AppHeader`), which is what puts the
 * school's sections in the header navigation: they are published to
 * `site.navigation` by this module's Nitro plugin, and the header renders that
 * config — so there is one navigation, editable in the dashboard, instead of a
 * second row owned by this layout.
 *
 * What the layout adds is the two things every page needs and no page should own:
 * the signed-in identity (so a visitor always knows which role they are seeing
 * the school through) and a footer with the school's name.
 *
 * Printing matters here more than in most modules — a report card is a document
 * someone hands to a parent — so the header, the navigation and the footer are all
 * marked `print:hidden`, and the page body is left in charge of the printed page.
 */
const { data } = await useAsyncData('sms:viewer', () => fetchViewer())
const viewer = computed(() => data.value?.viewer ?? null)
const { data: config } = await useAsyncData('sms:school', () => cGet<{ schoolName: string }>('/api/sms/config'))
const schoolName = computed(() => config.value?.schoolName ?? 'School')
const { t } = useI18n()
</script>

<template>
  <div class="flex min-h-screen flex-col bg-default">
    <div class="print:hidden">
      <AppHeader />
    </div>

    <UMain>
      <div class="mx-auto w-full max-w-[1400px] px-5 py-8 sm:px-8 lg:px-12 print:max-w-none print:px-0 print:py-0">
        <!--
          Who the school is being viewed as. A teacher and a student open the same
          URL and see different things, so this is not decoration: it is the answer
          to "why am I not allowed to do that".
        -->
        <div
          v-if="viewer"
          class="mb-6 flex flex-wrap items-center gap-3 print:hidden"
        >
          <SmsSchoolRoleBadge :role="viewer.role" />
          <span
            v-if="viewer.signedIn && viewer.name"
            class="text-sm text-muted"
          >
            {{ t('sms.messages.signedInAs', { name: viewer.name }) }}
          </span>
          <NuxtLink
            v-else
            to="/login"
            class="text-sm text-primary hover:underline"
          >
            {{ t('sms.actions.signIn') }}
          </NuxtLink>
          <span class="ml-auto text-sm font-medium text-muted">
            {{ schoolName }}
          </span>
        </div>

        <slot />
      </div>
    </UMain>

    <footer class="border-t border-default py-6 print:hidden">
      <div class="mx-auto flex w-full max-w-[1400px] flex-wrap items-center gap-4 px-5 text-xs text-muted sm:px-8 lg:px-12">
        <span>{{ schoolName }}</span>
        <NuxtLink
          to="/sms/feedback"
          class="hover:text-highlighted"
        >
          {{ t('sms.feedback.title') }}
        </NuxtLink>
        <NuxtLink
          to="/sms/account"
          class="hover:text-highlighted"
        >
          {{ t('sms.account.profile') }}
        </NuxtLink>
      </div>
    </footer>
  </div>
</template>
