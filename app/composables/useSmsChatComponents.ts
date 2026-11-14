import type { Component } from 'vue'

/**
 * Builds the chat component map from the module's own components folder.
 *
 * Nuxt only auto-registers components referenced in a template, so the ids are
 * derived from filenames instead of a hand-maintained map:
 * `sms/StudentTable.vue` → `sms.student-table`. Ids that are not in the server
 * catalog never reach the client, so extra entries are harmless.
 */
const modules = import.meta.glob<{ default: Component }>('../components/sms/*.vue', { eager: true })

function kebabCase(value: string): string {
  return value
    .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
    .replace(/([A-Z])([A-Z][a-z])/g, '$1-$2')
    .toLowerCase()
}

export function buildSmsChatComponentMap(): Record<string, Component> {
  const map: Record<string, Component> = {}
  for (const [path, module] of Object.entries(modules)) {
    const name = path.split('/').pop()?.replace(/\.vue$/, '')
    if (!name) continue
    map[`sms.${kebabCase(name)}`] = module.default
  }
  return map
}
