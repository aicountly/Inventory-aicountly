import { MasterPage } from '../../masters/MasterPage'
import { brandsConfig, itemGroupsConfig, locationsConfig, stockCategoriesConfig, uomConfig, warehouseGroupsConfig, warehousesConfig } from '../../masters/configs'

/** Master screens that are entirely described by a config. */

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

/*
 * Batches is NOT here: it outgrew the config-driven list. A batch carries
 * expiry dates that decide whether stock is sellable, quantities spread across
 * warehouses and a movement history, none of which a name-and-status master
 * screen can show. It lives in `pages/masters/batches/BatchesPage.tsx` and is
 * routed from there; `batchesConfig` still describes its form and its sheet.
 */
