import { MASTER_NAV as REGISTRY_MASTER_NAV, MASTER_READ_PERMISSIONS, SIDEBAR_NAV } from '../config/navRegistry'

/**
 * Compatibility view over the navigation registry.
 *
 * `src/config/navRegistry.ts` is now the single source of truth for navigation
 * — the sidebar, its mega menus, the command palette and the hub screens all
 * read it. This module keeps the older `NAV_ITEMS` / `MASTER_NAV` shapes alive,
 * derived from that registry rather than duplicated, so the screens that still
 * import them cannot drift from the rail. Delete it once the last importer
 * (pages/masters/MastersIndex.tsx, pages/masters/MastersLayout.tsx) reads the
 * registry directly.
 */

export interface NavItem {
  label: string
  to: string
  /** Kept for the type's shape; the registry carries real lucide icons. */
  icon: string
  permissions: readonly string[]
}

export { MASTER_READ_PERMISSIONS }

export const NAV_ITEMS: readonly NavItem[] = SIDEBAR_NAV.map((item) => ({
  label: item.label,
  to: item.path,
  icon: '',
  permissions: item.permissions ?? [],
}))

export interface MasterNavItem {
  label: string
  /** URL slug under /masters. */
  slug: string
  /** Permission slug (underscored) — differs from the URL slug. */
  permissionSlug: string
  description: string
}

export const MASTER_NAV: readonly MasterNavItem[] = REGISTRY_MASTER_NAV.map((master) => ({
  label: master.label,
  slug: master.path.replace('/masters/', ''),
  permissionSlug: master.permissionSlug,
  description: master.description,
}))
