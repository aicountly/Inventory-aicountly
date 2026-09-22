import { useMemo } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { ListTree } from 'lucide-react'
import { useCompany } from '../../company/CompanyContext'
import { useScopeLabel } from '../../company/useScopeLabel'
import { ListSheetActions } from '../../components/ListSheetActions'
import { Notice } from '../../components/Notice'
import { RequirePermission } from '../../components/RequirePermission'
import { useQuery } from '../../hooks/useQuery'
import type { ExportableColumn } from '../../registers/registerCells'
import { P } from '../../services/access'
import { reconciliationApi } from '../../services/reconciliationApi'
import { Badge } from '../../ui/Badge'
import { Card, CardHeader } from '../../ui/Card'
import { StatusBadge } from '../../ui/StatusBadge'
import { BreadcrumbHeader } from '../../ui/shell/BreadcrumbHeader'
import { PageShell } from '../../ui/shell/PageShell'
import { formatDate, formatInt, formatMoney, humanize } from '../../utils/format'
import { ReconciliationTabs } from './ReconciliationTabs'
import { BucketBreakdown } from './VarianceBreakdown'
import {
  booksAnswered,
  bucketRows,
  differencePercent,
  formatPercent,
  headlineRun,
  unexplainedExplanation,
} from './reconciliationModel'
import type { BucketRow } from './reconciliationModel'

const EXPORT_COLUMNS: ExportableColumn<BucketRow>[] = [
  { key: 'label', csvHeader: 'Bucket' },
  { key: 'help', csvHeader: 'What it means' },
  { key: 'count', csvHeader: 'Items', align: 'right', format: 'int' },
  { key: 'amount', csvHeader: 'Contribution to difference (₹)', align: 'right', format: 'amount' },
  { key: 'share', csvHeader: 'Share of difference', align: 'right', csv: (r) => formatPercent(r.share) },
  { key: 'documents', csvHeader: 'Documents', align: 'right', format: 'int' },
]

/**
 * Item-wise variance — as far as the two apps can honestly take it.
 *
 * Inventory can name the item behind every one of its own documents. Books
 * publishes ONE Stock-in-Hand balance for the company, not a balance per item,
 * and there is no endpoint that would give a per-item Books figure to set
 * against the per-item Inventory figure. So this screen explains the gap the
 * way the server computes it — bucket by bucket, each one opening onto the
 * documents inside it — and says so in the first paragraph rather than
 * inventing a Books column that would look authoritative and be fiction.
 */
