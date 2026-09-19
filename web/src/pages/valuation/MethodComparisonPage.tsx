import { useMemo } from 'react'
import { Link } from 'react-router-dom'
import { Scale } from 'lucide-react'
import { useCompany } from '../../company/CompanyContext'
import { ItemFilter } from '../../components/ItemFilter'
import { RequirePermission } from '../../components/RequirePermission'
import { WarehouseSelect } from '../../documents/WarehouseSelect'
import { useReferenceData } from '../../documents/useReferenceData'
import { useListParams } from '../../hooks/useListParams'
import { useQuery } from '../../hooks/useQuery'
import { P } from '../../services/access'
import { METHOD_LABELS, REPORT_METHODS, valuationApi } from '../../services/valuationApi'
import type { ReportMethod, ValuationSnapshotSummary } from '../../services/valuationApi'
import { Card } from '../../ui/Card'
import { EmptyState } from '../../ui/EmptyState'
import { ErrorState } from '../../ui/ErrorState'
import { Input } from '../../ui/Input'
import { Skeleton } from '../../ui/Skeleton'
import { FilterField } from '../../ui/shell/FilterBar'
import { BreadcrumbHeader } from '../../ui/shell/BreadcrumbHeader'
import { PageShell } from '../../ui/shell/PageShell'
import { BAR_TRACK } from '../../dashboard/visuals'
import { formatCurrencyCompact } from '../../dashboard/formatters'
import { FILTER_CARD } from '../../styles/designTokens'
import { formatInt, formatMoney, formatQty, todayIso } from '../../utils/format'
import { cx } from '../../ui/cx'
import { ValuationTabs } from './ValuationLayout'

const FILTER_KEYS = ['as_of', 'item_id', 'warehouse_id'] as const

/** The basis the books are actually kept on; every difference is measured from it. */
const BASIS: ReportMethod = 'AS_PER_MASTER'

interface MethodResult {
  method: ReportMethod
  summary: ValuationSnapshotSummary | null
}

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
 * counterfactual and nothing here posts, revalues or saves anything.
 */
export function MethodComparisonPage() {
  const { scope } = useCompany()
  const { warehouses } = useReferenceData()
  const params = useListParams({ sort: 'item_name', limit: 1, filterKeys: FILTER_KEYS })
  const { state } = params

  const asOf = state.filters.as_of || todayIso()
  const itemId = state.filters.item_id ?? ''
  const warehouseId = state.filters.warehouse_id ?? ''

  const results = useQuery<MethodResult[]>(
    async (signal) =>
      Promise.all(
        REPORT_METHODS.map(async (method) => {
          try {
            const res = await valuationApi.snapshot(
              {
                as_of: asOf,
                method,
                item_id: itemId || undefined,
                warehouse_id: warehouseId || undefined,
                // The summary is computed over the whole filtered set before
                // the page is sliced, so one row buys the company total.
                limit: 1,
                page: 1,
              },
              signal,
            )
            return { method, summary: res.summary }
          } catch {
            return { method, summary: null }
          }
        }),
      ),
    [asOf, itemId, warehouseId, scope?.cmp_id, scope?.fy_id, scope?.bo_id],
    { enabled: scope !== null, resetKey: scope ? `${scope.cmp_id}:${scope.fy_id}:${scope.bo_id}` : null },
  )

  const rows = results.data ?? []
  const basis = rows.find((r) => r.method === BASIS)?.summary ?? null
  const maxValue = useMemo(
    () => Math.max(...rows.map((r) => Math.abs(r.summary?.total_value ?? 0)), 0),
    [rows],
  )
  const answered = rows.filter((r) => r.summary !== null).length

  return (
    <PageShell compact>
      <BreadcrumbHeader
        breadcrumbs={[{ label: 'Valuation', to: '/registers/valuation' }, { label: 'Method comparison' }]}
        title="Method comparison"
        description="What the same stock is worth under each valuation method, as at one date."
        icon={Scale}
        backTo="/registers/valuation"
      />

      <ValuationTabs />

      <RequirePermission permission={P.report('valuation')} what="Method comparison">
        <div className={cx(FILTER_CARD, 'flex flex-wrap items-end gap-3')}>
          <FilterField label="As at">
            <Input
              type="date"
              value={asOf}
              onChange={(e) => params.setFilter('as_of', e.target.value)}
              className="w-[9rem]"
              aria-label="As at date"
            />
          </FilterField>
          <div className="min-w-[13rem] max-w-[22rem] grow">
            <ItemFilter
              value={itemId}
              onChange={(id) => params.setFilter('item_id', id)}
              placeholder="Search item code or name…"
            />
          </div>
          <FilterField label="Warehouse">
            <WarehouseSelect
              value={warehouseId ? Number(warehouseId) : null}
              onChange={(id) => params.setFilter('warehouse_id', id ? String(id) : '')}
              warehouses={warehouses}
              emptyLabel="Whole company"
            />
          </FilterField>
        </div>

        {results.error ? (
          <ErrorState
            title="The comparison could not be run"
            description="The valuation service did not answer for this date. Try again, or pick another date."
            onRetry={results.reload}
          />
        ) : results.loading && rows.length === 0 ? (
          <Card padding="md" className="space-y-3">
            {REPORT_METHODS.map((m) => (
              <Skeleton key={m} height="h-12" />
            ))}
          </Card>
        ) : answered === 0 ? (
          <EmptyState
            icon={Scale}
            title="No valuation data found"
            description="No stock valuation is available for the selected date and filters."
          />
        ) : (
          <>
            <Card padding="none" className="overflow-hidden">
              <table className="w-full text-sm">
                <caption className="sr-only">
                  Total stock value, quantity and item count under each valuation method as at {asOf}.
                </caption>
                <thead>
                  <tr className="border-b border-gray-200 bg-gray-50 text-left">
                    <th scope="col" className="px-3 py-2 text-label-sm font-semibold uppercase tracking-wide text-gray-500">
                      Method
                    </th>
                    <th scope="col" className="px-3 py-2 text-right text-label-sm font-semibold uppercase tracking-wide text-gray-500">
                      Items
                    </th>
                    <th scope="col" className="px-3 py-2 text-right text-label-sm font-semibold uppercase tracking-wide text-gray-500">
                      Closing qty
                    </th>
                    <th scope="col" className="px-3 py-2 text-right text-label-sm font-semibold uppercase tracking-wide text-gray-500">
                      Stock value
                    </th>
                    <th scope="col" className="px-3 py-2 text-right text-label-sm font-semibold uppercase tracking-wide text-gray-500">
                      vs item master
                    </th>
                    <th scope="col" className="w-[28%] px-3 py-2 text-label-sm font-semibold uppercase tracking-wide text-gray-500">
                      Relative value
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => (
                    <MethodRow
                      key={row.method}
                      row={row}
                      basis={basis}
                      maxValue={maxValue}
                    />
                  ))}
                </tbody>
              </table>
            </Card>

            <p className="text-xs leading-relaxed text-gray-500">
              <strong className="font-semibold text-gray-700">As per item master</strong> is the
              basis this company&rsquo;s books are kept on — each item valued by the method on its
              own master, falling back to the company default. The other three show what the same
              stock would be worth if one method were applied throughout. Nothing on this screen
              posts, revalues or saves anything;{' '}
              <Link to="/settings" className="font-semibold text-primary hover:underline">
                the default method is a company setting
              </Link>
              .
            </p>
            {answered < rows.length ? (
              <p className="text-xs text-amber-700">
                {rows.length - answered} of {rows.length} methods could not be valued at this date
                and are shown as unavailable.
              </p>
            ) : null}
          </>
        )}
      </RequirePermission>
    </PageShell>
  )
}

