import { useCallback, useMemo, useState } from 'react'
import {
  ArrowDownToLine,
  ArrowUpFromLine,
  ClipboardCheck,
  ClipboardList,
  Clock,
  FileText,
  ListChecks,
  Repeat,
  Truck,
} from 'lucide-react'
import { useAccess } from '../../access/AccessContext'
import { useCompany } from '../../company/CompanyContext'
import { useQuery } from '../../hooks/useQuery'
import { P } from '../../services/access'
import { Badge } from '../../ui/Badge'
import { ProgressBar } from '../../ui/ProgressBar'
import { formatDate, formatQty, todayIso } from '../../utils/format'
import { assertScope, fetchOperations } from '../aggregatesApi'
import type { CountDocumentRow, InFlightRow, Metric } from '../aggregatesApi'
import { ColumnChart } from '../charts/ColumnChart'
import { DashboardPageHeader } from '../components/DashboardPageHeader'
import { MetricCard } from '../components/MetricCard'
import { MiniTable } from '../components/MiniTable'
import { PulseBriefing } from '../components/PulseBriefing'
import { WidgetCard } from '../components/WidgetCard'
import { QuickActions } from '../components/QuickActions'
import { formatCount } from '../formatters'
import { drill } from '../kpiNavigation'
import {
  TIMELINESS_LABEL,
  TIMELINESS_TONE,
  countProgress,
  hourLabel,
  hourlySeries,
  inFlightSummary,
  pendingKindLabel,
  progressLabel,
} from '../operationsModel'
import { buildPulseFindings } from '../pulse'
import { exportDashboardPdf } from '../dashboardExport'
import { useSyncStamp } from '../useSyncStamp'
import { BAR_FILL } from '../visuals'
import type { DashboardSectionProps } from './types'

/**
 * Dashboard 2 — keep receipts, issues, transfers and counts moving.
 *
 * One request (`/v1/dashboard/operations`) rather than six: every figure here
 * is a different slice of `inv_documents` and `inv_pending_quantities`, and
 * splitting them would mean six scans of the same tables to draw one screen.
 *
 * The screen is scoped by company, financial year, branch and as-at DATE. It is
 * NOT scoped by warehouse: the counts are per document, and a document is not
 * owned by one warehouse — a transfer names two and a multi-line issue can name
 * several. Filtering it by warehouse would produce a number that no register
 * reproduces, so the header says so rather than applying a filter that lies.
 */
