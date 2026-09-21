import { useMemo, useState } from 'react'
import { History, X } from 'lucide-react'
import { useCan } from '../../access/AccessContext'
import { useCompany } from '../../company/CompanyContext'
import { DataTable } from '../../components/DataTable'
import type { Column } from '../../components/DataTable'
import { JsonBlock } from '../../components/JsonBlock'
import { ListSheetActions } from '../../components/ListSheetActions'
import { Modal } from '../../components/Modal'
import { Pagination } from '../../components/Pagination'
import { RequirePermission } from '../../components/RequirePermission'
import { StatusBadge, statusBadgeLabel } from '../../components/StatusBadge'
import { useListParams } from '../../hooks/useListParams'
import { useQuery } from '../../hooks/useQuery'
import type { ExportableColumn } from '../../registers/registerCells'
import { P } from '../../services/access'
import { ApiError } from '../../services/api'
import { OUTBOX_STATUSES, integrationApi } from '../../services/integrationApi'
import type { OutboxEvent } from '../../services/integrationApi'
import { fetchAllRows } from '../../services/listAll'
import { Button } from '../../ui/Button'
import { Card } from '../../ui/Card'
import { Input } from '../../ui/Input'
import { Select } from '../../ui/Select'
import { BreadcrumbHeader } from '../../ui/shell/BreadcrumbHeader'
import { PageShell } from '../../ui/shell/PageShell'
import { useToast } from '../../ui/ToastContext'
import { useScopeLabel } from '../../company/useScopeLabel'
import { formatDateTime, formatInt } from '../../utils/format'
import { ReconciliationExplainer } from '../reconciliation/ReconciliationExplainer'
import { ReconciliationTabs } from '../reconciliation/ReconciliationTabs'
import '../views.css'

const FILTER_KEYS = ['status', 'event_type', 'aggregate_type', 'aggregate_id', 'target_app', 'from', 'to'] as const
const STATUS_TONE: Record<string, 'info' | 'good' | 'warning' | 'critical' | 'neutral'> = { PENDING: 'info', SENT: 'good', ACKED: 'good', FAILED: 'warning', DEAD: 'critical' }
/**
 * The sheet's columns — the delivery record, including the error text. An
 * outbox export exists so somebody can work through the failures away from the
 * screen, and a list of dead events without the reason they died is no use.
 */
const EXPORT_COLUMNS: ExportableColumn<OutboxEvent>[] = [
  { key: 'event_id', csvHeader: 'Event', align: 'right', format: 'int' },
  { key: 'created_at', csvHeader: 'Created', format: 'datetime' },
  // The screen shows the badge's words ("Dead", "Pending"); the file must not
  // show the raw token. `statusBadgeLabel` is the badge's own resolver.
  { key: 'status', csvHeader: 'Status', csv: (e) => statusBadgeLabel(e.status) },
  { key: 'event_type', csvHeader: 'Event type' },
  { key: 'aggregate', csvHeader: 'About', csv: (e) => `${e.aggregate_type} #${e.aggregate_id}` },
  { key: 'target_app', csvHeader: 'To' },
  { key: 'attempts', csvHeader: 'Attempts', align: 'right', format: 'int' },
  { key: 'next_attempt_at', csvHeader: 'Next try', format: 'datetime', csv: (e) => (e.status === 'PENDING' || e.status === 'FAILED' ? e.next_attempt_at ?? '' : '') },
  { key: 'sent_at', csvHeader: 'Sent', format: 'datetime' },
  { key: 'acked_at', csvHeader: 'Acknowledged', format: 'datetime' },
  { key: 'last_error', csvHeader: 'Last error', csv: (e) => e.last_error ?? '' },
]

