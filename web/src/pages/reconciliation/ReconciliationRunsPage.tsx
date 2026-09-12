import { useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useCan } from '../../access/AccessContext'
import { useCompany } from '../../company/CompanyContext'
import { DataTable } from '../../components/DataTable'
import type { Column } from '../../components/DataTable'
import { PageHeader } from '../../components/PageHeader'
import { Pagination } from '../../components/Pagination'
import { RequirePermission } from '../../components/RequirePermission'
import { StatusBadge } from '../../components/StatusBadge'
import { useListParams } from '../../hooks/useListParams'
import { useQuery } from '../../hooks/useQuery'
import { P } from '../../services/access'
import { ApiError } from '../../services/api'
import { RECONCILIATION_STATUSES, reconciliationApi } from '../../services/reconciliationApi'
import type { ReconciliationRun } from '../../services/reconciliationApi'
import { useToast } from '../../ui/ToastContext'
import { formatDate, formatDateTime, formatMoney, formatQty, todayIso } from '../../utils/format'
import '../views.css'

const FILTER_KEYS = ['status', 'from', 'to', 'all_fy'] as const
const STATUS_TONE: Record<string, 'good' | 'critical' | 'warning'> = { COMPLETED: 'good', FAILED: 'critical', BOOKS_UNAVAILABLE: 'warning' }

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
      { key: 'inventory_closing_value', header: 'Inventory value', align: 'right', render: (r) => formatMoney(r.inventory_closing_value) },
      { key: 'books_stock_ledger_balance', header: 'Books stock ledger', align: 'right', render: (r) => formatMoney(r.books_stock_ledger_balance) },
      { key: 'difference', header: 'Difference', align: 'right', sortKey: 'difference', render: (r) => <StatusBadge value={formatMoney(r.difference)} tone={differenceTone(r.difference)} /> },
      { key: 'requested_by', header: 'By', render: (r) => r.requested_by ?? <span className="muted">scheduled</span> },
    ],
    [],
  )

  return (
    <>
      <PageHeader
        title="Inventory ↔ Books reconciliation"
        subtitle="Each run compares Inventory's closing stock value with the Stock-in-Hand ledger in Books and explains the gap bucket by bucket. Runs are kept for the audit trail."
        actions={
          canRun ? (
            <span className="inline-form">
              <input className="input date" type="date" value={asOf} onChange={(e) => setAsOf(e.target.value)} aria-label="As at" />
              <button type="button" className="btn btn-primary" disabled={running || !asOf} onClick={runNow}>
                {running ? 'Running…' : 'Run now'}
              </button>
            </span>
          ) : null
        }
      />
      <RequirePermission permission={P.reconciliationRead} what="reconciliation runs">
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
