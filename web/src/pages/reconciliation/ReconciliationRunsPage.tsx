import { useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useCan } from '../../access/AccessContext'
import { useCompany } from '../../company/CompanyContext'
import { DataTable } from '../../components/DataTable'
import type { Column } from '../../components/DataTable'
import { ListSheetActions } from '../../components/ListSheetActions'
import { PageHeader } from '../../components/PageHeader'
import { Pagination } from '../../components/Pagination'
import { RequirePermission } from '../../components/RequirePermission'
import { StatusBadge } from '../../components/StatusBadge'
import { useListParams } from '../../hooks/useListParams'
import { useQuery } from '../../hooks/useQuery'
import type { ExportableColumn } from '../../registers/registerCells'
import { P } from '../../services/access'
import { ApiError } from '../../services/api'
import { fetchAllRows } from '../../services/listAll'
import { RECONCILIATION_STATUSES, reconciliationApi } from '../../services/reconciliationApi'
import type { ReconciliationRun } from '../../services/reconciliationApi'
import { useToast } from '../../ui/ToastContext'
import { formatDate, formatDateTime, formatMoney, formatQty, humanize, todayIso } from '../../utils/format'
import { ReconciliationExplainer } from './ReconciliationExplainer'
import '../views.css'

const FILTER_KEYS = ['status', 'from', 'to', 'all_fy'] as const

/**
 * The sheet's columns. Both totals are named for the side they come from, and
 * the difference states its own direction, because a printed reconciliation
 * whose sign convention is implied is a document two readers will argue over.
 */
const EXPORT_COLUMNS: ExportableColumn<ReconciliationRun>[] = [
  { key: 'run_id', csvHeader: 'Run', align: 'right', format: 'int' },
  { key: 'as_of_date', csvHeader: 'As at', format: 'date' },
  { key: 'created_at', csvHeader: 'Run at', format: 'datetime' },
  { key: 'status', csvHeader: 'Status', csv: (r) => humanize(r.status) },
  { key: 'inventory_closing_qty', csvHeader: 'Inventory closing qty', align: 'right', format: 'qty' },
  { key: 'inventory_closing_value', csvHeader: 'Inventory closing value (valuation)', align: 'right', format: 'amount' },
  { key: 'books_stock_ledger_balance', csvHeader: 'Books stock ledger balance', align: 'right', format: 'amount' },
  { key: 'difference', csvHeader: 'Difference (Inventory − Books)', align: 'right', format: 'amount' },
  // The screen and the file say the same words for the same cell. A run with no
  // actor is one nobody was recorded for — NOT a scheduled run: there is no
  // scheduler in this deployment, which is what the explainer above the table
  // says in as many words.
  { key: 'requested_by', csvHeader: 'Requested by', csv: (r) => r.requested_by ?? NO_ACTOR },
]
const STATUS_TONE: Record<string, 'good' | 'critical' | 'warning'> = { COMPLETED: 'good', FAILED: 'critical', BOOKS_UNAVAILABLE: 'warning' }

/** What the By column says when `requested_by` is null. Screen and sheet alike. */
const NO_ACTOR = 'Not recorded'

export function differenceTone(difference: number | null): 'good' | 'warning' | 'critical' | 'neutral' {
  if (difference === null) return 'neutral'
  const abs = Math.abs(difference)
  return abs < 0.005 ? 'good' : abs < 1 ? 'warning' : 'critical'
}

