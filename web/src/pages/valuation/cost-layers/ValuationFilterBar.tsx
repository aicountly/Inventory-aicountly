import { useId } from 'react'
import type { ReactNode } from 'react'
import { Filter, RotateCcw, SlidersHorizontal } from 'lucide-react'
import { Badge } from '../../../ui/Badge'
import { Button } from '../../../ui/Button'
import { Card } from '../../../ui/Card'
import { Input } from '../../../ui/Input'
import { Select } from '../../../ui/Select'
import { Tooltip } from '../../../ui/Tooltip'
import { cx } from '../../../ui/cx'
import { Modal } from '../../../components/Modal'
import { ItemFilter } from '../../../components/ItemFilter'
import { WarehouseSelect } from '../../../documents/WarehouseSelect'
import type { FormOptionWarehouse } from '../../../services/items'
import type { BatchRow } from '../../../services/lookupApi'
import { METHOD_LABELS, REPORT_METHODS } from '../../../services/valuationApi'
import { QUICK_FILTERS } from '../costLayerModel'

export interface CostLayerFilterValues {
  itemId: string
  warehouseId: string
  layerKind: string
  method: string
  openOnly: boolean
  allFy: boolean
  quick: string
  batchId: string
  receivedFrom: string
  receivedTo: string
  costMin: string
  costMax: string
  unlinked: boolean
}

export interface ValuationFilterBarProps {
  values: CostLayerFilterValues
  onChange: (key: keyof CostLayerFilterValues, value: string) => void
  onReset: () => void
  warehouses: FormOptionWarehouse[]
  batches: BatchRow[]
  moreOpen: boolean
  onMoreOpen: (open: boolean) => void
  /** Count of refinements the server cannot express that are currently on. */
  refinementCount: number
}

/**
 * A labelled control in the bar. Stacked rather than inline: five filters with
 * leading labels wrap into an unreadable ribbon by 1280px, and the label is
 * what tells a reader that "All warehouses" is a filter and not a heading.
 */
function Field({
  label,
  htmlFor,
  hint,
  className,
  children,
}: {
  label: string
  htmlFor?: string
  hint?: string
  className?: string
  children: ReactNode
}) {
  return (
    <div className={cx('flex min-w-0 flex-col gap-1', className)}>
      <label
        htmlFor={htmlFor}
        className="text-[11px] font-semibold uppercase tracking-wide text-gray-500"
        title={hint}
      >
        {label}
      </label>
      {children}
    </div>
  )
}

/**
 * The open-layers switch.
 *
 * A real checkbox under the paint: the visible track is `aria-hidden`
 * decoration and every keyboard, screen reader and form behaviour comes from
 * the input, which is what a `role="switch"` div would have had to reimplement
 * and get wrong.
 */
export function Toggle({
  checked,
  onChange,
  label,
  id,
}: {
  checked: boolean
  onChange: (next: boolean) => void
  label: string
  id?: string
}) {
  const fallbackId = useId()
  const inputId = id ?? fallbackId
  return (
    <label
      htmlFor={inputId}
      className="inline-flex cursor-pointer select-none items-center gap-2 text-xs font-medium text-gray-600"
    >
      <span className="relative inline-flex h-[18px] w-[30px] shrink-0 items-center">
        <input
          id={inputId}
          type="checkbox"
          checked={checked}
          onChange={(e) => onChange(e.target.checked)}
          className="peer absolute h-full w-full cursor-pointer opacity-0"
        />
        <span
          aria-hidden
          className={cx(
            'pointer-events-none h-[18px] w-[30px] rounded-full transition-colors peer-focus-visible:ring-2 peer-focus-visible:ring-primary/40 peer-focus-visible:ring-offset-1',
            checked ? 'bg-primary' : 'bg-gray-300',
          )}
        />
        <span
          aria-hidden
          className={cx(
            'pointer-events-none absolute top-[3px] h-3 w-3 rounded-full bg-white shadow transition-transform',
            checked ? 'translate-x-[15px]' : 'translate-x-[3px]',
          )}
        />
      </span>
      {label}
    </label>
  )
}

