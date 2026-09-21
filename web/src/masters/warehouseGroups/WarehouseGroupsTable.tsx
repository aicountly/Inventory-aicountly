import { useMemo } from 'react'
import type { ReactNode, RefObject } from 'react'
import { Boxes, MoreHorizontal } from 'lucide-react'
import { ActiveBadge } from '../../ui/StatusBadge'
import { MenuButton } from '../../ui/MenuButton'
import { cx } from '../../ui/cx'
import { SmartTable } from '../../ui/shell/SmartTable'
import type { SmartColumn } from '../../ui/shell/SmartTable'
import { TABLE_ROW_SELECTED } from '../../styles/designTokens'
import type { SortOrder } from '../../services/api'
import type { WarehouseGroup } from '../../services/masters'
import { formatDateTime } from '../../utils/format'
import { actorLabel, warehouseCount } from './model'
import type { SortKey } from './model'
import type { RowAction } from './rowActions'

/**
 * The list view.
 *
 * Header sorting and the Sort by control are the SAME state: clicking a header
 * writes the matching `SortKey`, and choosing from the dropdown moves the
 * header's arrow. Two controls that disagreed about the order of the rows under
 * them would be two controls a reader stops trusting.
 */

/** Which column a SortKey points at, and which way. */
export function sortIndicator(sort: SortKey): { key: string; order: SortOrder } {
  switch (sort) {
    case 'name_desc':
      return { key: 'grp_name', order: 'desc' }
    case 'newest':
      return { key: 'created_at', order: 'desc' }
    case 'oldest':
      return { key: 'created_at', order: 'asc' }
    case 'updated':
      return { key: 'updated_at', order: 'desc' }
    case 'warehouses_desc':
      return { key: 'warehouse_count', order: 'desc' }
    case 'warehouses_asc':
      return { key: 'warehouse_count', order: 'asc' }
    case 'name_asc':
    default:
      return { key: 'grp_name', order: 'asc' }
  }
}

/** The SortKey a header click produces, flipping when the column is already it. */
export function sortKeyForColumn(column: string, current: SortKey): SortKey {
  switch (column) {
    case 'grp_name':
      return current === 'name_asc' ? 'name_desc' : 'name_asc'
    case 'warehouse_count':
      return current === 'warehouses_desc' ? 'warehouses_asc' : 'warehouses_desc'
    case 'created_at':
      return current === 'newest' ? 'oldest' : 'newest'
    case 'updated_at':
      return 'updated'
    default:
      return current
  }
}

export interface WarehouseGroupsTableProps {
  rows: readonly WarehouseGroup[]
  loading: boolean
  error: Error | null
  onRetry: () => void
  empty: ReactNode
  selected: ReadonlySet<number>
  onToggle: (id: number) => void
  onToggleAll: () => void
  onOpen: (row: WarehouseGroup) => void
  onShowWarehouses: (row: WarehouseGroup) => void
  actionsFor: (row: WarehouseGroup) => RowAction[]
  sort: SortKey
  onSortChange: (sort: SortKey) => void
  searchInputRef?: RefObject<HTMLInputElement | null>
  /** Row number of the first row on this page, for the `#` column. */
  offset: number
}

