import { useEffect, useMemo, useState } from 'react'
import type { FormEvent, RefObject } from 'react'
import { CalendarDays, Filter, RotateCcw, Search, SlidersHorizontal, X } from 'lucide-react'
import { ItemFilter } from '../../../components/ItemFilter'
import { Button } from '../../../ui/Button'
import { Input } from '../../../ui/Input'
import { Select } from '../../../ui/Select'
import { AIC, cx } from '../../../ui/cx'
import { FILTER_LABEL_COMPACT } from '../../../styles/designTokens'
import type { ItemFormOptions } from '../../../services/items'
import { BATCH_STATUSES } from '../../../services/masters'
import { humanize } from '../../../utils/format'
import { EXPIRY_PRESETS } from './batchPresentation'

/**
 * The toolbar above the batch table.
 *
 * Two behaviours, and the split is deliberate:
 *
 *  - The search box and the six primary controls apply immediately. They are
 *    how a warehouse clerk sweeps — pick a warehouse, pick "next 30 days", look
 *    — and an Apply button between every glance would make the strip useless.
 *    Search is debounced by the page so a keystroke is not a request.
 *  - "More filters" is a DRAFT until Apply. It sets four or five things at once
 *    (a group, a category, a manufacturing window) and wants one query at the
 *    end, not five intermediate ones.
 *
 * Every control writes to the URL, so the view is a link: a colleague opening
 * `?health=expiring&warehouse_id=3` sees the rows this reader is looking at.
 */

/** Every filter key this toolbar owns — what "Clear" clears, exactly. */
export const BATCH_FILTER_KEYS = [
  'status',
  'health',
  'item_id',
  'warehouse_id',
  'expiry',
  'expiry_from',
  'expiry_to',
  'item_grp_id',
  'stock_cat_id',
  'brand_id',
  'lot_no',
  'mfg_from',
  'mfg_to',
  'stock',
] as const

export type BatchFilterValues = Record<string, string>

/** Opened on arrival when one of these already carries a value. */
const ADVANCED_KEYS = ['item_grp_id', 'stock_cat_id', 'brand_id', 'lot_no', 'mfg_from', 'mfg_to', 'stock'] as const

const STOCK_OPTIONS = [
  { value: '', label: 'Any quantity' },
  { value: 'with', label: 'On hand above zero' },
  { value: 'zero', label: 'Zero on hand' },
]

const HEALTH_OPTIONS = [
  { value: '', label: 'Any expiry health' },
  { value: 'active', label: 'Healthy' },
  { value: 'expiring', label: 'Expiring soon' },
  { value: 'expired', label: 'Expired' },
  { value: 'inactive', label: 'On hold or closed' },
]

export interface BatchFiltersProps {
  /** The committed filters, as held in the URL. */
  filters: BatchFilterValues
  /** One filter, one navigation. */
  onSet: (key: string, value: string) => void
  /** Several filters in one navigation — the advanced panel and the presets. */
  onSetMany: (patch: BatchFilterValues) => void
  /** Drops every filter AND the search term. */
  onClear: () => void
  search: string
  onSearchChange: (value: string) => void
  options: ItemFormOptions | null
  searchInputRef?: RefObject<HTMLInputElement | null>
  disabled?: boolean
}

