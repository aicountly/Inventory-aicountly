import { useState } from 'react'
import type { ReactNode, RefObject } from 'react'
import { SlidersHorizontal, X } from 'lucide-react'
import { Button } from '../../../ui/Button'
import { Drawer } from '../../../ui/Drawer'
import { SearchBox } from '../../../ui/SearchBox'
import { Select } from '../../../ui/Select'
import { AIC, cx } from '../../../ui/cx'
import { FILTER_INPUT } from '../../../styles/designTokens'
import { BRAND_SORTS, CREATED_PRESETS, advancedBrandFilterCount } from './brandsQuery'
import type { BrandFilterState, BrandSortKey, CreatedPreset } from './brandsQuery'

/**
 * Search, the three filters a reader reaches for every day, and a drawer for
 * the ones they reach for occasionally.
 *
 * What is on the bar and what is behind "More filters" is a judgement about
 * frequency, not importance: status, period and order are set on most visits;
 * a custom date range and "brands with no items" are set on some. Everything
 * either way lands in the URL, so the view is one link and survives a reload.
 *
 * The chips under the bar exist because a filter you cannot see is a filter you
 * forget — a reader who left `has_items=0` set last week and comes back to four
 * rows should be told why there are four, and be able to undo it in one click.
 */

export interface BrandsToolbarProps {
  state: BrandFilterState
  /** The uncommitted search text — the URL lags it by the debounce. */
  searchText: string
  sortKey: BrandSortKey
  searchInputRef?: RefObject<HTMLInputElement | null>
  onSearchChange: (value: string) => void
  onStatusChange: (value: string) => void
  onCreatedChange: (value: CreatedPreset) => void
  onSortChange: (key: BrandSortKey) => void
  onAdvancedChange: (patch: Record<string, string>) => void
  onClearAll: () => void
  /** Column chooser and anything else that belongs at the right of the bar. */
  actions?: ReactNode
  busy?: boolean
}

interface Chip {
  key: string
  label: string
  onRemove: () => void
}

