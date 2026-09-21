import { useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { BarChart3, BookOpen, Boxes, Coins, Layers, RefreshCw, Scale } from 'lucide-react'
import { useCompany } from '../../company/CompanyContext'
import { ListSheetActions } from '../../components/ListSheetActions'
import { RequirePermission } from '../../components/RequirePermission'
import { useListParams } from '../../hooks/useListParams'
import type { ExportableColumn } from '../../registers/registerCells'
import { P } from '../../services/access'
import { METHOD_LABELS } from '../../services/valuationApi'
import { Badge } from '../../ui/Badge'
import { Button } from '../../ui/Button'
import { Card } from '../../ui/Card'
import { EmptyState } from '../../ui/EmptyState'
import { ErrorState } from '../../ui/ErrorState'
import { Skeleton } from '../../ui/Skeleton'
import { StatCard, StatCardSkeleton } from '../../ui/StatCard'
import { cx } from '../../ui/cx'
import { LiveDataBadge } from '../../ui/shell/LiveDataBadge'
import { PageHeader } from '../../ui/shell/PageHeader'
import { PageShell } from '../../ui/shell/PageShell'
import { METRIC_CARD_GRID } from '../../styles/designTokens'
import { formatDate, formatInt, formatMoney, formatQty, todayIso } from '../../utils/format'
import {
  MethodComparisonFilters,
  compareScopeLabel,
} from './methodComparison/MethodComparisonFilters'
import type { CompareScope } from './methodComparison/MethodComparisonFilters'
import { MethodComparisonTable } from './methodComparison/MethodComparisonTable'
import { InsightStrip } from './methodComparison/InsightStrip'
import { MethodsExplainer } from './methodComparison/MethodsExplainer'
import { Takeaways } from './methodComparison/Takeaways'
import { VarianceDrilldown } from './methodComparison/VarianceDrilldown'
import { defaultAsOfDate, insightSentence, takeaways } from './methodComparison/model'
import type { MethodComparisonRow } from './methodComparison/model'
import { useMethodComparison } from './methodComparison/useMethodComparison'
import { WORDS, signedPercent } from './methodComparison/words'

const FILTER_KEYS = ['as_of', 'item_id', 'warehouse_id', 'qty_sign'] as const

/**
 * The columns the export writes — the table's, in the table's order.
 *
 * The percentages go out as plain numbers under a header that names the unit,
 * not as `"+0.56%"` strings: the first thing anyone does with an exported
 * comparison is sort or chart it, and a column of text cannot be either.
 */
const EXPORT_COLUMNS: ExportableColumn<MethodComparisonRow>[] = [
  {
    key: 'label',
    csvHeader: 'Method',
    format: 'text',
    csv: (r) => (r.baseline ? `${r.label} (books basis)` : r.label),
  },
  { key: 'items', csvHeader: 'Items', align: 'right', format: 'int', csv: (r) => r.items },
  { key: 'closingQty', csvHeader: 'Closing qty', align: 'right', format: 'qty', csv: (r) => r.closingQty },
  { key: 'stockValue', csvHeader: 'Stock value', align: 'right', format: 'amount', csv: (r) => r.stockValue },
  {
    key: 'difference',
    csvHeader: 'Difference vs item master',
    align: 'right',
    format: 'amount',
    csv: (r) => r.difference,
  },
  {
    key: 'relativeValue',
    csvHeader: 'Relative value %',
    align: 'right',
    format: 'qty',
    csv: (r) => r.relativeValue,
  },
  {
    key: 'variancePercent',
    csvHeader: 'Variance %',
    align: 'right',
    format: 'qty',
    csv: (r) => r.variancePercent,
  },
]

const FOOTER_NOTES = [
  `"${METHOD_LABELS.AS_PER_MASTER}" is the basis these books are kept on: each item valued by the method on its own master, falling back to the company default.`,
  'The other three rows are simulations — what the same physical stock would be worth if one method were applied throughout. Nothing on this screen posts, revalues or saves anything.',
]

/**
 * The same stock, costed four ways.
 *
 * The valuation register answers "what is this worth" under one method at a
 * time. This screen asks the question the method dropdown implies but cannot
 * show: what the choice is *worth* — the spread between FIFO, LIFO, weighted
 * average and what the item masters actually prescribe, at one date.
 *
 * Every figure is a separate `GET /v1/valuation` at that method, so nothing is
 * re-costed here: four questions to the valuation engine, and the differences
 * between the answers it gave. A method whose request fails is shown as
 * unavailable rather than as zero — a blank row in a comparison is a missing
 * answer, and a zero would read as "this method values the stock at nothing".
 *
 * "As per item master" is the basis the books are kept on. The other three are
 * counterfactual, and nothing here posts, revalues or saves anything: there is
 * no Save, no Make default, and the only link that changes a method goes to
 * Settings, where that decision belongs.
 */
export function MethodComparisonPage() {
  const { fyRange } = useCompany()
  const params = useListParams({ sort: 'item_name', limit: 1, filterKeys: FILTER_KEYS })
  const { state } = params

  const asOf = state.filters.as_of || defaultAsOfDate(todayIso(), fyRange)
  const itemId = state.filters.item_id ?? ''
  const warehouseId = state.filters.warehouse_id ?? ''
  const compareScope = (state.filters.qty_sign ?? '') as CompareScope

  const dateRef = useRef<HTMLInputElement>(null)
  const warehouseRef = useRef<HTMLSelectElement>(null)
  const [explainerOpen, setExplainerOpen] = useState(false)
  const [drilldown, setDrilldown] = useState<MethodComparisonRow | null>(null)
  const [insightDismissed, setInsightDismissed] = useState(false)

  const { comparison, loading, refreshing, error, reload, fetchedAt, previousBasis, previousDate } =
    useMethodComparison({
      asOf,
      itemId,
      warehouseId,
      qtySign: compareScope || undefined,
    })

  const insight = useMemo(() => insightSentence(comparison, WORDS), [comparison])
  const bullets = useMemo(() => takeaways(comparison, WORDS), [comparison])
  const scopeLabel = compareScopeLabel(compareScope)

  /** "vs 19 Aug 2026 (17,780)" — the comparison period, never left to be guessed. */
  const against = (value: number | null | undefined, format: (v: unknown) => string) =>
    previousBasis && previousDate ? `vs ${formatDate(previousDate)} (${format(value)})` : undefined

  const metaLines = useMemo(
    () => [
      `As at ${formatDate(asOf)}`,
      `Scope: ${scopeLabel}`,
      warehouseId ? 'One warehouse' : 'Whole company',
      ...(itemId ? ['Filtered to one item'] : []),
    ],
    [asOf, scopeLabel, warehouseId, itemId],
  )

  const summaryCards = useMemo(
    () => [
      { label: 'Items compared', value: comparison.itemsCompared === null ? '—' : formatInt(comparison.itemsCompared) },
      { label: 'Closing quantity', value: comparison.closingQty === null ? '—' : formatQty(comparison.closingQty) },
      { label: 'Basis stock value', value: comparison.basisValue === null ? '—' : formatMoney(comparison.basisValue) },
      {
        label: 'Max variance',
        value: comparison.maxVariance === null ? '—' : formatMoney(comparison.maxVariance),
        hint: comparison.maxVarianceRow?.label,
        tone: 'warn' as const,
      },
    ],
    [comparison],
  )

  const exportActions = (
    <ListSheetActions<MethodComparisonRow>
      columns={EXPORT_COLUMNS}
      rows={comparison.rows}
      filenameBase="method-comparison"
      title="Valuation method comparison"
      description={`The same closing stock valued under each method, as at ${formatDate(asOf)}.`}
      metaLines={metaLines}
      summaryCards={summaryCards}
      footerNotes={FOOTER_NOTES}
      orientation="landscape"
      scopePeriod={`as at ${formatDate(asOf)}`}
      onRefresh={reload}
      refreshing={refreshing}
      disabled={loading || comparison.answered === 0}
    />
  )

  return (
    // `w-full min-w-0`: the comparison table carries a min-width so seven
    // finance columns stay readable, and this shell is a flex item of the
    // layout's `.page` whose own `mx-auto` suppresses the flex stretch. Left to
    // size itself it takes the table's width rather than the viewport's, and on
    // a phone the KPI cards, the filters and the takeaways are dragged off the
    // right edge with it. The table is meant to scroll inside its own card, not
    // take the page with it.
    <PageShell compact className="w-full min-w-0">
      <PageHeader
        title="Method comparison"
        description="What the same stock is worth under each valuation method, as at one date."
        icon={Scale}
        badge={
          <Badge tone="primary" dot>
            Valuation
          </Badge>
        }
        actions={
          <>
            <LiveDataBadge
              fetchedAt={fetchedAt}
              refreshing={refreshing}
              stale={error !== null && comparison.answered > 0}
            />
            <Button variant="ghost" size="sm" icon={BookOpen} onClick={() => setExplainerOpen(true)}>
              {/* `sr-only` rather than `hidden` so the button keeps its name on
                  a phone, and mobile-first rather than `max-sm:` — this config
                  declares `raw` screens, which stops Tailwind generating the
                  `max-*` variants at all. */}
              <span className="sr-only sm:not-sr-only">Learn about valuation methods</span>
            </Button>
          </>
        }
      />

      <RequirePermission permission={P.report('valuation')} what="Method comparison">
        <div className={METRIC_CARD_GRID}>
          {loading ? (
            <>
              <StatCardSkeleton layout="metric" />
              <StatCardSkeleton layout="metric" />
              <StatCardSkeleton layout="metric" />
              <StatCardSkeleton layout="metric" />
            </>
          ) : (
            <>
              <StatCard
                layout="metric"
                label="Items compared"
                value={comparison.itemsCompared === null ? '—' : formatInt(comparison.itemsCompared)}
                icon={Boxes}
                tone="primary"
                current={comparison.itemsCompared}
                previous={previousBasis?.item_count}
                hint={against(previousBasis?.item_count, (v) => formatInt(v)) ?? 'Items holding stock at this date'}
              />
              <StatCard
                layout="metric"
                label="Closing quantity"
                value={comparison.closingQty === null ? '—' : formatQty(comparison.closingQty)}
                icon={Layers}
                tone="violet"
                current={comparison.closingQty}
                previous={previousBasis?.total_qty}
                hint={against(previousBasis?.total_qty, (v) => formatQty(v)) ?? 'Same quantity under every method'}
              />
              <StatCard
                layout="metric"
                label="Baseline stock value"
                value={comparison.basisValue === null ? '—' : formatMoney(comparison.basisValue)}
                icon={Coins}
                tone="info"
                current={comparison.basisValue}
                previous={previousBasis?.total_value}
                emphasizeNegative
                // The date alone here: a full rupee figure beside the chip
                // truncates in this card's width, and half a number is worse
                // than none. The other two cards' figures are short enough.
                hint={
                  previousBasis && previousDate
                    ? `vs ${formatDate(previousDate)}`
                    : 'Valued as per item master'
                }
              />
              <StatCard
                layout="metric"
                label="Max variance"
                value={comparison.maxVariance === null ? '—' : formatMoney(comparison.maxVariance)}
                icon={BarChart3}
                tone="rose"
                // No comparative exists for this one: it is derived from four
                // readings at one date, and there is no second date's spread to
                // set beside it. The hint says which method it belongs to,
                // which is the thing a reader actually needs next.
                hint={
                  comparison.maxVarianceRow && comparison.maxVarianceRow.variancePercent !== null
                    ? `${comparison.maxVarianceRow.label}, ${signedPercent(comparison.maxVarianceRow.variancePercent)} vs basis`
                    : 'No method differs from the basis'
                }
              />
            </>
          )}
        </div>

        {loading ? (
          <Skeleton height="h-[3.25rem]" rounded="xl" className="shrink-0" />
        ) : insight && !insightDismissed && comparison.hasStock ? (
          <InsightStrip
            text={insight}
            onExplore={
              comparison.maxVarianceRow ? () => setDrilldown(comparison.maxVarianceRow) : undefined
            }
            exploreLabel="Where it comes from"
            onDismiss={() => setInsightDismissed(true)}
          />
        ) : null}

        <MethodComparisonFilters
          asOf={asOf}
          onAsOf={(value) => params.setFilter('as_of', value)}
          itemId={itemId}
          onItemId={(value) => params.setFilter('item_id', value)}
          warehouseId={warehouseId}
          onWarehouseId={(value) => params.setFilter('warehouse_id', value)}
          scope={compareScope}
          onScope={(value) => params.setFilter('qty_sign', value)}
          actions={exportActions}
          dateRef={dateRef}
          warehouseRef={warehouseRef}
        />

        {error && comparison.answered === 0 ? (
          <ErrorState
            title="Unable to load valuation comparison"
            description="The valuation service did not answer for this date. Please retry — nothing in your inventory data has been changed."
            onRetry={reload}
          />
        ) : loading ? (
          <Card padding="md" className="space-y-3">
            {[0, 1, 2, 3].map((i) => (
              <Skeleton key={i} height="h-12" />
            ))}
          </Card>
        ) : !comparison.hasStock ? (
          <Card padding="none">
            <EmptyState
              icon={Scale}
              title="No stock available for comparison"
              description="There is no closing inventory for the selected date and scope, so there is nothing to value under any method."
              action={
                <div className="flex flex-wrap justify-center gap-2">
                  <Button variant="secondary" onClick={() => dateRef.current?.focus()}>
                    Change date
                  </Button>
                  <Button variant="secondary" onClick={() => warehouseRef.current?.focus()}>
                    Change warehouse
                  </Button>
                  <Button variant="ghost" icon={RefreshCw} onClick={reload}>
                    Refresh
                  </Button>
                </div>
              }
            />
          </Card>
        ) : (
          <>
            <Card padding="none" className="overflow-hidden">
              <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1.5 px-4 py-3">
                <h2 className="text-sm font-semibold text-gray-900">
                  Comparison by valuation method
                </h2>
                <div className="flex flex-wrap items-center gap-2 text-xs text-gray-500">
                  <span>
                    {formatInt(comparison.answered)} of {comparison.rows.length} methods
                  </span>
                  <span className="h-3.5 w-px bg-gray-200" aria-hidden />
                  <span>As at {formatDate(asOf)}</span>
                  <span className="h-3.5 w-px bg-gray-200" aria-hidden />
                  <span>{scopeLabel}</span>
                </div>
              </div>
              <MethodComparisonTable
                comparison={comparison}
                asOf={asOf}
                onDrilldown={setDrilldown}
                refreshing={refreshing}
              />
            </Card>

            <p className="text-xs leading-relaxed text-gray-500">
              <strong className="font-semibold text-gray-700">
                {METHOD_LABELS.AS_PER_MASTER}
              </strong>{' '}
              is the basis this company&rsquo;s books are kept on — each item valued by the method on
              its own master, falling back to the company default. The other three show what the same
              stock would be worth if one method were applied throughout. Nothing on this screen
              posts, revalues or saves anything;{' '}
              <Link to="/settings" className="font-semibold text-primary hover:underline">
                the default method is a company setting
              </Link>
              .
            </p>

            {comparison.answered < comparison.rows.length ? (
              <p className={cx('text-xs text-amber-700')} role="status">
                {comparison.rows.length - comparison.answered} of {comparison.rows.length} methods
                could not be valued at this date and are shown as unavailable.
              </p>
            ) : null}

            <Takeaways items={bullets} onLearnMore={() => setExplainerOpen(true)} />
          </>
        )}
      </RequirePermission>

      <MethodsExplainer open={explainerOpen} onClose={() => setExplainerOpen(false)} />
      <VarianceDrilldown
        row={drilldown}
        onClose={() => setDrilldown(null)}
        asOf={asOf}
        itemId={itemId}
        warehouseId={warehouseId}
        qtySign={compareScope || undefined}
      />
    </PageShell>
  )
}

export default MethodComparisonPage
