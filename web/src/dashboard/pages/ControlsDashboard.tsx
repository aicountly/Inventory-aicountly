import { useCallback, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  AlertOctagon,
  BookOpen,
  CheckCircle2,
  ClipboardCheck,
  History,
  Link2,
  PlayCircle,
  ShieldAlert,
  Truck,
} from 'lucide-react'
import { useAccess } from '../../access/AccessContext'
import { useCompany } from '../../company/CompanyContext'
import { useQuery } from '../../hooks/useQuery'
import { P } from '../../services/access'
import { auditApi } from '../../services/auditApi'
import type { AuditLogRow } from '../../services/auditApi'
import { documentsApi } from '../../services/documentsApi'
import type { DocumentListRow } from '../../documents/types'
import { reconciliationApi } from '../../services/reconciliationApi'
import { errorMessage } from '../../services/api'
import { Badge } from '../../ui/Badge'
import { Button } from '../../ui/Button'
import { Notice } from '../../components/Notice'
import { notify } from '../../ui/notify'
import { formatDate, formatDateTime, humanize, todayIso } from '../../utils/format'
import { assertScope, fetchControls } from '../aggregatesApi'
import type { ExceptionRow } from '../aggregatesApi'
import { DashboardPageHeader } from '../components/DashboardPageHeader'
import { MetricCard } from '../components/MetricCard'
import { MiniTable } from '../components/MiniTable'
import { PulseBriefing } from '../components/PulseBriefing'
import { WidgetCard } from '../components/WidgetCard'
import { exportDashboardPdf } from '../dashboardExport'
import { formatCount, formatCurrencyCompact, relativeTimeFromNow } from '../formatters'
import { drill } from '../kpiNavigation'
import { buildPulseFindings } from '../pulse'
import { useSyncStamp } from '../useSyncStamp'
import {
  RECONCILIATION_TONE,
  reconciliationVerdict,
  severityTone,
  ageInDays,
} from '../controlsModel'
import type { DashboardSectionProps } from './types'

const PANEL_ROWS = 6

/**
 * Dashboard 5 — exceptions, approvals and the Inventory ↔ Books reconciliation.
 *
 * The rule the whole screen turns on: **a reconciliation that could not ask
 * Books is not a reconciliation that found no difference.** `BOOKS_UNAVAILABLE`
 * renders as "Unavailable", never as a zero difference and never as a green
 * tick — those two states look identical on a card and mean opposite things,
 * and one of them tells a controller to stand down on a problem that is still
 * there. `reconciliationVerdict` in controlsModel.ts is where that is decided,
 * so it is decided once and tested.
 */
