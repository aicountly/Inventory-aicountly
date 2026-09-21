import { useMemo } from 'react'
import type { RefObject } from 'react'
import {
  AlertTriangle,
  ClipboardList,
  Filter,
  Layers,
  ListRestart,
  PackageSearch,
  RotateCcw,
  ScanBarcode,
  Trash2,
  TrendingUp,
} from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { Badge } from '../../ui/Badge'
import { Button } from '../../ui/Button'
import { EmptyState } from '../../ui/EmptyState'
import { MenuButton } from '../../ui/MenuButton'
import type { MenuAction } from '../../ui/MenuButton'
import { SearchBox } from '../../ui/SearchBox'
import { SmartTable, TablePagination, useClientTablePagination } from '../../ui/shell'
import type { SmartColumn } from '../../ui/shell'
import { cx } from '../../ui/cx'
import { ConfigureColumns } from '../../registers/ConfigureColumns'
import type { ColumnVisibility } from '../../registers/columnPrefs'
import { isColumnVisible } from '../../registers/columnPrefs'
import { formatInt, formatQty } from '../../utils/format'
import type { LineDraft } from '../formModel'
import { columnsFor } from './countColumns'
import type { CountFilters } from './countFilters'
import { activeFilterCount, hasAnyFilter, PRESET_LABEL, QUICK_PRESETS } from './countFilters'
import { CountedQuantityInput } from './CountedQuantityInput'
import { STATUS_LABEL } from './countModel'
import type { CountRow, CountStatus } from './countModel'

/**
 * The count sheet: one row per thing to count, one editable figure each.
 *
 * Rendered through the shared SmartTable so it looks, scrolls, aligns and
 * announces exactly like every other grid in Inventory, and configured through
 * the shared ConfigureColumns so the reader's column choice is stored the same
 * way and in the same place as every register's.
 *
 * Two things it does differently from a register, both because it is an entry
 * form: pagination is client-side (the counted quantities live in the browser
 * until the draft is saved, so the server cannot page over them), and row
 * activation is off, because the arrow keys belong to the quantity cell.
 */

const STATUS_TONE: Record<CountStatus, 'neutral' | 'success' | 'danger' | 'warning' | 'info'> = {
  pending: 'neutral',
  ok: 'success',
  shortage: 'danger',
  excess: 'success',
  recount: 'info',
  exception: 'warning',
}

export interface CountSheetProps {
  /** Rows after search and filters. */
  rows: readonly CountRow[]
  /** Every loaded row, for "showing x of y". */
  totalRows: number
  filters: CountFilters
  onFiltersChange: (next: CountFilters) => void
  onOpenFilters: () => void
  visibility: ColumnVisibility
  onVisibilityChange: (next: ColumnVisibility) => void

  onPatchLine: (key: string, patch: Partial<LineDraft>) => void
  onRemoveLine: (key: string) => void
  onOpenSerials: (row: CountRow) => void
  onOpenBatches: (row: CountRow) => void
  onToggleRecount: (key: string) => void

  warehouseName: (id: number | null | undefined) => string
  money: (value: number) => string
  showCost: boolean
  canRemoveLines: boolean

  /** Row to scroll to and ring — set by the scanner and the insight rail. */
  highlightKey: string | null
  loading: boolean
  disabled: boolean
  searchInputRef?: RefObject<HTMLInputElement | null>

  /** Empty-state actions, before anything is loaded. */
  onLoad: () => void
  onImport: () => void
  canImport: boolean
}