function MethodRow({
  row,
  basis,
  maxValue,
}: {
  row: MethodResult
  basis: ValuationSnapshotSummary | null
  maxValue: number
}) {
  const s = row.summary
  const isBasis = row.method === BASIS
  const label = METHOD_LABELS[row.method]

  if (!s) {
    return (
      <tr className="border-b border-gray-100 last:border-b-0">
        <th scope="row" className="px-3 py-2.5 text-left font-semibold text-gray-900">
          {label}
        </th>
        <td colSpan={5} className="px-3 py-2.5 text-xs text-gray-500">
          Could not be valued at this date.
        </td>
      </tr>
    )
  }

  // Only against a basis that actually answered: a difference from a missing
  // figure is not zero, it is unknown.
  const delta = basis && !isBasis ? s.total_value - basis.total_value : null
  const width = maxValue > 0 ? Math.min(100, (Math.abs(s.total_value) / maxValue) * 100) : 0

  return (
    <tr className={cx('border-b border-gray-100 last:border-b-0', isBasis && 'bg-primary-light/30')}>
      <th scope="row" className="px-3 py-2.5 text-left font-semibold text-gray-900">
        {label}
        {isBasis ? (
          <span className="ml-1.5 rounded-full bg-primary-light px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-primary">
            Books basis
          </span>
        ) : null}
      </th>
      <td className="px-3 py-2.5 text-right tabular-nums text-gray-600">{formatInt(s.item_count)}</td>
      <td className="px-3 py-2.5 text-right tabular-nums text-gray-600">{formatQty(s.total_qty)}</td>
      <td className="px-3 py-2.5 text-right font-semibold tabular-nums text-gray-900">
        {formatMoney(s.total_value)}
      </td>
      <td
        className={cx(
          'px-3 py-2.5 text-right tabular-nums',
          delta === null ? 'text-gray-300' : delta > 0 ? 'text-emerald-600' : delta < 0 ? 'text-red-600' : 'text-gray-500',
        )}
      >
        {delta === null ? '—' : `${delta > 0 ? '+' : ''}${formatMoney(delta)}`}
      </td>
      <td className="px-3 py-2.5">
        <div className={cx('h-1.5 overflow-hidden rounded-full', BAR_TRACK)}>
          <div
            className={cx('h-full rounded-full', isBasis ? 'bg-primary' : 'bg-sky-500')}
            style={{ width: `${Math.max(s.total_value !== 0 ? 3 : 0, width)}%` }}
          />
        </div>
        <span className="sr-only">{formatCurrencyCompact(s.total_value)}</span>
      </td>
    </tr>
  )
}

export default MethodComparisonPage