export function OutboxPage() {
  const { scope } = useCompany()
  const scopeLabel = useScopeLabel()
  const toast = useToast()
  const canReplay = useCan(P.integrationReplay)
  const params = useListParams({ sort: 'created_at', order: 'desc', limit: 100, filterKeys: FILTER_KEYS })
  const { state, query } = params
  const list = useQuery((signal) => integrationApi.outbox(query, signal), [JSON.stringify(query), scope?.cmp_id], { enabled: scope !== null })
  const [busy, setBusy] = useState<number | 'dispatch' | null>(null)
  const [detail, setDetail] = useState<OutboxEvent | null>(null)
  const fetchAll = useMemo(
    () => () => fetchAllRows<OutboxEvent>((page, limit) => integrationApi.outbox({ ...query, page, limit })),
    [query],
  )

  const replay = async (ev: OutboxEvent) => {
    setBusy(ev.event_id)
    try {
      const next = await integrationApi.replay(ev.event_id)
      toast.success(`Event #${ev.event_id} queued again (${next.status}).`)
      list.reload()
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Could not replay the event.')
    } finally {
      setBusy(null)
    }
  }
  const dispatch = async () => {
    setBusy('dispatch')
    try {
      const r = await integrationApi.dispatch(200)
      toast.success(`Dispatched: ${formatInt(r.sent)} sent, ${formatInt(r.failed)} failed, ${formatInt(r.dead)} dead, ${formatInt(r.skipped)} skipped.`)
      list.reload()
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Dispatch failed.')
    } finally {
      setBusy(null)
    }
  }

  const columns = useMemo<Column<OutboxEvent>[]>(
    () => [
      { key: 'event_id', header: '#', sortKey: 'event_id', render: (r) => <button type="button" className="link" onClick={() => setDetail(r)}>{r.event_id}</button> },
      { key: 'created_at', header: 'Created', sortKey: 'created_at', render: (r) => formatDateTime(r.created_at) },
      { key: 'status', header: 'Status', sortKey: 'status', render: (r) => <StatusBadge value={r.status} tone={STATUS_TONE[r.status] ?? 'neutral'} /> },
      { key: 'event_type', header: 'Event', sortKey: 'event_type', render: (r) => <code>{r.event_type}</code> },
      { key: 'aggregate', header: 'About', render: (r) => `${r.aggregate_type} #${r.aggregate_id}` },
      { key: 'target_app', header: 'To', render: (r) => r.target_app },
      { key: 'attempts', header: 'Attempts', align: 'right', render: (r) => formatInt(r.attempts) },
      { key: 'next_attempt_at', header: 'Next try', render: (r) => (r.status === 'PENDING' || r.status === 'FAILED' ? formatDateTime(r.next_attempt_at) : '—') },
      { key: 'sent_at', header: 'Sent', render: (r) => formatDateTime(r.sent_at) },
      { key: 'acked_at', header: 'Acknowledged', render: (r) => formatDateTime(r.acked_at) },
      { key: 'last_error', header: 'Last error', render: (r) => (r.last_error ? <span className="text-critical">{r.last_error}</span> : <span className="muted">—</span>) },
    ],
    [],
  )

  return (
    <PageShell fullBleed>
      <BreadcrumbHeader
        breadcrumbs={[
          { label: 'Inventory', to: '/' },
          { label: 'Reconciliation', to: '/reconciliation' },
          { label: 'Audit Trail' },
        ]}
        icon={History}
        title="Audit Trail"
        description="The outbox events behind every reconciliation: everything Inventory tells Books — postings, reversals, valuation revisions, master changes — with delivery attempts. DEAD events exhausted their retries and need a replay once the cause is fixed."
        meta={<span className="text-[11px] text-gray-500">{scopeLabel}</span>}
        escBack={false}
        actions={
          <>
            <ListSheetActions<OutboxEvent>
              columns={EXPORT_COLUMNS}
              rows={list.data?.data ?? []}
              fetchAll={fetchAll}
              filenameBase="outbox-events"
              title="Outbox events"
              description="Everything Inventory has told Books, with its delivery attempts"
              metaLines={[
                state.filters.status ? `Status: ${state.filters.status}` : '',
                state.filters.event_type ? `Event type: ${state.filters.event_type}` : '',
                state.filters.aggregate_type ? `About: ${state.filters.aggregate_type}${state.filters.aggregate_id ? ` #${state.filters.aggregate_id}` : ''}` : '',
                state.filters.from || state.filters.to ? `Created between: ${state.filters.from || '…'} and ${state.filters.to || '…'}` : '',
              ].filter(Boolean)}
              footerNotes={['Nothing is dispatched on a schedule in this deployment: pending events move on the next dispatch or the next posting.']}
              onRefresh={list.reload}
              refreshing={list.loading}
              disabled={!list.data || list.data.meta.total === 0}
            />
            {canReplay ? <button type="button" className="btn" disabled={busy === 'dispatch'} onClick={dispatch}>{busy === 'dispatch' ? 'Dispatching…' : 'Dispatch due events now'}</button> : null}
          </>
        }
      />
      <RequirePermission permission={P.integrationRead} what="outbox events">
        <ReconciliationTabs />
        <ReconciliationExplainer screen="outbox" />
        <Card padding="none" className="print:hidden">
          <div className="flex flex-wrap items-end gap-2 px-3 py-2.5">
            <label className="flex flex-col gap-1">
              <span className="text-[11px] font-semibold uppercase tracking-wide text-gray-500">Status</span>
              <Select size="md" className="min-w-[10rem]" value={state.filters.status ?? ''} onChange={(e) => params.setFilter('status', e.target.value)}>
                <option value="">All statuses</option>
                {OUTBOX_STATUSES.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </Select>
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-[11px] font-semibold uppercase tracking-wide text-gray-500">Event type</span>
              <Input size="md" className="w-[16rem]" placeholder="inventory.document.posted…" value={state.filters.event_type ?? ''} onChange={(e) => params.setFilter('event_type', e.target.value)} />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-[11px] font-semibold uppercase tracking-wide text-gray-500">Aggregate type</span>
              <Input size="md" className="w-[9rem]" placeholder="document" value={state.filters.aggregate_type ?? ''} onChange={(e) => params.setFilter('aggregate_type', e.target.value)} />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-[11px] font-semibold uppercase tracking-wide text-gray-500">Aggregate id</span>
              <Input size="md" className="w-[7rem]" inputMode="numeric" placeholder="e.g. 91" value={state.filters.aggregate_id ?? ''} onChange={(e) => params.setFilter('aggregate_id', e.target.value.replace(/[^\d]/g, ''))} />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-[11px] font-semibold uppercase tracking-wide text-gray-500">Created from</span>
              <Input size="md" className="w-[9.5rem]" type="date" value={state.filters.from ?? ''} onChange={(e) => params.setFilter('from', e.target.value)} />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-[11px] font-semibold uppercase tracking-wide text-gray-500">Created to</span>
              <Input size="md" className="w-[9.5rem]" type="date" value={state.filters.to ?? ''} onChange={(e) => params.setFilter('to', e.target.value)} />
            </label>
            {Object.keys(state.filters).length > 0 ? (
              <Button variant="ghost" size="md" icon={X} className="ml-auto" onClick={params.reset}>
                Clear
              </Button>
            ) : null}
          </div>
        </Card>
        <DataTable
          columns={columns}
          rows={list.data?.data ?? []}
          rowKey={(r) => r.event_id}
          loading={list.loading}
          error={list.error}
          emptyMessage="No events."
          sort={{ key: state.sort, order: state.order }}
          onSort={params.toggleSort}
          rowClassName={(r) => (r.status === 'DEAD' ? 'row-critical' : r.status === 'FAILED' ? 'row-warning' : undefined)}
          rowActions={(r) => (canReplay && (r.status === 'FAILED' || r.status === 'DEAD') ? <button type="button" className="btn btn-sm" disabled={busy === r.event_id} onClick={() => replay(r)}>{busy === r.event_id ? 'Replaying…' : 'Replay'}</button> : null)}
        />
        <Pagination meta={list.data?.meta ?? null} onPage={params.setPage} onLimit={params.setLimit} limit={state.limit} />
      </RequirePermission>
      <Modal open={detail !== null} title={detail ? `Event #${detail.event_id} — ${detail.event_type}` : ''} onClose={() => setDetail(null)} size="lg">
        {detail ? <JsonBlock value={detail} label="Event" open /> : null}
      </Modal>
    </PageShell>
  )
}
