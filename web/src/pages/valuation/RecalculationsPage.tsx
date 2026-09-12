import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useCan } from '../../access/AccessContext'
import { useCompany } from '../../company/CompanyContext'
import { DataTable } from '../../components/DataTable'
import type { Column } from '../../components/DataTable'
import { FormField } from '../../components/FormField'
import { ItemFilter } from '../../components/ItemFilter'
import { JsonBlock } from '../../components/JsonBlock'
import { Modal } from '../../components/Modal'
import { PageHeader } from '../../components/PageHeader'
import { Pagination } from '../../components/Pagination'
import { RequirePermission } from '../../components/RequirePermission'
import { StatusBadge } from '../../components/StatusBadge'
import { useListParams } from '../../hooks/useListParams'
import { useQuery } from '../../hooks/useQuery'
import { P } from '../../services/access'
import { ApiError } from '../../services/api'
import { RECALC_STATUSES, valuationApi } from '../../services/valuationApi'
import type { RecalcJob } from '../../services/valuationApi'
import { useToast } from '../../ui/ToastContext'
import { formatDate, formatDateTime, formatInt, formatMoney, todayIso } from '../../utils/format'
import '../views.css'

const FILTER_KEYS = ['status', 'item_id', 'trigger_kind', 'from', 'to', 'all_fy'] as const
const STATUS_TONE: Record<string, 'neutral' | 'good' | 'warning' | 'critical' | 'info'> = { QUEUED: 'info', RUNNING: 'warning', COMPLETED: 'good', FAILED: 'critical', CANCELLED: 'neutral' }

