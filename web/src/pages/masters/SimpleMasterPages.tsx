import { MasterPage } from '../../masters/MasterPage'
import { batchesConfig, itemGroupsConfig, locationsConfig, stockCategoriesConfig, uomConfig, warehouseGroupsConfig, warehousesConfig } from '../../masters/configs'

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

export function UomPage() {
  return <MasterPage config={uomConfig} breadcrumbs={crumbs} />
}

export function WarehouseGroupsPage() {
  return <MasterPage config={warehouseGroupsConfig} breadcrumbs={crumbs} />
}

export function WarehousesPage() {
  return <MasterPage config={warehousesConfig} breadcrumbs={crumbs} />
}

export function LocationsPage() {
  return <MasterPage config={locationsConfig} breadcrumbs={crumbs} />
}

export function BatchesPage() {
  return <MasterPage config={batchesConfig} breadcrumbs={crumbs} />
}
