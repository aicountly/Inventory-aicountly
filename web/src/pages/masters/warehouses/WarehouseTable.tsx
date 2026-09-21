import { ArrowDown, ArrowUp, ChevronsUpDown, MoreHorizontal, Star, Warehouse as WarehouseIcon } from 'lucide-react'
import { Badge, ProgressBar, Tooltip, cx } from '../../../ui'
import { MenuButton } from '../../../ui/MenuButton'
import type { MenuAction } from '../../../ui/MenuButton'
import type { SortOrder } from '../../../services/api'
import type { Warehouse } from '../../../services/masters'
import { formatDateTime, formatQty, humanize } from '../../../utils/format'
import { capacityOf, placeOf, utilisationLevel, utilisationOf, UTILISATION_LABELS } from './warehouseMetrics'
import type { UtilisationLevel, WarehouseStock } from './warehouseMetrics'
import { EMPTY_STOCK } from './warehouseMetrics'

/**
 * The warehouse list as a real table: one `<th scope="col">` per column, a
 * live `aria-sort` on the column the API is ordering by, and a caption the
 * screen reader hears before the rows.
 *
 * Two rules run through the cells:
 *
 *  - Nothing is invented. A warehouse with no code prints an em dash, not a
 *    generated code; a warehouse with no capacity prints "Not configured", not
 *    a zero; a user without the stock report's permission sees a dash with the
 *    reason on the header, not a quantity of 0.
 *  - Colour never carries meaning on its own. The utilisation bar has a band
 *    colour, and the percentage is printed beside it in every row; the status
 *    badge has a dot, and the word "Active" beside it.
 */

const TH = 'h-10 px-3 text-left text-[10.5px] font-semibold uppercase tracking-[0.03em] text-gray-500 whitespace-nowrap bg-gray-50 border-b border-gray-200'
const TD = 'px-3 py-3 align-middle text-xs text-gray-600 border-b border-gray-100'

const UTILISATION_BAR: Record<UtilisationLevel, string> = {
  empty: 'bg-gray-300',
  normal: 'bg-primary',
  warning: 'bg-amber-500',
  high: 'bg-red-500',
}

const TYPE_TONE: Record<string, 'info' | 'warning' | 'danger' | 'violet' | 'neutral' | 'teal'> = {
  standard: 'info',
  transit: 'teal',
  damaged: 'danger',
  quarantine: 'warning',
  consignment: 'violet',
  job_worker: 'violet',
  virtual: 'neutral',
}

export interface WarehouseColumn {
  key: string
  label: string
  /** API sort parameter; omitted for columns the server cannot order by. */
  sortKey?: string
  align?: 'left' | 'right'
}

/**
 * Derived columns carry no `sortKey` on purpose.
 *
 * Stock and utilisation are computed from a separate report, so the API cannot
 * order the page by them; offering a sort that silently sorted the fifty rows
 * on screen would be a control that lies on every page but the last.
 */
export const WAREHOUSE_COLUMNS: readonly WarehouseColumn[] = [
  { key: 'warehouse_name', label: 'Warehouse', sortKey: 'warehouse_name' },
  { key: 'warehouse_code', label: 'Code', sortKey: 'warehouse_code' },
  { key: 'warehouse_type', label: 'Type', sortKey: 'warehouse_type' },
  { key: 'location', label: 'Location' },
  { key: 'capacity_units', label: 'Capacity', sortKey: 'capacity_units', align: 'right' },
  { key: 'stock', label: 'Current stock', align: 'right' },
  { key: 'utilisation', label: 'Utilisation' },
  { key: 'allow_negative', label: 'Negative stock' },
  { key: 'is_active', label: 'Status' },
  { key: 'updated_at', label: 'Updated', sortKey: 'updated_at' },
]

