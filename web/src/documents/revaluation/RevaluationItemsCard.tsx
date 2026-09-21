import { useEffect, useId, useMemo, useRef, useState } from 'react'
import type { KeyboardEvent, RefObject } from 'react'
import { Boxes, Calculator, ChevronDown, Copy, Download, Eraser, Filter, ListPlus, Plus, RotateCcw, Trash2, X } from 'lucide-react'
import type { ItemSearchRow } from '../../services/lookupApi'
import type { FormOptionWarehouse } from '../../services/items'
import { Badge, Button, EmptyState, Kbd, MenuButton, Select } from '../../ui'
import { TABLE_STICKY_HEAD } from '../../styles/designTokens'
import { RevaluationItemRow } from './RevaluationItemRow'
import { RevaluationItemSearch } from './RevaluationItemSearch'
import type { MoneyFormat } from './revaluationFormat'
import { contextFor, countActiveFilters, SHOW_FILTERS, visibleLines } from './revaluationModel'
import type { LineFilters, RevaluationLine, StockContextMap, ValuationScope } from './revaluationModel'

export interface RevaluationItemsCardProps {
  lines: readonly RevaluationLine[]
  contexts: StockContextMap
  scope: ValuationScope
  money: MoneyFormat
  warehouses: readonly FormOptionWarehouse[]
  disabled?: boolean
  filters: LineFilters
  onFiltersChange: (filters: LineFilters) => void
  offendingKeys: ReadonlySet<string>
  flaggedKeys: ReadonlySet<string>
  searchInputRef: RefObject<HTMLInputElement | null>
  defaultWarehouseId: number | null
  onAddItem: (item: ItemSearchRow) => void
  onPatchLine: (key: string, patch: Partial<RevaluationLine>) => void
  onDuplicateLine: (key: string) => void
  onRemoveLine: (key: string) => void
  onOpenAddMultiple: () => void
  onOpenCopyRates: () => void
  onClearRates: () => void
  onRemoveUnchanged: () => void
  onRemoveAll: () => void
  onRecalculate: () => void
  onExportPreview: () => void
}

const HEAD = 'px-2.5 py-2 text-[10px] font-bold uppercase tracking-wide text-gray-500 whitespace-nowrap border-b border-gray-200'

/**
 * The grid, its toolbar and everything that fills it.
 *
 * The filter only changes what is on screen: a hidden line is still in the document, still in the
 * totals and still posted. The `#` column therefore numbers the document, not the view.
 */
