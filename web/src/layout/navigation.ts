import { MASTER_PERMISSION_SLUGS, P } from '../services/access'

/**
 * Primary navigation. `permissions` lists the keys any one of which reveals the
 * entry; the server still enforces each call. Icons are simple glyphs so the
 * shell needs no icon library.
 */
export interface NavItem {
  label: string
  to: string
  icon: string
  permissions: readonly string[]
}

const REPORT_SLUGS = ['stock_summary', 'stock_ledger', 'warehouse_stock', 'batch_stock', 'serial_stock', 'stock_ageing', 'movement_analysis', 'near_expiry', 'valuation', 'reconciliation', 'replenishment'] as const

export const MASTER_READ_PERMISSIONS: readonly string[] = MASTER_PERMISSION_SLUGS.map((slug) => P.masters(slug, 'read'))

export const NAV_ITEMS: readonly NavItem[] = [
  { label: 'Dashboard', to: '/dashboard', icon: '▦', permissions: [P.dashboard] },
  { label: 'Items', to: '/items', icon: '◫', permissions: [P.masters('items', 'read')] },
  { label: 'Masters', to: '/masters', icon: '☰', permissions: MASTER_READ_PERMISSIONS },
  { label: 'Documents', to: '/documents', icon: '▤', permissions: [P.documentsRead] },
  { label: 'Packing lists', to: '/packing-lists', icon: '▣', permissions: ['documents.packing.read', P.documentsRead] },
  { label: 'Reservations', to: '/reservations', icon: '◇', permissions: ['documents.reservation.read', P.documentsRead] },
  { label: 'Pending quantities', to: '/pending-quantities', icon: '◔', permissions: [P.documentsRead] },
  { label: 'Stock', to: '/stock', icon: '▥', permissions: [P.report('stock_summary'), P.report('warehouse_stock'), P.report('stock_ledger')] },
  { label: 'Valuation', to: '/valuation', icon: '◈', permissions: [P.report('valuation')] },
  { label: 'Reports', to: '/reports', icon: '▧', permissions: REPORT_SLUGS.map((s) => P.report(s)) },
  { label: 'Reconciliation', to: '/reconciliation', icon: '⇄', permissions: [P.reconciliationRead] },
  { label: 'Settings', to: '/settings', icon: '⚙', permissions: [P.settingsRead] },
  { label: 'Audit', to: '/audit', icon: '◷', permissions: [P.auditRead] },
]

/** Master screens under /masters (items has its own top-level entry). */
export interface MasterNavItem {
  label: string
  slug: string
  /** Permission slug (underscored) — differs from the URL slug. */
  permissionSlug: string
  description: string
}

export const MASTER_NAV: readonly MasterNavItem[] = [
  { label: 'Item groups', slug: 'item-groups', permissionSlug: 'item_groups', description: 'Hierarchy that organises items for reports and defaults.' },
  { label: 'Stock categories', slug: 'stock-categories', permissionSlug: 'stock_categories', description: 'Cross-cutting classification independent of the group tree.' },
  { label: 'Brands', slug: 'brands', permissionSlug: 'brands', description: 'Manufacturer or label an item is sold under.' },
  { label: 'Units of measure', slug: 'uom', permissionSlug: 'uom', description: 'Base and alternate units with GST UQC codes.' },
  { label: 'Warehouse groups', slug: 'warehouse-groups', permissionSlug: 'warehouse_groups', description: 'Groups of material centres for consolidated views.' },
  { label: 'Warehouses', slug: 'warehouses', permissionSlug: 'warehouses', description: 'Material centres that hold stock, per branch or shared.' },
  { label: 'Locations', slug: 'locations', permissionSlug: 'locations', description: 'Zones, racks, shelves and bins inside a warehouse.' },
  { label: 'Bill of materials', slug: 'bill-of-materials', permissionSlug: 'bill_of_materials', description: 'Components, by-products and scrap for a finished item.' },
  { label: 'Batches', slug: 'batches', permissionSlug: 'batches', description: 'Lots with manufacturing and expiry dates.' },
  { label: 'Serials', slug: 'serials', permissionSlug: 'serials', description: 'Individual serial numbers, registered singly or in bulk.' },
]
