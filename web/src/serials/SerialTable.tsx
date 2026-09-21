import { useMemo } from 'react'
import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { Boxes, MapPin, MoreHorizontal, Package } from 'lucide-react'
import { MenuButton } from '../ui/MenuButton'
import type { MenuAction } from '../ui/MenuButton'
import { SmartTable } from '../ui/shell/SmartTable'
import type { SmartColumn } from '../ui/shell/SmartTable'
import { StatusBadge } from '../ui/StatusBadge'
import { cx } from '../ui/cx'
import { currencySymbol, formatDate, formatMoney } from '../utils/format'
import type { Serial } from '../services/masters'
import type { SortOrder } from '../services/api'
import { SerialWarrantyCell } from './SerialWarrantyCell'
import { relativeUpdated } from './serialTime'
import type { WarrantyThresholds } from './warranty'

/**
 * The serial register.
 *
 * `SmartTable` does the table — sticky header, sortable columns, keyboard row
 * activation, skeleton / error / empty bodies — and this file decides what a
 * serial's cells say. Two things are deliberate:
 *
 *  - the unit-cost column is BUILT or NOT BUILT from `costVisible`, rather than
 *    rendered and hidden. A column hidden with CSS is a column whose figures
 *    are in the DOM;
 *  - the row actions offered depend on the row's own status, because an action
 *    the server will refuse is worse than an action that is not there.
 */
export interface SerialTableProps {
  rows: readonly Serial[]
  loading: boolean
  error: Error | null
  onRetry: () => void
  empty: ReactNode

  selected: ReadonlySet<number>
  onToggle: (serialId: number) => void
  onToggleAll: () => void

  sort: { key: string; order: SortOrder }
  onSort: (key: string) => void

  onOpen: (row: Serial) => void
  onEdit: (row: Serial) => void
  onPrintLabel: (row: Serial) => void
  onDelete: (row: Serial) => void
  canWrite: boolean
  canDelete: boolean

  costVisible: boolean
  currency: string
  today: string
  thresholds: WarrantyThresholds
}

/**
 * Deleting is refused by the API for a serial the company physically holds —
 * it has to leave through an adjustment document so the stock ledger records
 * it. Offering the action anyway would be offering an error message.
 */
const STOCK_BEARING = new Set(['in_stock', 'reserved', 'in_transit'])

