import type { ReactNode, RefObject } from 'react'
import { ItemFilter } from '../../../components/ItemFilter'
import { WarehouseSelect } from '../../../documents/WarehouseSelect'
import { useReferenceData } from '../../../documents/useReferenceData'
import { Input } from '../../../ui/Input'
import { Select } from '../../../ui/Select'
import { FilterField } from '../../../ui/shell/FilterBar'
import type { SnapshotQtySign } from '../../../services/valuationApi'

/** What the comparison is run over. `''` is the whole snapshot. */
export type CompareScope = '' | SnapshotQtySign

export const COMPARE_SCOPES: { value: CompareScope; label: string }[] = [
  { value: '', label: 'All items in stock' },
  { value: 'positive', label: 'Positive stock only' },
  { value: 'negative', label: 'Negative stock only' },
]

/** The scope, said in words, for the export letterhead and the sheet's meta. */
export function compareScopeLabel(scope: CompareScope): string {
  return COMPARE_SCOPES.find((s) => s.value === scope)?.label ?? COMPARE_SCOPES[0].label
}

export interface MethodComparisonFiltersProps {
  asOf: string
  onAsOf: (value: string) => void
  itemId: string
  onItemId: (value: string) => void
  warehouseId: string
  onWarehouseId: (value: string) => void
  scope: CompareScope
  onScope: (value: CompareScope) => void
  /** Refresh, Export and Print — the shared sheet actions. */
  actions?: ReactNode
  dateRef?: RefObject<HTMLInputElement | null>
  warehouseRef?: RefObject<HTMLSelectElement | null>
}

/**
 * The one bar that decides what is being compared: a date, an optional item, a
 * warehouse and how much of the stock to count.
 *
 * Every control writes straight to the URL (see the page's `useListParams`), so
 * the comparison re-runs as it changes and a link to this screen carries the
 * whole question with it. There is deliberately no "Apply" gate — a reader
 * changing the date wants the figures for that date, not a second click.
 *
 * The item control is the app's own typeahead rather than a free-text box: the
 * valuation endpoint compares an item, not a phrase, and the typeahead is what
 * turns "brass" into the item id it will accept. It already searches name,
 * alias, SKU and barcode, and already debounces.
 */
export function MethodComparisonFilters({
  asOf,
  onAsOf,
  itemId,
  onItemId,
  warehouseId,
  onWarehouseId,
  scope,
  onScope,
  actions,
  dateRef,
  warehouseRef,
}: MethodComparisonFiltersProps) {
  const { warehouses } = useReferenceData()

  return (
    <section
      className="aic shrink-0 rounded-xl border border-gray-200 bg-white px-4 py-3.5 shadow-card print:hidden"
      aria-label="Comparison filters"
    >
      {/*
        The controls take the row; the actions sit at its right and drop to a
        line of their own when they no longer fit. Refresh, Export and Print
        carry shortcut chips and run to about 330px, which on a 1440px screen
        beside four labelled fields is a row that would have to truncate
        something — and a truncated date field is worse than a second line.
      */}
      <div className="flex flex-wrap items-end justify-end gap-x-4 gap-y-3">
        <div className="grid min-w-0 flex-1 basis-[38rem] grid-cols-1 items-end gap-x-4 gap-y-3 sm:grid-cols-2 xl:grid-cols-[minmax(9rem,0.8fr)_minmax(14rem,1.4fr)_minmax(11rem,1fr)_minmax(11rem,1fr)]">
        <FilterField label="As at date" stacked className="min-w-0 w-full">
          <Input
            ref={dateRef}
            type="date"
            size="md"
            value={asOf}
            onChange={(e) => onAsOf(e.target.value)}
            className="w-full"
            aria-label="As at date"
          />
        </FilterField>

        <FilterField label="Item code or name" stacked className="min-w-0 w-full">
          {/* ItemFilter caps itself at 22rem; the wrapper lets the cell decide. */}
          <div className="w-full [&>div]:!max-w-none [&>div]:w-full">
            <ItemFilter value={itemId} onChange={onItemId} placeholder="Search items…" />
          </div>
        </FilterField>

        <FilterField label="Warehouse / company" stacked className="min-w-0 w-full">
          <WarehouseSelect
            ref={warehouseRef}
            value={warehouseId ? Number(warehouseId) : null}
            onChange={(id) => onWarehouseId(id ? String(id) : '')}
            warehouses={warehouses}
            emptyLabel="Whole company"
            className="w-full"
          />
        </FilterField>

        <FilterField label="Compare scope" stacked className="min-w-0 w-full">
          <Select
            size="md"
            value={scope}
            onChange={(e) => onScope(e.target.value as CompareScope)}
            aria-label="Compare scope"
            className="w-full"
          >
            {COMPARE_SCOPES.map((s) => (
              <option key={s.value || 'all'} value={s.value}>
                {s.label}
              </option>
            ))}
          </Select>
        </FilterField>
        </div>

        {actions ? (
          <div className="flex shrink-0 flex-wrap items-center justify-end gap-2">{actions}</div>
        ) : null}
      </div>
    </section>
  )
}

export default MethodComparisonFilters