export function ReconciliationVariancePage() {
  const { scope } = useCompany()
  const scopeLabel = useScopeLabel()
  const [search] = useSearchParams()
  const requested = Number(search.get('run') ?? 0)
  const scopeKey = scope ? `${scope.cmp_id}:${scope.fy_id}:${scope.bo_id}` : null

  /* Only needed when no run was named — the run rows carry no breakdown, so the
     screen still has to read the run itself either way. */
  const recent = useQuery(
    (signal) => reconciliationApi.runs({ limit: 12, sort: 'as_of_date', order: 'desc' }, signal),
    [scopeKey],
    { enabled: scope !== null && requested <= 0, resetKey: scopeKey },
  )
  const fallbackId = headlineRun(recent.data?.data ?? [])?.run_id ?? 0
  const runId = requested > 0 ? requested : fallbackId

  const detail = useQuery(
    (signal) => reconciliationApi.get(runId, signal),
    [runId, scopeKey],
    { enabled: scope !== null && runId > 0, resetKey: scopeKey },
  )
  const run = detail.data ?? null
  const rows = useMemo(() => bucketRows(run?.breakdown ?? null), [run?.breakdown])
  const unexplained = useMemo(() => unexplainedExplanation(run?.breakdown ?? null), [run?.breakdown])

  const loading = detail.loading || (requested <= 0 && recent.loading)

  return (
    <PageShell fullBleed>
      <BreadcrumbHeader
        breadcrumbs={[{ label: 'Inventory', to: '/' }, { label: 'Reconciliation', to: '/reconciliation' }, { label: 'Item-wise Variance' }]}
        icon={ListTree}
        title="Item-wise Variance"
        description="What stands between Inventory's closing valuation and the Books Stock-in-Hand ledger, bucket by bucket, down to the documents inside each one."
        meta={<span className="text-[11px] text-gray-500">{scopeLabel}</span>}
        escBack={false}
        actions={
          <ListSheetActions<BucketRow>
            columns={EXPORT_COLUMNS}
            rows={rows}
            filenameBase="reconciliation-variance"
            title="Reconciliation variance breakdown"
            description={run ? `Run #${run.run_id} as at ${formatDate(run.as_of_date)}` : 'Reconciliation variance'}
            scopePeriod={run ? `as at ${formatDate(run.as_of_date)}` : undefined}
            metaLines={[
              run ? `Run #${run.run_id} · ${humanize(run.status)}` : '',
              run && booksAnswered(run) ? `Difference (Inventory − Books): ₹ ${formatMoney(run.difference)}` : '',
            ].filter(Boolean)}
            footerNotes={[
              'Each bucket is a contribution to Inventory − Books, as computed by the run. They sum to the explained total; anything left over sits in “unexplained”.',
            ]}
            onRefresh={detail.reload}
            refreshing={detail.loading}
            disabled={rows.length === 0}
          />
        }
      />

      <RequirePermission permission={P.reconciliationRead} what="reconciliation runs">
        <ReconciliationTabs />

        {detail.error ? <Notice kind="error">{detail.error.message}</Notice> : null}
        {!loading && runId === 0 ? (
          <Notice kind="info" title="No run to explain yet">
            Run a reconciliation from the <Link to="/reconciliation">Runs</Link> tab and its breakdown will appear here.
          </Notice>
        ) : null}
        {run && !booksAnswered(run) ? (
          <Notice kind="warning" title="Books data temporarily unavailable">
            This run could not reach the Books Stock-in-Hand ledger, so the buckets below explain the Inventory side
            only.
          </Notice>
        ) : null}

        <Card padding="md">
          <CardHeader
            title={run ? `Run #${run.run_id} — as at ${formatDate(run.as_of_date)}` : 'Latest run'}
            description={
              run
                ? `Inventory ₹ ${formatMoney(run.inventory_closing_value)} · Books ${booksAnswered(run) ? `₹ ${formatMoney(run.books_stock_ledger_balance)}` : 'not reported'} · Difference ${booksAnswered(run) ? `₹ ${formatMoney(run.difference)} (${formatPercent(differencePercent(run))})` : '—'}`
                : 'Loading the latest completed run…'
            }
            action={
              run ? (
                <span className="flex items-center gap-2">
                  <StatusBadge value={run.status} tone={run.status === 'COMPLETED' ? 'good' : run.status === 'FAILED' ? 'critical' : 'warning'} />
                  {/* A count of explanations is not a severity: the tone of the
                      difference is carried by the figures above, not by this. */}
                  <Badge tone="neutral" size="xs">
                    {rows.length === 0 ? 'No buckets' : `${formatInt(rows.length)} buckets`}
                  </Badge>
                  <Link to={`/reconciliation/${run.run_id}`} className="text-[11px] font-semibold text-primary hover:underline">
                    Full run record →
                  </Link>
                </span>
              ) : null
            }
          />
          <p className="mb-3 text-xs leading-relaxed text-gray-500">
            Books owns the accounting ledger and publishes a single Stock-in-Hand balance for the company — not one
            per item — so there is no Books figure to set beside each item. The variance is therefore explained by
            bucket, and every bucket that names documents opens onto them.
          </p>
          <BucketBreakdown
            rows={rows}
            loading={loading}
            emptyMessage={
              run
                ? 'This run reports no bucket with a value or a count — nothing is standing between the two sides.'
                : 'No breakdown to show yet.'
            }
            unexplained={unexplained}
          />
        </Card>
      </RequirePermission>
    </PageShell>
  )
}

export default ReconciliationVariancePage
