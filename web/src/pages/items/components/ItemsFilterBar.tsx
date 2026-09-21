import { useMemo, useRef, useState } from 'react'
import { useEffect } from 'react'
import { ChevronDown, LayoutGrid, LayoutList, SlidersHorizontal, X } from 'lucide-react'
import { SegmentedControl } from '../../../ui/SegmentedControl'
import { cx } from '../../../ui/cx'
import { humanize } from '../../../utils/format'
import type { ItemFormOptions } from '../../../services/items'

export type ItemsView = 'table' | 'cards'

export interface FilterChoice {
  value: string
  label: string
}

export interface FilterSpec {
  /** Query-string key — what lands in the URL and goes to the API. */
  name: string
  label: string
  choices: FilterChoice[]
  /** Kept out of the main row and shown inside "More filters". */
  secondary?: boolean
}

export interface ItemsFilterBarProps {
  filters: Record<string, string>
  onChange: (name: string, value: string) => void
  onClearAll: () => void
  options: ItemFormOptions | null
  view: ItemsView
  onView: (view: ItemsView) => void
  /**
   * False below `md`, where the table is not offered at all. Hidden rather than
   * disabled: a control that cannot do anything is better absent than present
   * and dead.
   */
  showViewSwitcher?: boolean
  /** Rendered at the right of the toolbar — the column configurator. */
  trailing?: React.ReactNode
}

const STATUS: FilterChoice[] = [
  { value: 'active', label: 'Active only' },
  { value: 'inactive', label: 'Inactive only' },
]

const STOCK_STATUS: FilterChoice[] = [
  { value: 'attention', label: 'Needs attention' },
  { value: 'negative', label: 'Negative stock' },
  { value: 'out', label: 'Out of stock' },
  { value: 'low', label: 'Low stock' },
  { value: 'in_stock', label: 'In stock' },
]

const TRACKING: FilterChoice[] = [
  { value: 'batch', label: 'Batch tracked' },
  { value: 'serial', label: 'Serial tracked' },
  { value: 'expiry', label: 'Expiry tracked' },
  { value: 'none', label: 'Not tracked' },
]

const PRESENCE: FilterChoice[] = [
  { value: '1', label: 'Present' },
  { value: '0', label: 'Missing' },
]

/**
 * Every filter the screen offers, in the order a stock controller reaches for
 * them, with the rarely-used half behind one more click.
 *
 * All of it lives in the query string (`useListParams`), which is what makes a
 * filtered view refresh-safe, Back-safe and shareable — "the 3 items below
 * reorder level in Raw Material" is a URL somebody can be sent.
 */
export function buildFilterSpecs(options: ItemFormOptions | null): FilterSpec[] {
  const o = options
  return [
    { name: 'status', label: 'Status', choices: STATUS },
    { name: 'stock_status', label: 'Stock', choices: STOCK_STATUS },
    { name: 'item_type', label: 'Type', choices: ['stock', 'service', 'non_stock'].map((t) => ({ value: t, label: humanize(t) })) },
    { name: 'item_grp_id', label: 'Group', choices: (o?.item_groups ?? []).map((g) => ({ value: String(g.item_grp_id), label: g.grp_name })) },
    { name: 'stock_cat_id', label: 'Category', choices: (o?.stock_categories ?? []).map((c) => ({ value: String(c.stock_cat_id), label: c.cat_name })) },
    { name: 'brand_id', label: 'Brand', choices: (o?.brands ?? []).map((b) => ({ value: String(b.brand_id), label: b.brand_name })) },
    { name: 'unit_id', label: 'Unit', choices: (o?.units ?? []).map((u) => ({ value: String(u.unit_id), label: u.unit_symbol ? `${u.unit_name} (${u.unit_symbol})` : u.unit_name })) },
    { name: 'valuation_method', label: 'Valuation', secondary: true, choices: (o?.valuation_methods ?? []).map((m) => ({ value: m, label: m })) },
    { name: 'tracking', label: 'Tracking', secondary: true, choices: TRACKING },
    { name: 'has_hsn', label: 'HSN code', secondary: true, choices: PRESENCE },
    { name: 'has_barcode', label: 'Barcode', secondary: true, choices: PRESENCE },
    { name: 'has_sku', label: 'SKU', secondary: true, choices: PRESENCE },
  ]
}

/** The human sentence for one applied filter — what the removable chip says. */
export function describeFilter(spec: FilterSpec, value: string): string {
  const choice = spec.choices.find((c) => c.value === value)
  return `${spec.label}: ${choice?.label ?? value}`
}

function FilterDropdown({
  spec,
  value,
  onChange,
}: {
  spec: FilterSpec
  value: string
  onChange: (value: string) => void
}) {
  const active = Boolean(value)
  const selected = spec.choices.find((c) => c.value === value)
  const id = `items-filter-${spec.name}`

  return (
    <div className="relative">
      <label htmlFor={id} className="sr-only">
        {spec.label}
      </label>
      {/*
       * A native <select> under a chip skin.
       *
       * A hand-rolled listbox here would owe keyboard support, screen-reader
       * semantics and mobile behaviour that the platform control already has —
       * on a phone this opens the OS picker, which is the right answer and one
       * no popover reproduces.
       */}
      <select
        id={id}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className={cx(
          'peer h-8 cursor-pointer appearance-none rounded-lg border py-0 pl-2.5 pr-7 text-xs font-medium transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40',
          active
            ? 'border-primary/30 bg-primary-light text-primary'
            : 'border-gray-200 bg-white text-gray-600 hover:bg-gray-50',
        )}
      >
        <option value="">{spec.label}</option>
        {spec.choices.map((c) => (
          <option key={c.value} value={c.value}>
            {c.label}
          </option>
        ))}
      </select>
      <ChevronDown
        className={cx('pointer-events-none absolute right-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2', active ? 'text-primary' : 'text-gray-400')}
        aria-hidden
      />
      <span className="sr-only">{selected ? `${spec.label} is ${selected.label}` : `${spec.label}: any`}</span>
    </div>
  )
}