export function WarehouseGroupsTable({
  rows,
  loading,
  error,
  onRetry,
  empty,
  selected,
  onToggle,
  onToggleAll,
  onOpen,
  onShowWarehouses,
  actionsFor,
  sort,
  onSortChange,
  searchInputRef,
  offset,
}: WarehouseGroupsTableProps) {
  const allSelected = rows.length > 0 && rows.every((r) => selected.has(r.warehouse_group_id))
  const someSelected = rows.some((r) => selected.has(r.warehouse_group_id))

  const columns = useMemo<SmartColumn<WarehouseGroup>[]>(
    () => [
      {
        key: 'select',
        width: 44,
        header: (
          <input
            type="checkbox"
            className="h-3.5 w-3.5 cursor-pointer accent-[rgb(var(--color-primary))]"
            checked={allSelected}
            ref={(el) => {
              if (el) el.indeterminate = !allSelected && someSelected
            }}
            onChange={onToggleAll}
            aria-label={allSelected ? 'Clear selection' : 'Select all warehouse groups on this page'}
          />
        ),
        render: (row) => (
          <input
            type="checkbox"
            className="h-3.5 w-3.5 cursor-pointer accent-[rgb(var(--color-primary))]"
            checked={selected.has(row.warehouse_group_id)}
            onChange={() => onToggle(row.warehouse_group_id)}
            onClick={(e) => e.stopPropagation()}
            aria-label={`Select ${row.grp_name}`}
          />
        ),
      },
      {
        key: 'index',
        header: '#',
        width: 48,
        cellClassName: 'text-gray-400 tabular-nums',
        render: (_row, index) => offset + index + 1,
      },
      {
        key: 'grp_name',
        header: 'Group name',
        sortKey: 'grp_name',
        minWidth: 200,
        render: (row) => (
          <span className="flex min-w-0 items-center gap-2.5">
            <span
              className={cx(
                'grid h-8 w-8 shrink-0 place-items-center rounded-lg',
                Number(row.is_active) === 1 ? 'bg-primary-light text-primary' : 'bg-gray-100 text-gray-400',
              )}
              aria-hidden
            >
              <Boxes className="h-4 w-4" />
            </span>
            <span className="min-w-0">
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation()
                  onOpen(row)
                }}
                className="block max-w-full truncate text-left text-sm font-semibold text-gray-900 transition-colors hover:text-primary focus:outline-none focus-visible:text-primary focus-visible:underline"
              >
                {row.grp_name}
              </button>
              {row.parent_grp_id ? (
                <span className="block text-[11px] text-gray-400">Sub-group</span>
              ) : null}
            </span>
          </span>
        ),
      },
      {
        key: 'grp_code',
        header: 'Code',
        width: 96,
        render: (row) =>
          row.grp_code ? (
            <span className="inline-flex items-center rounded-md border border-gray-200 bg-gray-50 px-1.5 py-0.5 font-mono text-[11px] font-semibold tracking-wide text-gray-600">
              {row.grp_code}
            </span>
          ) : null,
      },
      {
        key: 'description',
        header: 'Description',
        minWidth: 180,
        render: (row) =>
          row.description ? (
            <span className="block max-w-[28rem] truncate text-gray-600" title={row.description}>
              {row.description}
            </span>
          ) : null,
      },
      {
        key: 'warehouse_count',
        header: 'Warehouses',
        sortKey: 'warehouse_count',
        align: 'center',
        width: 118,
        render: (row) => {
          const count = warehouseCount(row)
          return (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation()
                onShowWarehouses(row)
              }}
              className={cx(
                'inline-flex h-6 min-w-[1.75rem] items-center justify-center rounded-full border px-2 text-[11px] font-semibold tabular-nums transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/30',
                count > 0
                  ? 'border-sky-200 bg-sky-50 text-sky-700 hover:border-sky-300 hover:bg-sky-100'
                  : 'border-gray-200 bg-gray-50 text-gray-400 hover:border-gray-300',
              )}
              aria-label={`${count} ${count === 1 ? 'warehouse' : 'warehouses'} in ${row.grp_name}`}
            >
              {count}
            </button>
          )
        },
      },
      {
        key: 'is_active',
        header: 'Status',
        width: 104,
        render: (row) => <ActiveBadge active={row.is_active} />,
      },
      {
        key: 'updated_at',
        header: 'Updated on',
        sortKey: 'updated_at',
        width: 170,
        render: (row) => {
          const who = actorLabel(row.updated_by ?? row.created_by, row.updated_by_name ?? row.created_by_name)
          return (
            <span className="block">
              <span className="block whitespace-nowrap text-gray-700">
                {formatDateTime(row.updated_at ?? row.created_at)}
              </span>
              {who ? <span className="block truncate text-[11px] text-gray-400">by {who}</span> : null}
            </span>
          )
        },
      },
      {
        key: 'actions',
        header: <span className="sr-only">Actions</span>,
        align: 'right',
        width: 56,
        render: (row) => {
          const actions = actionsFor(row)
          if (actions.length === 0) return null
          return (
            <span className="inline-flex justify-end" onClick={(e) => e.stopPropagation()}>
              <MenuButton
                label={`Actions for ${row.grp_name}`}
                actions={actions}
                icon={MoreHorizontal}
                variant="ghost"
                size="xs"
                buttonProps={{ className: 'px-1.5' }}
              />
            </span>
          )
        },
      },
    ],
    [allSelected, someSelected, selected, offset, onToggle, onToggleAll, onOpen, onShowWarehouses, actionsFor],
  )

  return (
    <SmartTable<WarehouseGroup>
      columns={columns}
      rows={rows}
      rowKey={(row) => row.warehouse_group_id}
      loading={loading}
      error={error ? { title: "Couldn't load warehouse groups.", description: error.message, onRetry } : null}
      empty={empty}
      density="normal"
      minWidth={940}
      cardPadding="none"
      searchInputRef={searchInputRef}
      keyboardResetKey={`${sort}:${offset}`}
      onRowActivate={onOpen}
      rowClassName={(row) => (selected.has(row.warehouse_group_id) ? TABLE_ROW_SELECTED : undefined)}
      sort={sortIndicator(sort)}
      onSort={(key) => onSortChange(sortKeyForColumn(key, sort))}
      caption="Warehouse groups in the selected company"
    />
  )
}

export default WarehouseGroupsTable