export function RecalculationsPage() {
  const { scope } = useCompany()
  const toast = useToast()
  const canRun = useCan(P.valuationRecalculate)
  const params = useListParams({ sort: 'created_at', order: 'desc', limit: 50, filterKeys: FILTER_KEYS })
  const { state, query } = params
  const list = useQuery((signal) => valuationApi.recalcJobs(query, signal), [JSON.stringify(query), scope?.cmp_id, scope?.fy_id, scope?.bo_id], { enabled: scope !== null })
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState<number | 'new' | null>(null)
  const [detail, setDetail] = useState<RecalcJob | null>(null)
  const [form, setForm] = useState({ from_date: todayIso(), item_id: '', dry_run: true, run_now: true })

  const runJob = async (job: RecalcJob) => {
    setBusy(job.job_id)
    try {
      const done = await valuationApi.runRecalc(job.job_id)
      toast.success(`Recalculation #${job.job_id} ${done.status.toLowerCase()}: ${formatInt(done.revised_line_count ?? 0)} lines revised, COGS delta ${formatMoney(done.cogs_delta)}.`)
      list.reload()
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Could not run the recalculation.')
    } finally {
      setBusy(null)
    }
  }
  const enqueue = async () => {
    setBusy('new')
    try {
      const job = await valuationApi.enqueueRecalc({ from_date: form.from_date, item_id: form.item_id ? Number(form.item_id) : null, dry_run: form.dry_run, run_now: form.run_now })
      toast.success(`Recalculation #${job.job_id} ${job.status.toLowerCase()}${job.dry_run ? ' (dry run)' : ''}.`)
      setOpen(false)
      list.reload()
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Could not queue the recalculation.')
    } finally {
      setBusy(null)
    }
  }

  const columns = useMemo<Column<RecalcJob>[]>(
    () => [
      { key: 'job_id', header: '#', sortKey: 'job_id', render: (r) => <button type="button" className="link" onClick={() => setDetail(r)}>{r.job_id}</button> },
      { key: 'created_at', header: 'Queued', sortKey: 'created_at', render: (r) => formatDateTime(r.created_at) },
      { key: 'status', header: 'Status', sortKey: 'status', render: (r) => <StatusBadge value={r.status} tone={STATUS_TONE[r.status] ?? 'neutral'} /> },
      { key: 'dry_run', header: 'Mode', render: (r) => (r.dry_run ? <span className="muted">dry run</span> : 'live') },
      { key: 'from_date', header: 'From', sortKey: 'from_date', render: (r) => formatDate(r.from_date) },
      { key: 'item_name', header: 'Scope', render: (r) => (r.item_id ? <Link to={`/valuation/cost-layers?item_id=${r.item_id}`}>{r.item_name ?? `Item #${r.item_id}`}</Link> : <span className="muted">all items</span>) },
      { key: 'trigger_kind', header: 'Trigger', render: (r) => <span>{r.trigger_kind.replace(/_/g, ' ')}{r.trigger_document_id ? <> · <Link to={`/documents/${r.trigger_document_id}`}>{r.trigger_document_no ?? `#${r.trigger_document_id}`}</Link></> : null}</span> },
      { key: 'affected_line_count', header: 'Affected', align: 'right', render: (r) => formatInt(r.affected_line_count ?? 0) },
      { key: 'revised_line_count', header: 'Revised', align: 'right', render: (r) => formatInt(r.revised_line_count ?? 0) },
      { key: 'cogs_delta', header: 'COGS delta', align: 'right', sortKey: 'cogs_delta', render: (r) => <strong>{formatMoney(r.cogs_delta)}</strong> },
      { key: 'finished_at', header: 'Finished', render: (r) => formatDateTime(r.finished_at) },
      { key: 'failure_reason', header: 'Failure', render: (r) => r.failure_reason ?? <span className="muted">—</span> },
    ],
    [],
  )

  return (
    <>
      <PageHeader
        title="Valuation recalculations"
        subtitle="Back-dated receipts and edits re-run the costing from a date forward. Each job records the lines whose valuation changed and publishes the COGS revisions Books applies."
        actions={canRun ? <button type="button" className="btn btn-primary" onClick={() => setOpen(true)}>New recalculation</button> : null}
      />
      <RequirePermission permission={P.report('valuation')} what="recalculations">
        <div className="toolbar">
          <select className="select" value={state.filters.status ?? ''} onChange={(e) => params.setFilter('status', e.target.value)} aria-label="Status">
            <option value="">All statuses</option>
            {RECALC_STATUSES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
          <ItemFilter value={state.filters.item_id ?? ''} onChange={(id) => params.setFilter('item_id', id)} />
          <input className="input date" type="date" value={state.filters.from ?? ''} onChange={(e) => params.setFilter('from', e.target.value)} aria-label="Queued from" />
          <input className="input date" type="date" value={state.filters.to ?? ''} onChange={(e) => params.setFilter('to', e.target.value)} aria-label="Queued to" />
          <label className="checkbox">
            <input type="checkbox" checked={state.filters.all_fy === '1'} onChange={(e) => params.setFilter('all_fy', e.target.checked ? '1' : '')} /> All years
          </label>
          <button type="button" className="btn btn-sm" onClick={list.reload} disabled={list.loading}>
            Refresh
          </button>
        </div>
        <DataTable
          columns={columns}
          rows={list.data?.data ?? []}
          rowKey={(r) => r.job_id}
          loading={list.loading}
          error={list.error}
          emptyMessage="No recalculation jobs."
          sort={{ key: state.sort, order: state.order }}
          onSort={params.toggleSort}
          rowActions={(r) => (canRun && r.status === 'QUEUED' ? <button type="button" className="btn btn-sm" disabled={busy === r.job_id} onClick={() => runJob(r)}>{busy === r.job_id ? 'Running…' : 'Run now'}</button> : null)}
        />
        <Pagination meta={list.data?.meta ?? null} onPage={params.setPage} onLimit={params.setLimit} limit={state.limit} />
      </RequirePermission>

      <Modal open={open} title="New recalculation" onClose={() => setOpen(false)} busy={busy === 'new'} footer={<><button type="button" className="btn" onClick={() => setOpen(false)}>Cancel</button><button type="button" className="btn btn-primary" disabled={busy === 'new' || !form.from_date} onClick={enqueue}>{form.dry_run ? 'Preview' : 'Recalculate'}</button></>}>
        <div className="form-grid">
          <FormField label="Recalculate from" htmlFor="recalc-from" required help="Every movement on or after this date is re-costed in order.">
            <input id="recalc-from" className="input" type="date" value={form.from_date} onChange={(e) => setForm({ ...form, from_date: e.target.value })} />
          </FormField>
          <FormField label="Item" htmlFor="recalc-item" help="Leave empty to recalculate every item.">
            <ItemFilter id="recalc-item" value={form.item_id} onChange={(id) => setForm({ ...form, item_id: id })} placeholder="All items" />
          </FormField>
          <label className="checkbox span-2">
            <input type="checkbox" checked={form.dry_run} onChange={(e) => setForm({ ...form, dry_run: e.target.checked })} /> Dry run — report what would change without writing revisions
          </label>
          <label className="checkbox span-2">
            <input type="checkbox" checked={form.run_now} onChange={(e) => setForm({ ...form, run_now: e.target.checked })} /> Run immediately (otherwise the worker picks it up)
          </label>
        </div>
      </Modal>

      <Modal open={detail !== null} title={detail ? `Recalculation #${detail.job_id}` : ''} onClose={() => setDetail(null)} size="lg">
        {detail ? (
          <div className="stack">
            <p>
              <StatusBadge value={detail.status} tone={STATUS_TONE[detail.status] ?? 'neutral'} /> {detail.dry_run ? 'Dry run' : 'Live run'} from {formatDate(detail.from_date)}{detail.to_date ? ` to ${formatDate(detail.to_date)}` : ''}; requested by {detail.requested_by ?? 'system'} at {formatDateTime(detail.created_at)}.
            </p>
            <p>
              {formatInt(detail.affected_line_count ?? 0)} lines examined, {formatInt(detail.revised_line_count ?? 0)} revised, COGS delta <strong>{formatMoney(detail.cogs_delta)}</strong>.
              {detail.revision_summary ? ` ${formatInt(detail.revision_summary.revisions)} revisions published, ${formatInt(detail.revision_summary.unacknowledged)} awaiting Books.` : ''}
            </p>
            {detail.failure_reason ? <p className="text-critical">{detail.failure_reason}</p> : null}
            {detail.affected_document_ids?.length ? (
              <p>
                Documents: {detail.affected_document_ids.slice(0, 40).map((id, i) => (<span key={id}>{i > 0 ? ', ' : ''}<Link to={`/documents/${id}`}>#{id}</Link></span>))}{detail.affected_document_ids.length > 40 ? ` … and ${detail.affected_document_ids.length - 40} more` : ''}
              </p>
            ) : null}
            <Link to={`/valuation/revisions?job_id=${detail.job_id}`}>Open the revisions of this job</Link>
            <JsonBlock value={detail} label="Raw job" />
          </div>
        ) : null}
      </Modal>
    </>
  )
}
