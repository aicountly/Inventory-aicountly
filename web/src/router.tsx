import { Navigate, Route, Routes } from 'react-router-dom'
import { AppLayout } from './layout/AppLayout'
import Dashboard from './pages/Dashboard'
import { renderDocumentRoutes } from './documents/routes'
import { ModulePlaceholder } from './pages/ModulePlaceholder'
import NotFound from './pages/NotFound'
import { ItemFormPage } from './pages/items/ItemFormPage'
import { ItemsListPage } from './pages/items/ItemsListPage'
import { BomFormPage } from './pages/masters/BomFormPage'
import { BomListPage } from './pages/masters/BomListPage'
import { MastersIndex } from './pages/masters/MastersIndex'
import { MastersLayout } from './pages/masters/MastersLayout'
import { SerialsPage } from './pages/masters/SerialsPage'
import { BatchesPage, BrandsPage, ItemGroupsPage, LocationsPage, StockCategoriesPage, UomPage, WarehouseGroupsPage, WarehousesPage } from './pages/masters/SimpleMasterPages'
import { P } from './services/access'

/**
 * Authenticated route table. The portal callback (`/auth/callback`) is consumed
 * by AuthProvider before this mounts, so it only needs a fallback here.
 */
export function AppRoutes() {
  return (
    <Routes>
      <Route element={<AppLayout />}>
        <Route index element={<Navigate to="/dashboard" replace />} />
        <Route path="auth/callback" element={<Navigate to="/dashboard" replace />} />
        <Route path="dashboard" element={<Dashboard />} />

        <Route path="items" element={<ItemsListPage />} />
        <Route path="items/new" element={<ItemFormPage />} />
        <Route path="items/:id" element={<ItemFormPage />} />

        <Route path="masters" element={<MastersLayout />}>
          <Route index element={<MastersIndex />} />
          <Route path="item-groups" element={<ItemGroupsPage />} />
          <Route path="stock-categories" element={<StockCategoriesPage />} />
          <Route path="brands" element={<BrandsPage />} />
          <Route path="uom" element={<UomPage />} />
          <Route path="warehouse-groups" element={<WarehouseGroupsPage />} />
          <Route path="warehouses" element={<WarehousesPage />} />
          <Route path="locations" element={<LocationsPage />} />
          <Route path="bill-of-materials" element={<BomListPage />} />
          <Route path="bill-of-materials/new" element={<BomFormPage />} />
          <Route path="bill-of-materials/:id" element={<BomFormPage />} />
          <Route path="batches" element={<BatchesPage />} />
          <Route path="serials" element={<SerialsPage />} />
        </Route>

        {renderDocumentRoutes()}
        <Route path="stock" element={<ModulePlaceholder title="Stock" description="Availability, balances by warehouse, batch and serial, reservations and the stock ledger." permission={[P.report('stock_summary'), P.report('warehouse_stock'), P.report('stock_ledger')]} />} />
        <Route path="valuation" element={<ModulePlaceholder title="Valuation" description="Unit costs, cost layers, revaluation and backdated recalculation jobs." permission={P.report('valuation')} />} />
        <Route path="reports" element={<ModulePlaceholder title="Reports" description="Stock summary, ledger, ageing, movement analysis, near-expiry and replenishment reports." permission={[P.report('stock_summary'), P.report('stock_ageing'), P.report('movement_analysis'), P.report('near_expiry'), P.report('replenishment')]} />} />
        <Route path="reconciliation" element={<ModulePlaceholder title="Reconciliation" description="Inventory versus Books stock ledger, posting status and replay of integration events." permission={P.reconciliationRead} />} />
        <Route path="settings" element={<ModulePlaceholder title="Settings" description="Company inventory settings, period locks, access profiles and team members." permission={P.settingsRead} />} />
        <Route path="audit" element={<ModulePlaceholder title="Audit" description="Who changed what, when — across masters, documents and access." permission={P.auditRead} />} />

        <Route path="*" element={<NotFound />} />
      </Route>
    </Routes>
  )
}
