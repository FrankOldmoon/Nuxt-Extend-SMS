/**
 * The signed-in viewer, shared across every school page.
 *
 * `sms:viewer` is the same key the layout uses, so a page and the shell read one
 * payload rather than firing two identical requests. The API answers for a
 * signed-out visitor (role `anonymous`) instead of raising 401, so this never
 * throws and is safe to call at the top of a public page.
 */
import { fetchViewer, type SmsViewer } from './useSms'

export function useSmsViewer() {
  const { data, refresh } = useAsyncData('sms:viewer', () => fetchViewer())
  const viewer = computed<SmsViewer | null>(() => data.value?.viewer ?? null)
  return { viewer, refresh }
}
