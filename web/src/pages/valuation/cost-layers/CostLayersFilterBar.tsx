import { ListFilter, RotateCcw } from 'lucide-react'
import type { ReactNode, RefObject } from 'react'
import { ItemFilter } from '../../../components/ItemFilter'
import { Button } from '../../../ui/Button'
import { Card } from '../../../ui/Card'
import { Select } from '../../../ui/Select'
import { Tooltip } from '../../../ui/Tooltip'
import { cx } from '../../../ui/cx'
import type { FormOptionWarehouse } from '../../../services/items'
import { METHOD_LABELS, REPORT_METHODS } from '../../../services/valuationApi'
import type { ReportMethod } from '../../../services/valuationApi'
import { QUICK_VIEWS } from './costLayersModel'
import type { PeriodOption } from './costLayersModel'

function Field({
  label,
  htmlFor,
  children,
  className,
}: {
  label: string
  htmlFor?: string
  children: ReactNode
  className?: string
}) {
  return (
    <div className={cx('flex min-w-0 flex-col gap-1', className)}>
      <label htmlFor={htmlFor} className="text-[11px] font-semibold text-gray-500">
        {label}
      </label>
      {children}
    </div>
  )
}

/**
 * The switch every list in this product has used for a yes/no filter, drawn as
 * a switch rather than a tick-box because it sits in a row of dropdowns and
 * reads as one control among them.
 */
function Toggle({
  checked,
  onChange,
  label,
  id,
}: {
  checked: boolean
  onChange: (next: boolean) => void
  label: string
  id: string
}) {
  return (
    <label
      htmlFor={id}
      className="aic inline-flex min-h-[2rem] cursor-pointer select-none items-center gap-2 whitespace-nowrap text-xs text-gray-600"
    >
      <input
        id={id}
        type="checkbox"
        role="switch"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="peer sr-only"
      />
      <span
        aria-hidden
        className={cx(
          'relative inline-flex h-[1.125rem] w-[1.875rem] shrink-0 rounded-full transition-colors',
          'peer-focus-visible:ring-2 peer-focus-visible:ring-primary/30',
          checked ? 'bg-primary' : 'bg-gray-300',
        )}
      >
        <span
          className={cx(
            'absolute top-[0.1875rem] left-[0.1875rem] h-3 w-3 rounded-full bg-white shadow-sm transition-transform',
            checked && 'translate-x-3',
          )}
        />
      </span>
      {label}
    </label>
  )
}

export interface CostLayersFilterBarProps {
  itemId: string
  /** The empty state focuses this box rather than hunting for it in the DOM. */
  itemSearchRef?: RefObject<HTMLInputElement | null>
  onItem: (itemId: string) => void
  warehouseId: string
  onWarehouse: (warehouseId: string) => void
  warehouses: readonly FormOptionWarehouse[]
  method: ReportMethod
  onMethod: (method: ReportMethod) => void
  /** Methods the company has actually enabled, when settings could be read. */
  allowedMethods?: readonly ReportMethod[] | null
  period: string
  periods: readonly PeriodOption[]
  onPeriod: (period: string) => void
  openOnly: boolean
  onOpenOnly: (next: boolean) => void
  onOpenMoreFilters: () => void
  moreFiltersOpen: boolean
  /** How many of the advanced filters are set — the count on the button. */
  moreFilterCount: number
  activeQuickView: string
  onQuickView: (key: string) => void
  onReset: () => void
  /** Any filter at all is set, so Reset is worth offering. */
  canReset: boolean
}

/**
 * The question the table answers, as controls.
 *
 * Every one of these writes to the URL and the API honours it server-side —
 * there is no filter here that quietly sifts the current page and calls itself
 * a filter. `Value at` is the exception worth naming: cost layers are recorded
 * under the item's own method, so that control re-values the SNAPSHOT beside
 * the table (what this stock would be worth under FIFO, LIFO or weighted
 * average) and never pretends to re-cut the layers themselves.
 */