export function ValuationFilterBar({
  values,
  onChange,
  onReset,
  warehouses,
  batches,
  moreOpen,
  onMoreOpen,
  refinementCount,
}: ValuationFilterBarProps) {
  const ids = useId()

  return (
    <Card padding="none" className="shrink-0 px-3 py-2.5 print:hidden">
      <div className="flex flex-wrap items-end gap-x-3 gap-y-2.5">
        <Field label="Item" className="min-w-[14rem] flex-1 basis-[18rem]">
          <ItemFilter
            value={values.itemId}
            onChange={(id) => onChange('itemId', id)}
            placeholder="Search item by name, SKU or code…"
          />
        </Field>

        <Field label="Warehouse" htmlFor={`${ids}-wh`} className="basis-[10rem]">
          <WarehouseSelect
            id={`${ids}-wh`}
            value={values.warehouseId ? Number(values.warehouseId) : null}
            onChange={(id) => onChange('warehouseId', id ? String(id) : '')}
            warehouses={warehouses}
            emptyLabel="All warehouses"
          />
        </Field>

        {/*
         * Cost basis, not "valuation method of these layers". A layer is
         * recorded at the cost the item's own method produced when it opened
         * and nothing here re-costs it; what this changes is the basis the
         * snapshot figures beside the grid are read at, which is a real
         * parameter of `GET /v1/valuation`.
         */}
        <Field
          label="Cost basis"
          htmlFor={`${ids}-method`}
          hint="The method the snapshot figures are read at. Layer costs are recorded under the item's own method."
          className="basis-[11rem]"
        >
          <Select
            id={`${ids}-method`}
            value={values.method}
            onChange={(e) => onChange('method', e.target.value)}
          >
            {REPORT_METHODS.map((m) => (
              <option key={m} value={m}>
                {METHOD_LABELS[m]}
              </option>
            ))}
          </Select>
        </Field>

        <Field label="Layer type" htmlFor={`${ids}-kind`} className="basis-[9rem]">
          <Select
            id={`${ids}-kind`}
            value={values.layerKind}
            onChange={(e) => onChange('layerKind', e.target.value)}
          >
            <option value="">All types</option>
            <option value="opening">Opening</option>
            <option value="receipt">Receipt</option>
            <option value="backorder">Backorder</option>
            <option value="revaluation">Revaluation</option>
          </Select>
        </Field>

        {/*
         * "Period" on the mock. Inventory scopes cost layers by financial year,
         * not by month — the layer belongs to the year its receipt was posted
         * in — so the control offers the scope the server actually has rather
         * than a month picker that would silently do nothing.
         */}
        <Field label="Period" htmlFor={`${ids}-fy`} className="basis-[11rem]">
          <Select
            id={`${ids}-fy`}
            value={values.allFy ? 'all' : 'fy'}
            onChange={(e) => onChange('allFy', e.target.value === 'all' ? '1' : '')}
          >
            <option value="fy">This financial year</option>
            <option value="all">All financial years</option>
          </Select>
        </Field>

        <div className="flex items-center gap-2 pb-1.5">
          <Toggle
            id={`${ids}-open`}
            checked={values.openOnly}
            onChange={(next) => onChange('openOnly', next ? '' : '0')}
            label="Open layers only"
          />
          <Tooltip label="Filters the server cannot express — batch, date window, cost band">
            <Button
              variant="secondary"
              size="sm"
              icon={SlidersHorizontal}
              aria-expanded={moreOpen}
              aria-haspopup="dialog"
              onClick={() => onMoreOpen(true)}
            >
              More filters
              {refinementCount > 0 ? (
                <Badge tone="primary" size="xs" className="ml-1.5 normal-case">
                  {refinementCount}
                </Badge>
              ) : null}
            </Button>
          </Tooltip>
        </div>
      </div>

      <div className="mt-2.5 flex flex-wrap items-center gap-1.5 border-t border-gray-100 pt-2.5">
        <span className="mr-0.5 inline-flex items-center gap-1 text-[11px] font-semibold text-gray-700">
          <Filter className="h-3 w-3 text-gray-400" aria-hidden />
          Quick filters
        </span>
        {QUICK_FILTERS.map((chip) => {
          const active = values.quick === chip.key || (chip.key === 'all' && !values.quick)
          return (
            <button
              key={chip.key}
              type="button"
              title={chip.hint}
              aria-pressed={active}
              onClick={() => onChange('quick', chip.key === 'all' ? '' : chip.key)}
              className={cx(
                'inline-flex h-7 items-center rounded-lg border px-2.5 text-[11px] transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/30',
                active
                  ? 'border-primary/40 bg-primary-light font-semibold text-primary'
                  : 'border-gray-200 bg-gray-50 text-gray-600 hover:border-gray-300 hover:bg-gray-100 hover:text-gray-900',
              )}
            >
              {chip.label}
            </button>
          )
        })}
        <Button
          variant="ghost"
          size="xs"
          icon={RotateCcw}
          onClick={onReset}
          className="ml-auto"
          title="Clear every filter on this screen"
        >
          Reset
        </Button>
      </div>

      <MoreFiltersDialog
        open={moreOpen}
        onClose={() => onMoreOpen(false)}
        values={values}
        onChange={onChange}
        batches={batches}
      />
    </Card>
  )
}

