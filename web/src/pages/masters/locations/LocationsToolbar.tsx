import { useEffect, useId, useRef, useState } from 'react'
import type { ReactNode, RefObject } from 'react'
import { Plus, SlidersHorizontal, X } from 'lucide-react'
import { Button } from '../../../ui/Button'
import { SearchBox } from '../../../ui/SearchBox'
import { Select } from '../../../ui/Select'
import { AIC, cx } from '../../../ui/cx'
import type { FormOptionWarehouse } from '../../../services/items'
import { LOCATION_TYPE_ORDER, locationTypeMeta } from './locationsModel'

/**
 * Search, the sheet actions, the create button and the filter row.
 *
 * Every control here writes to the URL (useListParams) and every one of them
 * narrows the *server's* query — there is no control in this row that the API
 * ignores, so the pager and the "N locations" count always describe the rows on
 * screen. `location_type` and `parent_location_id` were added to
 * LocationsController::applyIndexFilters for exactly that reason.
 */

export interface LocationsToolbarProps {
  q: string
  onQChange: (value: string) => void
  searchInputRef: RefObject<HTMLInputElement | null>

  status: string
  warehouseId: string
  locationType: string
  parentScope: string
  onFilter: (key: string, value: string) => void
  onClear: () => void
  hasFilters: boolean

  warehouses: readonly FormOptionWarehouse[]
  /** ListSheetActions — export, print, refresh. */
  sheetActions?: ReactNode
  canWrite: boolean
  onCreate: () => void
  /**
   * Shown INSTEAD of the filter row while rows are selected.
   *
   * Instead of, not below: an extra strip appearing on first click would push
   * the table down by its height and move the row under the pointer, which is
   * how a second click lands on the wrong record. Both rows are one control
   * line tall, so the card does not resize.
   */
  bulkBar?: ReactNode
}

const FILTER_WIDTH = 'w-[10.5rem] shrink-0'

export function LocationsToolbar({
  q,
  onQChange,
  searchInputRef,
  status,
  warehouseId,
  locationType,
  parentScope,
  onFilter,
  onClear,
  hasFilters,
  warehouses,
  sheetActions,
  canWrite,
  onCreate,
  bulkBar,
}: LocationsToolbarProps) {
  return (
    <div className={cx(AIC, 'border-b border-gray-100 p-3.5')}>
      <div className="flex flex-wrap items-center gap-2">
        <div className="min-w-[14rem] flex-1">
          <SearchBox
            ref={searchInputRef}
            value={q}
            onChange={onQChange}
            placeholder="Search by code or name…"
            size="md"
            kbd="/"
            aria-label="Search locations"
          />
        </div>
        {sheetActions}
        {canWrite ? (
          <Button size="md" icon={Plus} onClick={onCreate}>
            New location
          </Button>
        ) : null}
      </div>

      {bulkBar ? (
        <div className="mt-2.5">{bulkBar}</div>
      ) : (
      <div className="mt-2.5 flex flex-wrap items-center gap-2">
        <div className={FILTER_WIDTH}>
          <Select
            size="md"
            value={status}
            onChange={(e) => onFilter('status', e.target.value)}
            aria-label="Filter by status"
          >
            <option value="">All status</option>
            <option value="active">Active</option>
            <option value="inactive">Inactive</option>
          </Select>
        </div>

        <div className={FILTER_WIDTH}>
          <Select
            size="md"
            value={warehouseId}
            onChange={(e) => onFilter('warehouse_id', e.target.value)}
            aria-label="Filter by warehouse"
          >
            <option value="">All warehouses</option>
            {warehouses.map((w) => (
              <option key={w.warehouse_id} value={String(w.warehouse_id)}>
                {w.warehouse_name}
              </option>
            ))}
          </Select>
        </div>

        <div className={FILTER_WIDTH}>
          <Select
            size="md"
            value={locationType}
            onChange={(e) => onFilter('location_type', e.target.value)}
            aria-label="Filter by type"
          >
            <option value="">All types</option>
            {LOCATION_TYPE_ORDER.map((t) => (
              <option key={t} value={t}>
                {locationTypeMeta(t).label}
              </option>
            ))}
          </Select>
        </div>

        <MoreFilters parentScope={parentScope} onFilter={onFilter} />

        {hasFilters ? (
          <Button variant="ghost" size="md" icon={X} onClick={onClear}>
            Clear filters
          </Button>
        ) : null}
      </div>
      )}
    </div>
  )
}

/**
 * The overflow filters.
 *
 * A popover rather than a drawer: it holds one control today, and sliding a
 * full panel over the list to change a dropdown is a lot of motion for that.
 * It still behaves like a dialog — Escape closes it, a click outside closes
 * it, and focus returns to the trigger — because a thing that traps a click
 * has to give the keyboard a way out too.
 */
function MoreFilters({
  parentScope,
  onFilter,
}: {
  parentScope: string
  onFilter: (key: string, value: string) => void
}) {
  const panelId = useId()
  const [open, setOpen] = useState(false)
  const wrapRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const count = parentScope ? 1 : 0

  useEffect(() => {
    if (!open) return undefined
    const onPointerDown = (e: MouseEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false)
    }
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      e.stopPropagation()
      setOpen(false)
      triggerRef.current?.focus()
    }
    document.addEventListener('mousedown', onPointerDown, true)
    document.addEventListener('keydown', onKeyDown, true)
    return () => {
      document.removeEventListener('mousedown', onPointerDown, true)
      document.removeEventListener('keydown', onKeyDown, true)
    }
  }, [open])

  return (
    <div ref={wrapRef} className="relative">
      <Button
        ref={triggerRef}
        variant="secondary"
        size="md"
        icon={SlidersHorizontal}
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        onClick={() => setOpen((v) => !v)}
      >
        More filters
        {count > 0 ? (
          <span className="ml-1 rounded-full bg-primary px-1.5 text-[10px] font-bold leading-4 text-white">
            {count}
          </span>
        ) : null}
      </Button>

      {open ? (
        <div
          id={panelId}
          role="group"
          aria-label="More filters"
          className={cx(
            AIC,
            'absolute left-0 top-[calc(100%+0.375rem)] z-30 w-64 rounded-xl border border-gray-200 bg-white p-3 shadow-lg',
          )}
        >
          <label className="block">
            <span className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-gray-500">
              Hierarchy
            </span>
            <Select
              size="md"
              value={parentScope}
              onChange={(e) => onFilter('parent_location_id', e.target.value)}
              aria-label="Filter by hierarchy level"
            >
              <option value="">Every level</option>
              <option value="root">Top level only</option>
            </Select>
          </label>
          <p className="mt-2 text-[11px] leading-relaxed text-gray-500">
            Top level shows locations with no parent — usually the zones a warehouse is divided into.
          </p>
        </div>
      ) : null}
    </div>
  )
}

export default LocationsToolbar