export function CostLayersFilterBar({
  itemId,
  itemSearchRef,
  onItem,
  warehouseId,
  onWarehouse,
  warehouses,
  method,
  onMethod,
  allowedMethods,
  period,
  periods,
  onPeriod,
  openOnly,
  onOpenOnly,
  onOpenMoreFilters,
  moreFiltersOpen,
  moreFilterCount,
  activeQuickView,
  onQuickView,
  onReset,
  canReset,
}: CostLayersFilterBarProps) {
  const methods = allowedMethods && allowedMethods.length > 0 ? allowedMethods : REPORT_METHODS

  return (
    <Card padding="none" className="px-3 py-2.5 print:hidden">
      <div className="flex flex-wrap items-end gap-2.5">
        <Field label="Item" className="flex-[1_1_16rem]">
          <ItemFilter
            ref={itemSearchRef}
            value={itemId}
            onChange={onItem}
            placeholder="Search item by name, SKU or code…"
          />
        </Field>

        <Field label="Warehouse" htmlFor="cl-warehouse" className="flex-[0_1_10rem]">
          <Select
            id="cl-warehouse"
            value={warehouseId}
            onChange={(e) => onWarehouse(e.target.value)}
            className="w-full"
          >
            <option value="">All warehouses</option>
            {warehouses.map((w) => (
              <option key={w.warehouse_id} value={String(w.warehouse_id)}>
                {w.warehouse_name}
                {w.warehouse_code ? ` (${w.warehouse_code})` : ''}
              </option>
            ))}
          </Select>
        </Field>

        <Field label="Value at" htmlFor="cl-method" className="flex-[0_1_10rem]">
          <Tooltip
            className="w-full"
            label="Re-values the item snapshot beside the table. Layers keep the cost they were recorded at."
          >
            <Select
              id="cl-method"
              value={method}
              aria-describedby="cl-method-hint"
              onChange={(e) => onMethod(e.target.value as ReportMethod)}
              className="w-full"
            >
              {methods.map((m) => (
                <option key={m} value={m}>
                  {METHOD_LABELS[m] ?? m}
                </option>
              ))}
            </Select>
          </Tooltip>
          {/* The tooltip is for the mouse; this is the same sentence for
              everyone else, and it is the one a screen reader announces. */}
          <span id="cl-method-hint" className="sr-only">
            Re-values the item snapshot beside the table. The layers keep the cost they were recorded at.
          </span>
        </Field>

        <Field label="Period" htmlFor="cl-period" className="flex-[0_1_10rem]">
          <Select id="cl-period" value={period} onChange={(e) => onPeriod(e.target.value)} className="w-full">
            {periods.map((p) => (
              <option key={p.value || 'all'} value={p.value}>
                {p.label}
              </option>
            ))}
          </Select>
        </Field>

        <Toggle id="cl-open-only" checked={openOnly} onChange={onOpenOnly} label="Open layers only" />

        <Button
          variant="secondary"
          icon={ListFilter}
          onClick={onOpenMoreFilters}
          aria-expanded={moreFiltersOpen}
        >
          More filters
          {moreFilterCount > 0 ? (
            <span className="ml-1 inline-flex h-4 min-w-[1rem] items-center justify-center rounded-full bg-primary px-1 text-[10px] font-bold text-white">
              {moreFilterCount}
            </span>
          ) : null}
        </Button>

        {canReset ? (
          <Button variant="ghost" icon={RotateCcw} onClick={onReset}>
            Reset
          </Button>
        ) : null}
      </div>

      <div className="mt-2.5 flex flex-wrap items-center gap-1.5 border-t border-gray-100 pt-2.5">
        <span className="mr-0.5 text-[11px] font-bold text-gray-700">Quick filters:</span>
        {QUICK_VIEWS.map((view) => {
          const active = view.key === activeQuickView
          return (
            <Tooltip key={view.key} label={view.hint}>
              <button
                type="button"
                aria-pressed={active}
                onClick={() => onQuickView(view.key)}
                className={cx(
                  'aic inline-flex min-h-[1.75rem] items-center rounded-lg border px-2.5 text-[11.5px] transition-colors',
                  'focus:outline-none focus:ring-2 focus:ring-primary/30',
                  active
                    ? 'border-primary/40 bg-primary-light font-bold text-primary'
                    : 'border-gray-200 bg-gray-50 text-gray-600 hover:border-gray-300 hover:bg-gray-100 hover:text-gray-900',
                )}
              >
                {view.label}
              </button>
            </Tooltip>
          )
        })}
      </div>
    </Card>
  )
}

export default CostLayersFilterBar
