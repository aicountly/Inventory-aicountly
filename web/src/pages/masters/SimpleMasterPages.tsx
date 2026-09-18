import { MasterPage } from '../../masters/MasterPage'
import { batchesConfig, brandsConfig, itemGroupsConfig, locationsConfig, uomConfig, warehouseGroupsConfig, warehousesConfig } from '../../masters/configs'

/**
 * Master screens that are entirely described by a config.
 *
 * Stock categories is no longer one of them — it has its own screen under
 * `stockCategories/`, because usage counts, company-wide figures and a
 * selection that survives paging are not things a config can describe. It is
 * re-exported from here so the router keeps importing every simple master from
 * one place.
 */

const crumbs = [{ label: 'Masters', to: '/masters' }]

export { StockCategoriesPage } from './stockCategories/StockCategoriesPage'

export function ItemGroupsPage() {
  return <MasterPage config={itemGroupsConfig} breadcrumbs={crumbs} />
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

export function BatchesPage() {
  return <MasterPage config={batchesConfig} breadcrumbs={crumbs} />
}
