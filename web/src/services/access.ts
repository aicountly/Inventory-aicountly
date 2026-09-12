/** `GET /v1/access/me` — the signed-in user's Inventory access in the selected company. */

import { api } from './api'
import type { ItemResponse } from './api'

export interface AccessMember {
  uuid: string
  status: string
  profile_id: number | null
  display_name?: string | null
  email?: string | null
  is_portal_owner?: boolean
}

export interface AccessProfile {
  profile_id?: number
  profile_name: string
  template_key: string | null
  is_system?: number
  description?: string | null
}

export interface AccessMe {
  member: AccessMember | null
  profile: AccessProfile | null
  permissions: string[]
  /** null = unrestricted. */
  allowed_warehouses: number[] | null
}

export async function fetchAccessMe(signal?: AbortSignal): Promise<AccessMe> {
  const res = await api.get<ItemResponse<AccessMe>>('v1/access/me', { signal })
  const d = res.data
  return {
    member: d?.member ?? null,
    profile: d?.profile ?? null,
    permissions: Array.isArray(d?.permissions) ? d.permissions.filter((p): p is string => typeof p === 'string') : [],
    allowed_warehouses: Array.isArray(d?.allowed_warehouses) ? d.allowed_warehouses.map(Number).filter((n) => Number.isFinite(n)) : null,
  }
}

/** Permission keys, mirroring server-php PermissionRegistry. */
export const P = {
  dashboard: 'dashboard.read',
  masters: (slug: string, action: 'read' | 'write' | 'delete') => `masters.${slug}.${action}`,
  documentsRead: 'documents.read',
  settingsRead: 'settings.read',
  reconciliationRead: 'reconciliation.read',
  auditRead: 'audit.read',
  integrationRead: 'integration.read',
  integrationReplay: 'integration.replay',
  settingsWrite: 'settings.write',
  periodsLock: 'periods.lock',
  valuationRecalculate: 'valuation.recalculate',
  reconciliationResolve: 'reconciliation.resolve',
  accessManage: 'access.manage',
  accessMembersManage: 'access.members.manage',
  auditExport: 'audit.export',
  inventoryEnter: 'inventory.enter',
  report: (slug: string) => `reports.${slug}.read`,
} as const

/** Master slugs as used in permission keys (not URL slugs). */
export const MASTER_PERMISSION_SLUGS = [
  'items',
  'item_groups',
  'stock_categories',
  'brands',
  'uom',
  'warehouses',
  'warehouse_groups',
  'locations',
  'bill_of_materials',
  'batches',
  'serials',
] as const
