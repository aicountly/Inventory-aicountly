import { useEffect, useMemo, useRef } from 'react'
import {
  Copy,
  MoreHorizontal,
  Pencil,
  Play,
  Square,
  Trash2,
} from 'lucide-react'
import type { SmartColumn } from '../../../ui/shell/SmartTable'
import type { MenuAction } from '../../../ui/MenuButton'
import { MenuButton } from '../../../ui/MenuButton'
import { ActiveBadge } from '../../../ui/StatusBadge'
import type { Location } from '../../../services/masters'
import type { FormOptionWarehouse } from '../../../services/items'
import { formatDate } from '../../../utils/format'
import { buildHierarchy, isActive, locationTypeMeta, pathLabel } from './locationsModel'
import type { LocationNode } from './locationsModel'

/**
 * The columns the Locations table renders, and the CSV each one writes.
 *
 * Two of them are the reason this screen exists rather than another
 * `MasterPage`: WAREHOUSE and PARENT used to print `#3` and `#12`, which are
 * primary keys, not answers. Both are resolved to the name the user gave the
 * record — the warehouse from `/v1/items/form-options`, the parent from the
 * hierarchy set the page already loads for its KPIs — and both fall back to the
 * id rather than to a dash when the referenced row is outside the loaded set.
 */

export const SELECT_COLUMN_KEY = '__select__'
export const ACTIONS_COLUMN_KEY = '__actions__'

export interface LocationRowActions {
  onEdit: (row: Location) => void
  onDuplicate: (row: Location) => void
  onToggleActive: (row: Location) => void
  onDelete: (row: Location) => void
  canWrite: boolean
  canDelete: boolean
}

export interface LocationColumnsOptions extends LocationRowActions {
  warehouses: readonly FormOptionWarehouse[]
  /** Every row in scope — used to name parents the current page does not hold. */
  allRows: readonly Location[]
  selected: ReadonlySet<number>
  onToggleRow: (id: number, checked: boolean) => void
  onToggleAll: (checked: boolean) => void
  /** Rows on the current page, for the header checkbox's state. */
  pageRows: readonly Location[]
  selectable: boolean
}

/** A header checkbox that can also say "some, not all". */
function SelectAllBox({
  checked,
  indeterminate,
  onChange,
}: {
  checked: boolean
  indeterminate: boolean
  onChange: (checked: boolean) => void
}) {
  const ref = useRef<HTMLInputElement>(null)
  useEffect(() => {
    if (ref.current) ref.current.indeterminate = indeterminate
  }, [indeterminate])
  return (
    <input
      ref={ref}
      type="checkbox"
      className="h-3.5 w-3.5 cursor-pointer accent-[rgb(var(--color-primary))]"
      checked={checked}
      onChange={(e) => onChange(e.target.checked)}
      aria-label={checked ? 'Clear selection' : 'Select all locations on this page'}
    />
  )
}

