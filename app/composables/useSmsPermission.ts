/**
 * SMS-specific permission checks for chat components.
 *
 * The host `usePermission().can(table, action)` only understands `table:action`
 * grants and `*`, while SMS roles use canonical permissions such as
 * `sms.students.update` (see module.ts / register.ts) or the coarse
 * `sms:update`. This composable accepts all of them.
 */
export type SmsAction = 'read' | 'create' | 'update' | 'delete'

/**
 * Pure matcher shared by the composable and unit tests. Accepts the canonical
 * `sms.<resource>.<action>`, the coarse `sms:<action>`, a bare `sms` grant, the
 * host-style `<resource>:<action>`, and `*`.
 */
export function smsPermissionMatches(
  permissions: readonly string[] | null | undefined,
  resource: string,
  action: SmsAction
): boolean {
  const perms = permissions ?? []
  return perms.includes('*')
    || perms.includes('sms')
    || perms.includes(`sms:${action}`)
    || perms.includes(`sms.${resource}`)
    || perms.includes(`sms.${resource}.${action}`)
    || perms.includes(`${resource}:${action}`)
}

export function useSmsPermission() {
  const { user } = useAuth()
  const isAdmin = computed(() => user.value?.role?.name === 'admin')
  const permissions = computed<string[]>(() => user.value?.role?.permissions ?? [])

  function can(resource: string, action: SmsAction): boolean {
    return isAdmin.value || smsPermissionMatches(permissions.value, resource, action)
  }

  return { can, isAdmin }
}