/**
 * The refinements with no server parameter.
 *
 * They are separated from the bar above on purpose and the dialog says which
 * they are: the controls up there narrow the query, these narrow the answer it
 * came back with, and a reader who does not know the difference cannot judge
 * whether "3 layers" means three in the company or three in the window the
 * screen read.
 */
function MoreFiltersDialog({
  open,
  onClose,
  values,
  onChange,
  batches,
}: {
  open: boolean
  onClose: () => void
  values: CostLayerFilterValues
  onChange: (key: keyof CostLayerFilterValues, value: string) => void
  batches: BatchRow[]
}) {
  const ids = useId()
  return (
    <Modal
      open={open}
      title="More filters"
      description="Applied to the layers this screen has loaded for the selected item."
      onClose={onClose}
      size="md"
      footer={
        <>
          <Button
            variant="ghost"
            onClick={() => {
              for (const key of ['batchId', 'receivedFrom', 'receivedTo', 'costMin', 'costMax'] as const) {
                onChange(key, '')
              }
              onChange('unlinked', '')
            }}
          >
            Clear refinements
          </Button>
          <Button onClick={onClose}>Done</Button>
        </>
      }
    >
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field label="Batch / lot" htmlFor={`${ids}-batch`} className="sm:col-span-2">
          <Select
            id={`${ids}-batch`}
            value={values.batchId}
            onChange={(e) => onChange('batchId', e.target.value)}
            disabled={batches.length === 0}
          >
            <option value="">{batches.length === 0 ? 'This item is not batch tracked' : 'Any batch'}</option>
            {batches.map((b) => (
              <option key={b.batch_id} value={String(b.batch_id)}>
                {b.batch_no}
                {b.lot_no ? ` / ${b.lot_no}` : ''}
                {b.expiry_date ? ` · expires ${b.expiry_date}` : ''}
              </option>
            ))}
          </Select>
        </Field>

        <Field label="Received from" htmlFor={`${ids}-from`}>
          <Input
            id={`${ids}-from`}
            type="date"
            value={values.receivedFrom}
            onChange={(e) => onChange('receivedFrom', e.target.value)}
          />
        </Field>
        <Field label="Received to" htmlFor={`${ids}-to`}>
          <Input
            id={`${ids}-to`}
            type="date"
            value={values.receivedTo}
            onChange={(e) => onChange('receivedTo', e.target.value)}
          />
        </Field>

        <Field label="Unit cost from" htmlFor={`${ids}-cmin`}>
          <Input
            id={`${ids}-cmin`}
            type="number"
            inputMode="decimal"
            step="0.0001"
            value={values.costMin}
            onChange={(e) => onChange('costMin', e.target.value)}
            placeholder="0.0000"
          />
        </Field>
        <Field label="Unit cost to" htmlFor={`${ids}-cmax`}>
          <Input
            id={`${ids}-cmax`}
            type="number"
            inputMode="decimal"
            step="0.0001"
            value={values.costMax}
            onChange={(e) => onChange('costMax', e.target.value)}
            placeholder="No limit"
          />
        </Field>

        <label className="flex items-center gap-2 text-xs text-gray-600 sm:col-span-2">
          <input
            type="checkbox"
            checked={values.unlinked}
            onChange={(e) => onChange('unlinked', e.target.checked ? '1' : '')}
            className="h-3.5 w-3.5 rounded border-gray-300 text-primary focus:ring-primary/30"
          />
          Only layers with no source document — a receipt that cannot be traced on audit
        </label>
      </div>

      <p className="mt-3 rounded-lg bg-gray-50 px-3 py-2 text-[11px] leading-relaxed text-gray-500">
        The item, warehouse, layer type, period and open-only controls are sent to the valuation
        service and narrow the query itself. The refinements above are applied to the layers already
        loaded for this item, so the grid count reflects what was read, not a fresh server count.
      </p>
    </Modal>
  )
}

export default ValuationFilterBar
