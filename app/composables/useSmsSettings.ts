/**
 * The school's settings (name, pass mark, current semester), shared per session.
 *
 * `sms:school` is the layout's own key, so the shell's footer and a page's
 * heading resolve to the same fetch. `passMark` is what colours a mark, so it is
 * read here rather than passed down from page to page.
 */
import type { SmsSettings } from './useSms'

export function useSmsSettings() {
  const { data, refresh } = useAsyncData('sms:school', () =>
    cGet<SmsSettings>('/api/sms/config'))
  const settings = computed<SmsSettings | null>(() => data.value ?? null)
  const schoolName = computed(() => data.value?.schoolName ?? 'School')
  const passMark = computed(() => data.value?.passMark ?? 60)
  return { settings, schoolName, passMark, refresh }
}