export function RevaluationItemsCard({
  lines,
  contexts,
  scope,
  money,
  warehouses,
  disabled,
  filters,
  onFiltersChange,
  offendingKeys,
  flaggedKeys,
  searchInputRef,
  defaultWarehouseId,
  onAddItem,
  onPatchLine,
  onDuplicateLine,
  onRemoveLine,
  onOpenAddMultiple,
  onOpenCopyRates,
  onClearRates,
  onRemoveUnchanged,
  onRemoveAll,
  onRecalculate,
  onExportPreview,
}: RevaluationItemsCardProps) {
  const [scanMode, setScanMode] = useState(false)
  const [filtersOpen, setFiltersOpen] = useState(false)
  const filterRef = useRef<HTMLDivElement>(null)
  const bodyRef = useRef<HTMLTableSectionElement>(null)
  const filterPanelId = useId()

  const positions = useMemo(() => new Map(lines.map((line, index) => [line.key, index + 1])), [lines])
  const shown = useMemo(() => visibleLines(lines, contexts, scope, filters), [lines, contexts, scope, filters])
  const existingItemIds = useMemo(() => new Set(lines.map((l) => l.itemId).filter((id): id is number => id !== null)), [lines])
  const activeFilters = countActiveFilters(filters)

  useEffect(() => {
    if (!filtersOpen) return undefined
    const onDown = (e: MouseEvent) => {
      if (filterRef.current && e.target instanceof Node && !filterRef.current.contains(e.target)) setFiltersOpen(false)
    }
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key === 'Escape') setFiltersOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [filtersOpen])

  /**
   * Enter commits the cost and drops to the next line's cost box — the way a rate column is filled
   * down a keyboard. Tab keeps the browser's own order across the row, which is what Tab means.
   */
  const onGridKeyDown = (e: KeyboardEvent<HTMLTableSectionElement>) => {
    if (e.key !== 'Enter') return
    const target = e.target as HTMLElement
    if (target.dataset.revaluationCost !== 'true') return
    e.preventDefault()
    const boxes = [...(bodyRef.current?.querySelectorAll<HTMLInputElement>('[data-revaluation-cost="true"]') ?? [])]
    const index = boxes.indexOf(target as HTMLInputElement)
    const next = boxes[index + (e.shiftKey ? -1 : 1)]
    if (next) {
      next.focus()
      next.select()
    } else {
      target.blur()
    }
  }

  return (
    <section className="rounded-xl border border-gray-200 bg-white shadow-card" aria-labelledby="revaluation-items-heading">
      <div className="flex flex-col gap-3 border-b border-gray-100 p-4 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex min-w-0 items-center gap-3">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary-light">
            <Boxes className="h-4 w-4 text-primary" aria-hidden />
          </span>
          <div className="min-w-0">
            <h2 id="revaluation-items-heading" className="text-sm font-semibold text-gray-900">
              Items to revalue
            </h2>
            <p className="mt-0.5 text-xs text-gray-500">Add items and enter the new unit cost. Quantity is informational — it is the stock on hand.</p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2 lg:shrink-0">
          <Button size="md" variant="secondary" icon={ListPlus} onClick={onOpenAddMultiple} disabled={disabled}>
            Add multiple
          </Button>
          <Button size="md" variant="secondary" icon={Copy} onClick={onOpenCopyRates} disabled={disabled || lines.length === 0}>
            Copy rates
          </Button>
          <MenuButton
            label="Line actions"
            variant="secondary"
            size="md"
            width={248}
            buttonProps={{ disabled, iconRight: ChevronDown }}
            actions={[
              { key: 'recalculate', label: 'Recalculate costs and quantities', icon: Calculator, onSelect: onRecalculate },
              { key: 'clear', label: 'Clear every new rate', icon: Eraser, onSelect: onClearRates, disabled: lines.length === 0 },
              { key: 'unchanged', label: 'Remove lines with no change', icon: X, onSelect: onRemoveUnchanged, disabled: lines.length === 0 },
              { key: 'export', label: 'Export this preview (CSV)', icon: Download, onSelect: onExportPreview, separated: true, disabled: lines.length === 0 },
              { key: 'reset', label: 'Reset the filters', icon: RotateCcw, onSelect: () => onFiltersChange({ show: 'all', warehouseId: null, tracking: 'any', search: '' }), disabled: activeFilters === 0 },
              { key: 'removeall', label: 'Remove all lines', icon: Trash2, onSelect: onRemoveAll, danger: true, separated: true, disabled: lines.length === 0 },
            ]}
          >
            Actions
          </MenuButton>
        </div>
      </div>

      <div className="flex flex-col gap-2.5 p-4 md:flex-row md:items-start md:justify-between">
        <RevaluationItemSearch
          warehouseId={defaultWarehouseId}
          onPick={onAddItem}
          existingItemIds={existingItemIds}
          disabled={disabled}
          inputRef={searchInputRef}
          scanMode={scanMode}
          onScanModeChange={setScanMode}
        />

        <div className="flex shrink-0 items-center gap-2" ref={filterRef}>
          <label className="text-[11px] font-semibold uppercase tracking-wide text-gray-500" htmlFor={`${filterPanelId}-show`}>
            Show
          </label>
          <Select id={`${filterPanelId}-show`} size="md" className="w-40" value={filters.show} onChange={(e) => onFiltersChange({ ...filters, show: e.target.value as LineFilters['show'] })}>
            {SHOW_FILTERS.map((f) => (
              <option key={f.value} value={f.value}>
                {f.label}
              </option>
            ))}
          </Select>
          <div className="relative">
            <button
              type="button"
              onClick={() => setFiltersOpen((o) => !o)}
              aria-expanded={filtersOpen}
              aria-controls={filterPanelId}
              aria-label={`Filter lines${activeFilters ? `, ${activeFilters} active` : ''}`}
              className={[
                'aic inline-flex h-9 items-center gap-1.5 rounded-lg border px-2.5 text-sm font-medium transition-colors',
                activeFilters > 0 ? 'border-primary bg-primary-light text-primary' : 'border-gray-200 bg-white text-gray-700 hover:border-primary/40 hover:bg-primary-light hover:text-primary',
              ].join(' ')}
            >
              <Filter className="h-4 w-4" aria-hidden />
              {activeFilters > 0 ? <span className="text-xs tabular-nums">{activeFilters}</span> : null}
            </button>
            {filtersOpen ? (
              <div id={filterPanelId} className="aic absolute right-0 top-full z-30 mt-1 w-72 rounded-xl border border-gray-200 bg-white p-3 shadow-overlay">
                <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-500">Filter the lines on screen</p>
                <p className="mt-1 text-[10px] leading-relaxed text-gray-500">Filtering never removes a line from the document or from the impact below.</p>
                <div className="mt-2.5 space-y-2.5">
                  <label className="block">
                    <span className="text-[10px] font-semibold uppercase tracking-wide text-gray-400">Warehouse</span>
                    <Select size="md" className="mt-1" value={filters.warehouseId ?? ''} onChange={(e) => onFiltersChange({ ...filters, warehouseId: e.target.value === '' ? null : Number(e.target.value) })}>
                      <option value="">Any warehouse</option>
                      {warehouses.map((w) => (
                        <option key={w.warehouse_id} value={w.warehouse_id}>
                          {w.warehouse_name}
                        </option>
                      ))}
                    </Select>
                  </label>
                  <label className="block">
                    <span className="text-[10px] font-semibold uppercase tracking-wide text-gray-400">Tracking</span>
                    <Select size="md" className="mt-1" value={filters.tracking} onChange={(e) => onFiltersChange({ ...filters, tracking: e.target.value as LineFilters['tracking'] })}>
                      <option value="any">Any</option>
                      <option value="batch">Batch-tracked</option>
                      <option value="serial">Serial-tracked</option>
                      <option value="none">Neither</option>
                    </Select>
                  </label>
                  <label className="block">
                    <span className="text-[10px] font-semibold uppercase tracking-wide text-gray-400">Name, SKU or HSN contains</span>
                    <input
                      className="aic mt-1 block h-9 w-full rounded-lg border border-gray-200 bg-white px-2.5 text-sm text-gray-900 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30"
                      value={filters.search}
                      onChange={(e) => onFiltersChange({ ...filters, search: e.target.value })}
                      placeholder="e.g. LAP001"
                    />
                  </label>
                </div>
                <div className="mt-3 flex justify-between border-t border-gray-100 pt-2.5">
                  <Button size="xs" variant="ghost" onClick={() => onFiltersChange({ show: 'all', warehouseId: null, tracking: 'any', search: '' })}>
                    Clear
                  </Button>
                  <Button size="xs" variant="secondary" onClick={() => setFiltersOpen(false)}>
                    Done
                  </Button>
                </div>
              </div>
            ) : null}
          </div>
        </div>
      </div>

      {lines.length === 0 ? (
        <div className="px-4 pb-4">
          <div className="rounded-xl border border-dashed border-gray-200">
            <EmptyState
              icon={Boxes}
              title="No items added yet"
              description="Search, scan or add several at once to start the revaluation. Nothing is written until you save."
              action={
                <div className="flex flex-wrap items-center justify-center gap-2">
                  <Button size="sm" variant="primary" icon={Plus} onClick={() => searchInputRef.current?.focus()} disabled={disabled}>
                    Add item
                  </Button>
                  <Button size="sm" variant="secondary" icon={ListPlus} onClick={onOpenAddMultiple} disabled={disabled}>
                    Add multiple
                  </Button>
                </div>
              }
            />
          </div>
        </div>
      ) : (
        <>
          <div className="mx-4 overflow-x-auto rounded-xl border border-gray-200">
            <table className="w-full min-w-[68rem] border-collapse">
              <thead className={TABLE_STICKY_HEAD}>
                <tr>
                  <th scope="col" className={`${HEAD} w-10 text-left`}>
                    #
                  </th>
                  <th scope="col" className={`${HEAD} text-left`}>
                    Item details
                  </th>
                  <th scope="col" className={`${HEAD} text-left`}>
                    Warehouse
                  </th>
                  <th scope="col" className={`${HEAD} text-left`}>
                    Batch / serial
                  </th>
                  <th scope="col" className={`${HEAD} text-right`}>
                    Current cost ({money.symbol})
                  </th>
                  <th scope="col" className={`${HEAD} text-right`}>
                    New cost ({money.symbol})
                  </th>
                  <th scope="col" className={`${HEAD} text-right`}>
                    On-hand qty
                  </th>
                  <th scope="col" className={`${HEAD} text-right`}>
                    Value impact ({money.symbol})
                  </th>
                  <th scope="col" className={`${HEAD} text-left`}>
                    Remarks
                  </th>
                  <th scope="col" className={`${HEAD} text-right`}>
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody ref={bodyRef} onKeyDown={onGridKeyDown}>
                {shown.map((line) => (
                  <RevaluationItemRow
                    key={line.key}
                    line={line}
                    position={positions.get(line.key) ?? 0}
                    context={contextFor(line, contexts, scope)}
                    scope={scope}
                    money={money}
                    warehouses={warehouses}
                    disabled={disabled}
                    invalid={offendingKeys.has(line.key)}
                    flagged={flaggedKeys.has(line.key)}
                    canDuplicate={scope === 'warehouse'}
                    onPatch={onPatchLine}
                    onDuplicate={onDuplicateLine}
                    onRemove={onRemoveLine}
                  />
                ))}
                {shown.length === 0 ? (
                  <tr>
                    <td colSpan={10} className="px-3 py-8 text-center">
                      <p className="text-xs font-semibold text-gray-700">No line matches the current filter.</p>
                      <p className="mt-1 text-[11px] text-gray-500">
                        {lines.length} line{lines.length === 1 ? ' is' : 's are'} still in the document and will still be posted.
                      </p>
                      <Button className="mt-2.5" size="xs" variant="secondary" icon={RotateCcw} onClick={() => onFiltersChange({ show: 'all', warehouseId: null, tracking: 'any', search: '' })}>
                        Clear the filter
                      </Button>
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3 p-4">
            <div className="flex flex-wrap items-center gap-2">
              <Button size="sm" variant="outline" icon={Plus} onClick={() => searchInputRef.current?.focus()} disabled={disabled}>
                Add item
              </Button>
              <span className="inline-flex items-center gap-1 text-[11px] text-gray-500">
                or paste a column of codes and rates <Kbd>Ctrl</Kbd> <Kbd>V</Kbd>
              </span>
            </div>
            <div className="flex items-center gap-2 text-[11px] text-gray-500">
              {activeFilters > 0 ? (
                <Badge tone="primary" size="xs">
                  {shown.length} of {lines.length} shown
                </Badge>
              ) : null}
              <span>
                Total items <strong className="text-gray-900 tabular-nums">{lines.length}</strong>
              </span>
            </div>
          </div>
        </>
      )}
    </section>
  )
}

export default RevaluationItemsCard
