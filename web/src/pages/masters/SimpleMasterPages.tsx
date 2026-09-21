import { MasterPage } from '../../masters/MasterPage'
import { batchesConfig, itemGroupsConfig, locationsConfig, stockCategoriesConfig, warehousesConfig } from '../../masters/configs'
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

export function BatchesPage() {
  return <MasterPage config={batchesConfig} breadcrumbs={crumbs} />
}
