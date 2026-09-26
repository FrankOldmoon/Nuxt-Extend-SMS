/**
 * The school's reference lists (departments, grades, subjects, semesters, rooms,
 * the bell schedule), shared per session.
 *
 * Every filter bar and picker needs the same handful of lookups, and they only
 * change when an administrator edits the back office, so one fetch and one key
 * (`sms:reference`) is enough. Returns null until loaded; callers treat a
 * missing `reference` as "an empty picker", never as an error.
 */
import { fetchReference, type SmsReference } from './useSms'

export function useSmsReference() {
  const { data, refresh } = useAsyncData('sms:reference', () => fetchReference())
  const reference = computed<SmsReference | null>(() => data.value ?? null)
  return { reference, refresh }
}