export function ItemsFilterBar({
  filters,
  onChange,
  onClearAll,
  options,
  view,
  onView,
  showViewSwitcher = true,
  trailing,
}: ItemsFilterBarProps) {
  const specs = useMemo(() => buildFilterSpecs(options), [options])
  const primary = specs.filter((s) => !s.secondary)
  const secondary = specs.filter((s) => s.secondary)
  const [moreOpen, setMoreOpen] = useState(false)
  const moreRef = useRef<HTMLDivElement | null>(null)

  const applied = specs
    .map((spec) => ({ spec, value: filters[spec.name] ?? '' }))
    .filter((f) => f.value !== '')
  const secondaryCount = secondary.filter((s) => filters[s.name]).length

  useEffect(() => {
    if (!moreOpen) return undefined
    const onDown = (e: MouseEvent) => {
      if (moreRef.current && !moreRef.current.contains(e.target as Node)) setMoreOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setMoreOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [moreOpen])

  return (
    <div className="shrink-0 space-y-2 print:hidden">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-1.5">
          <button
            type="button"
            onClick={onClearAll}
            className={cx(
              'h-8 rounded-lg border px-2.5 text-xs font-medium transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40',
              applied.length === 0
                ? 'border-primary/30 bg-primary-light text-primary'
                : 'border-gray-200 bg-white text-gray-600 hover:bg-gray-50',
            )}
            aria-pressed={applied.length === 0}
          >
            All items
          </button>

          {primary.map((spec) => (
            <FilterDropdown
              key={spec.name}
              spec={spec}
              value={filters[spec.name] ?? ''}
              onChange={(v) => onChange(spec.name, v)}
            />
          ))}

          <div className="relative" ref={moreRef}>
            <button
              type="button"
              onClick={() => setMoreOpen((v) => !v)}
              aria-expanded={moreOpen}
              aria-haspopup="dialog"
              className={cx(
                'inline-flex h-8 items-center gap-1.5 rounded-lg border px-2.5 text-xs font-medium transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40',
                secondaryCount > 0
                  ? 'border-primary/30 bg-primary-light text-primary'
                  : 'border-gray-200 bg-white text-gray-600 hover:bg-gray-50',
              )}
            >
              <SlidersHorizontal className="h-3.5 w-3.5" aria-hidden />
              More filters
              {secondaryCount > 0 ? (
                <span className="rounded-full bg-primary px-1.5 text-[10px] font-bold text-white">{secondaryCount}</span>
              ) : null}
            </button>

            {moreOpen ? (
              <div
                role="dialog"
                aria-label="More filters"
                className="absolute left-0 top-9 z-40 w-72 rounded-xl border border-gray-200 bg-white p-3 shadow-overlay"
              >
                <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-gray-500">More filters</p>
                <div className="space-y-2.5">
                  {secondary.map((spec) => (
                    <div key={spec.name}>
                      <label
                        htmlFor={`items-more-${spec.name}`}
                        className="mb-1 block text-[11px] font-medium text-gray-600"
                      >
                        {spec.label}
                      </label>
                      <select
                        id={`items-more-${spec.name}`}
                        value={filters[spec.name] ?? ''}
                        onChange={(e) => onChange(spec.name, e.target.value)}
                        className="block h-8 w-full rounded-lg border border-gray-200 bg-white px-2 text-xs text-gray-900 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30"
                      >
                        <option value="">Any</option>
                        {spec.choices.map((c) => (
                          <option key={c.value} value={c.value}>
                            {c.label}
                          </option>
                        ))}
                      </select>
                    </div>
                  ))}
                </div>
              </div>
            ) : null}
          </div>
        </div>

        <div className="flex items-center gap-2">
          {trailing}
          {showViewSwitcher ? (
            <SegmentedControl<ItemsView>
              value={view}
              onChange={onView}
              options={[
                { value: 'table', label: <span className="inline-flex items-center gap-1"><LayoutList className="h-3.5 w-3.5" aria-hidden />Table</span>, title: 'Table view' },
                { value: 'cards', label: <span className="inline-flex items-center gap-1"><LayoutGrid className="h-3.5 w-3.5" aria-hidden />Cards</span>, title: 'Card view' },
              ]}
            />
          ) : null}
        </div>
      </div>

      {applied.length > 0 ? (
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-[11px] font-medium text-gray-500">Filtered by</span>
          {applied.map(({ spec, value }) => (
            <span
              key={spec.name}
              className="inline-flex items-center gap-1 rounded-full border border-primary/20 bg-primary-light py-0.5 pl-2 pr-1 text-[11px] font-medium text-primary"
            >
              {describeFilter(spec, value)}
              <button
                type="button"
                onClick={() => onChange(spec.name, '')}
                aria-label={`Remove filter ${describeFilter(spec, value)}`}
                className="inline-flex h-4 w-4 items-center justify-center rounded-full hover:bg-primary/15 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
              >
                <X className="h-3 w-3" aria-hidden />
              </button>
            </span>
          ))}
          <button
            type="button"
            onClick={onClearAll}
            className="rounded-lg px-2 py-0.5 text-[11px] font-semibold text-gray-500 hover:bg-gray-100 hover:text-gray-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
          >
            Clear all
          </button>
        </div>
      ) : null}
    </div>
  )
}
