import { MasterPage } from '../../masters/MasterPage'
import { brandsConfig, itemGroupsConfig, locationsConfig, stockCategoriesConfig, uomConfig, warehouseGroupsConfig, warehousesConfig } from '../../masters/configs'

/**
 * Master screens that are entirely described by a config.
 *
 * Batches used to be one of them and no longer is: it has its own workspace at
 * `pages/masters/batches` (expiry intelligence, a server summary, a detail
 * drawer, labels, import). `batchesConfig` stays where it is and is still the
 * single source of truth for the batch FORM and the export columns — the new
 * screen reads it rather than re-declaring the fields.
 */

const crumbs = [{ label: 'Masters', to: '/masters' }]

export function ItemGroupsPage() {
  return <MasterPage config={itemGroupsConfig} breadcrumbs={crumbs} />
}

export function StockCategoriesPage() {
  return <MasterPage config={stockCategoriesConfig} breadcrumbs={crumbs} />
}

export function BrandsPage() {
  return <MasterPage config={brandsConfig} breadcrumbs={crumbs} />
}

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