export function buildLocationColumns({
  warehouses,
  allRows,
  selected,
  onToggleRow,
  onToggleAll,
  pageRows,
  selectable,
  onEdit,
  onDuplicate,
  onToggleActive,
  onDelete,
  canWrite,
  canDelete,
}: LocationColumnsOptions): SmartColumn<Location>[] {
  const warehouseNames = new Map<number, string>(
    warehouses.map((w) => [Number(w.warehouse_id), w.warehouse_name]),
  )
  const byId = new Map<number, Location>(allRows.map((r) => [Number(r.location_id), r]))
  const hierarchy = buildHierarchy(allRows)

  const warehouseOf = (row: Location): string =>
    warehouseNames.get(Number(row.warehouse_id)) ?? `Warehouse #${row.warehouse_id}`

  const parentOf = (row: Location): string => {
    if (!row.parent_location_id) return ''
    const parent = byId.get(Number(row.parent_location_id))
    if (!parent) return `#${row.parent_location_id}`
    return parent.location_name?.trim() ? `${parent.location_code} · ${parent.location_name}` : parent.location_code
  }

  const nodeOf = (row: Location): LocationNode | undefined => hierarchy.get(Number(row.location_id))

  const selectedOnPage = pageRows.filter((r) => selected.has(Number(r.location_id))).length
  const allOnPage = pageRows.length > 0 && selectedOnPage === pageRows.length

  const columns: SmartColumn<Location>[] = []

  if (selectable) {
    columns.push({
      key: SELECT_COLUMN_KEY,
      header: (
        <SelectAllBox
          checked={allOnPage}
          indeterminate={selectedOnPage > 0 && !allOnPage}
          onChange={onToggleAll}
        />
      ),
      width: 36,
      headerClassName: 'w-9',
      cellClassName: 'w-9',
      render: (row) => {
        const id = Number(row.location_id)
        return (
          <input
            type="checkbox"
            className="h-3.5 w-3.5 cursor-pointer accent-[rgb(var(--color-primary))]"
            checked={selected.has(id)}
            onChange={(e) => onToggleRow(id, e.target.checked)}
            onClick={(e) => e.stopPropagation()}
            aria-label={`Select ${row.location_code}`}
          />
        )
      },
    })
  }

  columns.push(
    {
      key: 'location_code',
      header: 'Code',
      sortKey: 'location_code',
      alwaysVisible: true,
      render: (row) => (
        <span className="whitespace-nowrap font-semibold text-primary">{row.location_code}</span>
      ),
      csv: (row) => row.location_code,
    },
    {
      key: 'location_name',
      header: 'Name',
      sortKey: 'location_name',
      width: 170,
      cellClassName: 'max-w-[170px]',
      render: (row) => {
        const path = pathLabel(nodeOf(row))
        return (
          <div className="min-w-0">
            <div className="truncate text-gray-900">{row.location_name?.trim() || '—'}</div>
            {path ? (
              <div className="truncate text-[11px] text-gray-400" title={path}>
                {path}
              </div>
            ) : null}
          </div>
        )
      },
      csv: (row) => row.location_name ?? '',
    },
    {
      key: 'location_type',
      header: 'Type',
      sortKey: 'location_type',
      render: (row) => {
        const meta = locationTypeMeta(row.location_type)
        return (
          <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
            <span
              className="h-2 w-2 shrink-0 rounded-full"
              style={{ background: meta.color }}
              aria-hidden
            />
            {meta.label}
          </span>
        )
      },
      csv: (row) => locationTypeMeta(row.location_type).label,
    },
    {
      key: 'warehouse_id',
      header: 'Warehouse',
      sortKey: 'warehouse_id',
      width: 140,
      cellClassName: 'max-w-[140px]',
      render: (row) => (
        <span className="block truncate" title={warehouseOf(row)}>
          {warehouseOf(row)}
        </span>
      ),
      csv: (row) => warehouseOf(row),
    },
    {
      key: 'parent_location_id',
      header: 'Parent',
      sortKey: 'parent_location_id',
      width: 145,
      cellClassName: 'max-w-[145px]',
      render: (row) => {
        const parent = parentOf(row)
        return parent ? (
          <span className="block truncate text-gray-600" title={parent}>
            {parent}
          </span>
        ) : (
          <span className="whitespace-nowrap text-gray-400">— Top level —</span>
        )
      },
      csv: (row) => parentOf(row) || 'Top level',
    },
    {
      key: 'is_active',
      header: 'Status',
      render: (row) => <ActiveBadge active={row.is_active} />,
      csv: (row) => (isActive(row) ? 'Active' : 'Inactive'),
    },
    {
      key: 'updated_at',
      header: 'Updated',
      sortKey: 'updated_at',
      render: (row) => <span className="whitespace-nowrap text-gray-500">{formatDate(row.updated_at)}</span>,
      csv: (row) => formatDate(row.updated_at),
    },
  )

  columns.push({
    key: ACTIONS_COLUMN_KEY,
    header: <span className="sr-only">Actions</span>,
    align: 'right',
    width: 48,
    render: (row) => {
      const actions: MenuAction[] = [
        {
          key: 'edit',
          label: canWrite ? 'Edit' : 'View',
          icon: Pencil,
          onSelect: () => onEdit(row),
        },
      ]
      if (canWrite) {
        actions.push(
          {
            key: 'toggle',
            label: isActive(row) ? 'Deactivate' : 'Activate',
            icon: isActive(row) ? Square : Play,
            onSelect: () => onToggleActive(row),
          },
          { key: 'duplicate', label: 'Duplicate', icon: Copy, onSelect: () => onDuplicate(row) },
        )
      }
      if (canDelete) {
        actions.push({
          key: 'delete',
          label: 'Delete',
          icon: Trash2,
          danger: true,
          separated: true,
          onSelect: () => onDelete(row),
        })
      }
      return (
        <span onClick={(e) => e.stopPropagation()}>
          <MenuButton
            actions={actions}
            label={`Actions for ${row.location_code}`}
            icon={MoreHorizontal}
            align="end"
            width={180}
          />
        </span>
      )
    },
  })

  return columns
}