export function BrandsToolbar({
  state,
  searchText,
  sortKey,
  searchInputRef,
  onSearchChange,
  onStatusChange,
  onCreatedChange,
  onSortChange,
  onAdvancedChange,
  onClearAll,
  actions,
  busy = false,
}: BrandsToolbarProps) {
  const [advancedOpen, setAdvancedOpen] = useState(false)
  const advancedCount = advancedBrandFilterCount(state)

  const chips: Chip[] = []
  if (state.status) {
    chips.push({
      key: 'status',
      label: state.status === 'active' ? 'Active only' : 'Inactive only',
      onRemove: () => onStatusChange(''),
    })
  }
  if (state.created) {
    const label = CREATED_PRESETS.find((p) => p.value === state.created)?.label ?? state.created
    chips.push({
      key: 'created',
      label:
        state.created === 'custom' && (state.createdFrom || state.createdTo)
          ? `Created ${state.createdFrom || '…'} → ${state.createdTo || '…'}`
          : `Created: ${label}`,
      onRemove: () => onCreatedChange(''),
    })
  }
  if (state.hasItems) {
    chips.push({
      key: 'has_items',
      label: state.hasItems === '1' ? 'With items' : 'No items',
      onRemove: () => onAdvancedChange({ has_items: '' }),
    })
  }

  return (
    <div className={cx(AIC, 'space-y-2')}>
      <div className="flex flex-wrap items-center gap-2">
        <div className="min-w-[14rem] flex-1 basis-72">
          <SearchBox
            ref={searchInputRef}
            value={searchText}
            onChange={onSearchChange}
            placeholder="Search brands by name, alias, code or description…"
            aria-label="Search brands"
            kbd="/"
            size="md"
          />
        </div>

        <label className="sr-only" htmlFor="brand-status-filter">
          Filter brands by status
        </label>
        <Select
          id="brand-status-filter"
          size="md"
          value={state.status}
          onChange={(e) => onStatusChange(e.target.value)}
          className="w-auto min-w-[9rem]"
        >
          <option value="">All statuses</option>
          <option value="active">Active only</option>
          <option value="inactive">Inactive only</option>
        </Select>

        <label className="sr-only" htmlFor="brand-created-filter">
          Filter brands by when they were created
        </label>
        <Select
          id="brand-created-filter"
          size="md"
          value={state.created}
          onChange={(e) => onCreatedChange(e.target.value as CreatedPreset)}
          className="w-auto min-w-[10rem]"
        >
          {CREATED_PRESETS.map((p) => (
            <option key={p.value || 'all'} value={p.value}>
              {p.label}
            </option>
          ))}
        </Select>

        <label className="sr-only" htmlFor="brand-sort">
          Sort brands
        </label>
        <Select
          id="brand-sort"
          size="md"
          value={sortKey}
          onChange={(e) => onSortChange(e.target.value as BrandSortKey)}
          className="w-auto min-w-[10rem]"
        >
          {BRAND_SORTS.map((s) => (
            <option key={s.key} value={s.key}>
              {s.label}
            </option>
          ))}
        </Select>

        <Button
          variant="secondary"
          size="md"
          icon={SlidersHorizontal}
          onClick={() => setAdvancedOpen(true)}
          aria-haspopup="dialog"
          aria-expanded={advancedOpen}
        >
          More filters
          {advancedCount > 0 ? (
            <span className="ml-1.5 inline-flex h-4 min-w-[1rem] items-center justify-center rounded-full bg-primary px-1 text-[10px] font-bold text-white">
              {advancedCount}
            </span>
          ) : null}
        </Button>

        {actions ? <div className="flex items-center gap-2">{actions}</div> : null}
      </div>

      {chips.length > 0 ? (
        <div className="flex flex-wrap items-center gap-1.5" aria-label="Active filters">
          <span className="text-[11px] font-semibold uppercase tracking-wide text-gray-400">
            Filters
          </span>
          {chips.map((chip) => (
            <span
              key={chip.key}
              className="inline-flex items-center gap-1 rounded-full border border-gray-200 bg-white py-0.5 pl-2 pr-1 text-[11px] font-medium text-gray-700"
            >
              {chip.label}
              <button
                type="button"
                onClick={chip.onRemove}
                aria-label={`Remove filter: ${chip.label}`}
                className="inline-flex h-4 w-4 items-center justify-center rounded-full text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
              >
                <X className="h-3 w-3" aria-hidden />
              </button>
            </span>
          ))}
          <Button variant="link" size="xs" onClick={onClearAll} disabled={busy}>
            Clear all
          </Button>
        </div>
      ) : null}

      <Drawer
        open={advancedOpen}
        onClose={() => setAdvancedOpen(false)}
        title="More filters"
        description="Narrow the list further. Every filter here is kept in the address bar."
        width="md"
        footer={
          <div className="flex items-center justify-between gap-2">
            <Button
              variant="ghost"
              onClick={() => onAdvancedChange({ created: '', created_from: '', created_to: '', has_items: '' })}
              disabled={advancedCount === 0}
            >
              Reset
            </Button>
            <Button onClick={() => setAdvancedOpen(false)}>Done</Button>
          </div>
        }
      >
        <div className="space-y-5">
          <fieldset className="space-y-2">
            <legend className="text-xs font-semibold text-gray-700">Item linkage</legend>
            <p className="text-[11px] leading-relaxed text-gray-500">
              A brand with nothing filed under it is either new or finished. This is how you find
              both.
            </p>
            <Select
              size="md"
              value={state.hasItems}
              onChange={(e) => onAdvancedChange({ has_items: e.target.value })}
              aria-label="Filter brands by item linkage"
            >
              <option value="">Any number of items</option>
              <option value="1">Has at least one item</option>
              <option value="0">Has no items</option>
            </Select>
          </fieldset>

          <fieldset className="space-y-2">
            <legend className="text-xs font-semibold text-gray-700">Created</legend>
            <Select
              size="md"
              value={state.created}
              onChange={(e) => onCreatedChange(e.target.value as CreatedPreset)}
              aria-label="Filter brands by when they were created"
            >
              {CREATED_PRESETS.map((p) => (
                <option key={p.value || 'all'} value={p.value}>
                  {p.label}
                </option>
              ))}
            </Select>

            {state.created === 'custom' ? (
              <div className="grid grid-cols-2 gap-2 pt-1">
                <label className="space-y-1">
                  <span className="block text-[11px] font-medium text-gray-600">From</span>
                  <input
                    type="date"
                    className={FILTER_INPUT}
                    value={state.createdFrom}
                    max={state.createdTo || undefined}
                    onChange={(e) => onAdvancedChange({ created_from: e.target.value })}
                  />
                </label>
                <label className="space-y-1">
                  <span className="block text-[11px] font-medium text-gray-600">To</span>
                  <input
                    type="date"
                    className={FILTER_INPUT}
                    value={state.createdTo}
                    min={state.createdFrom || undefined}
                    onChange={(e) => onAdvancedChange({ created_to: e.target.value })}
                  />
                </label>
              </div>
            ) : null}
          </fieldset>

          <p className="rounded-lg bg-gray-50 px-3 py-2 text-[11px] leading-relaxed text-gray-500">
            Filtering by revenue is not offered here. A brand&rsquo;s turnover comes from Sales over
            a live API, so Inventory cannot order or filter its own list by it — the column appears
            once that service is connected.
          </p>
        </div>
      </Drawer>
    </div>
  )
}

export default BrandsToolbar
