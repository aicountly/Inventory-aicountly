import { MasterPage } from '../../masters/MasterPage'
import { batchesConfig, brandsConfig, itemGroupsConfig, stockCategoriesConfig, uomConfig, warehouseGroupsConfig, warehousesConfig } from '../../masters/configs'

/**
 * Master screens that are entirely described by a config.
 *
 * Locations is no longer one of them: it has its own workspace in
 * `pages/masters/locations`, which still reuses `locationsConfig` for the form
 * and the API. The route points straight at it.
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

export function BatchesPage() {
  return <MasterPage config={batchesConfig} breadcrumbs={crumbs} />
}
