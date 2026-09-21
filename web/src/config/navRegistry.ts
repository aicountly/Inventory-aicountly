import {
  Activity,
  ArrowDownToLine,
  ArrowLeftRight,
  ArrowUpFromLine,
  Barcode,
  BookOpen,
  ChartNoAxesCombined,
  Coins,
  Library,
  Boxes,
  ClipboardList,
  Cog,
  FilePlus2,
  Factory,
  FileText,
  FlaskConical,
  Gauge,
  History,
  Layers,
  LayoutDashboard,
  ListTree,
  MapPin,
  Package,
  PackageCheck,
  Repeat,
  Ruler,
  Scale,
  ScanBarcode,
  ScrollText,
  ShieldCheck,
  SlidersHorizontal,
  Star,
  Tag,
  Timer,
  Warehouse,
  Workflow,
  Boxes as BoxesIcon,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { MASTER_PERMISSION_SLUGS, P } from '../services/access'

/**
 * The one navigation model for the whole app.
 *
 * The sidebar, its mega-menu flyouts, the command palette and the hub screens
 * all read this file, so a route can never appear in one and be missing from
 * another. It folds in everything that used to live in
 * `src/layout/navigation.ts` (NAV_ITEMS, MASTER_NAV, MASTER_READ_PERMISSIONS)
 * — nothing that was reachable before is unreachable now.
 *
 * Permissions use the `P` vocabulary from services/access.ts and are evaluated
 * with `useAccess().can`, which treats an array as "any one of these". The
 * server still enforces every call; this only decides what to show.
 */

export interface NavLeaf {
  label: string
  /** Internal route. */
  path?: string
  /** External URL — rendered with an "opens elsewhere" affordance. */
  href?: string
  /** Exact match for the active state (index routes). */
  end?: boolean
  description?: string
  badge?: string
  icon?: LucideIcon
  permissions?: readonly string[]
}

export interface MegaMenuColumn {
  label: string
  icon?: LucideIcon
  items: readonly NavLeaf[]
}

export interface SidebarNavItem {
  key: string
  label: string
  icon: LucideIcon
  path: string
  end?: boolean
  /** Flyout columns shown on hover / focus of the rail item. */
  megaMenu?: readonly MegaMenuColumn[]
  permissions?: readonly string[]
}

/** Read permission for any master — reveals the Masters section. */
export const MASTER_READ_PERMISSIONS: readonly string[] = MASTER_PERMISSION_SLUGS.map((slug) =>
  P.masters(slug, 'read'),
)

const REPORT_SLUGS = [
  'stock_summary',
  'stock_ledger',
  'warehouse_stock',
  'batch_stock',
  'serial_stock',
  'stock_ageing',
  'movement_analysis',
  'near_expiry',
  'valuation',
  'reconciliation',
  'replenishment',
] as const

export const REPORT_READ_PERMISSIONS: readonly string[] = REPORT_SLUGS.map((s) => P.report(s))

/** Master screens under /masters. Items has its own top-level entry. */
export interface MasterNavItem extends NavLeaf {
  label: string
  path: string
  /** Permission slug (underscored) — differs from the URL slug. */
  permissionSlug: string
  description: string
  icon: LucideIcon
}

export const MASTER_NAV: readonly MasterNavItem[] = [
  {
    label: 'Item groups',
    path: '/masters/item-groups',
    permissionSlug: 'item_groups',
    description: 'Hierarchy that organises items for reports and defaults.',
    icon: ListTree,
    permissions: [P.masters('item_groups', 'read')],
  },
  {
    label: 'Stock categories',
    path: '/masters/stock-categories',
    permissionSlug: 'stock_categories',
    description: 'Cross-cutting classification independent of the group tree.',
    icon: Tag,
    permissions: [P.masters('stock_categories', 'read')],
  },
  {
    label: 'Brands',
    path: '/masters/brands',
    permissionSlug: 'brands',
    description: 'Manufacturer or label an item is sold under.',
    icon: Star,
    permissions: [P.masters('brands', 'read')],
  },
  {
    label: 'Units of measure',
    path: '/masters/uom',
    permissionSlug: 'uom',
    description: 'Base and alternate units with GST UQC codes.',
    icon: Ruler,
    permissions: [P.masters('uom', 'read')],
  },
  {
    label: 'Warehouse groups',
    path: '/masters/warehouse-groups',
    permissionSlug: 'warehouse_groups',
    description: 'Groups of material centres for consolidated views.',
    icon: Boxes,
    permissions: [P.masters('warehouse_groups', 'read')],
  },
  {
    label: 'Warehouses',
    path: '/masters/warehouses',
    permissionSlug: 'warehouses',
    description: 'Material centres that hold stock, per branch or shared.',
    icon: Warehouse,
    permissions: [P.masters('warehouses', 'read')],
  },
  {
    label: 'Locations',
    path: '/masters/locations',
    permissionSlug: 'locations',
    description: 'Zones, racks, shelves and bins inside a warehouse.',
    icon: MapPin,
    permissions: [P.masters('locations', 'read')],
  },
  {
    label: 'Bill of materials',
    path: '/masters/bill-of-materials',
    permissionSlug: 'bill_of_materials',
    description: 'Components, by-products and scrap for a finished item.',
    icon: Workflow,
    permissions: [P.masters('bill_of_materials', 'read')],
  },
  {
    label: 'Batches',
    path: '/masters/batches',
    permissionSlug: 'batches',
    description: 'Lots with manufacturing and expiry dates.',
    icon: Barcode,
    permissions: [P.masters('batches', 'read')],
  },
  {
    label: 'Serials',
    path: '/masters/serials',
    permissionSlug: 'serials',
    description: 'Individual serial numbers, registered singly or in bulk.',
    icon: ScanBarcode,
    permissions: [P.masters('serials', 'read')],
  },
]

/** Reports, mirroring src/reports/configs — one row per register. */
export const REPORT_NAV: readonly NavLeaf[] = [
  {
    label: 'Stock summary',
    path: '/reports/stock-summary',
    description: 'Opening, receipts, issues and closing per item for the period.',
    icon: ScrollText,
    permissions: [P.report('stock_summary')],
  },
  {
    label: 'Warehouse stock',
    path: '/reports/warehouse-stock',
    description: 'Closing stock per item and warehouse as at a date.',
    icon: Warehouse,
    permissions: [P.report('warehouse_stock')],
  },
  {
    label: 'Batch stock',
    path: '/reports/batch-stock',
    description: 'On-hand and available quantity per batch, with expiry.',
    icon: FlaskConical,
    permissions: [P.report('batch_stock')],
  },
  {
    label: 'Serial numbers',
    path: '/reports/serial-stock',
    description: 'Every tracked serial with its status, location and documents.',
    icon: Barcode,
    permissions: [P.report('serial_stock')],
  },
  {
    label: 'Stock ageing',
    path: '/reports/stock-ageing',
    description: 'Open cost layers bucketed by age as at a date.',
    icon: Timer,
    permissions: [P.report('stock_ageing')],
  },
  {
    label: 'Movement analysis',
    path: '/reports/movement-analysis',
    description: 'Fast, slow, non-moving and dead stock for the period.',
    icon: Activity,
    permissions: [P.report('movement_analysis')],
  },
  {
    label: 'Near expiry',
    path: '/reports/near-expiry',
    description: 'Batches expiring within the window, oldest first.',
    icon: Timer,
    permissions: [P.report('near_expiry')],
  },
  {
    label: 'Replenishment',
    path: '/reports/replenishment',
    description: 'Items at or below their reorder point, with a suggested quantity.',
    icon: PackageCheck,
    permissions: [P.report('replenishment')],
  },
]

/**
 * Registers — the dated, totalled, printable listings.
 *
 * These render through the same engine as REPORT_NAV above (see
 * src/registers/configs), so the two lists differ only in what they answer:
 * a report summarises, a register lists line by line and drills through to the
 * document behind each line.
 */
/*
 * Reservations and reconciliation runs are deliberately absent: both screens
 * carry actions the register has no room for ("New reservation", "Release",
 * "Fulfil", "Run now"), so the action screen stays the single nav door and the
 * printable register is one click away on the hub.
 */
export const REGISTER_NAV: readonly NavLeaf[] = [
  {
    label: 'All registers',
    path: '/registers',
    end: true,
    description: 'Every register, grouped by what it answers.',
    icon: Library,
  },
  {
    label: 'Stock ledger',
    path: '/registers/stock-ledger',
    description: 'One item, every movement, with a running balance.',
    icon: BookOpen,
    permissions: [P.report('stock_ledger')],
  },
  {
    label: 'Movement register',
    path: '/registers/movement-register',
    description: 'Every posted movement in the year, whichever product raised it.',
    icon: ArrowLeftRight,
    permissions: [P.report('stock_ledger'), P.documentsRead],
  },
  {
    label: 'Stock balances',
    path: '/registers/stock-balances',
    description: 'On hand, reserved, packed and available by item, warehouse and batch.',
    icon: Warehouse,
    permissions: [P.report('warehouse_stock'), P.report('stock_summary')],
  },
  {
    label: 'Valuation register',
    path: '/registers/valuation',
    description: 'Closing value per item at FIFO, LIFO, weighted average or per master.',
    icon: Coins,
    permissions: [P.report('valuation')],
  },
  {
    // Named as the register names itself. Its siblings here are "Movement
    // register" and "Valuation register", and the screen's own <h1> is
    // "Pending quantity register" — three different names for one destination
    // is how a reader stops trusting the nav.
    label: 'Pending quantity register',
    path: '/registers/pending-quantities',
    description: 'Everything issued or expected and not yet settled, with what is overdue.',
    icon: Timer,
    permissions: [P.documentsRead],
  },
]

const STOCK_PERMISSIONS = [
  P.report('stock_summary'),
  P.report('warehouse_stock'),
  P.report('stock_ledger'),
] as const

export const SIDEBAR_NAV: readonly SidebarNavItem[] = [
  {
    key: 'dashboard',
    label: 'Dashboard',
    icon: LayoutDashboard,
    path: '/dashboard',
    permissions: [P.dashboard],
  },
  {
    key: 'items',
    label: 'Items',
    icon: Package,
    path: '/items',
    permissions: [P.masters('items', 'read')],
    megaMenu: [
      {
        label: 'Items',
        icon: Package,
        items: [
          {
            label: 'All items',
            path: '/items',
            end: true,
            description: 'Search, filter and open any item.',
            icon: Package,
          },
          {
            label: 'New item',
            path: '/items/new',
            description: 'Create an item with its units, tracking and reorder rules.',
            icon: Package,
            permissions: [P.masters('items', 'write')],
          },
          {
            label: 'Bulk edit',
            path: '/items/bulk-edit',
            description: 'Change a field across many items at once.',
            icon: SlidersHorizontal,
            permissions: [P.masters('items', 'write')],
          },
        ],
      },
    ],
  },
  {
    key: 'masters',
    label: 'Masters',
    icon: ListTree,
    path: '/masters',
    permissions: MASTER_READ_PERMISSIONS,
    megaMenu: [
      {
        label: 'Classification',
        icon: Layers,
        items: MASTER_NAV.slice(0, 4),
      },
      {
        label: 'Places',
        icon: Warehouse,
        items: MASTER_NAV.slice(4, 7),
      },
      {
        label: 'Composition & tracking',
        icon: FlaskConical,
        items: MASTER_NAV.slice(7),
      },
    ],
  },
  {
    key: 'documents',
    label: 'Documents',
    icon: FileText,
    path: '/documents',
    permissions: [P.documentsRead],
    megaMenu: [
      {
        label: 'Enter a document',
        icon: FilePlus2,
        items: [
          {
            /*
             * The one nav entry that leads to data entry.
             *
             * Until this existed, every creatable document type in Inventory
             * sat behind a single "New document" dropdown on the documents
             * register and appeared in no menu, no hub and no command-palette
             * result — which read, to a user arriving from Books' always-visible
             * Transactions mega-menu, as twenty-one vouchers that were never
             * built. The hub lists all of them, including the ones the profile
             * cannot raise, with the reason attached.
             */
            label: 'New document',
            path: '/documents/new',
            description: 'Every type you can raise — receipts, issues, transfers, adjustments, production, job work.',
            icon: FilePlus2,
          },
        ],
      },
      {
        label: 'Documents',
        icon: FileText,
        items: [
          {
            label: 'All documents',
            path: '/documents',
            end: true,
            description: 'Every inventory document for the period.',
            icon: FileText,
          },
          {
            label: 'Pending approval',
            path: '/documents?status=pending_approval',
            description: 'Documents waiting for someone to approve them.',
            icon: ClipboardList,
          },
          {
            label: 'Failed',
            path: '/documents?status=failed',
            description: 'Documents that could not be posted.',
            icon: ClipboardList,
          },
        ],
      },
      {
        /*
         * Job work is the one workflow in Documents that is two document types
         * and one position. Until it had a column of its own, both halves were
         * reachable only through the entry hub's long list, and the quantities
         * sitting with job workers — the thing the workflow is actually about —
         * appeared nowhere in the navigation at all.
         */
        label: 'Job work',
        icon: Factory,
        items: [
          {
            label: 'Job Work Inward',
            path: '/documents/new/job_work_in',
            description: 'Receive finished goods and settle what is pending with a job worker.',
            icon: ArrowDownToLine,
            permissions: ['documents.job_work_in.create', 'documents.create'],
          },
          {
            label: 'Job Work Outward',
            path: '/documents/new/job_work_out',
            description: 'Send material out and track it until it is settled.',
            icon: ArrowUpFromLine,
            permissions: ['documents.job_work_out.create', 'documents.create'],
          },
          {
            label: 'With job workers',
            path: '/registers/pending-quantities?kind=job_work',
            description: 'Every quantity still out on a job-work challan.',
            icon: Timer,
            permissions: [P.documentsRead],
          },
        ],
      },
      {
        label: 'Open positions',
        icon: PackageCheck,
        items: [
          {
            label: 'Packing lists',
            path: '/packing-lists',
            description: 'Packed stock held until it is sold or unpacked.',
            icon: PackageCheck,
            permissions: ['documents.packing.read', P.documentsRead],
          },
          {
            label: 'Reservations',
            path: '/reservations',
            description: 'Stock promised to a document but not yet issued.',
            icon: BoxesIcon,
            permissions: ['documents.reservation.read', P.documentsRead],
          },
          {
            label: 'Pending quantities',
            path: '/registers/pending-quantities',
            description: 'Challans and job work still to be settled.',
            icon: Timer,
            permissions: [P.documentsRead],
          },
        ],
      },
    ],
  },
  {
    key: 'stock',
    label: 'Stock',
    icon: Boxes,
    path: '/registers/stock-balances',
    permissions: STOCK_PERMISSIONS,
    megaMenu: [
      {
        label: 'Stock',
        icon: Boxes,
        items: [
          // These three are the registers, not a second plain copy of them:
          // shipping both doors is what left a user on the old screen wondering
          // why their colleague's looked different.
          {
            label: 'Balances',
            path: '/registers/stock-balances',
            description: 'On-hand, reserved and available quantity per item.',
            icon: Boxes,
            permissions: [P.report('warehouse_stock'), P.report('stock_summary')],
          },
          {
            label: 'Ledger',
            path: '/registers/stock-ledger',
            description: 'Every movement of one item, in date order.',
            icon: ScrollText,
            permissions: [P.report('stock_ledger')],
          },
          {
            label: 'Movements',
            path: '/registers/movement-register',
            description: 'All movements for the period across items.',
            icon: Repeat,
            permissions: [P.report('stock_ledger'), P.documentsRead],
          },
        ],
      },
    ],
  },
  {
    key: 'valuation',
    label: 'Valuation',
    icon: Gauge,
    path: '/registers/valuation',
    permissions: [P.report('valuation')],
    // Two columns, because Valuation is not one report: the left is what the
    // stock is worth and how that value is composed, the right is the analysis
    // and the control trail behind it. Every entry lands on a screen that
    // already exists — "Warehouse valuation" is the warehouse-stock register
    // and "Valuation summary" the dashboard's valuation view, rather than two
    // more half-copies of screens the product already ships.
    megaMenu: [
      {
        label: 'Valuation',
        icon: Gauge,
        items: [
          {
            label: 'Valuation register',
            path: '/registers/valuation',
            description: 'Item-wise value of stock on hand by the chosen method.',
            icon: Gauge,
            permissions: [P.report('valuation')],
          },
          {
            label: 'Item valuation',
            path: '/valuation/cost-layers',
            description: 'The open cost layers behind one item\u2019s value.',
            icon: Layers,
            permissions: [P.report('valuation')],
          },
          {
            label: 'Warehouse valuation',
            path: '/registers/warehouse-stock',
            description: 'Closing stock and value per item and warehouse.',
            icon: Warehouse,
            permissions: [P.report('warehouse_stock')],
          },
          {
            label: 'Method comparison',
            path: '/valuation/method-comparison',
            description: 'What the same stock is worth under each method.',
            icon: Scale,
            permissions: [P.report('valuation')],
          },
        ],
      },
      {
        label: 'Analysis and control',
        icon: Activity,
        items: [
          {
            label: 'Valuation summary',
            path: '/dashboard?view=valuation',
            description: 'Cost, ageing and the capital tied up in stock.',
            icon: Activity,
            permissions: [P.report('stock_summary'), P.report('stock_ageing')],
          },
          {
            label: 'Ageing analysis',
            path: '/registers/stock-ageing',
            description: 'How long the stock on hand has been sitting there.',
            icon: Timer,
            permissions: [P.report('stock_ageing')],
          },
          {
            label: 'Recalculations',
            path: '/valuation/recalculations',
            description: 'Back-dated recalculation runs and their status.',
            icon: Repeat,
            permissions: [P.report('valuation')],
          },
          {
            label: 'Revisions',
            path: '/valuation/revisions',
            description: 'Cost revisions sent to Books and their acknowledgement.',
            icon: History,
            permissions: [P.report('valuation')],
          },
        ],
      },
    ],
  },
  {
    key: 'registers',
    label: 'Registers',
    icon: Library,
    path: '/registers',
    permissions: [...REPORT_READ_PERMISSIONS, P.documentsRead, P.reconciliationRead],
    megaMenu: [
      {
        label: 'Registers',
        icon: Library,
        items: REGISTER_NAV,
      },
    ],
  },
  {
    key: 'reports',
    label: 'Reports',
    icon: ScrollText,
    path: '/reports',
    permissions: REPORT_READ_PERMISSIONS,
    megaMenu: [
      {
        label: 'Stock reports',
        icon: ScrollText,
        items: REPORT_NAV.slice(0, 4),
      },
      {
        label: 'Analysis',
        icon: Activity,
        items: REPORT_NAV.slice(4),
      },
    ],
  },
  {
    key: 'reconciliation',
    label: 'Reconciliation',
    icon: Repeat,
    path: '/reconciliation',
    permissions: [P.reconciliationRead],
    megaMenu: [
      {
        label: 'Reconciliation',
        icon: Repeat,
        items: [
          {
            label: 'Runs',
            path: '/reconciliation',
            end: true,
            description: 'Comparison runs against Books and their differences.',
            icon: Repeat,
          },
          {
            label: 'Item-wise variance',
            path: '/reconciliation/variance',
            description: 'What explains the latest gap, bucket by bucket.',
            icon: ListTree,
          },
          {
            label: 'Pending adjustments',
            path: '/reconciliation/posting-status',
            description: 'Which documents have reached Books.',
            icon: ClipboardList,
          },
          {
            label: 'Audit trail',
            path: '/integration/outbox',
            description: 'Messages queued for, or rejected by, Books.',
            icon: History,
            permissions: [P.integrationRead],
          },
          {
            label: 'Insights',
            path: '/reconciliation/insights',
            description: 'Reconciliation health across the runs on record.',
            icon: ChartNoAxesCombined,
          },
        ],
      },
    ],
  },
  {
    key: 'settings',
    label: 'Settings',
    icon: Cog,
    path: '/settings',
    permissions: [P.settingsRead],
    megaMenu: [
      {
        label: 'Settings',
        icon: Cog,
        items: [
          {
            label: 'Company',
            path: '/settings',
            end: true,
            description: 'Valuation method, negative stock and other policies.',
            icon: Cog,
          },
          {
            label: 'Period locks',
            path: '/settings/period-locks',
            description: 'Close a period so it can no longer be posted into.',
            icon: ShieldCheck,
          },
          {
            label: 'Access',
            path: '/settings/access',
            description: 'Profiles, members and warehouse restrictions.',
            icon: ShieldCheck,
            permissions: [P.accessManage, P.accessMembersManage],
          },
          {
            label: 'Document types',
            path: '/settings/document-types',
            description: 'Which document types this company uses.',
            icon: FileText,
          },
        ],
      },
    ],
  },
  {
    key: 'audit',
    label: 'Audit',
    icon: History,
    path: '/audit',
    permissions: [P.auditRead],
  },
]

/** Quick actions offered at the foot of the sidebar and in the palette. */
export const SIDEBAR_SHORTCUTS: readonly NavLeaf[] = [
  {
    label: 'New item',
    path: '/items/new',
    icon: Package,
    permissions: [P.masters('items', 'write')],
  },
  {
    // Was '/documents' — the register. A shortcut called "New document" that
    // lands on a list of existing ones is the shape of this bug report.
    label: 'New document',
    path: '/documents/new',
    icon: FilePlus2,
    permissions: [P.documentsRead],
  },
]

export type PermissionCheck = (key: string | readonly string[]) => boolean

/** Flatten every reachable leaf — the command palette's search corpus. */
export function collectNavLeaves(
  items: readonly SidebarNavItem[] = SIDEBAR_NAV,
): { section: string; leaf: NavLeaf }[] {
  const out: { section: string; leaf: NavLeaf }[] = []
  for (const item of items) {
    out.push({
      section: item.label,
      leaf: {
        label: item.label,
        path: item.path,
        end: item.end,
        icon: item.icon,
        permissions: item.permissions,
      },
    })
    for (const column of item.megaMenu ?? []) {
      for (const leaf of column.items) {
        // The column's own landing page is already the rail entry above.
        if (leaf.path === item.path && leaf.end) continue
        out.push({ section: `${item.label} › ${column.label}`, leaf })
      }
    }
  }
  return out
}

/** Keep only the items the user can reach. `can` comes from useAccess(). */
export function filterNav(
  items: readonly SidebarNavItem[],
  can: PermissionCheck,
): SidebarNavItem[] {
  const result: SidebarNavItem[] = []
  for (const item of items) {
    if (item.permissions && !can(item.permissions)) continue
    const megaMenu = (item.megaMenu ?? [])
      .map((col) => ({
        ...col,
        items: col.items.filter((leaf) => !leaf.permissions || can(leaf.permissions)),
      }))
      .filter((col) => col.items.length > 0)
    result.push(megaMenu.length ? { ...item, megaMenu } : { ...item, megaMenu: undefined })
  }
  return result
}

export function filterLeaves(leaves: readonly NavLeaf[], can: PermissionCheck): NavLeaf[] {
  return leaves.filter((leaf) => !leaf.permissions || can(leaf.permissions))
}
