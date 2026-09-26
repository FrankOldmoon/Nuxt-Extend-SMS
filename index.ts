/**
 * School management system (Nuxt layer + module entry).
 *
 * A generic school information system that mounts onto the host admin project.
 * It is independent from the library, music and photo modules: they may be
 * enabled together.
 *
 * While `SMS_ENABLED=true` the module:
 *   - takes over the site root: the host landing page (`/`) is removed and
 *     replaced with the school's public home page;
 *   - serves its own pages under `/sms/**` (provided by this layer);
 *   - publishes its sections into the host header navigation, and hands the
 *     labels to the Nitro plugin through the public runtime config (see below).
 *
 * Set `SMS_TAKE_SITE_ROOT=false` to leave `/` to the host — or to another
 * extension module that claims the root the same way.
 *
 * The takeover runs on `pages:resolved` rather than `pages:extend` so that it has
 * the last word: the host mounts its `modules/*` layers in filesystem order, so
 * if two modules both claimed the root from `pages:extend`, which one won would
 * depend on directory listing order. `pages:resolved` runs after every
 * `pages:extend` hook, so "sms enabled ⇒ the school is the home page" is
 * deterministic rather than accidental.
 */
import { defineNuxtModule, createResolver } from '@nuxt/kit'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const LOCALE_FILES = [['en', 'en.json'], ['zh', 'zh.json'], ['zh-TW', 'zh-TW.json']] as const

/**
 * Read the header-navigation labels out of this module's own locale files.
 *
 * The host renders `site.navigation` entries verbatim — they are admin-authored
 * content with no per-locale lookup — so the school's sections have to be stored
 * as plain text. Reading the strings here (build time, where the files are on
 * disk) and passing them through the public runtime config avoids duplicating
 * them, and lets the header speak the site's default language.
 */
function readNavLabels(moduleDir: string): Record<string, Record<string, string>> | null {
  try {
    const labels: Record<string, Record<string, string>> = {}
    for (const [code, file] of LOCALE_FILES) {
      const raw = readFileSync(join(moduleDir, 'i18n', 'locales', file), 'utf8')
      const parsed = JSON.parse(raw) as { sms?: { nav?: Record<string, string> } }
      labels[code] = parsed.sms?.nav ?? {}
    }
    return labels
  } catch (error) {
    console.warn('[sms] could not read locale files for the header navigation:', error)
    return null
  }
}

export default defineNuxtModule({
  meta: {
    name: 'sms',
    configKey: 'sms'
  },
  setup(_options, nuxt) {
    if (process.env.SMS_ENABLED !== 'true') return

    const resolver = createResolver(import.meta.url)
    const moduleDir = resolver.resolve('.')

    // Header-navigation labels, in the site's default language (the config that
    // drives the header is global, so "the default locale" is the only choice
    // that is right for most visitors).
    const publicConfig = nuxt.options.runtimeConfig.public as Record<string, unknown>
    const labels = readNavLabels(moduleDir)
    if (labels) publicConfig.smsNavLabels = labels
    const i18n = (nuxt.options as { i18n?: { defaultLocale?: string } }).i18n
    publicConfig.smsNavLocale = i18n?.defaultLocale ?? 'en'

    const takeRoot = process.env.SMS_TAKE_SITE_ROOT !== 'false'
    console.log(`[sms] module entry active — pages under /sms${takeRoot ? ', taking the site root' : ''}`)
    if (!takeRoot) return

    const home = join(moduleDir, 'app/pages/sms/index.vue')
    if (!existsSync(home)) {
      // Guard rather than crash the build: taking the root needs the page to exist.
      console.warn(`[sms] ${home} is missing — leaving the site root alone`)
      return
    }

    nuxt.hook('pages:resolved', (pages) => {
      // Drop whatever currently owns `/` (the host landing page, or another
      // module's home) and mount the school's home page there instead.
      for (let i = pages.length - 1; i >= 0; i--) {
        if (pages[i]?.path === '/') pages.splice(i, 1)
      }
      pages.unshift({
        name: 'sms-home',
        path: '/',
        file: home,
        // The layout has to be stated here as well as in the page's own
        // `definePageMeta`: a page injected through this hook is not built from
        // the scanned file's meta, so without it the home page silently falls
        // back to the host's default layout (and loses the school shell).
        meta: { layout: 'school' }
      })
    })
  }
})
