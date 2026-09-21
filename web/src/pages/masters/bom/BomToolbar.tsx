import type { ReactNode, RefObject } from 'react'
import { LayoutGrid, List, Plus, SlidersHorizontal, Upload, X } from 'lucide-react'
import type { ItemFormOptions } from '../../../services/items'
import { SearchInput } from '../../../components/SearchInput'
import { Badge } from '../../../ui/Badge'
import { Button } from '../../../ui/Button'
import { Card } from '../../../ui/Card'
import { Select } from '../../../ui/Select'
import { Tooltip } from '../../../ui/Tooltip'
import { cx } from '../../../ui/cx'
import { formatInt } from '../../../utils/format'
import { advancedFilterCount, activeFilterCount } from './bomFilters'
import type { BomFilters } from './bomFilters'

/** The list / grid switch. Kept here so the toolbar owns its own vocabulary. */
export type BomViewMode = 'list' | 'grid'

export interface BomToolbarProps {
  search: string
  onSearch: (value: string) => void
  searchRef: RefObject<HTMLInputElement | null>
  filters: BomFilters
  onFilter: (key: string, value: string) => void
  onOpenFilters: () => void
  onClearFilters: () => void
  options: ItemFormOptions | null
  view: BomViewMode
  onView: (view: BomViewMode) => void
  onImport: () => void
  onNew: () => void
  canWrite: boolean
  canImport: boolean
  /** The export / print / refresh group — owned by the page, rendered here. */
  sheetActions?: ReactNode
  /** Replaces the whole bar while rows are selected. */
  selection?: ReactNode
}

/**
 * Search, the two filters worth having in reach, and the page's actions.
 *
 * Only status and item group sit in the bar. The other eleven are behind "More
 * filters" with a count on the button, because a toolbar that wraps to three
 * rows of dropdowns pushes the table below the fold and makes the two filters
 * people actually use harder to find, not easier.
 *
 * When rows are selected the whole bar is replaced by the selection actions:
 * a reader who has ticked nine bills is doing one thing, and leaving the
 * filters in place invites them to change the result set underneath their own
 * selection.
 */
export function BomToolbar({
  search,
  onSearch,
  searchRef,
  filters,
  onFilter,
  onOpenFilters,
  onClearFilters,
  options,
  view,
  onView,
  onImport,
  onNew,
  canWrite,
  canImport,
  sheetActions,
  selection,
}: BomToolbarProps) {
  const advanced = advancedFilterCount(filters)
  const anyFilter = activeFilterCount(filters) > 0 || search.trim() !== ''

  if (selection) {
    return (
      <Card padding="none" className="flex flex-wrap items-center gap-2 border-primary/30 bg-primary-light/40 px-3 py-2 print:hidden">
        {selection}
      </Card>
    )
  }

  return (
    <Card padding="none" className="flex flex-wrap items-center gap-2 px-3 py-2 print:hidden">
      <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
        {/* Debounced by SearchInput, so a request goes out when the typing
            stops rather than on every keystroke. */}
        <SearchInput
          ref={searchRef}
          value={search}
          onChange={onSearch}
          placeholder="Search by BOM name, code or finished item…"
          aria-label="Search bills of materials"
          className="w-full min-w-[15rem] sm:w-[19rem]"
        />

        <Select
          aria-label="Status"
          value={filters.status ?? ''}
          onChange={(e) => onFilter('status', e.target.value)}
          className="w-[8.5rem]"
        >
          <option value="">All status</option>
          <option value="active">Active</option>
          <option value="inactive">Inactive</option>
        </Select>

        <Select
          aria-label="Item group of the finished item"
          value={filters.item_grp_id ?? ''}
          onChange={(e) => onFilter('item_grp_id', e.target.value)}
          className="w-[10rem]"
        >
          <option value="">All item groups</option>
          {(options?.item_groups ?? []).map((g) => (
            <option key={g.item_grp_id} value={g.item_grp_id}>
              {g.grp_name}
            </option>
          ))}
        </Select>

        <Button
          variant="secondary"
          icon={SlidersHorizontal}
          onClick={onOpenFilters}
          aria-label={advanced > 0 ? `More filters, ${advanced} applied` : 'More filters'}
        >
          More filters
          {advanced > 0 ? (
            <Badge tone="primary" size="xs" className="ml-1 normal-case">
              {formatInt(advanced)}
            </Badge>
          ) : null}
        </Button>

        {anyFilter ? (
          <Button variant="ghost" icon={X} onClick={onClearFilters}>
            Clear
          </Button>
        ) : null}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div
          className="inline-flex items-center rounded-lg border border-gray-200 bg-white p-0.5"
          role="group"
          aria-label="View"
        >
          {(
            [
              { mode: 'list' as const, icon: List, label: 'List view' },
              { mode: 'grid' as const, icon: LayoutGrid, label: 'Grid view' },
            ]
          ).map(({ mode, icon: Icon, label }) => (
            <Tooltip key={mode} label={label}>
              <button
                type="button"
                aria-label={label}
                aria-pressed={view === mode}
                onClick={() => onView(mode)}
                className={cx(
                  'grid h-7 w-8 place-items-center rounded-md transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40',
                  view === mode ? 'bg-primary-light text-primary' : 'text-gray-500 hover:bg-gray-100 hover:text-gray-900',
                )}
              >
                <Icon className="h-4 w-4" aria-hidden />
              </button>
            </Tooltip>
          ))}
        </div>

        {canImport ? (
          <Button variant="secondary" icon={Upload} onClick={onImport}>
            Import
          </Button>
        ) : null}

        {sheetActions}

        {canWrite ? (
          <Button icon={Plus} onClick={onNew}>
            New bill of materials
          </Button>
        ) : null}
      </div>
    </Card>
  )
}

export default BomToolbar
