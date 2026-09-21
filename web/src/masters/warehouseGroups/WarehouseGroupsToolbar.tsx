import { useState } from 'react'
import type { RefObject } from 'react'
import { LayoutGrid, ListTree, Rows3, SlidersHorizontal, X } from 'lucide-react'
import { Button } from '../../ui/Button'
import { Drawer } from '../../ui/Drawer'
import { SearchBox } from '../../ui/SearchBox'
import { SegmentedControl } from '../../ui/SegmentedControl'
import { Select } from '../../ui/Select'
import { Input } from '../../ui/Input'
import { AIC, cx } from '../../ui/cx'
import { TOOLBAR_CARD } from '../../styles/designTokens'
import { SORT_KEYS, SORT_LABELS, activeFilterCount } from './model'
import type { CreatorOption, FilterState, SortKey, ViewMode } from './model'

/**
 * Search, the three filters people reach for, the rest behind one button, and
 * the view switcher.
 *
 * The advanced filters open in the shared Drawer rather than a bespoke popover:
 * the drawer already traps focus, closes on Escape, returns focus to its
 * trigger and is the same control at every width — which is exactly the
 * behaviour a hand-rolled popover has to reimplement and usually gets half
 * right. One control, one set of keyboard rules, phone to ultrawide.
 */

const VIEW_OPTIONS = [
  { value: 'list' as const, label: (<span className="inline-flex items-center gap-1.5"><Rows3 className="h-3.5 w-3.5" aria-hidden />List</span>), title: 'List view' },
  { value: 'tree' as const, label: (<span className="inline-flex items-center gap-1.5"><ListTree className="h-3.5 w-3.5" aria-hidden />Tree</span>), title: 'Tree view' },
  { value: 'cards' as const, label: (<span className="inline-flex items-center gap-1.5"><LayoutGrid className="h-3.5 w-3.5" aria-hidden />Cards</span>), title: 'Card view' },
]

export interface WarehouseGroupsToolbarProps {
  filters: FilterState
  onChange: (patch: Partial<FilterState>) => void
  onClear: () => void
  creators: readonly CreatorOption[]
  view: ViewMode
  onViewChange: (view: ViewMode) => void
  searchInputRef?: RefObject<HTMLInputElement | null>
  /** Rows the filters leave, and rows on record. */
  shown: number
  total: number
  className?: string
}

interface Chip {
  key: string
  label: string
  clear: Partial<FilterState>
}

