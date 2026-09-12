import { Navigate, Route, Routes } from 'react-router-dom'
import { AppLayout } from './layout/AppLayout'
import Dashboard from './pages/Dashboard'
import { renderDocumentRoutes } from './documents/routes'
import NotFound from './pages/NotFound'
import { ItemFormPage } from './pages/items/ItemFormPage'
import { ItemsListPage } from './pages/items/ItemsListPage'
import { BomFormPage } from './pages/masters/BomFormPage'
import { BomListPage } from './pages/masters/BomListPage'
import { MastersIndex } from './pages/masters/MastersIndex'
import { MastersLayout } from './pages/masters/MastersLayout'
import { SerialsPage } from './pages/masters/SerialsPage'
import { BatchesPage, BrandsPage, ItemGroupsPage, LocationsPage, StockCategoriesPage, UomPage, WarehouseGroupsPage, WarehousesPage } from './pages/masters/SimpleMasterPages'
import { AuditLogPage } from './pages/audit/AuditLogPage'
import { OutboxPage } from './pages/integration/OutboxPage'
import { PostingStatusPage } from './pages/reconciliation/PostingStatusPage'
import { ReconciliationLayout } from './pages/reconciliation/ReconciliationLayout'
import { ReconciliationRunPage } from './pages/reconciliation/ReconciliationRunPage'
import { ReconciliationRunsPage } from './pages/reconciliation/ReconciliationRunsPage'
import { ReportRoutePage } from './pages/reports/ReportRoutePage'
import { ReportsIndexPage } from './pages/reports/ReportsIndexPage'
import { AccessPage } from './pages/settings/AccessPage'
import { CompanySettingsPage } from './pages/settings/CompanySettingsPage'
import { DocumentTypesPage } from './pages/settings/DocumentTypesPage'
import { PeriodLocksPage } from './pages/settings/PeriodLocksPage'
import { SettingsLayout } from './pages/settings/SettingsLayout'
import { StockBalancesPage } from './pages/stock/StockBalancesPage'
import { StockLayout } from './pages/stock/StockLayout'
import { StockLedgerPage } from './pages/stock/StockLedgerPage'
import { StockMovementsPage } from './pages/stock/StockMovementsPage'
import { CostLayersPage } from './pages/valuation/CostLayersPage'
import { RecalculationsPage } from './pages/valuation/RecalculationsPage'
import { RevisionsPage } from './pages/valuation/RevisionsPage'
import { ValuationLayout } from './pages/valuation/ValuationLayout'
import { ValuationSnapshotPage } from './pages/valuation/ValuationSnapshotPage'

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
        <Route path="stock" element={<StockLayout />}>
          <Route index element={<StockBalancesPage />} />
          <Route path="ledger" element={<StockLedgerPage />} />
          <Route path="movements" element={<StockMovementsPage />} />
        </Route>
        <Route path="valuation" element={<ValuationLayout />}>
          <Route index element={<ValuationSnapshotPage />} />
          <Route path="cost-layers" element={<CostLayersPage />} />
          <Route path="recalculations" element={<RecalculationsPage />} />
          <Route path="revisions" element={<RevisionsPage />} />
        </Route>
        <Route path="reports" element={<ReportsIndexPage />} />
        <Route path="reports/:path" element={<ReportRoutePage />} />
        <Route path="reconciliation" element={<ReconciliationLayout />}>
          <Route index element={<ReconciliationRunsPage />} />
          <Route path="posting-status" element={<PostingStatusPage />} />
          <Route path=":id" element={<ReconciliationRunPage />} />
        </Route>
        <Route path="integration/outbox" element={<OutboxPage />} />
        <Route path="settings" element={<SettingsLayout />}>
          <Route index element={<CompanySettingsPage />} />
          <Route path="period-locks" element={<PeriodLocksPage />} />
          <Route path="access" element={<AccessPage />} />
          <Route path="document-types" element={<DocumentTypesPage />} />
        </Route>
        <Route path="audit" element={<AuditLogPage />} />

        <Route path="*" element={<NotFound />} />
      </Route>
    </Routes>
  )
}