export function ControlsDashboard({ scope, view }: DashboardSectionProps) {
  const { companyName, fy, branch } = useCompany()
  const { can } = useAccess()
  const [exporting, setExporting] = useState(false)
  const [running, setRunning] = useState(false)

  const expected = scope.scope
  const enabled = scope.ready
  const canReconciliation = can(P.reconciliationRead)
  const canRunReconciliation = can(P.reconciliationResolve)
  const canDocuments = can(P.documentsRead)
  const canAudit = can(P.auditRead)

  const controls = useQuery(
    async (signal) => {
      const envelope = await fetchControls(signal)
      return expected ? assertScope(envelope, expected) : envelope
    },
    [scope.scopeKey],
    { enabled: enabled && can(P.dashboard), resetKey: scope.scopeKey },
  )

  const runs = useQuery(
    (signal) => reconciliationApi.runs({ limit: 1, sort: 'created_at', order: 'desc' }, signal),
    [scope.scopeKey],
    { enabled: enabled && canReconciliation, resetKey: scope.scopeKey },
  )

  const approvals = useQuery(
    (signal) => documentsApi.list({ status: 'PENDING_APPROVAL', limit: PANEL_ROWS, sort: 'document_date', order: 'asc' }, signal),
    [scope.scopeKey],
    { enabled: enabled && canDocuments, resetKey: scope.scopeKey },
  )

  const audit = useQuery(
    (signal) => auditApi.list({ limit: PANEL_ROWS, sort: 'created_at', order: 'desc' }, signal),
    [scope.scopeKey],
    { enabled: enabled && canAudit, resetKey: scope.scopeKey },
  )

  const queries = [controls, runs, approvals, audit]
  const refreshing = queries.some((q) => q.loading)
  const lastSyncedAt = useSyncStamp(refreshing)
  const reloadsRef = useRef<(() => void)[]>([])
  reloadsRef.current = queries.map((q) => q.reload)
  const refreshAll = useCallback(() => {
    for (const reload of reloadsRef.current) reload()
  }, [])

  const data = controls.data?.data ?? null
  const lastRun = runs.data?.data[0] ?? null
  const verdict = useMemo(() => reconciliationVerdict(lastRun), [lastRun])

  const openExceptions = useMemo(
    () => (data?.exceptions ?? []).filter((e) => e.issues > 0),
    [data],
  )

  const findings = useMemo(
    () =>
      buildPulseFindings({
        outboxFailed: data?.delivery.failed ?? null,
        outboxPending: data?.delivery.pending ?? null,
        pendingApproval: data?.approvals.pending ?? null,
        reconciliationDifference: verdict.difference,
        reconciliationStatus: lastRun?.status ?? null,
      }),
    [data, verdict, lastRun],
  )

  /**
   * Run the reconciliation.
   *
   * Explicit and user-initiated only. Rendering a dashboard must never mutate
   * anything, so this lives behind a button, behind a permission, and is
   * guarded against a double press producing two runs.
   */
  const onRun = useCallback(async () => {
    if (running) return
    setRunning(true)
    try {
      await reconciliationApi.run(scope.asOf)
      notify.success('Reconciliation complete. The figures below have been refreshed.')
      refreshAll()
    } catch (err) {
      notify.error(errorMessage(err))
    } finally {
      setRunning(false)
    }
  }, [running, scope.asOf, refreshAll])

  const onExport = useCallback(() => {
    setExporting(true)
    try {
      exportDashboardPdf({
        title: 'Controls and reconciliation',
        description: view.description,
        companyName,
        fyLabel: fy?.label ?? 'Financial year',
        branchLabel: branch ? branch.name : 'All branches',
        warehouseLabel: 'All warehouses (controls are company and branch scoped)',
        asOf: scope.asOf,
        generatedAt: controls.data?.meta.generated_at ?? null,
        metrics: [
          ['Open exception kinds', data ? formatCount(data.open_exception_kinds) : null, data?.exception_counting_rule ?? ''],
          ['Pending approvals', data ? formatCount(data.approvals.pending) : null, 'Documents submitted and waiting for an approver.'],
          ['Books delivery pending', data ? formatCount(data.delivery.pending) : null, 'Events queued or sent but not yet acknowledged by Books.'],
          ['Last reconciliation', verdict.headline, verdict.explanation],
        ],
        tables: [
          {
            title: 'Exception register',
            note: data?.exception_counting_rule,
            numericColumns: [2],
            columns: ['Severity', 'Issue', 'Issues', 'Counted in', 'Detail'],
            rows: (data?.exceptions ?? []).map((e) => [
              e.severity,
              e.label,
              formatCount(e.issues),
              e.scope,
              e.detail,
            ]),
          },
          {
            title: 'Inventory ↔ Books reconciliation',
            note: verdict.explanation,
            numericColumns: [1],
            columns: ['Figure', 'Amount', 'Basis'],
            rows: lastRun
              ? [
                  ['Inventory closing value', formatCurrencyCompact(lastRun.inventory_closing_value), 'Valuation walk at cost, as at the run date'],
                  ['Books stock ledger balance', lastRun.books_stock_ledger_balance === null ? 'Unavailable' : formatCurrencyCompact(lastRun.books_stock_ledger_balance), 'Balance of the mapped inventory-control account in Books'],
                  ['Difference', lastRun.difference === null ? 'Unknown — Books was not reachable' : formatCurrencyCompact(lastRun.difference), 'Inventory minus Books. Positive means Books is lower.'],
                  ['Run status', humanize(lastRun.status), `Run at ${formatDateTime(lastRun.created_at)} for ${formatDate(lastRun.as_of_date)}`],
                ]
              : [],
          },
          {
            title: 'Approval inbox',
            note:
              data && approvals.data && approvals.data.data.length < data.approvals.pending
                ? `Showing ${approvals.data.data.length} of ${data.approvals.pending} pending documents.`
                : undefined,
            columns: ['Document', 'Type', 'Dated', 'Waiting', 'Party'],
            rows: (approvals.data?.data ?? []).map((d) => [
              d.document_no ?? `#${d.document_id}`,
              d.document_type_label ?? d.document_type,
              formatDate(d.document_date),
              `${ageInDays(d.document_date)} days`,
              d.party_name ?? '—',
            ]),
          },
          {
            title: 'Books delivery health',
            numericColumns: [1],
            columns: ['Status', 'Events'],
            rows: Object.entries(data?.delivery.by_status ?? {}).map(([status, n]) => [humanize(status), formatCount(n)]),
          },
        ],
        notes: [
          'Reconciliation compares the inventory valuation at cost against the mapped inventory-control account balance in Books, on the same company, branch and cut-off. It does not compare inventory cost with sales revenue, purchase invoice totals, taxes or receivables.',
          'Sign convention: difference = inventory minus Books. A positive difference means Books carries less than Inventory.',
          verdict.explanation,
          data?.exception_counting_rule ?? '',
          'Issues are counted in the unit each row names — rows, documents, lines, events — and are never added across kinds into one "items" figure, because a single item can raise several.',
        ].filter(Boolean),
      })
    } finally {
      setExporting(false)
    }
  }, [view, companyName, fy, branch, scope.asOf, controls.data, data, verdict, lastRun, approvals.data])

  return (
    <div className="space-y-3">
      <DashboardPageHeader
        title="Controls and reconciliation"
        description={view.description}
        companyName={companyName}
        fyLabel={fy?.label ?? 'Financial year'}
        branchLabel={branch ? branch.name : 'All branches'}
        asOf={scope.asOf}
        onAsOf={scope.setAsOf}
        maxDate={todayIso()}
        warehouses={scope.warehouses}
        warehouseId={scope.effectiveWarehouseId}
        onWarehouseId={scope.setWarehouseId}
        warehouseDropped={scope.warehouseDropped}
        refreshing={refreshing}
        onRefresh={refreshAll}
        lastSyncedAt={lastSyncedAt}
        onExport={onExport}
        exporting={exporting}
        actions={
          canRunReconciliation ? (
            <Button size="sm" icon={PlayCircle} onClick={onRun} disabled={running}>
              {running ? 'Running…' : 'Run reconciliation'}
            </Button>
          ) : null
        }
      />

      <PulseBriefing
        findings={findings}
        anyDataKnown={data !== null || lastRun !== null}
        lastSyncedAt={lastSyncedAt}
        reviewTo={canReconciliation ? '/reconciliation' : undefined}
        reviewLabel="Open reconciliation"
      />

      <section aria-label="Control summary" className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <MetricCard
          label="Open exceptions"
          value={data ? formatCount(data.open_exception_kinds) : null}
          numeric={data?.open_exception_kinds ?? null}
          definition={data?.exception_counting_rule ?? 'Exception kinds with at least one issue outstanding.'}
          hint={
            data
              ? `${formatCount(data.open_exception_issues)} issues across ${formatCount(data.open_exception_kinds)} kinds`
              : undefined
          }
          icon={ShieldAlert}
          tone="danger"
          loading={controls.loading && !data}
          error={controls.error}
          onRetry={controls.reload}
          badge={(data?.open_exception_kinds ?? 0) > 0 ? { label: 'Act now', tone: 'danger' } : undefined}
        />
        <MetricCard
          label="Pending approvals"
          value={data ? formatCount(data.approvals.pending) : null}
          numeric={data?.approvals.pending ?? null}
          definition="Documents submitted and waiting for an approver, across every type in this financial year."
          hint={
            data && data.approvals.approved_not_posted > 0
              ? `${formatCount(data.approvals.approved_not_posted)} approved but not yet posted`
              : undefined
          }
          icon={ClipboardCheck}
          tone="info"
          loading={controls.loading && !data}
          error={controls.error}
          onRetry={controls.reload}
          to={canDocuments ? drill.documents({ status: 'PENDING_APPROVAL' }) : undefined}
        />
        <MetricCard
          label="Books delivery pending"
          value={data ? formatCount(data.delivery.pending) : null}
          numeric={data?.delivery.pending ?? null}
          definition="Integration events queued or sent but not yet acknowledged by Books. Delivery is retried by the dispatcher; nothing is re-sent from this screen."
          hint={
            data
              ? data.delivery.failed > 0
                ? `${formatCount(data.delivery.failed)} failed`
                : `Last delivered ${relativeTimeFromNow(data.delivery.last_delivered_at)}`
              : undefined
          }
          icon={Truck}
          tone={data && data.delivery.failed > 0 ? 'danger' : 'primary'}
          loading={controls.loading && !data}
          error={controls.error}
          onRetry={controls.reload}
          to="/integration/outbox"
          badge={(data?.delivery.failed ?? 0) > 0 ? { label: 'Failed', tone: 'danger' } : undefined}
        />
        {/* The card the whole screen turns on. "Books unreachable" renders as
            Unavailable, never as a zero difference and never as a green tick. */}
        <MetricCard
          label="Last reconciliation"
          value={verdict.headline}
          definition={verdict.explanation}
          state={verdict.state}
          reason={verdict.state === 'not_configured' ? verdict.explanation : undefined}
          hint={lastRun ? `${formatDateTime(lastRun.created_at)} · as at ${formatDate(lastRun.as_of_date)}` : undefined}
          icon={verdict.matched ? CheckCircle2 : AlertOctagon}
          tone={RECONCILIATION_TONE[verdict.kind]}
          loading={runs.loading && !runs.data}
          error={runs.error}
          onRetry={runs.reload}
          to={canReconciliation ? (lastRun ? drill.reconciliationRun(lastRun.run_id) : '/reconciliation') : undefined}
          badge={verdict.kind === 'unavailable' ? { label: 'Books unreachable', tone: 'warning' } : undefined}
        />
      </section>

      <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
        <WidgetCard
          title="Inventory ↔ Books reconciliation"
          description="Same company, branch and cut-off · inventory control account, at cost"
          icon={BookOpen}
          tone="primary"
          state={{
            loading: runs.loading && !runs.data,
            error: runs.error,
            empty: lastRun === null,
            reload: runs.reload,
          }}
          skeleton={<div className="skeleton h-44 rounded-lg" />}
          emptyTitle="No reconciliation has been run"
          emptyDescription="Run one to compare the inventory valuation against the Books stock ledger for this scope."
          emptyIcon={BookOpen}
          viewAll={canReconciliation ? { to: '/reconciliation', label: 'All runs' } : undefined}
          footer={
            <>
              <span className="block">{verdict.explanation}</span>
              <span className="mt-1 block">
                Difference is inventory minus Books; a positive figure means Books carries less. This compares
                inventory cost against the mapped inventory-control balance — never against sales revenue, invoice
                totals, taxes or receivables.
              </span>
            </>
          }
        >
          {lastRun ? (
            <div className="space-y-3">
              <div className="grid grid-cols-3 gap-2">
                {[
                  { label: 'Inventory closing', value: formatCurrencyCompact(lastRun.inventory_closing_value), hint: 'Valuation at cost' },
                  {
                    label: 'Books balance',
                    // Never "₹0.00" for an answer Books never gave.
                    value: lastRun.books_stock_ledger_balance === null ? 'Unavailable' : formatCurrencyCompact(lastRun.books_stock_ledger_balance),
                    hint: lastRun.books_stock_ledger_balance === null ? 'Books did not answer' : 'Inventory control account',
                  },
                  {
                    label: 'Difference',
                    value: lastRun.difference === null ? 'Unknown' : formatCurrencyCompact(lastRun.difference),
                    hint: lastRun.difference === null ? 'Cannot be computed' : 'Inventory − Books',
                  },
                ].map((cell) => (
                  <div key={cell.label} className="rounded-lg border border-gray-200 p-2">
                    <p className="text-[10px] uppercase tracking-wide text-gray-400">{cell.label}</p>
                    <p className="truncate text-sm font-semibold tabular-nums text-gray-900">{cell.value}</p>
                    <p className="truncate text-[10px] text-gray-500">{cell.hint}</p>
                  </div>
                ))}
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <Badge tone={verdict.kind === 'matched' ? 'success' : verdict.kind === 'unavailable' ? 'warning' : 'danger'} size="xs">
                  {verdict.statusLabel}
                </Badge>
                <span className="text-[11px] text-gray-500">
                  Run {formatDateTime(lastRun.created_at)}
                  {lastRun.requested_by ? ` by ${lastRun.requested_by}` : ''}
                </span>
              </div>

              {canReconciliation ? (
                <Link
                  to={drill.reconciliationRun(lastRun.run_id)}
                  className="inline-flex items-center gap-1 text-xs font-semibold text-primary print:hidden"
                >
                  Open the full breakdown
                </Link>
              ) : null}
            </div>
          ) : null}
        </WidgetCard>

        <WidgetCard
          title="Approval inbox"
          description="Documents waiting on a decision, oldest first"
          icon={ClipboardCheck}
          tone="info"
          state={{
            loading: approvals.loading && !approvals.data,
            error: approvals.error,
            empty: (approvals.data?.data.length ?? 0) === 0,
            reload: approvals.reload,
          }}
          skeleton={<div className="skeleton h-44 rounded-lg" />}
          emptyTitle="Nothing is waiting"
          emptyDescription="Submitted documents appear here until they are approved or rejected."
          emptyIcon={CheckCircle2}
          viewAll={canDocuments ? { to: drill.documents({ status: 'PENDING_APPROVAL' }), label: 'All approvals' } : undefined}
          footer={
            data && approvals.data && approvals.data.data.length < data.approvals.pending
              ? `Showing ${approvals.data.data.length} of ${formatCount(data.approvals.pending)} waiting`
              : undefined
          }
        >
          <MiniTable<DocumentListRow>
            caption="Documents pending approval, oldest first."
            rows={approvals.data?.data ?? []}
            rowKey={(d) => d.document_id}
            to={(d) => drill.document(d.document_id)}
            rowLabel={(d) => `${d.document_type_label ?? d.document_type} ${d.document_no ?? d.document_id}`}
            minWidth={460}
            columns={[
              {
                key: 'document',
                header: 'Document',
                render: (d) => (
                  <div className="min-w-0">
                    <p className="truncate text-xs font-medium text-gray-900">{d.document_no ?? `#${d.document_id}`}</p>
                    <p className="truncate text-[11px] text-gray-500">{d.document_type_label ?? d.document_type}</p>
                  </div>
                ),
              },
              {
                key: 'party',
                header: 'Party',
                render: (d) => <span className="text-xs text-gray-700">{d.party_name ?? '—'}</span>,
              },
              {
                key: 'age',
                header: 'Waiting',
                align: 'right',
                cellClassName: 'tabular-nums',
                render: (d) => {
                  const days = ageInDays(d.document_date)
                  return (
                    <Badge tone={days >= 7 ? 'danger' : days >= 3 ? 'warning' : 'neutral'} size="xs">
                      {days} d
                    </Badge>
                  )
                },
              },
              {
                key: 'dated',
                header: 'Dated',
                render: (d) => <span className="text-xs text-gray-600">{formatDate(d.document_date)}</span>,
              },
            ]}
          />
        </WidgetCard>
      </div>

      <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
        <WidgetCard
          title="Exception register"
          description="What is wrong, counted in the unit each row names"
          icon={ShieldAlert}
          tone="danger"
          state={{
            loading: controls.loading && !data,
            error: controls.error,
            empty: openExceptions.length === 0,
            reload: controls.reload,
          }}
          skeleton={<div className="skeleton h-44 rounded-lg" />}
          emptyTitle="No exceptions are open"
          emptyDescription="Negative stock, missing costs, failed postings, count variances and delivery failures all appear here."
          emptyIcon={CheckCircle2}
          footer={data?.exception_counting_rule}
        >
          <MiniTable<ExceptionRow>
            caption="Open exception kinds, with the number of issues in each and the unit they are counted in."
            rows={openExceptions}
            rowKey={(e) => e.key}
            to={(e) => e.path}
            rowLabel={(e) => `Investigate ${e.label}`}
            minWidth={480}
            columns={[
              {
                key: 'severity',
                header: 'Severity',
                render: (e) => (
                  <Badge tone={severityTone(e.severity)} size="xs">
                    {e.severity}
                  </Badge>
                ),
              },
              {
                key: 'issue',
                header: 'Issue',
                render: (e) => (
                  <div className="min-w-0">
                    <p className="truncate text-xs font-medium text-gray-900">{e.label}</p>
                    <p className="truncate text-[11px] text-gray-500" title={e.detail}>
                      {e.detail}
                    </p>
                  </div>
                ),
              },
              {
                key: 'issues',
                header: 'Issues',
                align: 'right',
                cellClassName: 'tabular-nums',
                render: (e) => (
                  <span className="text-xs font-semibold text-gray-900">
                    {/* The unit travels with the number. "3 issues" and
                        "3 unique items" are different claims and one item can
                        raise several. */}
                    {formatCount(e.issues)} {e.scope}
                  </span>
                ),
              },
            ]}
          />
        </WidgetCard>

        <WidgetCard
          title="Recent audit activity"
          description="Who did what, and what actually happened"
          icon={History}
          tone="slate"
          state={{
            loading: audit.loading && !audit.data,
            error: audit.error,
            empty: (audit.data?.data.length ?? 0) === 0,
            reload: audit.reload,
          }}
          skeleton={<div className="skeleton h-44 rounded-lg" />}
          emptyTitle="Nothing recorded yet"
          emptyDescription="Postings, approvals, reconciliations and master changes are all recorded here."
          emptyIcon={History}
          viewAll={canAudit ? { to: '/audit', label: 'Full audit log' } : undefined}
        >
          <MiniTable<AuditLogRow>
            caption="The most recent entries in the append-only audit log."
            rows={audit.data?.data ?? []}
            rowKey={(a) => a.audit_id}
            minWidth={460}
            columns={[
              {
                key: 'when',
                header: 'When',
                render: (a) => (
                  <div className="min-w-0">
                    <p className="truncate text-xs text-gray-900">{formatDateTime(a.created_at)}</p>
                    <p className="truncate text-[11px] text-gray-500">{relativeTimeFromNow(a.created_at)}</p>
                  </div>
                ),
              },
              {
                key: 'action',
                header: 'Action',
                render: (a) => (
                  <div className="min-w-0">
                    <p className="truncate text-xs font-medium text-gray-900">{humanize(a.action)}</p>
                    <p className="truncate text-[11px] text-gray-500">
                      {humanize(a.entity_type)} #{a.entity_id}
                    </p>
                  </div>
                ),
              },
              {
                key: 'actor',
                header: 'By',
                render: (a) => (
                  <span className="truncate text-xs text-gray-600">{a.actor_uuid ?? a.source_app ?? 'System'}</span>
                ),
              },
            ]}
          />
        </WidgetCard>
      </div>

      <WidgetCard
        title="Books delivery health"
        description="Inventory events on their way to Books"
        icon={Link2}
        tone="primary"
        state={{ loading: controls.loading && !data, error: controls.error, empty: false, reload: controls.reload }}
        skeleton={<div className="skeleton h-24 rounded-lg" />}
        viewAll={{ to: '/integration/outbox', label: 'Open the outbox' }}
        footer={
          <>
            {/* "Last delivered" is the last ACK, not the last attempt: a queue
                that has been retrying and failing all morning must not read as
                healthy because it was busy. */}
            Last acknowledged by Books {relativeTimeFromNow(data?.delivery.last_delivered_at ?? null)}. Retries are the
            dispatcher&rsquo;s job and are idempotent; nothing is re-sent from this screen.
          </>
        }
      >
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
          {Object.entries(data?.delivery.by_status ?? {}).map(([status, count]) => (
            <Link
              key={status}
              to={`/integration/outbox?status=${status}`}
              className="rounded-lg border border-gray-200 p-2 no-underline transition-colors hover:border-primary/40"
            >
              <p className="text-[10px] uppercase tracking-wide text-gray-400">{humanize(status)}</p>
              <p
                className={
                  (status === 'FAILED' || status === 'DEAD') && count > 0
                    ? 'text-sm font-semibold tabular-nums text-red-600'
                    : 'text-sm font-semibold tabular-nums text-gray-900'
                }
              >
                {formatCount(count)}
              </p>
            </Link>
          ))}
        </div>
        {data && data.delivery.unacknowledged_revisions > 0 ? (
          <Notice kind="warning" className="mt-3">
            {formatCount(data.delivery.unacknowledged_revisions)} valuation revisions have not been acknowledged by
            Books. Until they are, the two systems can disagree by the amount of those revisions.{' '}
            <Link to="/valuation/revisions?acknowledged=0" className="font-semibold">
              Review them
            </Link>
          </Notice>
        ) : null}
      </WidgetCard>
    </div>
  )
}

export default ControlsDashboard