export function WarehouseGroupsToolbar({
  filters,
  onChange,
  onClear,
  creators,
  view,
  onViewChange,
  searchInputRef,
  shown,
  total,
  className,
}: WarehouseGroupsToolbarProps) {
  const [advancedOpen, setAdvancedOpen] = useState(false)
  const advancedCount = activeFilterCount(filters)

  const chips: Chip[] = []
  if (filters.status !== 'all') {
    chips.push({ key: 'status', label: `Status: ${filters.status === 'active' ? 'Active' : 'Inactive'}`, clear: { status: 'all' } })
  }
  if (filters.createdBy !== '') {
    const creator = creators.find((c) => c.value === filters.createdBy)
    chips.push({ key: 'createdBy', label: `Created by: ${creator?.label ?? filters.createdBy}`, clear: { createdBy: '' } })
  }
  if (filters.contents !== 'all') {
    chips.push({ key: 'contents', label: filters.contents === 'with' ? 'Contains warehouses' : 'Empty groups', clear: { contents: 'all' } })
  }
  if (filters.level !== 'all') {
    chips.push({ key: 'level', label: filters.level === 'root' ? 'Top-level groups' : 'Sub-groups', clear: { level: 'all' } })
  }
  if (filters.updatedFrom !== '') {
    chips.push({ key: 'updatedFrom', label: `Updated since ${filters.updatedFrom}`, clear: { updatedFrom: '' } })
  }
  if (filters.q !== '') {
    chips.push({ key: 'q', label: `Search: ${filters.q}`, clear: { q: '' } })
  }

  return (
    <div className={cx(AIC, 'space-y-2', className)}>
      <div className={TOOLBAR_CARD}>
        <SearchBox
          ref={searchInputRef}
          value={filters.q}
          onChange={(q) => onChange({ q })}
          placeholder="Search warehouse groups, code or description…"
          aria-label="Search warehouse groups"
          size="md"
          kbd="/"
          className="min-w-[12rem] flex-1 basis-[16rem]"
        />

        <div className="w-[9.5rem] shrink-0">
          <label className="sr-only" htmlFor="wg-status">Status</label>
          <Select
            id="wg-status"
            size="md"
            value={filters.status}
            onChange={(e) => onChange({ status: e.target.value as FilterState['status'] })}
          >
            <option value="all">Status: All</option>
            <option value="active">Status: Active</option>
            <option value="inactive">Status: Inactive</option>
          </Select>
        </div>

        <div className="w-[11rem] shrink-0">
          <label className="sr-only" htmlFor="wg-created-by">Created by</label>
          <Select
            id="wg-created-by"
            size="md"
            value={filters.createdBy}
            onChange={(e) => onChange({ createdBy: e.target.value })}
            disabled={creators.length === 0}
            title={creators.length === 0 ? 'No creator is recorded on these groups' : undefined}
          >
            <option value="">Created by: All</option>
            {creators.map((c) => (
              <option key={c.value} value={c.value}>
                {c.label} ({c.count})
              </option>
            ))}
          </Select>
        </div>

        <div className="w-[12rem] shrink-0">
          <label className="sr-only" htmlFor="wg-sort">Sort by</label>
          <Select
            id="wg-sort"
            size="md"
            value={filters.sort}
            onChange={(e) => onChange({ sort: e.target.value as SortKey })}
          >
            {SORT_KEYS.map((key) => (
              <option key={key} value={key}>
                Sort by: {SORT_LABELS[key]}
              </option>
            ))}
          </Select>
        </div>

        <Button
          variant="secondary"
          size="md"
          className="shrink-0"
          icon={SlidersHorizontal}
          onClick={() => setAdvancedOpen(true)}
          aria-expanded={advancedOpen}
          aria-haspopup="dialog"
        >
          More filters
          {advancedCount > 0 ? (
            <span className="ml-1.5 inline-flex h-4 min-w-[1rem] items-center justify-center rounded-full bg-primary px-1 text-[10px] font-bold text-white">
              {advancedCount}
            </span>
          ) : null}
        </Button>

        <SegmentedControl<ViewMode>
          value={view}
          onChange={onViewChange}
          options={VIEW_OPTIONS}
          aria-label="View"
          className="ml-auto shrink-0"
        />
      </div>

      {chips.length > 0 ? (
        <div className="flex flex-wrap items-center gap-1.5 print:hidden">
          <span className="text-xs text-gray-500">
            {shown === total ? `${total} warehouse ${total === 1 ? 'group' : 'groups'}` : `${shown} of ${total} warehouse groups`}
          </span>
          {chips.map((chip) => (
            <button
              key={chip.key}
              type="button"
              onClick={() => onChange(chip.clear)}
              className="inline-flex items-center gap-1 rounded-full border border-gray-200 bg-white px-2 py-0.5 text-[11px] font-medium text-gray-600 transition-colors hover:border-primary/40 hover:text-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/30"
            >
              <span className="max-w-[16rem] truncate">{chip.label}</span>
              <X className="h-3 w-3 shrink-0" aria-hidden />
              <span className="sr-only">Remove this filter</span>
            </button>
          ))}
          <Button variant="link" size="xs" onClick={onClear}>
            Clear all
          </Button>
        </div>
      ) : null}

      <Drawer
        open={advancedOpen}
        onClose={() => setAdvancedOpen(false)}
        title="More filters"
        description="Narrow the list by what a group holds, where it sits and when it last changed."
        width="md"
        footer={
          <div className="flex items-center justify-between gap-2">
            <Button
              variant="ghost"
              size="md"
              onClick={() => onChange({ contents: 'all', level: 'all', updatedFrom: '', status: 'all', createdBy: '' })}
              disabled={advancedCount === 0}
            >
              Reset filters
            </Button>
            <Button variant="primary" size="md" onClick={() => setAdvancedOpen(false)}>
              Show {shown} {shown === 1 ? 'group' : 'groups'}
            </Button>
          </div>
        }
      >
        <div className="space-y-4">
          <fieldset className="space-y-1.5">
            <legend className="text-xs font-semibold text-gray-700">Contents</legend>
            <Select
              size="md"
              aria-label="Contents"
              value={filters.contents}
              onChange={(e) => onChange({ contents: e.target.value as FilterState['contents'] })}
            >
              <option value="all">Any group</option>
              <option value="with">Contains warehouses</option>
              <option value="empty">Empty groups</option>
            </Select>
            <p className="text-[11px] text-gray-500">
              Empty groups add a choice to every warehouse picker without narrowing anything.
            </p>
          </fieldset>

          <fieldset className="space-y-1.5">
            <legend className="text-xs font-semibold text-gray-700">Level</legend>
            <Select
              size="md"
              aria-label="Level"
              value={filters.level}
              onChange={(e) => onChange({ level: e.target.value as FilterState['level'] })}
            >
              <option value="all">Any level</option>
              <option value="root">Top-level groups only</option>
              <option value="child">Sub-groups only</option>
            </Select>
          </fieldset>

          <fieldset className="space-y-1.5">
            <legend className="text-xs font-semibold text-gray-700">Updated since</legend>
            <Input
              type="date"
              size="md"
              aria-label="Updated since"
              value={filters.updatedFrom}
              onChange={(e) => onChange({ updatedFrom: e.target.value })}
            />
            <p className="text-[11px] text-gray-500">
              Keeps groups last changed on or after this date.
            </p>
          </fieldset>

          <fieldset className="space-y-1.5">
            <legend className="text-xs font-semibold text-gray-700">Status</legend>
            <Select
              size="md"
              aria-label="Status"
              value={filters.status}
              onChange={(e) => onChange({ status: e.target.value as FilterState['status'] })}
            >
              <option value="all">Active and inactive</option>
              <option value="active">Active only</option>
              <option value="inactive">Inactive only</option>
            </Select>
          </fieldset>

          {creators.length > 0 ? (
            <fieldset className="space-y-1.5">
              <legend className="text-xs font-semibold text-gray-700">Created by</legend>
              <Select
                size="md"
                aria-label="Created by"
                value={filters.createdBy}
                onChange={(e) => onChange({ createdBy: e.target.value })}
              >
                <option value="">Anyone</option>
                {creators.map((c) => (
                  <option key={c.value} value={c.value}>
                    {c.label} ({c.count})
                  </option>
                ))}
              </Select>
              <p className="text-[11px] text-gray-500">
                Only people who created one of these groups are listed.
              </p>
            </fieldset>
          ) : null}
        </div>
      </Drawer>
    </div>
  )
}

export default WarehouseGroupsToolbar
