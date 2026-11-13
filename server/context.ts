import { ModuleForbiddenError, permMatches, type TableAction } from '../../../server/sdk'

export interface SisActor {
  userId: number
  roleName?: string | null
  permissions?: readonly string[] | null
  organizationId?: number | null
  tenantId?: number | null
}

export function isSisAdmin(actor: SisActor): boolean {
  return actor.roleName === 'admin' && !!actor.permissions?.includes('*')
}

export function canUseSis(actor: SisActor, action: TableAction = 'read', resource = 'students'): boolean {
  if (!actor.organizationId) return false
  if (isSisAdmin(actor)) return true
  const canonical = `sis.${resource}.${action}`
  return (actor.permissions ?? []).some(permission =>
    permission === canonical || permMatches(permission, 'sis', action)
  )
}

export function requireSisOrganization(actor: SisActor): number {
  if (!actor.organizationId) {
    throw new ModuleForbiddenError('An active organization is required for SIS data')
  }
  return actor.organizationId
}