export function CountSheet({
  rows,
  totalRows,
  filters,
  onFiltersChange,
  onOpenFilters,
  visibility,
  onVisibilityChange,
  onPatchLine,
  onRemoveLine,
  onOpenSerials,
  onOpenBatches,
  onToggleRecount,
  warehouseName,
  money,
  showCost,
  canRemoveLines,
  highlightKey,
  loading,
  disabled,
  searchInputRef,
  onLoad,
  onImport,
  canImport,
}: CountSheetProps) {
  const navigate = useNavigate()
  const configurable = useMemo(() => columnsFor(showCost), [showCost])
  const shown = useMemo(
    () => new Set(configurable.filter((c) => isColumnVisible(c, visibility)).map((c) => c.key)),
    [configurable, visibility],
  )

  const { pagination, page, pageSize, setPage, setPageSize } = useClientTablePagination(rows, {
    // A changed filter or column set makes the current cursor meaningless.
    resetKey: `${filters.preset}|${filters.search}|${filters.warehouseId}|${[...shown].join(',')}`,
    initialPageSize: 50,
  })

  const columns = useMemo<SmartColumn<CountRow>[]>(() => {
    const all: (SmartColumn<CountRow> & { visibleKey?: string })[] = [
      {
        key: 'index',
        header: '#',
        width: '2.5rem',
        cellClassName: 'text-gray-400 tabular-nums',
        render: (_row, i) => formatInt(pagination.from + i),
      },
      {
        key: 'item',
        header: 'Item',
        minWidth: 200,
        render: (row) => (
          <span className="flex min-w-0 items-center gap-2">
            <span
              className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-gray-200 bg-gray-50"
              aria-hidden
            >
              <PackageSearch className="h-3.5 w-3.5 text-gray-400" />
            </span>
            <span className="min-w-0">
              <span className="block truncate text-xs font-semibold text-gray-900">
                {row.line.item_sku ?? `#${row.line.item_id ?? '—'}`}
              </span>
              <span className="block truncate text-[11px] text-gray-500">{row.line.item_name}</span>
            </span>
          </span>
        ),
      },
      {
        key: 'warehouse',
        header: 'Warehouse',
        minWidth: 120,
        render: (row) => row.snapshot.warehouseName ?? warehouseName(row.line.warehouse_id) ?? null,
      },
      {
        key: 'batch',
        header: 'Batch',
        minWidth: 90,
        render: (row) =>
          row.line.batch_no ? (
            <button
              type="button"
              className="rounded text-xs text-nav underline-offset-2 hover:underline focus:outline-none focus:ring-2 focus:ring-primary/30"
              onClick={() => onOpenBatches(row)}
            >
              {row.line.batch_no}
            </button>
          ) : null,
      },
      {
        key: 'unit',
        header: 'Unit',
        width: '4rem',
        render: (row) => row.snapshot.unitSymbol ?? null,
      },
      {
        key: 'book_qty',
        header: 'Book qty',
        align: 'right',
        width: '6rem',
        render: (row) => (
          <span id={`book-${row.line.key}`} className="tabular-nums">
            {formatQty(row.line.book_qty)}
          </span>
        ),
      },
      {
        key: 'counted_qty',
        header: 'Counted qty',
        align: 'right',
        width: '7rem',
        render: (row) => (
          <CountedQuantityInput
            value={row.line.physical_qty}
            onChange={(next) => onPatchLine(row.line.key, { physical_qty: next })}
            highlighted={highlightKey === row.line.key}
            invalid={row.exceptions.some((e) => e.kind === 'invalid_qty')}
            disabled={disabled}
            ariaLabel={`Counted quantity for ${row.line.item_name}`}
            describedBy={`book-${row.line.key}`}
          />
        ),
      },
      {
        key: 'difference',
        header: 'Difference',
        align: 'right',
        width: '6rem',
        render: (row) => {
          if (row.difference === null) return null
          const tone =
            row.difference < 0 ? 'text-red-600' : row.difference > 0 ? 'text-emerald-600' : 'text-gray-500'
          return (
            <span className={cx('font-semibold tabular-nums', tone)}>
              {/* The sign is the meaning, so it is spelled out rather than left
                  to colour alone — a red 2 and a green 2 are the same glyph. */}
              {row.difference > 0 ? '+' : ''}
              {formatQty(row.difference)}
            </span>
          )
        },
      },
      {
        key: 'unit_cost',
        header: 'Unit cost',
        align: 'right',
        width: '7rem',
        render: (row) => (row.snapshot.unitCost === null ? null : money(row.snapshot.unitCost)),
      },
      {
        key: 'serials',
        header: 'Serials',
        align: 'right',
        width: '6rem',
        render: (row) => {
          if (!row.line.track_serial) return null
          const needed = row.difference !== null && row.difference < 0 ? Math.abs(row.difference) : null
          const short = needed !== null && row.line.serials.length !== needed
          return (
            <button
              type="button"
              onClick={() => onOpenSerials(row)}
              className={cx(
                'rounded px-1 text-xs tabular-nums underline-offset-2 hover:underline focus:outline-none focus:ring-2 focus:ring-primary/30',
                short ? 'font-semibold text-red-600' : 'text-nav',
              )}
              title="Manage serial numbers for this line"
            >
              {row.line.serials.length}
              {needed !== null ? ` / ${formatQty(needed)}` : row.snapshot.bookSerialCount !== null ? ` of ${row.snapshot.bookSerialCount}` : ''}
            </button>
          )
        },
      },
      {
        key: 'availability',
        header: 'Availability',
        align: 'right',
        width: '7rem',
        render: (row) => (row.snapshot.availableQty === null ? null : formatQty(row.snapshot.availableQty)),
      },
      {
        key: 'variance_value',
        header: 'Variance value',
        align: 'right',
        width: '8rem',
        render: (row) => {
          if (row.varianceValue === null) return null
          const tone =
            row.varianceValue < 0 ? 'text-red-600' : row.varianceValue > 0 ? 'text-emerald-600' : 'text-gray-500'
          return <span className={cx('font-semibold tabular-nums', tone)}>{money(row.varianceValue)}</span>
        },
      },
      {
        key: 'status',
        header: 'Status',
        width: '7rem',
        render: (row) => (
          <span className="flex items-center gap-1">
            <Badge tone={STATUS_TONE[row.status]} size="xs" dot>
              {STATUS_LABEL[row.status]}
            </Badge>
            {row.exceptions.length > 0 ? (
              <AlertTriangle
                className={cx(
                  'h-3.5 w-3.5 shrink-0',
                  row.exceptions.some((e) => e.severity === 'critical') ? 'text-red-600' : 'text-amber-600',
                )}
                aria-label={row.exceptions.map((e) => e.title).join('; ')}
              />
            ) : null}
          </span>
        ),
      },
    ]

    const visible = all.filter((col) => col.key === 'index' || shown.has(col.key))

    visible.push({
      key: 'actions',
      header: '',
      width: '2.5rem',
      align: 'right',
      cellClassName: 'overflow-visible',
      render: (row) => <RowMenu row={row} />,
    })
    return visible

    function RowMenu({ row }: { row: CountRow }) {
      const actions: MenuAction[] = []
      if (row.line.track_serial) {
        actions.push({ key: 'serials', label: 'Manage serial numbers', icon: ScanBarcode, onSelect: () => onOpenSerials(row) })
      }
      if (row.line.track_batch) {
        actions.push({ key: 'batch', label: 'Manage batch count', icon: Layers, onSelect: () => onOpenBatches(row) })
      }
      actions.push({
        key: 'recount',
        label: row.snapshot.recount ? 'Clear recount mark' : 'Mark for recount',
        icon: RotateCcw,
        onSelect: () => onToggleRecount(row.line.key),
      })
      actions.push({
        key: 'reset',
        label: 'Clear counted quantity',
        icon: ListRestart,
        disabled: !row.counted,
        onSelect: () => onPatchLine(row.line.key, { physical_qty: '', serials: [] }),
      })
      if (row.line.item_id !== null) {
        // Navigated, not linked: MenuButton renders each action as a `<button>`,
        // and an anchor inside a button is invalid markup that assistive
        // technology reports inconsistently.
        actions.push({
          key: 'item',
          separated: true,
          label: 'Open item',
          icon: PackageSearch,
          onSelect: () => navigate(`/items/${row.line.item_id}`),
        })
        actions.push({
          key: 'ledger',
          label: 'Stock movements',
          icon: TrendingUp,
          onSelect: () => navigate(`/stock/ledger?item_id=${row.line.item_id}`),
        })
      }
      if (canRemoveLines) {
        actions.push({
          key: 'remove',
          separated: true,
          danger: true,
          label: 'Remove line',
          icon: Trash2,
          onSelect: () => onRemoveLine(row.line.key),
        })
      }
      return <MenuButton actions={actions} label={`Actions for ${row.line.item_name}`} align="end" width={210} />
    }
  }, [
    shown,
    pagination.from,
    warehouseName,
    money,
    disabled,
    highlightKey,
    onPatchLine,
    onOpenSerials,
    onOpenBatches,
    onToggleRecount,
    onRemoveLine,
    canRemoveLines,
    navigate,
  ])

  const filterCount = activeFilterCount(filters)

  const toolbar = (
    <div className="flex flex-wrap items-center gap-2">
      <SearchBox
        ref={searchInputRef}
        value={filters.search}
        onChange={(search) => onFiltersChange({ ...filters, search })}
        placeholder="Search item, warehouse, batch, serial…"
        className="w-56"
      />
      <div className="flex flex-wrap items-center gap-1" role="group" aria-label="Quick filters">
        {QUICK_PRESETS.map((preset) => (
          <button
            key={preset}
            type="button"
            aria-pressed={filters.preset === preset}
            onClick={() => onFiltersChange({ ...filters, preset })}
            className={cx(
              'rounded-full border px-2 py-0.5 text-[11px] font-medium transition-colors focus:outline-none focus:ring-2 focus:ring-primary/30',
              filters.preset === preset
                ? 'border-primary/30 bg-primary-light text-primary'
                : 'border-gray-200 bg-white text-gray-600 hover:border-gray-300',
            )}
          >
            {PRESET_LABEL[preset]}
          </button>
        ))}
      </div>
      <Button variant="secondary" size="xs" icon={Filter} onClick={onOpenFilters}>
        Filters{filterCount ? ` (${filterCount})` : ''}
      </Button>
      <ConfigureColumns
        columns={configurable}
        visibility={visibility}
        onChange={onVisibilityChange}
        title="Count sheet columns"
        description="Choose the columns to show while counting. The choice is remembered for your own sign-in."
      />
    </div>
  )

  const emptyState =
    totalRows === 0 ? (
      <EmptyState
        icon={ClipboardList}
        title="Load stock to begin counting"
        description="Choose a warehouse and load book quantities, or import a count sheet from your handheld device."
        action={
          <div className="flex flex-wrap items-center justify-center gap-2">
            <Button onClick={onLoad} disabled={disabled}>
              Load book quantities
            </Button>
            <Button variant="secondary" onClick={onImport} disabled={disabled || !canImport}>
              Import count sheet
            </Button>
          </div>
        }
      />
    ) : (
      <EmptyState
        icon={Filter}
        size="sm"
        title="No lines match these filters"
        description={`${formatInt(totalRows)} line${totalRows === 1 ? '' : 's'} are loaded. Widen the filters to see them.`}
        action={
          hasAnyFilter(filters) ? (
            <Button
              variant="secondary"
              size="sm"
              onClick={() => onFiltersChange({ ...filters, preset: 'all', search: '', lineKeys: null, lineKeysLabel: null })}
            >
              Clear filters
            </Button>
          ) : undefined
        }
      />
    )

  return (
    <SmartTable<CountRow>
      title={`Count sheet${totalRows ? ` (${formatInt(totalRows)} item${totalRows === 1 ? '' : 's'})` : ''}`}
      headerAction={toolbar}
      columns={columns}
      rows={pagination.pageRows}
      rowKey={(row) => row.line.key}
      getRowDomId={(row) => `count-row-${row.line.key}`}
      rowClassName={(row) =>
        cx(
          highlightKey === row.line.key && 'bg-primary-light/50',
          row.exceptions.some((e) => e.severity === 'critical') && 'bg-red-50/40',
        )
      }
      caption="Book quantity versus counted quantity, per item and warehouse"
      loading={loading}
      empty={emptyState}
      // Off on purpose: the arrow keys belong to the quantity cell, and a row
      // that "activates" would fight the operator typing into it.
      keyboardNav={false}
      stickyHeader
      scrollBody
      density="compact"
      size="xs"
      minWidth={1100}
      className="max-h-[min(38rem,60vh)]"
      footer={
        totalRows > 0 ? (
          <TablePagination
            page={page}
            pageSize={pageSize}
            total={pagination.total}
            totalPages={pagination.totalPages}
            from={pagination.from}
            to={pagination.to}
            onPageChange={setPage}
            onPageSizeChange={(size) => setPageSize(size)}
            numbered
          />
        ) : null
      }
    />
  )
}

export default CountSheet