export function SerialTable({
  rows,
  loading,
  error,
  onRetry,
  empty,
  selected,
  onToggle,
  onToggleAll,
  sort,
  onSort,
  onOpen,
  onEdit,
  onPrintLabel,
  onDelete,
  canWrite,
  canDelete,
  costVisible,
  currency,
  today,
  thresholds,
}: SerialTableProps) {
  const allOnPageSelected = rows.length > 0 && rows.every((r) => selected.has(r.serial_id))
  const someOnPageSelected = rows.some((r) => selected.has(r.serial_id))
  const symbol = currencySymbol(currency)

  const columns = useMemo<SmartColumn<Serial>[]>(() => {
    const cols: SmartColumn<Serial>[] = [
      {
        key: 'select',
        width: 36,
        header: (
          <input
            type="checkbox"
            aria-label={allOnPageSelected ? 'Clear selection' : 'Select every serial on this page'}
            checked={allOnPageSelected}
            ref={(el) => {
              if (el) el.indeterminate = !allOnPageSelected && someOnPageSelected
            }}
            onChange={onToggleAll}
            className="h-3.5 w-3.5 cursor-pointer align-middle accent-[rgb(var(--color-primary))]"
          />
        ),
        headerClassName: 'w-9',
        render: (row) => (
          <input
            type="checkbox"
            aria-label={`Select ${row.serial_no}`}
            checked={selected.has(row.serial_id)}
            onChange={() => onToggle(row.serial_id)}
            onClick={(e) => e.stopPropagation()}
            className="h-3.5 w-3.5 cursor-pointer align-middle accent-[rgb(var(--color-primary))]"
          />
        ),
      },
      {
        key: 'serial_no',
        header: 'Serial number',
        sortKey: 'serial_no',
        minWidth: 150,
        render: (row) => (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation()
              onOpen(row)
            }}
            className="max-w-[16rem] truncate text-left font-mono text-[12px] font-semibold text-primary underline-offset-2 hover:underline focus:outline-none focus-visible:underline"
          >
            {row.serial_no}
          </button>
        ),
      },
      {
        key: 'item',
        header: 'Item',
        sortKey: 'item_name',
        minWidth: 186,
        render: (row) => (
          <span className="flex items-center gap-2">
            <span
              className="grid h-7 w-7 shrink-0 place-items-center rounded-md border border-gray-200 bg-gray-50 text-gray-400"
              aria-hidden
            >
              <Package className="h-3.5 w-3.5" />
            </span>
            <span className="min-w-0">
              <span className="block max-w-[13rem] truncate font-semibold text-gray-800">
                {row.item_name ?? `Item #${row.item_id}`}
              </span>
              {row.item_sku ? <span className="block truncate text-[10px] text-gray-400">{row.item_sku}</span> : null}
            </span>
          </span>
        ),
      },
      {
        key: 'status',
        header: 'Status',
        sortKey: 'status',
        minWidth: 100,
        render: (row) => <StatusBadge value={row.status} dot />,
      },
      {
        key: 'warehouse_name',
        header: 'Warehouse',
        sortKey: 'warehouse_name',
        minWidth: 124,
        render: (row) =>
          row.warehouse_name ? (
            <span className="min-w-0">
              <span className="block max-w-[11rem] truncate text-gray-800">{row.warehouse_name}</span>
              {row.warehouse_code ? (
                <span className="block truncate text-[10px] text-gray-400">{row.warehouse_code}</span>
              ) : null}
            </span>
          ) : (
            // Not a blank: a serial with no warehouse is a finding the insights
            // panel counts, and the row should say so where it is looked at.
            <span className="inline-flex items-center gap-1 text-[11px] text-amber-600">
              <MapPin className="h-3 w-3" aria-hidden />
              Not placed
            </span>
          ),
      },
      {
        key: 'batch_no',
        header: 'Batch',
        sortKey: 'batch_no',
        minWidth: 98,
        render: (row) =>
          row.batch_no ? (
            <Link
              to={`/masters/batches?q=${encodeURIComponent(row.batch_no)}`}
              onClick={(e) => e.stopPropagation()}
              className="inline-flex items-center gap-1 whitespace-nowrap font-mono text-[11px] text-gray-700 no-underline hover:text-primary hover:underline"
            >
              <Boxes className="h-3 w-3 text-gray-400" aria-hidden />
              {row.batch_no}
            </Link>
          ) : null,
      },
      {
        key: 'location_code',
        header: 'Location',
        sortKey: 'location_code',
        minWidth: 92,
        render: (row) => (row.location_code ? <span className="whitespace-nowrap font-mono text-[11px]">{row.location_code}</span> : null),
      },
    ]

    if (costVisible) {
      cols.push({
        key: 'unit_cost',
        header: 'Unit cost',
        sortKey: 'unit_cost',
        align: 'right',
        minWidth: 104,
        // The symbol rides with the figure rather than sitting in the header:
        // a two-line header over a one-line column costs more width than the
        // glyph does, and a lone number in a money column is ambiguous on a
        // printed page.
        render: (row) =>
          row.unit_cost === null || row.unit_cost === undefined ? null : (
            <span className="whitespace-nowrap">
              {symbol} {formatMoney(row.unit_cost)}
            </span>
          ),
      })
    }

    cols.push(
      {
        key: 'warranty_until',
        header: 'Warranty until',
        sortKey: 'warranty_until',
        minWidth: 118,
        render: (row) => <SerialWarrantyCell until={row.warranty_until} today={today} thresholds={thresholds} />,
      },
      {
        key: 'updated_at',
        header: 'Updated',
        sortKey: 'updated_at',
        minWidth: 108,
        render: (row) => {
          const ago = relativeUpdated(row.updated_at)
          return (
            <span className="min-w-0">
              <span className="block whitespace-nowrap text-gray-700">{formatDate(row.updated_at)}</span>
              {ago ? <span className="block whitespace-nowrap text-[10px] text-gray-400">{ago}</span> : null}
            </span>
          )
        },
      },
      {
        key: 'actions',
        header: <span className="sr-only">Actions</span>,
        align: 'right',
        width: 52,
        render: (row) => {
          const actions: MenuAction[] = [
            { key: 'view', label: 'View details', onSelect: () => onOpen(row) },
          ]
          if (canWrite) actions.push({ key: 'edit', label: 'Edit serial number', onSelect: () => onEdit(row) })
          actions.push({ key: 'label', label: 'Print label', onSelect: () => onPrintLabel(row) })
          if (canDelete) {
            const held = STOCK_BEARING.has(String(row.status))
            actions.push({
              key: 'delete',
              label: held ? 'Delete (use an adjustment)' : 'Delete',
              danger: true,
              separated: true,
              disabled: held,
              onSelect: () => onDelete(row),
            })
          }
          return <MenuButton label={`Actions for ${row.serial_no}`} icon={MoreHorizontal} actions={actions} align="end" width={220} />
        },
      },
    )

    return cols
  }, [
    allOnPageSelected,
    someOnPageSelected,
    selected,
    onToggle,
    onToggleAll,
    onOpen,
    onEdit,
    onPrintLabel,
    onDelete,
    canWrite,
    canDelete,
    costVisible,
    symbol,
    today,
    thresholds,
  ])

  return (
    <SmartTable<Serial>
      columns={columns}
      rows={rows}
      rowKey="serial_id"
      loading={loading}
      error={error ? { title: 'We couldn’t load serial numbers.', description: error.message, onRetry } : null}
      empty={empty}
      caption="Serial numbers"
      minWidth={1020}
      density="compact"
      stickyHeader
      sort={sort}
      onSort={onSort}
      onRowActivate={onOpen}
      keyboardResetKey={`${sort.key}:${sort.order}:${rows.length}`}
      rowClassName={(row) => cx(selected.has(row.serial_id) && 'bg-primary-light/40')}
      cardPadding="none"
      className="border-0 shadow-none"
      title={undefined}
    />
  )
}

export default SerialTable