function labelFor(key: string, value: string, options: ItemFormOptions | null): string {
  const named = (list: { label: string; id: number }[]) =>
    list.find((o) => String(o.id) === value)?.label ?? `#${value}`
  switch (key) {
    case 'status':
      return `Status: ${humanize(value)}`
    case 'health':
      return `Health: ${HEALTH_OPTIONS.find((o) => o.value === value)?.label ?? humanize(value)}`
    case 'item_id':
      return `Item #${value}`
    case 'warehouse_id':
      return `Warehouse: ${named((options?.warehouses ?? []).map((w) => ({ id: w.warehouse_id, label: w.warehouse_name })))}`
    case 'expiry':
      return EXPIRY_PRESETS.find((p) => p.value === value)?.label ?? humanize(value)
    case 'expiry_from':
      return `Expires from ${value}`
    case 'expiry_to':
      return `Expires to ${value}`
    case 'item_grp_id':
      return `Group: ${named((options?.item_groups ?? []).map((g) => ({ id: g.item_grp_id, label: g.grp_name })))}`
    case 'stock_cat_id':
      return `Category: ${named((options?.stock_categories ?? []).map((c) => ({ id: c.stock_cat_id, label: c.cat_name })))}`
    case 'brand_id':
      return `Brand: ${named((options?.brands ?? []).map((b) => ({ id: b.brand_id, label: b.brand_name })))}`
    case 'lot_no':
      return `Lot: ${value}`
    case 'mfg_from':
      return `Made from ${value}`
    case 'mfg_to':
      return `Made to ${value}`
    case 'stock':
      return STOCK_OPTIONS.find((o) => o.value === value)?.label ?? humanize(value)
    default:
      return `${humanize(key)}: ${value}`
  }
}