/** The columns a sheet writes: everything but the checkbox and the menu. */
export function exportableLocationColumns(
  columns: readonly SmartColumn<Location>[],
): SmartColumn<Location>[] {
  return columns.filter((c) => c.key !== SELECT_COLUMN_KEY && c.key !== ACTIONS_COLUMN_KEY)
}

/* --------------------------------------------------------------- bulk bar -- */

export interface LocationBulkBarProps {
  count: number
  onClear: () => void
  onActivate: () => void
  onDeactivate: () => void
  onDelete: () => void
  canWrite: boolean
  canDelete: boolean
  busy?: boolean
}

export function LocationBulkBar({
  count,
  onClear,
  onActivate,
  onDeactivate,
  onDelete,
  canWrite,
  canDelete,
  busy = false,
}: LocationBulkBarProps) {
  return (
    <div
      className="flex flex-wrap items-center gap-2 rounded-lg border border-primary/25 bg-primary-light/60 px-3 py-1.5"
      role="status"
    >
      <span className="text-[13px] font-semibold text-gray-900">
        {count} selected
      </span>
      <span className="flex-1" />
      {canWrite ? (
        <>
          <button
            type="button"
            onClick={onActivate}
            disabled={busy}
            className="inline-flex h-7 items-center gap-1 rounded-md border border-gray-200 bg-white px-2.5 text-xs font-semibold text-gray-700 transition-colors hover:border-primary/40 hover:text-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 disabled:opacity-60"
          >
            <Play className="h-3 w-3" aria-hidden />
            Activate
          </button>
          <button
            type="button"
            onClick={onDeactivate}
            disabled={busy}
            className="inline-flex h-7 items-center gap-1 rounded-md border border-gray-200 bg-white px-2.5 text-xs font-semibold text-gray-700 transition-colors hover:border-primary/40 hover:text-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 disabled:opacity-60"
          >
            <Square className="h-3 w-3" aria-hidden />
            Deactivate
          </button>
        </>
      ) : null}
      {canDelete ? (
        <button
          type="button"
          onClick={onDelete}
          disabled={busy}
          className="inline-flex h-7 items-center gap-1 rounded-md border border-red-200 bg-white px-2.5 text-xs font-semibold text-red-600 transition-colors hover:bg-red-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-red-300 disabled:opacity-60"
        >
          <Trash2 className="h-3 w-3" aria-hidden />
          Delete
        </button>
      ) : null}
      <button
        type="button"
        onClick={onClear}
        disabled={busy}
        className="inline-flex h-7 items-center rounded-md px-2 text-xs font-semibold text-gray-500 transition-colors hover:bg-white hover:text-gray-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-gray-300 disabled:opacity-60"
      >
        Clear
      </button>
    </div>
  )
}

/**
 * Memoised column list.
 *
 * The table re-renders on every selection tick, and rebuilding the hierarchy
 * index (a walk per row) inside that render is the difference between a
 * checkbox that responds and one that stutters on a 2,000-bin warehouse.
 */
export function useLocationColumns(options: LocationColumnsOptions): SmartColumn<Location>[] {
  const {
    warehouses,
    allRows,
    selected,
    onToggleRow,
    onToggleAll,
    pageRows,
    selectable,
    onEdit,
    onDuplicate,
    onToggleActive,
    onDelete,
    canWrite,
    canDelete,
  } = options
  return useMemo(
    () =>
      buildLocationColumns({
        warehouses,
        allRows,
        selected,
        onToggleRow,
        onToggleAll,
        pageRows,
        selectable,
        onEdit,
        onDuplicate,
        onToggleActive,
        onDelete,
        canWrite,
        canDelete,
      }),
    [
      warehouses,
      allRows,
      selected,
      onToggleRow,
      onToggleAll,
      pageRows,
      selectable,
      onEdit,
      onDuplicate,
      onToggleActive,
      onDelete,
      canWrite,
      canDelete,
    ],
  )
}

/** Row tint for a selected record, matching the register convention. */
export function locationRowClass(row: Location, selected: ReadonlySet<number>): string | undefined {
  return selected.has(Number(row.location_id)) ? 'bg-primary-light/40' : undefined
}