export interface WarehouseRowActions {
  onView: (row: Warehouse) => void
  onEdit: (row: Warehouse) => void
  onDuplicate: (row: Warehouse) => void
  onSetDefault: (row: Warehouse) => void
  onToggleActive: (row: Warehouse) => void
  onDelete: (row: Warehouse) => void
}

export interface WarehouseTableProps extends WarehouseRowActions {
  rows: readonly Warehouse[]
  stock: Map<number, WarehouseStock>
  canSeeStock: boolean
  canSeeStockValue: boolean
  formatValue: (value: number) => string
  canWrite: boolean
  canDelete: boolean
  loading: boolean
  sort: string
  order: SortOrder
  onSort: (key: string) => void
  selected: ReadonlySet<number>
  onToggleRow: (id: number) => void
  onToggleAll: () => void
  busyIds: ReadonlySet<number>
}

export function WarehouseTable({
  rows,
  stock,
  canSeeStock,
  canSeeStockValue,
  formatValue,
  canWrite,
  canDelete,
  loading,
  sort,
  order,
  onSort,
  selected,
  onToggleRow,
  onToggleAll,
  busyIds,
  ...actions
}: WarehouseTableProps) {
  const allSelected = rows.length > 0 && rows.every((r) => selected.has(r.warehouse_id))
  const someSelected = rows.some((r) => selected.has(r.warehouse_id))

  return (
    <div className="w-full overflow-x-auto">
      <table className="w-full min-w-[1180px] border-separate border-spacing-0">
        <caption className="sr-only">
          Warehouses, sorted by {WAREHOUSE_COLUMNS.find((c) => c.sortKey === sort)?.label ?? sort}, {order === 'asc' ? 'ascending' : 'descending'}
        </caption>
        <thead className="sticky top-0 z-10">
          <tr>
            <th scope="col" className={cx(TH, 'w-10')}>
              <input
                type="checkbox"
                className="align-middle"
                checked={allSelected}
                ref={(el) => {
                  if (el) el.indeterminate = someSelected && !allSelected
                }}
                onChange={onToggleAll}
                aria-label={allSelected ? 'Clear selection' : 'Select all warehouses on this page'}
                disabled={rows.length === 0}
              />
            </th>
            {WAREHOUSE_COLUMNS.map((col) => {
              const active = col.sortKey !== undefined && col.sortKey === sort
              const Icon = active ? (order === 'asc' ? ArrowUp : ArrowDown) : ChevronsUpDown
              return (
                <th
                  key={col.key}
                  scope="col"
                  className={cx(TH, col.align === 'right' && 'text-right')}
                  aria-sort={active ? (order === 'asc' ? 'ascending' : 'descending') : col.sortKey ? 'none' : undefined}
                >
                  {col.sortKey ? (
                    <button
                      type="button"
                      onClick={() => onSort(col.sortKey as string)}
                      className={cx(
                        'inline-flex items-center gap-1 uppercase tracking-[0.03em] hover:text-gray-900 rounded',
                        col.align === 'right' && 'flex-row-reverse',
                        active && 'text-gray-900',
                      )}
                    >
                      {col.label}
                      <Icon className="w-3 h-3 opacity-60" aria-hidden />
                    </button>
                  ) : col.key === 'stock' && !canSeeStock ? (
                    <Tooltip label="You do not have permission to read the warehouse stock report.">
                      <span>{col.label}</span>
                    </Tooltip>
                  ) : (
                    col.label
                  )}
                </th>
              )
            })}
            <th scope="col" className={cx(TH, 'w-12 text-right')}>
              <span className="sr-only">Actions</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {loading && rows.length === 0
            ? Array.from({ length: 6 }, (_, i) => <SkeletonRow key={i} />)
            : rows.map((row) => (
                <Row
                  key={row.warehouse_id}
                  row={row}
                  stock={stock.get(row.warehouse_id) ?? EMPTY_STOCK}
                  canSeeStock={canSeeStock}
                  canSeeStockValue={canSeeStockValue}
                  formatValue={formatValue}
                  canWrite={canWrite}
                  canDelete={canDelete}
                  selected={selected.has(row.warehouse_id)}
                  busy={busyIds.has(row.warehouse_id)}
                  onToggleRow={onToggleRow}
                  {...actions}
                />
              ))}
        </tbody>
      </table>
    </div>
  )
}

