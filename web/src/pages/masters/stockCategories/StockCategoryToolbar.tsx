import { LayoutGrid, List, X } from 'lucide-react'
import type { RefObject } from 'react'
import { Button } from '../../../ui/Button'
import { SegmentedControl } from '../../../ui/SegmentedControl'
import { Select } from '../../../ui/Select'
import { SearchInput } from '../../../components/SearchInput'
import type { SortOrder } from '../../../services/api'

/**
 * Search, status, sort and the view switch.
 *
 * Every control writes to the URL (see `useListParams`), so a filtered view is
 * a link: the back button, a refresh and a pasted address all restore the same
 * screen. The search box debounces before it does, because each keystroke here
 * is a request to the server, not a filter over rows already in the browser —
 * the list is paged, and filtering the page would hide matches on page two.
 */

export type StockCategoryView = 'list' | 'grid'

export interface SortChoice {
  value: string
  label: string
  sort: string
  order: SortOrder
}

/**
 * `sort` + `order` as one control.
 *
 * Both halves are still sent separately to the API and still live in the URL
 * separately — the table's own sortable headers write the same two parameters,
 * so picking "Most items" here and clicking the Items header do exactly the
 * same thing rather than fighting over two sources of truth.
 */
export const SORT_CHOICES: readonly SortChoice[] = [
  { value: 'name_asc', label: 'Name (A – Z)', sort: 'cat_name', order: 'asc' },
  { value: 'name_desc', label: 'Name (Z – A)', sort: 'cat_name', order: 'desc' },
  { value: 'updated_desc', label: 'Recently updated', sort: 'updated_at', order: 'desc' },
  { value: 'updated_asc', label: 'Oldest updated', sort: 'updated_at', order: 'asc' },
  { value: 'items_desc', label: 'Most items', sort: 'item_count', order: 'desc' },
  { value: 'items_asc', label: 'Least items', sort: 'item_count', order: 'asc' },
]

/** The choice matching the current URL, or the closest label for a header sort. */
export function sortChoiceValue(sort: string, order: SortOrder): string {
  return SORT_CHOICES.find((c) => c.sort === sort && c.order === order)?.value ?? ''
}

export interface StockCategoryToolbarProps {
  search: string
  onSearch: (value: string) => void
  searchInputRef: RefObject<HTMLInputElement | null>

  status: string
  onStatus: (value: string) => void

  sort: string
  order: SortOrder
  onSortChoice: (choice: SortChoice) => void

  view: StockCategoryView
  onView: (view: StockCategoryView) => void

  /** Any filter or search is set — shows the Clear button. */
  filtered: boolean
  onClear: () => void
}

export function StockCategoryToolbar({
  search,
  onSearch,
  searchInputRef,
  status,
  onStatus,
  sort,
  order,
  onSortChoice,
  view,
  onView,
  filtered,
  onClear,
}: StockCategoryToolbarProps) {
  const current = sortChoiceValue(sort, order)

  return (
    <div className="flex flex-wrap items-center gap-2 border-b border-gray-200 px-3 py-2.5 print:hidden">
      <SearchInput
        ref={searchInputRef}
        value={search}
        onChange={onSearch}
        placeholder="Search stock categories or alias…"
        aria-label="Search stock categories"
        className="w-full min-w-[15rem] flex-1 sm:max-w-md"
      />

      <label className="inline-flex items-center gap-1.5 text-xs text-gray-500">
        <span className="whitespace-nowrap font-medium">Status</span>
        <Select value={status} onChange={(e) => onStatus(e.target.value)} aria-label="Filter by status" className="min-w-[10rem]">
          <option value="">Active and inactive</option>
          <option value="active">Active only</option>
          <option value="inactive">Inactive only</option>
        </Select>
      </label>

      <label className="inline-flex items-center gap-1.5 text-xs text-gray-500">
        <span className="whitespace-nowrap font-medium">Sort by</span>
        <Select
          value={current}
          onChange={(e) => {
            const choice = SORT_CHOICES.find((c) => c.value === e.target.value)
            if (choice) onSortChoice(choice)
          }}
          aria-label="Sort categories"
          className="min-w-[11rem]"
        >
          {/* A header click can land on a pair this list does not name (alias,
              say). Rather than silently showing the wrong label, the box shows
              what actually happened until the reader picks from the list. */}
          {current === '' ? <option value="">Custom ({sort} {order})</option> : null}
          {SORT_CHOICES.map((choice) => (
            <option key={choice.value} value={choice.value}>
              {choice.label}
            </option>
          ))}
        </Select>
      </label>

      <SegmentedControl<StockCategoryView>
        value={view}
        onChange={onView}
        className="ml-auto"
        options={[
          { value: 'list', label: <List className="h-3.5 w-3.5" aria-label="Table view" />, title: 'Table view' },
          { value: 'grid', label: <LayoutGrid className="h-3.5 w-3.5" aria-label="Card view" />, title: 'Card view' },
        ]}
      />

      {filtered ? (
        <Button variant="ghost" size="sm" icon={X} onClick={onClear}>
          Clear
        </Button>
      ) : null}
    </div>
  )
}

export default StockCategoryToolbar
