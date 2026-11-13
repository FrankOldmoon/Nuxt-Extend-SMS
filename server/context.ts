import { ModuleForbiddenError, permMatches, type TableAction } from '../../../server/sdk'

export interface SmsActor {
  userId: number
  roleName?: string | null
  permissions?: readonly string[] | null
  organizationId?: number | null
  tenantId?: number | null
}

export function isSmsAdmin(actor: SmsActor): boolean {
  return actor.roleName === 'admin' && !!actor.permissions?.includes('*')
}

export function canUseSms(actor: SmsActor, action: TableAction = 'read', resource = 'students'): boolean {
  if (!actor.organizationId) return false
  if (isSmsAdmin(actor)) return true
  const canonical = `sms.${resource}.${action}`
  return (actor.permissions ?? []).some(permission =>
    permission === canonical || permMatches(permission, 'sms', action)
  )
}

export function requireSmsOrganization(actor: SmsActor): number {
  if (!actor.organizationId) {
    throw new ModuleForbiddenError('An active organization is required for SMS data')
  }
  return actor.organizationId
}
