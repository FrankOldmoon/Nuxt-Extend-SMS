/**
 * School management system (Nuxt layer) — i18n locale files and public runtime
 * config.
 *
 * The i18n block tells @nuxtjs/i18n to load this layer's locale files
 * (`./i18n/locales/*.json`) and deep-merge them with the host locales, so the
 * school's pages are localised and its tables participate in the host's shared
 * `dashboard.tables` / `dashboard.fields` translation system.
 */
export default defineNuxtConfig({
  runtimeConfig: {
    public: {
      /** Longest list a portal page will ask for in one request. */
      smsMaxPageSize: 100,
      /**
       * Filled in by `index.ts` at build time: the header-navigation labels read
       * from this module's locale files, plus the site's default locale to pick
       * them with. The host renders those labels verbatim, so they have to be
       * plain text chosen up front.
       */
      smsNavLocale: 'en',
      smsNavLabels: {} as Record<string, Record<string, string>>
    }
  },

  i18n: {
    langDir: 'locales',
    locales: [
      { code: 'en', name: 'English', file: 'en.json' },
      { code: 'zh', name: '中文', file: 'zh.json' },
      { code: 'zh-TW', name: '繁體中文', file: 'zh-TW.json' }
    ]
  }
})