export function OperationsDashboard({ scope, view }: DashboardSectionProps) {
  const { companyName, fy, branch } = useCompany()
  const { can } = useAccess()
  const [exporting, setExporting] = useState(false)

  const expected = scope.scope
  const query = useQuery(
    async (signal) => {
      const envelope = await fetchOperations(scope.asOf, signal)
      return expected ? assertScope(envelope, expected) : envelope
    },
    [scope.scopeKey, scope.asOf],
    { enabled: scope.ready, resetKey: scope.scopeKey },
  )

  const data = query.data?.data ?? null
  const lastSyncedAt = useSyncStamp(query.loading)

  const metric = useCallback((key: string): Metric | null => data?.metrics[key] ?? null, [data])
  const metricNumber = useCallback(
    (key: string): number | null => {
      const m = data?.metrics[key]
      if (!m || m.state !== 'ready' || typeof m.value !== 'number') return null
      return m.value
    },
    [data],
  )

  const hourly = useMemo(() => hourlySeries(data?.hourly.buckets ?? []), [data])
  const progress = useMemo(() => countProgress(data?.count_progress ?? []), [data])

  const findings = useMemo(
    () =>
      buildPulseFindings({
        failedPostings: metricNumber('failed_posting'),
        countVariances: metricNumber('count_variances'),
        overdueInFlight: data?.in_flight.overdue_documents ?? null,
        pendingApproval: metricNumber('awaiting_approval'),
      }),
    [metricNumber, data],
  )

  const truncatedNote =
    data && data.hourly.truncated_at_hour !== null
      ? `Shown to ${hourLabel(data.hourly.truncated_at_hour)} — the rest of the day has not happened yet.`
      : undefined

  const canDocuments = can(P.documentsRead)
  const todayFilter = data ? { from: data.date, to: data.date } : {}

  const onExport = useCallback(() => {
    if (!data) return
    setExporting(true)
    try {
      exportDashboardPdf({
        title: 'Warehouse operations',
        description: view.description,
        companyName,
        fyLabel: fy?.label ?? 'Financial year',
        branchLabel: branch ? branch.name : 'All branches',
        warehouseLabel: 'All warehouses (operations counts documents, not warehouses)',
        asOf: data.date,
        generatedAt: query.data?.meta.generated_at ?? null,
        metrics: [
          ['Receipts today', formatMetric(metric('receipts_today')), metric('receipts_today')?.definition ?? ''],
          ['Issues today', formatMetric(metric('issues_today')), metric('issues_today')?.definition ?? ''],
          ['Transfers today', formatMetric(metric('transfers_today')), metric('transfers_today')?.definition ?? ''],
          ['Goods awaited', formatMetric(metric('goods_awaited')), metric('goods_awaited')?.definition ?? ''],
          ['Awaiting approval', formatMetric(metric('awaiting_approval')), metric('awaiting_approval')?.definition ?? ''],
          ['Counts in progress', formatMetric(metric('counts_in_progress')), metric('counts_in_progress')?.definition ?? ''],
        ],
        tables: [
          {
            title: 'Goods out and awaited',
            note: data.in_flight.rows.length < data.in_flight.open_documents
              ? `Showing ${data.in_flight.rows.length} of ${data.in_flight.open_documents} documents. Open the pending-quantities register for the full list.`
              : undefined,
            columns: ['Document', 'Type', 'Party', 'Dispatched', 'Expected back', 'Outstanding', 'Status'],
            rows: data.in_flight.rows.map((r) => [
              r.document_no ?? `#${r.document_id}`,
              r.document_type_label,
              r.party_name ?? '—',
              formatDate(r.document_date),
              r.expected_return_date ? formatDate(r.expected_return_date) : 'No return date',
              formatQty(r.outstanding_qty),
              TIMELINESS_LABEL[r.timeliness],
            ]),
          },
          {
            title: 'Stock count progress',
            columns: ['Warehouse', 'Counted lines', 'Total lines', 'Complete', 'Documents'],
            rows: progress.map((p) => [
              p.label,
              formatCount(p.counted),
              formatCount(p.total),
              p.empty ? 'No lines' : `${p.percent.toFixed(0)}%`,
              formatCount(p.documents),
            ]),
          },
        ],
        notes: [
          `Receipt, issue, transfer and adjustment counts are DOCUMENT counts by posting time in ${data.timezone}. A document falls in exactly one class, so a transfer is never counted as both a receipt and an issue.`,
          metric('transfers_in_transit')?.reason ?? '',
        ].filter(Boolean),
      })
    } finally {
      setExporting(false)
    }
  }, [data, view, companyName, fy, branch, query.data, metric, progress])

  return (
    <div className="space-y-3">
      <DashboardPageHeader
        title="Warehouse operations"
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
        refreshing={query.loading}
        onRefresh={query.reload}
        lastSyncedAt={lastSyncedAt}
        onExport={data ? onExport : undefined}
        exporting={exporting}
      />

      <PulseBriefing
        findings={findings}
        anyDataKnown={data !== null}
        lastSyncedAt={lastSyncedAt}
        reviewTo={canDocuments ? drill.documents({ status: 'PENDING_APPROVAL' }) : undefined}
        reviewLabel="Review the queue"
      />

      <section aria-label="Today on the floor" className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <MetricCard
          label="Receipts today"
          value={formatMetric(metric('receipts_today'))}
          numeric={metricNumber('receipts_today')}
          definition={metric('receipts_today')?.definition ?? 'Inward documents posted on this date.'}
          state={metric('receipts_today')?.state}
          hint="Documents, not lines"
          icon={ArrowDownToLine}
          tone="success"
          loading={query.loading && !data}
          error={query.error}
          onRetry={query.reload}
          to={canDocuments ? drill.documents(todayFilter) : undefined}
        />
        <MetricCard
          label="Issues today"
          value={formatMetric(metric('issues_today'))}
          numeric={metricNumber('issues_today')}
          definition={metric('issues_today')?.definition ?? 'Outward documents posted on this date.'}
          state={metric('issues_today')?.state}
          hint="Documents, not lines"
          icon={ArrowUpFromLine}
          tone="teal"
          loading={query.loading && !data}
          error={query.error}
          onRetry={query.reload}
          to={canDocuments ? drill.documents(todayFilter) : undefined}
        />
        {/* A "not tracked" card, not a plausible number. This product posts a
            transfer out and in as one operation, so no balance is ever held in
            transit; the card says so and points at what genuinely IS out.

            Deliberately never in a loading state: the answer does not depend on
            the response, so making it shimmer would imply a figure is on its
            way that is never coming. */}
        <MetricCard
          label="Transfers in transit"
          value={null}
          definition={metric('transfers_in_transit')?.definition ?? 'Stock dispatched and not yet received.'}
          state="not_configured"
          reason={
            metric('transfers_in_transit')?.reason ??
            'Stock transfers post out and in as one operation in this product, so no balance is ever held in transit.'
          }
          icon={Repeat}
          insteadTo="/registers/pending-quantities"
          insteadLabel="See goods awaited"
        />
        <MetricCard
          label="Counts in progress"
          value={formatMetric(metric('counts_in_progress'))}
          numeric={metricNumber('counts_in_progress')}
          definition={metric('counts_in_progress')?.definition ?? 'Physical adjustments not yet posted.'}
          state={metric('counts_in_progress')?.state}
          hint={
            (metricNumber('count_variances') ?? 0) > 0
              ? `${formatCount(metricNumber('count_variances') ?? 0)} counted lines disagree with the system`
              : 'No counted line disagrees with the system'
          }
          badge={(metricNumber('count_variances') ?? 0) > 0 ? { label: 'Variances', tone: 'warning' } : undefined}
          icon={ClipboardList}
          tone="violet"
          loading={query.loading && !data}
          error={query.error}
          onRetry={query.reload}
          to={canDocuments ? drill.documents({ documentType: 'PHYSICAL_ADJUSTMENT' }) : undefined}
        />
      </section>

      <div className="grid grid-cols-1 gap-3 lg:grid-cols-3">
        <WidgetCard
          className="lg:col-span-2"
          title="Today's movement"
          description={`Documents posted through the day · times in ${data?.timezone ?? 'the company timezone'}`}
          icon={Clock}
          tone="primary"
          state={{ loading: query.loading && !data, error: query.error, empty: hourly.total === 0, reload: query.reload }}
          skeleton={<div className="skeleton h-[168px] rounded-lg" />}
          emptyTitle="Nothing posted yet"
          emptyDescription="Receipts, issues and transfers appear here as they are posted."
          emptyIcon={Clock}
          viewAll={canDocuments ? { to: drill.documents(todayFilter), label: 'All today' } : undefined}
          footer={
            hourly.busiestHour !== null
              ? `Busiest so far: ${hourLabel(hourly.busiestHour)} · ${formatCount(hourly.total)} documents posted`
              : undefined
          }
        >
          <ColumnChart
            categories={hourly.categories}
            unit="documents"
            truncatedNote={truncatedNote}
            caption={`Documents posted by hour on ${data ? formatDate(data.date) : 'the selected date'}, split into receipts, issues, transfers and adjustments. Counts documents, not lines.`}
            series={[
              { key: 'receipt', label: 'Receipts', fill: BAR_FILL.success, values: hourly.receipts },
              { key: 'issue', label: 'Issues', fill: BAR_FILL.teal, values: hourly.issues },
              { key: 'transfer', label: 'Transfers', fill: BAR_FILL.info, values: hourly.transfers },
              { key: 'adjustment', label: 'Adjustments', fill: BAR_FILL.warning, values: hourly.adjustments },
            ]}
          />
        </WidgetCard>

        <WidgetCard
          title="My work queue"
          description="Documents that need a decision"
          icon={ListChecks}
          tone="info"
          state={{ loading: query.loading && !data, error: query.error, empty: false, reload: query.reload }}
          skeleton={<div className="skeleton h-40 rounded-lg" />}
        >
          <ul className="divide-y divide-gray-100">
            {[
              { key: 'awaiting_approval', label: 'Awaiting approval', to: drill.documents({ status: 'PENDING_APPROVAL' }), tone: 'info' as const },
              { key: 'ready_to_post', label: 'Approved, not posted', to: drill.documents({ status: 'APPROVED' }), tone: 'warning' as const },
              { key: 'failed_posting', label: 'Failed postings', to: drill.documents({ status: 'FAILED' }), tone: 'danger' as const },
              { key: 'drafts', label: 'Drafts', to: drill.documents({ status: 'DRAFT' }), tone: 'neutral' as const },
            ].map((row) => {
              const n = metricNumber(row.key)
              return (
                <li key={row.key} className="flex items-center justify-between gap-3 py-2">
                  <span className="min-w-0 flex-1 truncate text-xs text-gray-700" title={metric(row.key)?.definition}>
                    {row.label}
                  </span>
                  <span className="shrink-0 text-sm font-semibold tabular-nums text-gray-900">
                    {n === null ? '—' : formatCount(n)}
                  </span>
                  {canDocuments && (n ?? 0) > 0 ? (
                    <a href={row.to} className="shrink-0 text-[11px] font-semibold text-primary print:hidden">
                      Open
                    </a>
                  ) : (
                    <span className="w-8 shrink-0" aria-hidden />
                  )}
                </li>
              )
            })}
          </ul>
        </WidgetCard>
      </div>

      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        <WidgetCard
          title="Goods out and awaited"
          description={data ? inFlightSummary(data.in_flight.by_kind) : 'Challans, deferred purchases and job work'}
          icon={Truck}
          tone="warning"
          state={{
            loading: query.loading && !data,
            error: query.error,
            empty: (data?.in_flight.rows.length ?? 0) === 0,
            reload: query.reload,
          }}
          skeleton={<div className="skeleton h-44 rounded-lg" />}
          emptyTitle="Nothing is outstanding"
          emptyDescription="Delivery challans, inward challans, deferred purchases and job work appear here until they are settled."
          emptyIcon={Truck}
          viewAll={{ to: '/registers/pending-quantities', label: 'Full register' }}
          footer={
            data && data.in_flight.rows.length < data.in_flight.open_documents
              ? `Showing ${data.in_flight.rows.length} of ${formatCount(data.in_flight.open_documents)} documents · ${formatCount(data.in_flight.overdue_documents)} past their agreed return date`
              : data && data.in_flight.overdue_documents > 0
                ? `${formatCount(data.in_flight.overdue_documents)} past their agreed return date`
                : undefined
          }
        >
          <MiniTable<InFlightRow>
            caption="Documents with quantity still outstanding, soonest expected return first."
            rows={data?.in_flight.rows ?? []}
            rowKey={(r) => r.document_id}
            to={(r) => drill.document(r.document_id)}
            rowLabel={(r) => `${r.document_type_label} ${r.document_no ?? r.document_id}`}
            minWidth={480}
            columns={[
              {
                key: 'document',
                header: 'Document',
                render: (r) => (
                  <div className="min-w-0">
                    <p className="truncate text-xs font-medium text-gray-900">{r.document_no ?? `#${r.document_id}`}</p>
                    <p className="truncate text-[11px] text-gray-500">{r.document_type_label}</p>
                  </div>
                ),
              },
              {
                key: 'party',
                header: 'Party / route',
                render: (r) => (
                  <div className="min-w-0">
                    <p className="truncate text-xs text-gray-700">{r.party_name ?? pendingKindLabel(r.pending_kind)}</p>
                    <p className="truncate text-[11px] text-gray-400">
                      {r.from_warehouse_name ?? '—'}
                      {r.to_warehouse_name ? ` → ${r.to_warehouse_name}` : ''}
                    </p>
                  </div>
                ),
              },
              {
                // One column, two dates: dispatched over expected. Six columns
                // do not fit a half-width card, and the one that got cut was
                // the status — the only cell that says whether to worry.
                key: 'dates',
                header: 'Out / expected back',
                render: (r) => (
                  <div className="min-w-0">
                    <p className="truncate text-xs text-gray-700">{formatDate(r.document_date)}</p>
                    <p className="truncate text-[11px] text-gray-400">
                      {r.expected_return_date ? `back ${formatDate(r.expected_return_date)}` : 'no return date'}
                    </p>
                  </div>
                ),
              },
              {
                key: 'outstanding',
                header: 'Outstanding',
                align: 'right',
                cellClassName: 'tabular-nums',
                render: (r) => <span className="text-xs text-gray-900">{formatQty(r.outstanding_qty)}</span>,
              },
              {
                key: 'status',
                header: 'Status',
                render: (r) => (
                  <Badge tone={TIMELINESS_TONE[r.timeliness]} size="xs">
                    {TIMELINESS_LABEL[r.timeliness]}
                  </Badge>
                ),
              },
            ]}
          />
        </WidgetCard>

        <WidgetCard
          title="Stock count progress"
          description="Counted lines against the lines expected"
          icon={ClipboardCheck}
          tone="violet"
          state={{
            loading: query.loading && !data,
            error: query.error,
            empty: progress.length === 0,
            reload: query.reload,
          }}
          skeleton={<div className="skeleton h-44 rounded-lg" />}
          emptyTitle="No count is open"
          emptyDescription="Start a physical adjustment and its progress appears here, warehouse by warehouse."
          emptyIcon={ClipboardCheck}
          viewAll={canDocuments ? { to: drill.documents({ documentType: 'PHYSICAL_ADJUSTMENT' }), label: 'All counts' } : undefined}
        >
          <ul className="space-y-3">
            {progress.map((p) => (
              <li key={p.key}>
                <div className="flex items-baseline justify-between gap-2">
                  <span className="min-w-0 flex-1 truncate text-xs font-medium text-gray-700">{p.label}</span>
                  {/* Numerator and denominator always travel with the bar: a
                      percentage on its own is not something a supervisor can
                      act on, and 0 of 0 is not "nothing done". */}
                  <span className="shrink-0 text-[11px] tabular-nums text-gray-500">
                    {progressLabel(p.counted, p.total)}
                  </span>
                </div>
                <ProgressBar
                  value={p.empty ? 0 : p.percent}
                  className="mt-1"
                  size="sm"
                  aria-label={`${p.label} count progress`}
                  barClassName={
                    p.empty
                      ? 'bg-gray-300'
                      : p.percent >= 100
                        ? 'bg-emerald-500'
                        : p.percent >= 50
                          ? 'bg-primary'
                          : 'bg-amber-500'
                  }
                />
              </li>
            ))}
          </ul>
        </WidgetCard>
      </div>

      <WidgetCard
        title="Counts being worked on"
        description="Unposted physical adjustments and the variances on them"
        icon={FileText}
        tone="primary"
        state={{
          loading: query.loading && !data,
          error: query.error,
          empty: (data?.count_documents.length ?? 0) === 0,
          reload: query.reload,
        }}
        skeleton={<div className="skeleton h-32 rounded-lg" />}
        emptyTitle="No count is open"
        emptyDescription="Counts appear here from the moment they are started until they post."
        emptyIcon={FileText}
      >
        <MiniTable<CountDocumentRow>
          caption="Physical adjustment documents not yet posted, with counted lines and variances."
          rows={data?.count_documents ?? []}
          rowKey={(r) => r.document_id}
          to={(r) => drill.document(r.document_id)}
          rowLabel={(r) => `Stock count ${r.document_no ?? r.document_id}`}
          minWidth={520}
          columns={[
            {
              key: 'document',
              header: 'Count',
              render: (r) => (
                <div className="min-w-0">
                  <p className="truncate text-xs font-medium text-gray-900">{r.document_no ?? `#${r.document_id}`}</p>
                  <p className="truncate text-[11px] text-gray-500">{formatDate(r.document_date)}</p>
                </div>
              ),
            },
            {
              key: 'warehouse',
              header: 'Warehouse',
              render: (r) => <span className="text-xs text-gray-700">{r.warehouse_name ?? '—'}</span>,
            },
            {
              key: 'progress',
              header: 'Progress',
              render: (r) => <span className="text-xs tabular-nums text-gray-700">{progressLabel(r.counted_lines, r.total_lines)}</span>,
            },
            {
              key: 'variance',
              header: 'Variances',
              align: 'right',
              cellClassName: 'tabular-nums',
              render: (r) =>
                r.variance_lines > 0 ? (
                  <Badge tone="warning" size="xs">
                    {formatCount(r.variance_lines)} lines
                  </Badge>
                ) : (
                  <span className="text-xs text-gray-400">None</span>
                ),
            },
            {
              key: 'status',
              header: 'Status',
              render: (r) => (
                <Badge tone="neutral" size="xs">
                  {r.status.replace(/_/g, ' ').toLowerCase()}
                </Badge>
              ),
            },
          ]}
        />
      </WidgetCard>

      <QuickActions asOf={scope.asOf} period={scope.period} />
    </div>
  )
}

/** A metric's figure as text, or `null` so the card renders its own state. */
function formatMetric(metric: Metric | null): string | null {
  if (!metric || metric.state !== 'ready' || metric.value === null) return null
  return typeof metric.value === 'number' ? formatCount(metric.value) : String(metric.value)
}

export default OperationsDashboard
