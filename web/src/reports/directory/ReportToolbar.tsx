import { Star } from 'lucide-react'
import type { FormOptionWarehouse } from '../../services/items'
import { SearchInput } from '../../components/SearchInput'
import { Button } from '../../ui/Button'
import { Select } from '../../ui/Select'
import { AIC, cx } from '../../ui/cx'
import { CATEGORY_LABELS, CATEGORY_ORDER } from './reportDirectory'
import type { ReportCategory } from './reportDirectory'

export interface ReportToolbarProps {
  search: string
  onSearch: (value: string) => void
  category: ReportCategory | 'all'
  onCategory: (value: ReportCategory | 'all') => void
  warehouseId: string
  onWarehouse: (value: string) => void
  warehouses: readonly FormOptionWarehouse[]
  favouritesOnly: boolean
  onToggleFavouritesOnly: () => void
  searchInputRef?: React.Ref<HTMLInputElement>
}

/**
 * Find-a-report row.
 *
 * The warehouse control is a launch default rather than a filter on the cards:
 * hiding "Stock summary" because a warehouse was chosen would be inventing a
 * rule the reports do not have. It is named "warehouse" because that is what
 * this product calls the thing everywhere else — `warehouse_id`,
 * `warehouse_name`, the Warehouses master — and a directory that called it a
 * location would be introducing a second word for one entity.
 */
export function ReportToolbar({
  search,
  onSearch,
  category,
  onCategory,
  warehouseId,
  onWarehouse,
  warehouses,
  favouritesOnly,
  onToggleFavouritesOnly,
  searchInputRef,
}: ReportToolbarProps) {
  return (
    <div
      className={cx(
        AIC,
        'grid gap-3 sm:grid-cols-2',
        'lg:grid-cols-[minmax(16rem,1fr)_minmax(9rem,12rem)_minmax(10rem,14rem)_auto] lg:items-center',
      )}
    >
      {/* SearchInput, not a raw SearchBox: it holds the keystrokes locally and
          writes to the URL once typing pauses. A box controlled straight from
          the query string loses characters at speed, because each keystroke is
          measured against the last value React committed rather than the one
          on screen. */}
      <SearchInput
        ref={searchInputRef}
        value={search}
        onChange={onSearch}
        size="md"
        className="w-full"
        placeholder="Search reports, e.g. stock, ageing, valuation…"
        aria-label="Search reports"
      />

      <Select
        size="md"
        value={category}
        onChange={(e) => onCategory(e.target.value as ReportCategory | 'all')}
        aria-label="Filter reports by category"
      >
        <option value="all">All categories</option>
        {CATEGORY_ORDER.map((key) => (
          <option key={key} value={key}>
            {CATEGORY_LABELS[key]}
          </option>
        ))}
      </Select>

      <Select
        size="md"
        value={warehouseId}
        onChange={(e) => onWarehouse(e.target.value)}
        aria-label="Open reports for a warehouse"
        title="Reports that take a warehouse open filtered to this one"
      >
        <option value="">All warehouses</option>
        {warehouses.map((w) => (
          <option key={w.warehouse_id} value={w.warehouse_id}>
            {w.warehouse_name}
            {w.warehouse_code ? ` (${w.warehouse_code})` : ''}
          </option>
        ))}
      </Select>

      <Button
        size="md"
        variant="primary"
        icon={Star}
        onClick={onToggleFavouritesOnly}
        aria-pressed={favouritesOnly}
        title={favouritesOnly ? 'Show every report again' : 'Show only your starred reports'}
        className={cx(
          'sm:col-span-2 lg:col-span-1',
          // Pressed: the star fills, so the state reads without the label moving.
          favouritesOnly && 'ring-2 ring-primary/40 [&_svg]:fill-current',
        )}
      >
        View favourites
      </Button>
    </div>
  )
}

export default ReportToolbar