export function BatchFilters({
  filters,
  onSet,
  onSetMany,
  onClear,
  search,
  onSearchChange,
  options,
  searchInputRef,
  disabled = false,
}: BatchFiltersProps) {
  const committedKey = JSON.stringify(filters)
  const [draft, setDraft] = useState<BatchFilterValues>(filters)
  const [showAdvanced, setShowAdvanced] = useState(() =>
    ADVANCED_KEYS.some((k) => (filters[k] ?? '') !== ''),
  )

  // Resync whenever the committed set changes from anywhere else — a removed
  // chip, Clear, a KPI card, the browser's Back button.
  useEffect(() => {
    setDraft(JSON.parse(committedKey) as BatchFilterValues)
  }, [committedKey])

  const setDraftValue = (key: string, value: string) => setDraft((d) => ({ ...d, [key]: value }))

  const advancedDirty = useMemo(
    () => ADVANCED_KEYS.some((k) => (draft[k] ?? '') !== (filters[k] ?? '')),
    [draft, filters],
  )

  const active = useMemo(
    () =>
      BATCH_FILTER_KEYS.filter((k) => (filters[k] ?? '') !== '')
        // The two date inputs ARE the custom preset; showing all three would be
        // one filter wearing three chips.
        .filter((k) => !(k === 'expiry' && filters.expiry === 'custom'))
        .map((k) => ({ key: k as string, value: filters[k] as string })),
    [filters],
  )

  const showCustomRange = filters.expiry === 'custom' || !!filters.expiry_from || !!filters.expiry_to

  const applyAdvanced = (e: FormEvent) => {
    e.preventDefault()
    onSetMany(Object.fromEntries(ADVANCED_KEYS.map((k) => [k, draft[k] ?? ''])))
  }

  /** Picking a preset drops any custom range it replaces, in one navigation. */
  const setExpiryPreset = (value: string) => {
    onSetMany(
      value === 'custom'
        ? { expiry: 'custom' }
        : { expiry: value, expiry_from: '', expiry_to: '' },
    )
  }

  return (
    <div className={cx(AIC, 'border-b border-gray-200 px-3 py-2.5 print:hidden')}>
      {/* One row only once there is room for six controls: the panel is at its
          narrowest beside the analytics rail, and six columns there would leave
          each select about 120px. */}
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3 wide:grid-cols-[minmax(13rem,1.5fr)_minmax(8rem,0.7fr)_minmax(11rem,1.1fr)_minmax(9rem,0.9fr)_minmax(9rem,0.9fr)_auto]">
        {/* `self-start` so the box keeps its own height: stretched by the grid
            it grows with the row, and the shortcut chip centred inside it would
            drift below the field whenever a neighbour wraps. */}
        <div className="relative self-start">
          <Input
            ref={searchInputRef}
            type="search"
            size="md"
            value={search}
            disabled={disabled}
            onChange={(e) => onSearchChange(e.target.value)}
            leadingIcon={Search}
            placeholder="Search by batch, item, lot or SKU…"
            aria-label="Search batches"
            className="w-full [&_input]:pr-8"
          />
          <span className="kbd pointer-events-none absolute right-2 top-1/2 -translate-y-1/2" aria-hidden>
            /
          </span>
        </div>

        <Select
          size="md"
          aria-label="Filter by batch status"
          value={filters.status ?? ''}
          disabled={disabled}
          onChange={(e) => onSet('status', e.target.value)}
        >
          <option value="">All statuses</option>
          {BATCH_STATUSES.map((s) => (
            <option key={s} value={s}>
              {humanize(s)}
            </option>
          ))}
        </Select>

        <ItemFilter
          value={filters.item_id ?? ''}
          onChange={(id) => onSet('item_id', id)}
          placeholder="All items"
        />

        <Select
          size="md"
          aria-label="Filter by warehouse"
          value={filters.warehouse_id ?? ''}
          disabled={disabled}
          onChange={(e) => onSet('warehouse_id', e.target.value)}
          title="Batches with stock recorded in this warehouse. On-hand figures narrow to it too."
        >
          <option value="">All warehouses</option>
          {(options?.warehouses ?? []).map((w) => (
            <option key={w.warehouse_id} value={String(w.warehouse_id)}>
              {w.warehouse_name}
            </option>
          ))}
        </Select>

        <Select
          size="md"
          aria-label="Filter by expiry date"
          value={filters.expiry ?? ''}
          disabled={disabled}
          onChange={(e) => setExpiryPreset(e.target.value)}
        >
          {EXPIRY_PRESETS.map((p) => (
            <option key={p.value || 'all'} value={p.value}>
              {p.label}
            </option>
          ))}
        </Select>

        <div className="flex flex-wrap items-center gap-1.5">
          <Button
            type="button"
            variant={showAdvanced ? 'outline' : 'secondary'}
            size="md"
            icon={SlidersHorizontal}
            onClick={() => setShowAdvanced((v) => !v)}
            aria-expanded={showAdvanced}
            aria-controls="batch-advanced-filters"
          >
            More filters
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="md"
            icon={RotateCcw}
            onClick={onClear}
            disabled={active.length === 0 && search === ''}
          >
            Clear
          </Button>
        </div>
      </div>

      {showCustomRange ? (
        <div className="mt-2 flex flex-wrap items-center gap-2 rounded-lg bg-gray-50 px-2.5 py-2">
          <CalendarDays className="h-4 w-4 shrink-0 text-gray-400" aria-hidden />
          <span className={FILTER_LABEL_COMPACT}>Expires between</span>
          <Input
            type="date"
            size="md"
            className="w-[9.5rem]"
            aria-label="Expiring on or after"
            value={filters.expiry_from ?? ''}
            max={filters.expiry_to || undefined}
            onChange={(e) => onSetMany({ expiry: 'custom', expiry_from: e.target.value })}
          />
          <span className="text-xs text-gray-400">and</span>
          <Input
            type="date"
            size="md"
            className="w-[9.5rem]"
            aria-label="Expiring on or before"
            value={filters.expiry_to ?? ''}
            min={filters.expiry_from || undefined}
            onChange={(e) => onSetMany({ expiry: 'custom', expiry_to: e.target.value })}
          />
        </div>
      ) : null}

      {showAdvanced ? (
        <form
          id="batch-advanced-filters"
          className="mt-2 grid grid-cols-1 gap-2 border-t border-gray-100 pt-2.5 sm:grid-cols-2 lg:grid-cols-4"
          onSubmit={applyAdvanced}
        >
          <Select
            size="md"
            aria-label="Filter by item group"
            value={draft.item_grp_id ?? ''}
            onChange={(e) => setDraftValue('item_grp_id', e.target.value)}
          >
            <option value="">All item groups</option>
            {(options?.item_groups ?? []).map((g) => (
              <option key={g.item_grp_id} value={String(g.item_grp_id)}>
                {g.grp_name}
              </option>
            ))}
          </Select>

          <Select
            size="md"
            aria-label="Filter by stock category"
            value={draft.stock_cat_id ?? ''}
            onChange={(e) => setDraftValue('stock_cat_id', e.target.value)}
          >
            <option value="">All stock categories</option>
            {(options?.stock_categories ?? []).map((c) => (
              <option key={c.stock_cat_id} value={String(c.stock_cat_id)}>
                {c.cat_name}
              </option>
            ))}
          </Select>

          <Select
            size="md"
            aria-label="Filter by brand"
            value={draft.brand_id ?? ''}
            onChange={(e) => setDraftValue('brand_id', e.target.value)}
          >
            <option value="">All brands</option>
            {(options?.brands ?? []).map((b) => (
              <option key={b.brand_id} value={String(b.brand_id)}>
                {b.brand_name}
              </option>
            ))}
          </Select>

          <Input
            size="md"
            placeholder="Lot number"
            aria-label="Lot number"
            value={draft.lot_no ?? ''}
            onChange={(e) => setDraftValue('lot_no', e.target.value)}
          />

          <label className={cx(AIC, 'flex items-center gap-1.5')}>
            <span className={FILTER_LABEL_COMPACT}>Made from</span>
            <Input
              type="date"
              size="md"
              className="w-full"
              value={draft.mfg_from ?? ''}
              max={draft.mfg_to || undefined}
              onChange={(e) => setDraftValue('mfg_from', e.target.value)}
            />
          </label>

          <label className={cx(AIC, 'flex items-center gap-1.5')}>
            <span className={FILTER_LABEL_COMPACT}>Made to</span>
            <Input
              type="date"
              size="md"
              className="w-full"
              value={draft.mfg_to ?? ''}
              min={draft.mfg_from || undefined}
              onChange={(e) => setDraftValue('mfg_to', e.target.value)}
            />
          </label>

          <Select
            size="md"
            aria-label="Filter by on-hand quantity"
            value={draft.stock ?? ''}
            onChange={(e) => setDraftValue('stock', e.target.value)}
          >
            {STOCK_OPTIONS.map((o) => (
              <option key={o.value || 'any'} value={o.value}>
                {o.label}
              </option>
            ))}
          </Select>

          <div className="flex items-center gap-1.5">
            <Button type="submit" size="md" icon={Filter} disabled={!advancedDirty}>
              Apply
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="md"
              onClick={() => onSetMany(Object.fromEntries(ADVANCED_KEYS.map((k) => [k, ''])))}
              disabled={ADVANCED_KEYS.every((k) => (filters[k] ?? '') === '')}
            >
              Reset these
            </Button>
          </div>
        </form>
      ) : null}

      {active.length > 0 ? (
        <div className="mt-2 flex flex-wrap items-center gap-1.5 border-t border-gray-100 pt-2.5">
          <span className={FILTER_LABEL_COMPACT}>Filtering by</span>
          {active.map(({ key, value }) => (
            <button
              key={key}
              type="button"
              onClick={() =>
                onSetMany(
                  key === 'expiry_from' || key === 'expiry_to'
                    ? { [key]: '', ...(filters.expiry === 'custom' && !filters[key === 'expiry_from' ? 'expiry_to' : 'expiry_from'] ? { expiry: '' } : {}) }
                    : { [key]: '' },
                )
              }
              className={cx(
                AIC,
                'inline-flex items-center gap-1 rounded-full border border-primary/20 bg-primary-light px-2 py-0.5 text-[11px] font-medium text-primary transition-colors hover:border-primary/40 focus:outline-none focus:ring-2 focus:ring-primary/30',
              )}
            >
              <span className="max-w-[14rem] truncate">{labelFor(key, value, options)}</span>
              <X className="h-3 w-3 shrink-0" aria-hidden />
              <span className="sr-only">Remove this filter</span>
            </button>
          ))}
          <button
            type="button"
            onClick={onClear}
            className={cx(
              AIC,
              'ml-1 text-[11px] font-medium text-gray-500 underline underline-offset-2 hover:text-gray-800',
            )}
          >
            Clear all
          </button>
        </div>
      ) : null}
    </div>
  )
}

export default BatchFilters