function SkeletonRow() {
  return (
    <tr>
      {Array.from({ length: WAREHOUSE_COLUMNS.length + 2 }, (_, i) => (
        <td key={i} className={TD}>
          <span className="skeleton block h-4 w-full max-w-[120px] rounded" aria-hidden />
        </td>
      ))}
    </tr>
  )
}

interface RowProps extends WarehouseRowActions {
  row: Warehouse
  stock: WarehouseStock
  canSeeStock: boolean
  canSeeStockValue: boolean
  formatValue: (value: number) => string
  canWrite: boolean
  canDelete: boolean
  selected: boolean
  busy: boolean
  onToggleRow: (id: number) => void
}

function Row({
  row,
  stock,
  canSeeStock,
  canSeeStockValue,
  formatValue,
  canWrite,
  canDelete,
  selected,
  busy,
  onToggleRow,
  onView,
  onEdit,
  onDuplicate,
  onSetDefault,
  onToggleActive,
  onDelete,
}: RowProps) {
  const isDefault = Number(row.is_default) === 1
  const isActive = Number(row.is_active) === 1
  const capacity = capacityOf(row)
  const utilisation = canSeeStock ? utilisationOf(capacity, stock.qty) : null
  const level = utilisationLevel(utilisation)
  const place = placeOf(row)

  const actions: MenuAction[] = [
    { key: 'view', label: canWrite ? 'Edit' : 'View', onSelect: () => (canWrite ? onEdit(row) : onView(row)) },
  ]
  if (canWrite) {
    actions.push({ key: 'duplicate', label: 'Duplicate', onSelect: () => onDuplicate(row) })
    if (!isDefault) actions.push({ key: 'default', label: 'Set as default', onSelect: () => onSetDefault(row) })
    actions.push({
      key: 'toggle',
      label: isActive ? 'Deactivate' : 'Activate',
      separated: true,
      onSelect: () => onToggleActive(row),
    })
  }
  if (canDelete) {
    actions.push({ key: 'delete', label: 'Delete', danger: true, separated: !canWrite, onSelect: () => onDelete(row) })
  }

  return (
    <tr className={cx('transition-colors hover:bg-primary-light/30', selected && 'bg-primary-light/40', busy && 'opacity-60')}>
      <td className={TD}>
        <input
          type="checkbox"
          className="align-middle"
          checked={selected}
          onChange={() => onToggleRow(row.warehouse_id)}
          aria-label={`Select ${row.warehouse_name}`}
        />
      </td>

      <td className={TD}>
        <div className="flex items-center gap-2.5">
          <span className="w-10 h-9 shrink-0 grid place-items-center rounded-lg border border-gray-200 bg-gray-50 text-gray-500" aria-hidden>
            <WarehouseIcon className="w-4 h-4" />
          </span>
          <span className="min-w-0 grid gap-0.5">
            <button
              type="button"
              onClick={() => (canWrite ? onEdit(row) : onView(row))}
              className="text-xs font-semibold text-gray-900 truncate text-left hover:text-primary rounded inline-flex items-center gap-1"
            >
              <span className="truncate">{row.warehouse_name}</span>
              {isDefault ? (
                <Tooltip label="Default warehouse — used when a document does not name one">
                  <Star className="w-3 h-3 text-amber-500 shrink-0" aria-label="Default warehouse" />
                </Tooltip>
              ) : null}
            </button>
            <span className="text-[10.5px] text-gray-500 truncate">{humanize(row.warehouse_type)} warehouse</span>
          </span>
        </div>
      </td>

      <td className={TD}>
        <span className="font-mono text-[11px]">{row.warehouse_code ?? '—'}</span>
      </td>

      <td className={TD}>
        <Badge tone={TYPE_TONE[String(row.warehouse_type)] ?? 'neutral'} size="xs">
          {humanize(row.warehouse_type)}
        </Badge>
      </td>

      <td className={TD}>
        <span className="grid gap-0.5">
          <span className="text-xs font-semibold text-gray-900">{Number(row.bo_id) > 0 ? `Branch #${row.bo_id}` : 'All branches'}</span>
          <span className="text-[10.5px] text-gray-500">{place.label ?? 'No location set'}</span>
        </span>
      </td>

      <td className={cx(TD, 'text-right')}>
        {capacity === null ? (
          <span className="text-gray-400">Not configured</span>
        ) : (
          <span className="grid gap-0.5">
            <span className="text-xs font-semibold text-gray-900 tabular-nums">{formatQty(capacity)} Units</span>
            <span className="text-[10.5px] text-gray-500 tabular-nums">{areaText(row)}</span>
          </span>
        )}
      </td>

      <td className={cx(TD, 'text-right')}>
        {!canSeeStock ? (
          <span className="text-gray-400">—</span>
        ) : (
          <span className="grid gap-0.5">
            <span className={cx('text-xs font-semibold tabular-nums', stock.qty < 0 ? 'text-red-600' : 'text-gray-900')}>{formatQty(stock.qty)} Units</span>
            {canSeeStockValue && stock.value !== null ? <span className="text-[10.5px] text-gray-500 tabular-nums">{formatValue(stock.value)}</span> : null}
          </span>
        )}
      </td>

      <td className={TD}>
        {utilisation === null ? (
          <span className="text-gray-400">{capacity === null ? 'Not configured' : '—'}</span>
        ) : (
          <span className="grid gap-1 min-w-[112px]">
            <span className="text-[11px] font-semibold text-gray-900 tabular-nums">{utilisation.toFixed(utilisation >= 10 ? 0 : 1)}%</span>
            <ProgressBar
              value={Math.min(100, utilisation)}
              size="sm"
              className="max-w-[110px]"
              barClassName={UTILISATION_BAR[level]}
              aria-label={`${row.warehouse_name}: ${utilisation.toFixed(1)} percent of capacity, ${UTILISATION_LABELS[level]}`}
            />
          </span>
        )}
      </td>

      <td className={TD}>
        {row.allow_negative === null || row.allow_negative === undefined
          ? 'Company policy'
          : Number(row.allow_negative) === 1
            ? 'Allowed'
            : 'Blocked'}
      </td>

      <td className={TD}>
        <Badge tone={isActive ? 'success' : 'neutral'} size="xs" dot>
          {isActive ? 'Active' : 'Inactive'}
        </Badge>
      </td>

      <td className={TD}>
        <span className="whitespace-nowrap text-gray-500">{formatDateTime(row.updated_at)}</span>
      </td>

      <td className={cx(TD, 'text-right')}>
        <MenuButton
          actions={actions}
          label={`Actions for ${row.warehouse_name}`}
          icon={MoreHorizontal}
          variant="ghost"
          size="sm"
          align="end"
        />
      </td>
    </tr>
  )
}

/** "2,500 Sq. Ft." under the unit ceiling, or a dash when only the ceiling is set. */
function areaText(row: Warehouse): string {
  const area = row.area === null || row.area === undefined ? null : Number(row.area)
  if (area === null || !Number.isFinite(area) || area <= 0) return '—'
  return `${formatQty(area)} ${areaUnitShort(row.area_unit)}`.trim()
}

const SHORT: Record<string, string> = {
  sq_ft: 'Sq. Ft.',
  sq_m: 'Sq. M.',
  sq_yd: 'Sq. Yd.',
  acre: 'Acre',
  hectare: 'Hectare',
}

function areaUnitShort(unit: string | null | undefined): string {
  if (!unit) return ''
  return SHORT[unit] ?? unit
}
