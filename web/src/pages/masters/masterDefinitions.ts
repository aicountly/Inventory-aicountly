import { Package } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { MASTER_NAV } from '../../config/navRegistry'
import { P } from '../../services/access'
import type { ListQuery, ListResponse } from '../../services/api'
import { itemsApi } from '../../services/items'
import {
  batchesApi,
  bomApi,
  brandsApi,
  itemGroupsApi,
  locationsApi,
  serialsApi,
  stockCategoriesApi,
  uomApi,
  warehouseGroupsApi,
  warehousesApi,
} from '../../services/masters'

/**
 * The Masters landing page's model of a master.
 *
 * Labels, descriptions, routes, icons and permissions are NOT redeclared here:
 * they are read from `src/config/navRegistry.ts`, the one navigation model the
 * sidebar, its flyouts and the command palette already share. A card on this
 * screen therefore cannot describe a master differently from the rail beside
 * it. What is added here is only what the landing page needs and no other
 * screen does — the list endpoint that answers "how many, and when last
 * touched", the audit `entity_type` the master writes, and where "create one"
 * goes.
 *
 * Items is prepended by hand because it is a top-level section (`/items`), not
 * a `/masters/*` child, so the registry carries it in SIDEBAR_NAV instead.
 */

/** The shape of a row the overview reads — every master list returns these. */
export interface MasterRowStamp {
  updated_at?: string | null
  created_at?: string | null
}

/**
 * Just enough of `CrudApi` to count a master and date it.
 *
 * Widened to the stamp above so the ten heterogeneous master APIs (plus items,
 * whose query type is narrower) can sit in one array.
 */
export interface CountableMasterApi {
  list(query?: ListQuery, signal?: AbortSignal): Promise<ListResponse<MasterRowStamp>>
}

export interface MasterDefinition {
  /** Stable id — URL slug of the master, used as a React key and a map key. */
  key: string
  title: string
  description: string
  /** Existing list route. Never invent one: these come from the registry. */
  route: string
  icon: LucideIcon
  /** Permission slug (underscored), e.g. `stock_categories`. */
  permissionSlug: string
  /** `entity_type` this master writes to the audit log. */
  auditEntity: string
  /**
   * Where "create one" goes. A master whose form is a modal is deep-linked
   * with `?new=1`, which MasterPage opens on arrival; the two masters with a
   * full-page form name that page directly.
   */
  createRoute: string
  /** List endpoint for the record count and the last-updated stamp. */
  api: CountableMasterApi
  /**
   * Inventory cannot record a movement without this master, so an empty one is
   * missing setup rather than simply unused. Drives the health breakdown.
   */
  essential: boolean
}

/** Per-master extras, keyed by the registry's permission slug. */
const EXTRAS: Record<string, Pick<MasterDefinition, 'api' | 'auditEntity' | 'createRoute' | 'essential'>> = {
  item_groups: { api: itemGroupsApi, auditEntity: 'item_group', createRoute: '/masters/item-groups?new=1', essential: false },
  stock_categories: { api: stockCategoriesApi, auditEntity: 'stock_category', createRoute: '/masters/stock-categories?new=1', essential: false },
  brands: { api: brandsApi, auditEntity: 'brand', createRoute: '/masters/brands?new=1', essential: false },
  uom: { api: uomApi, auditEntity: 'uom', createRoute: '/masters/uom?new=1', essential: true },
  warehouse_groups: { api: warehouseGroupsApi, auditEntity: 'warehouse_group', createRoute: '/masters/warehouse-groups?new=1', essential: false },
  warehouses: { api: warehousesApi, auditEntity: 'warehouse', createRoute: '/masters/warehouses?new=1', essential: true },
  locations: { api: locationsApi, auditEntity: 'location', createRoute: '/masters/locations?new=1', essential: false },
  bill_of_materials: { api: bomApi, auditEntity: 'bom', createRoute: '/masters/bill-of-materials/new', essential: false },
  batches: { api: batchesApi, auditEntity: 'batch', createRoute: '/masters/batches?new=1', essential: false },
  serials: { api: serialsApi, auditEntity: 'serial', createRoute: '/masters/serials?new=1', essential: false },
}

const ITEMS: MasterDefinition = {
  key: 'items',
  title: 'Items',
  description: 'Stock, service and non-stock items with units, tracking and opening stock.',
  route: '/items',
  icon: Package,
  permissionSlug: 'items',
  auditEntity: 'item',
  createRoute: '/items/new',
  api: itemsApi,
  essential: true,
}

export const MASTER_DEFINITIONS: readonly MasterDefinition[] = [
  ITEMS,
  ...MASTER_NAV.map((master): MasterDefinition => {
    const extras = EXTRAS[master.permissionSlug]
    if (!extras) {
      // A master was added to the registry without telling this screen how to
      // count it. Failing loudly at module load beats a card that silently
      // shows no figure forever.
      throw new Error(`No masters-overview mapping for "${master.permissionSlug}"`)
    }
    return {
      key: master.path.replace('/masters/', ''),
      title: master.label,
      description: master.description,
      route: master.path,
      icon: master.icon,
      permissionSlug: master.permissionSlug,
      ...extras,
    }
  }),
]

export function canReadMaster(master: MasterDefinition): string {
  return P.masters(master.permissionSlug, 'read')
}

export function canWriteMaster(master: MasterDefinition): string {
  return P.masters(master.permissionSlug, 'write')
}

/** Audit `entity_type` values that mean "a master changed". */
export const MASTER_AUDIT_ENTITIES: readonly string[] = MASTER_DEFINITIONS.map((m) => m.auditEntity)
