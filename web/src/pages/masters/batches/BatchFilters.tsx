import { useEffect, useId, useState } from 'react'
import type { RefObject } from 'react'
import { ChevronDown, RotateCcw, SlidersHorizontal } from 'lucide-react'
import { ItemFilter } from '../../../components/ItemFilter'
import { Badge } from '../../../ui/Badge'
import { Button } from '../../../ui/Button'
import { SearchBox } from '../../../ui/SearchBox'
import { Select } from '../../../ui/Select'
import { AIC, cx } from '../../../ui/cx'
import { FILTER_CARD, FILTER_LABEL_COMPACT } from '../../../styles/designTokens'
import { isAbortError } from '../../../services/api'
import { BATCH_STATUSES, warehouseGroupsApi } from '../../../services/masters'
import type { WarehouseGroup } from '../../../services/masters'
import type { ItemFormOptions } from '../../../services/items'
import { humanize } from '../../../utils/format'
import { BATCH_STATE_LABEL, EXPIRY_PRESETS, expiryPresetRange } from './batchExpiry'
import type { BatchState, ExpiryPreset } from './batchExpiry'
import { activeAdvancedCount, hasAnyFilter } from './batchFilters'
import type { BatchFilterValues } from './batchFilters'

/**
 * The toolbar above the batch table.
 *
 * Four controls are always visible because they answer the four questions a
 * stock controller actually arrives with — which batch, which state, which item,
 * which warehouse, and how soon does it expire. Everything else is a genuine
 * but occasional question, and lives behind "More filters" with a count on the
 * button so a narrowed list is never quietly narrow.
 *
 * Every control writes to the URL (see `useListParams` in the page): the
 * address bar is the filter state, so a view can be shared, bookmarked and
 * reloaded, and the browser's Back button steps through filter changes the way
 * a reader expects.
 *
 * Nothing here filters client-side. The controls set query parameters and the
 * server answers them — the page on screen is never the whole result, so a
 * filter applied to it would be a filter over an arbitrary slice.
 */

const STATES: { value: BatchState | ''; label: string }[] = [
  { value: '', label: 'All statuses' },
  { value: 'active', label: BATCH_STATE_LABEL.active },
  { value: 'expiring_soon', label: BATCH_STATE_LABEL.expiring_soon },
  { value: 'expired', label: BATCH_STATE_LABEL.expired },
  { value: 'inactive', label: BATCH_STATE_LABEL.inactive },
]

const STOCK_OPTIONS = [
  { value: '', label: 'Any quantity' },
  { value: 'positive', label: 'On hand above zero' },
  { value: 'zero', label: 'Zero on hand' },
]

export interface BatchFiltersProps {
  filters: BatchFilterValues
  /** Draft search text; the page debounces it before it reaches the URL. */
  search: string
  onSearchChange: (value: string) => void
  setFilter: (key: string, value: string) => void
  /** Several filters in one navigation — an expiry preset writes three. */
  setFilters: (patch: Record<string, string>) => void
  onClear: () => void
  options: ItemFormOptions | null
  /** Today, injected so the presets and the tests agree on what "now" is. */
  today: string
  searchInputRef?: RefObject<HTMLInputElement | null>
}

function Field({ label, htmlFor, children, className }: { label: string; htmlFor?: string; children: React.ReactNode; className?: string }) {
  return (
    <div className={cx('min-w-0', className)}>
      <label className={cx(FILTER_LABEL_COMPACT, 'mb-1 block')} htmlFor={htmlFor}>
        {label}
      </label>
      {children}
    </div>
  )
}

