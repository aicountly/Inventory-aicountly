import { MasterPage } from '../../masters/MasterPage'
import { batchesConfig, itemGroupsConfig, warehousesConfig } from '../../masters/configs'
import { UnitsOfMeasurePage } from './uom/UnitsOfMeasurePage'

export { StockCategoriesPage } from './stockCategories/StockCategoriesPage'

/** Master screens that are entirely described by a config. */

const crumbs = [{ label: 'Masters', to: '/masters' }]

export function ItemGroupsPage() {
  return <MasterPage config={itemGroupsConfig} breadcrumbs={crumbs} />
}

/*
 * Stock categories is NOT here either.
 *
 * Company-wide figures over the list, a usage count per row with the actions
 * that count implies, and a selection that survives paging are not things a
 * `MasterConfig` can describe. Its screen lives at
 * `pages/masters/stockCategories/StockCategoriesPage.tsx` and is re-exported
 * above, so the router still imports every simple master from one place.
 */

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

/* Locations is NOT here either: the bin master grew a KPI strip counted over
   the whole company, a contextual column, bulk actions and a table that
   resolves warehouse and parent to names. It lives in
   `pages/masters/locations/LocationsPage`, still reusing `locationsConfig` for
   the form and the API, and the route points straight at it. */

export function BatchesPage() {
  return <MasterPage config={batchesConfig} breadcrumbs={crumbs} />
}
