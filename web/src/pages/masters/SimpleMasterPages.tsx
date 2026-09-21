import { MasterPage } from '../../masters/MasterPage'
import { itemGroupsConfig, locationsConfig, stockCategoriesConfig, warehousesConfig } from '../../masters/configs'
import { UnitsOfMeasurePage } from './uom/UnitsOfMeasurePage'

/** Master screens that are entirely described by a config. */

const crumbs = [{ label: 'Masters', to: '/masters' }]

export function ItemGroupsPage() {
  return <MasterPage config={itemGroupsConfig} breadcrumbs={crumbs} />
}

export function StockCategoriesPage() {
  return <MasterPage config={stockCategoriesConfig} breadcrumbs={crumbs} />
}

/*
 * Brands is NOT here.
 *
 * It outgrew the generic master screen: an item count worth clicking through, a
 * revenue column that belongs to another product, a linkage problem worth
 * surfacing and a create form with four fields rather than three. It has its
 * own screen at `pages/masters/brands/BrandsPage.tsx`, routed directly.
 */

/**
 * Units of measure is the one master that is no longer config-driven.
 *
 * It grew a usage count with a drill-down, a GST-aware type split, tabs, bulk
 * actions and a contextual panel — none of which the other masters asked for,
 * and all of which would have had to be optioned into `MasterConfig` to live
 * there. The route is unchanged, so every link to /masters/uom still resolves.
 */
export function UomPage() {
  return <UnitsOfMeasurePage />
}

/* Warehouse groups is NOT here: it has its own screen
   (masters/warehouseGroups/WarehouseGroupsPage) with list / tree / card views,
   live figures and a contextual panel, which a MasterConfig cannot describe. */

export function WarehousesPage() {
  return <MasterPage config={warehousesConfig} breadcrumbs={crumbs} />
}

export function LocationsPage() {
  return <MasterPage config={locationsConfig} breadcrumbs={crumbs} />
}

/*
 * Batches is NOT here either.
 *
 * Its question is rarely "which batch is this" and almost always "what is about
 * to go off, where is it, and how much of it is there" — server-counted
 * figures, derived expiry health, an inspector, labels and an import, none of
 * which a MasterConfig can describe. It has its own workspace at
 * `pages/masters/batches`. `batchesConfig` stays in configs.tsx and remains the
 * single source of truth for the batch FORM and the export columns; that screen
 * reads it rather than re-declaring the fields.
 */