export function BatchFilters({
  filters,
  search,
  onSearchChange,
  setFilter,
  setFilters,
  onClear,
  options,
  today,
  searchInputRef,
}: BatchFiltersProps) {
  const advancedCount = activeAdvancedCount(filters)
  const [open, setOpen] = useState(advancedCount > 0)
  const panelId = useId()
  const preset = (filters.expiry ?? '') as ExpiryPreset

  /*
   * Warehouse groups are not part of `items/form-options`, and a filter nobody
   * has opened yet does not justify a request on every page load — so the list
   * is fetched the first time the panel is expanded, and never again.
   */
  const [groups, setGroups] = useState<WarehouseGroup[] | null>(null)
  useEffect(() => {
    if (!open || groups !== null) return undefined
    const controller = new AbortController()
    warehouseGroupsApi
      .list({ limit: 500, status: 'active', sort: 'grp_name' }, controller.signal)
      .then((res) => {
        if (!controller.signal.aborted) setGroups(res.data)
      })
      .catch((err: unknown) => {
        // A missing list degrades to "no warehouse-group filter", which is the
        // state the panel was in a moment ago. It is not worth an error banner.
        if (!controller.signal.aborted && !isAbortError(err)) setGroups([])
      })
    return () => controller.abort()
  }, [open, groups])

  const applyPreset = (value: ExpiryPreset) => {
    if (value === 'custom') {
      setFilters({ expiry: 'custom', has_expiry: '' })
      setOpen(true)
      return
    }
    const range = expiryPresetRange(value, today)
    setFilters({ expiry: value, ...range })
  }

  return (
    <div className={cx(AIC, FILTER_CARD, 'space-y-2')}>
      <div className="flex flex-wrap items-end gap-2">
        {/*
          * The five controls wrap inside their own box and the two buttons sit
          * outside it. Left in one row they were last, so the growing fields
          * took the whole line and pushed "More filters" onto a line of its
          * own with 900px of empty space beside it.
          */}
        <div className="flex min-w-0 flex-1 flex-wrap items-end gap-2">
        <div className="min-w-[11rem] flex-1 basis-44">
          <label className={cx(FILTER_LABEL_COMPACT, 'mb-1 block')} htmlFor="batch-search">
            Search
          </label>
          <SearchBox
            ref={searchInputRef}
            name="batch-search"
            value={search}
            onChange={onSearchChange}
            placeholder="Search by batch, item, lot or SKU…"
            aria-label="Search batches"
            kbd="/"
            size="md"
          />
        </div>

        <Field label="Status" htmlFor="batch-state" className="w-[8.5rem]">
          <Select
            id="batch-state"
            size="md"
            value={filters.state ?? ''}
            onChange={(e) => setFilter('state', e.target.value)}
          >
            {STATES.map((s) => (
              <option key={s.value} value={s.value}>
                {s.label}
              </option>
            ))}
          </Select>
        </Field>

        <Field label="Item" className="min-w-[9rem] flex-1 basis-36">
          <ItemFilter
            id="batch-item"
            value={filters.item_id ?? ''}
            onChange={(id) => setFilter('item_id', id)}
            placeholder="All items"
          />
        </Field>

        <Field label="Warehouse" htmlFor="batch-warehouse" className="w-[9.5rem]">
          <Select
            id="batch-warehouse"
            size="md"
            value={filters.warehouse_id ?? ''}
            onChange={(e) => setFilter('warehouse_id', e.target.value)}
          >
            <option value="">All warehouses</option>
            {(options?.warehouses ?? []).map((w) => (
              <option key={w.warehouse_id} value={w.warehouse_id}>
                {w.warehouse_name}
              </option>
            ))}
          </Select>
        </Field>

        <Field label="Expiry date" htmlFor="batch-expiry" className="w-[10rem]">
          <Select
            id="batch-expiry"
            size="md"
            value={preset}
            onChange={(e) => applyPreset(e.target.value as ExpiryPreset)}
          >
            {EXPIRY_PRESETS.map((p) => (
              <option key={p.value || 'all'} value={p.value}>
                {p.label}
              </option>
            ))}
          </Select>
        </Field>

        </div>

        <div className="flex shrink-0 items-center gap-1.5">
          <Button
            variant={open ? 'outline' : 'secondary'}
            size="md"
            icon={SlidersHorizontal}
            iconRight={ChevronDown}
            aria-expanded={open}
            aria-controls={panelId}
            onClick={() => setOpen((v) => !v)}
          >
            More filters
            {advancedCount > 0 ? (
              <Badge tone="primary" size="xs" className="ml-1">
                {advancedCount}
              </Badge>
            ) : null}
          </Button>
          {hasAnyFilter(filters, search) ? (
            <Button variant="ghost" size="md" icon={RotateCcw} onClick={onClear}>
              Clear
            </Button>
          ) : null}
        </div>
      </div>

      {open ? (
        <div
          id={panelId}
          className="grid grid-cols-1 gap-2 border-t border-gray-100 pt-2 sm:grid-cols-2 lg:grid-cols-4"
        >
          <Field label="Batch status" htmlFor="batch-status">
            <Select
              id="batch-status"
              size="md"
              value={filters.status ?? ''}
              onChange={(e) => setFilter('status', e.target.value)}
            >
              <option value="">Any stored status</option>
              {BATCH_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {humanize(s)}
                </option>
              ))}
            </Select>
          </Field>

          <Field label="Item group" htmlFor="batch-item-group">
            <Select id="batch-item-group" size="md" value={filters.item_grp_id ?? ''} onChange={(e) => setFilter('item_grp_id', e.target.value)}>
              <option value="">All item groups</option>
              {(options?.item_groups ?? []).map((g) => (
                <option key={g.item_grp_id} value={g.item_grp_id}>
                  {g.grp_name}
                </option>
              ))}
            </Select>
          </Field>

          <Field label="Stock category" htmlFor="batch-stock-cat">
            <Select id="batch-stock-cat" size="md" value={filters.stock_cat_id ?? ''} onChange={(e) => setFilter('stock_cat_id', e.target.value)}>
              <option value="">All stock categories</option>
              {(options?.stock_categories ?? []).map((c) => (
                <option key={c.stock_cat_id} value={c.stock_cat_id}>
                  {c.cat_name}
                </option>
              ))}
            </Select>
          </Field>

          <Field label="Brand" htmlFor="batch-brand">
            <Select id="batch-brand" size="md" value={filters.brand_id ?? ''} onChange={(e) => setFilter('brand_id', e.target.value)}>
              <option value="">All brands</option>
              {(options?.brands ?? []).map((b) => (
                <option key={b.brand_id} value={b.brand_id}>
                  {b.brand_name}
                </option>
              ))}
            </Select>
          </Field>

          <Field label="Warehouse group" htmlFor="batch-warehouse-group">
            <Select
              id="batch-warehouse-group"
              size="md"
              value={filters.warehouse_group_id ?? ''}
              onChange={(e) => setFilter('warehouse_group_id', e.target.value)}
              disabled={groups !== null && groups.length === 0}
            >
              <option value="">{groups !== null && groups.length === 0 ? 'No warehouse groups' : 'All warehouse groups'}</option>
              {(groups ?? []).map((g) => (
                <option key={g.warehouse_group_id} value={g.warehouse_group_id}>
                  {g.grp_name}
                </option>
              ))}
            </Select>
          </Field>

          <Field label="Lot number" htmlFor="batch-lot">
            <input
              id="batch-lot"
              type="search"
              value={filters.lot_no ?? ''}
              onChange={(e) => setFilter('lot_no', e.target.value)}
              placeholder="Any lot"
              className="block h-9 w-full rounded-lg border border-gray-200 bg-white px-3 text-sm text-gray-900 transition-colors placeholder:text-gray-400 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30"
            />
          </Field>

          <Field label="Stock" htmlFor="batch-stock">
            <Select id="batch-stock" size="md" value={filters.stock ?? ''} onChange={(e) => setFilter('stock', e.target.value)}>
              {STOCK_OPTIONS.map((o) => (
                <option key={o.value || 'any'} value={o.value}>
                  {o.label}
                </option>
              ))}
            </Select>
          </Field>

          <Field label="Manufactured between" className="sm:col-span-2">
            <div className="flex items-center gap-1.5">
              <input
                type="date"
                aria-label="Manufactured from"
                value={filters.mfg_from ?? ''}
                onChange={(e) => setFilter('mfg_from', e.target.value)}
                className="block h-9 w-full min-w-0 rounded-lg border border-gray-200 bg-white px-2 text-sm text-gray-900 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30"
              />
              <span className="text-xs text-gray-400">to</span>
              <input
                type="date"
                aria-label="Manufactured to"
                value={filters.mfg_to ?? ''}
                onChange={(e) => setFilter('mfg_to', e.target.value)}
                className="block h-9 w-full min-w-0 rounded-lg border border-gray-200 bg-white px-2 text-sm text-gray-900 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30"
              />
            </div>
          </Field>

          {preset === 'custom' ? (
            <Field label="Expiry between" className="sm:col-span-2">
              <div className="flex items-center gap-1.5">
                <input
                  type="date"
                  aria-label="Expiry from"
                  value={filters.expiry_from ?? ''}
                  onChange={(e) => setFilters({ expiry: 'custom', expiry_from: e.target.value })}
                  className="block h-9 w-full min-w-0 rounded-lg border border-gray-200 bg-white px-2 text-sm text-gray-900 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30"
                />
                <span className="text-xs text-gray-400">to</span>
                <input
                  type="date"
                  aria-label="Expiry to"
                  value={filters.expiry_to ?? ''}
                  onChange={(e) => setFilters({ expiry: 'custom', expiry_to: e.target.value })}
                  className="block h-9 w-full min-w-0 rounded-lg border border-gray-200 bg-white px-2 text-sm text-gray-900 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30"
                />
              </div>
            </Field>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}

export default BatchFilters