export function ReconciliationRunsPage() {
  const { scope } = useCompany()
  const toast = useToast()
  const navigate = useNavigate()
  const canRun = useCan(P.reconciliationResolve)
  const params = useListParams({ sort: 'created_at', order: 'desc', limit: 50, filterKeys: FILTER_KEYS })
  const { state, query } = params
  const list = useQuery((signal) => reconciliationApi.runs(query, signal), [JSON.stringify(query), scope?.cmp_id, scope?.fy_id, scope?.bo_id], { enabled: scope !== null })
  const [asOf, setAsOf] = useState(todayIso())
  const [running, setRunning] = useState(false)
  const fetchAll = useMemo(
    () => () => fetchAllRows<ReconciliationRun>((page, limit) => reconciliationApi.runs({ ...query, page, limit })),
    [query],
  )

  const runNow = async () => {
    setRunning(true)
    try {
      const run = await reconciliationApi.run(asOf)
      toast.success(`Reconciliation #${run.run_id} ${run.status.toLowerCase()} — difference ${formatMoney(run.difference)}.`)
      navigate(`/reconciliation/${run.run_id}`)
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Could not run the reconciliation.')
    } finally {
      setRunning(false)
    }
  }

  const columns = useMemo<Column<ReconciliationRun>[]>(
    () => [
      { key: 'run_id', header: '#', sortKey: 'run_id', render: (r) => <Link to={`/reconciliation/${r.run_id}`}>{r.run_id}</Link> },
      { key: 'as_of_date', header: 'As at', sortKey: 'as_of_date', render: (r) => formatDate(r.as_of_date) },
      { key: 'created_at', header: 'Run', sortKey: 'created_at', render: (r) => formatDateTime(r.created_at) },
      { key: 'status', header: 'Status', render: (r) => <StatusBadge value={r.status} tone={STATUS_TONE[r.status] ?? 'neutral'} /> },
      { key: 'inventory_closing_qty', header: 'Inventory qty', align: 'right', render: (r) => formatQty(r.inventory_closing_qty) },
      // The same qualifiers the sheet carries. Two right-aligned money columns
      // whose owner is implied, and a bare "Difference" whose sign convention is
      // stated only in the exported file, is a screen two readers argue over.
      { key: 'inventory_closing_value', header: 'Inventory value (valuation)', align: 'right', render: (r) => formatMoney(r.inventory_closing_value) },
      { key: 'books_stock_ledger_balance', header: 'Books stock ledger balance', align: 'right', render: (r) => formatMoney(r.books_stock_ledger_balance) },
      { key: 'difference', header: 'Difference (Inventory − Books)', align: 'right', sortKey: 'difference', render: (r) => <StatusBadge value={formatMoney(r.difference)} tone={differenceTone(r.difference)} /> },
      { key: 'requested_by', header: 'By', render: (r) => r.requested_by ?? <span className="muted">{NO_ACTOR}</span> },
    ],
    [],
  )

  return (
    <>
      <PageHeader
        title="Inventory ↔ Books reconciliation"
        subtitle="Each run compares Inventory's closing stock value with the Stock-in-Hand ledger in Books and explains the gap bucket by bucket. Runs are kept for the audit trail."
        actions={
          <>
            <ListSheetActions<ReconciliationRun>
              columns={EXPORT_COLUMNS}
              rows={list.data?.data ?? []}
              fetchAll={fetchAll}
              filenameBase="reconciliation-runs"
              title="Inventory ↔ Books reconciliation"
              description="Closing stock value compared with the Books Stock-in-Hand ledger, run by run"
              metaLines={[
                state.filters.status ? `Status: ${humanize(state.filters.status)}` : '',
                state.filters.from || state.filters.to ? `Run between: ${state.filters.from || '…'} and ${state.filters.to || '…'}` : '',
                state.filters.all_fy === '1' ? 'Years: all financial years' : '',
              ].filter(Boolean)}
              footerNotes={['Difference = Inventory closing value − Books stock ledger balance. Zero means the two agree at that date.']}
              onRefresh={list.reload}
              refreshing={list.loading}
              disabled={!list.data || list.data.meta.total === 0}
            />
            {canRun ? (
              <span className="inline-form">
                <input className="input date" type="date" value={asOf} onChange={(e) => setAsOf(e.target.value)} aria-label="As at" />
                <button type="button" className="btn btn-primary" disabled={running || !asOf} onClick={runNow}>
                  {running ? 'Running…' : 'Run now'}
                </button>
              </span>
            ) : null}
          </>
        }
      />
      <RequirePermission permission={P.reconciliationRead} what="reconciliation runs">
        <ReconciliationExplainer screen="runs" />
        <div className="toolbar">
          <select className="select" value={state.filters.status ?? ''} onChange={(e) => params.setFilter('status', e.target.value)} aria-label="Status">
            <option value="">All statuses</option>
            {RECONCILIATION_STATUSES.map((s) => (
              <option key={s} value={s}>
                {s.replace(/_/g, ' ')}
              </option>
            ))}
          </select>
          <input className="input date" type="date" value={state.filters.from ?? ''} onChange={(e) => params.setFilter('from', e.target.value)} aria-label="From" />
          <input className="input date" type="date" value={state.filters.to ?? ''} onChange={(e) => params.setFilter('to', e.target.value)} aria-label="To" />
          <label className="checkbox">
            <input type="checkbox" checked={state.filters.all_fy === '1'} onChange={(e) => params.setFilter('all_fy', e.target.checked ? '1' : '')} /> All years
          </label>
        </div>
        <DataTable columns={columns} rows={list.data?.data ?? []} rowKey={(r) => r.run_id} loading={list.loading} error={list.error} emptyMessage="No reconciliation has been run yet." sort={{ key: state.sort, order: state.order }} onSort={params.toggleSort} onRowClick={(r) => navigate(`/reconciliation/${r.run_id}`)} />
        <Pagination meta={list.data?.meta ?? null} onPage={params.setPage} onLimit={params.setLimit} limit={state.limit} />
      </RequirePermission>
    </>
  )
}
