import { useMemo } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Copy, Ellipsis, Package, Pencil, Power, PowerOff, Trash2 } from 'lucide-react'
import type { ReactNode, RefObject } from 'react'
import { Badge } from '../../../ui/Badge'
import { Button } from '../../../ui/Button'
import { IconTile } from '../../../ui/IconTile'
import { MenuButton } from '../../../ui/MenuButton'
import type { MenuAction } from '../../../ui/MenuButton'
import { Tooltip } from '../../../ui/Tooltip'
import { SmartTable } from '../../../ui/shell/SmartTable'
import type { SmartColumn, SmartTableError } from '../../../ui/shell/SmartTable'
import { cx } from '../../../ui/cx'
import type { SortOrder } from '../../../services/api'
import type { StockCategory } from '../../../services/masters'
import { formatDateTime, formatInt } from '../../../utils/format'
import { categoryAppearance } from './categoryAppearance'

/**
 * The category list itself.
 *
 * `SmartTable` does the table — sticky header, sortable headers wired to the
 * server, keyboard row activation, and the loading / error / empty bodies — so
 * this file only describes the eight columns and what a row can do. Two of
 * them are not data and say so: the select box and the actions carry
 * `alwaysVisible` semantics by simply not being sortable, and neither reaches
 * the export, which is built from its own column list.
 *
 * Status is never colour alone: the pill carries the word Active or Inactive
 * beside the dot, so a row reads the same to a reader who cannot separate the
 * green from the grey.
 */

export interface StockCategoryTableProps {
  rows: readonly StockCategory[]
  loading: boolean
  error: SmartTableError
  /** 0-based offset of the first row, so `#` numbers the result, not the page. */
  offset: number
  sort: { key: string; order: SortOrder }
  onSort: (key: string) => void

  selectedIds: ReadonlySet<number>
  onToggleRow: (id: number, selected: boolean) => void
  onToggleAll: (selected: boolean) => void

  canWrite: boolean
  canDelete: boolean
  /** Undefined when the profile may not read items — the count stays plain text. */
  itemsLinkFor?: (stockCatId: number) => string | undefined

  onEdit: (row: StockCategory) => void
  onDuplicate: (row: StockCategory) => void
  onToggleStatus: (row: StockCategory) => void
  onDelete: (row: StockCategory) => void

  empty?: ReactNode
  searchInputRef?: RefObject<HTMLInputElement | null>
  /** Changes when the page, filters or sort change — resets keyboard focus. */
  keyboardResetKey?: string | number
}

function CategoryCell({ row }: { row: StockCategory }) {
  const { icon, tone } = categoryAppearance(row)
  return (
    <div className="flex min-w-0 items-center gap-2.5">
      <IconTile icon={icon} tone={tone} size="sm" />
      <span className="min-w-0">
        <span className="block truncate font-semibold text-gray-900">{row.cat_name}</span>
      </span>
    </div>
  )
}

export function StockCategoryTable({
  rows,
  loading,
  error,
  offset,
  sort,
  onSort,
  selectedIds,
  onToggleRow,
  onToggleAll,
  canWrite,
  canDelete,
  itemsLinkFor,
  onEdit,
  onDuplicate,
  onToggleStatus,
  onDelete,
  empty,
  searchInputRef,
  keyboardResetKey,
}: StockCategoryTableProps) {
  const navigate = useNavigate()
  const pageIds = useMemo(() => rows.map((r) => Number(r.stock_cat_id)), [rows])
  const selectedOnPage = pageIds.filter((id) => selectedIds.has(id)).length
  const allSelected = pageIds.length > 0 && selectedOnPage === pageIds.length
  const someSelected = selectedOnPage > 0 && !allSelected

  const columns = useMemo<SmartColumn<StockCategory>[]>(
    () => [
      {
        key: '__select',
        width: 44,
        headerClassName: 'w-11',
        cellClassName: 'w-11',
        header: (
          <input
            type="checkbox"
            className="h-3.5 w-3.5 cursor-pointer accent-[rgb(var(--color-primary))]"
            checked={allSelected}
            ref={(el) => {
              if (el) el.indeterminate = someSelected
            }}
            onChange={(e) => onToggleAll(e.target.checked)}
            aria-label={allSelected ? 'Clear selection' : 'Select all categories on this page'}
            disabled={pageIds.length === 0}
          />
        ),
        render: (row) => {
          const id = Number(row.stock_cat_id)
          return (
            <input
              type="checkbox"
              className="h-3.5 w-3.5 cursor-pointer accent-[rgb(var(--color-primary))]"
              checked={selectedIds.has(id)}
              onChange={(e) => onToggleRow(id, e.target.checked)}
              onClick={(e) => e.stopPropagation()}
              aria-label={`Select ${row.cat_name}`}
            />
          )
        },
      },
      {
        key: '__index',
        header: '#',
        width: 48,
        cellClassName: 'tabular-nums text-gray-400',
        render: (_row, index) => offset + index + 1,
      },
      {
        key: 'cat_name',
        header: 'Category',
        sortKey: 'cat_name',
        minWidth: 200,
        render: (row) => <CategoryCell row={row} />,
      },
      {
        key: 'cat_alias',
        header: 'Alias',
        sortKey: 'cat_alias',
        width: 120,
        render: (row) =>
          row.cat_alias ? (
            <span className="font-mono text-xs text-gray-600">{row.cat_alias}</span>
          ) : (
            <span className="text-gray-300">—</span>
          ),
      },
      {
        key: 'is_active',
        header: 'Status',
        width: 130,
        render: (row) =>
          Number(row.is_active) === 1 ? (
            <Badge tone="success" dot className="normal-case">
              Active
            </Badge>
          ) : (
            <Badge tone="neutral" dot className="normal-case">
              Inactive
            </Badge>
          ),
      },
      {
        key: 'item_count',
        header: 'Items',
        sortKey: 'item_count',
        align: 'right',
        width: 110,
        render: (row) => {
          if (typeof row.item_count !== 'number') return <span className="text-gray-300">—</span>
          const to = itemsLinkFor?.(Number(row.stock_cat_id))
          const label = formatInt(row.item_count)
          if (!to || row.item_count === 0) return <span className="tabular-nums">{label}</span>
          return (
            <Link
              to={to}
              onClick={(e) => e.stopPropagation()}
              className="rounded font-semibold tabular-nums text-gray-900 no-underline transition-colors hover:text-primary hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
              aria-label={`Show the ${label} items in ${row.cat_name}`}
            >
              {label}
            </Link>
          )
        },
      },
      {
        key: 'updated_at',
        header: 'Updated',
        sortKey: 'updated_at',
        width: 180,
        cellClassName: 'whitespace-nowrap text-gray-500',
        render: (row) => formatDateTime(row.updated_at),
      },
      {
        key: '__actions',
        header: 'Actions',
        align: 'right',
        width: 120,
        render: (row) => {
          const id = Number(row.stock_cat_id)
          const isActive = Number(row.is_active) === 1
          const itemsTo = itemsLinkFor?.(id)
          const menu: MenuAction[] = [
            { key: 'edit', label: canWrite ? 'Edit' : 'View', icon: Pencil, onSelect: () => onEdit(row) },
            ...(canWrite
              ? [{ key: 'duplicate', label: 'Duplicate', icon: Copy, onSelect: () => onDuplicate(row) } satisfies MenuAction]
              : []),
            ...(canWrite
              ? [
                  {
                    key: 'status',
                    label: isActive ? 'Deactivate' : 'Activate',
                    icon: isActive ? PowerOff : Power,
                    onSelect: () => onToggleStatus(row),
                  } satisfies MenuAction,
                ]
              : []),
            ...(itemsTo
              ? [{ key: 'items', label: 'View linked items', icon: Package, onSelect: () => navigate(itemsTo) } satisfies MenuAction]
              : []),
            ...(canDelete
              ? [{ key: 'delete', label: 'Delete', icon: Trash2, danger: true, separated: true, onSelect: () => onDelete(row) } satisfies MenuAction]
              : []),
          ]

          return (
            <div className="flex items-center justify-end gap-0.5" onClick={(e) => e.stopPropagation()}>
              <Tooltip label={canWrite ? `Edit ${row.cat_name}` : `View ${row.cat_name}`}>
                <Button
                  variant="ghost"
                  size="xs"
                  icon={Pencil}
                  onClick={() => onEdit(row)}
                  aria-label={canWrite ? `Edit ${row.cat_name}` : `View ${row.cat_name}`}
                />
              </Tooltip>
              {canWrite ? (
                <Tooltip label={`Duplicate ${row.cat_name}`}>
                  <Button
                    variant="ghost"
                    size="xs"
                    icon={Copy}
                    onClick={() => onDuplicate(row)}
                    aria-label={`Duplicate ${row.cat_name}`}
                  />
                </Tooltip>
              ) : null}
              <MenuButton
                actions={menu}
                label={`More actions for ${row.cat_name}`}
                icon={Ellipsis}
                variant="ghost"
                size="xs"
                align="end"
              />
            </div>
          )
        },
      },
    ],
    [allSelected, someSelected, pageIds.length, selectedIds, offset, canWrite, canDelete, itemsLinkFor, navigate, onToggleAll, onToggleRow, onEdit, onDuplicate, onToggleStatus, onDelete],
  )

  return (
    <SmartTable<StockCategory>
      columns={columns}
      rows={rows}
      rowKey={(row) => Number(row.stock_cat_id)}
      loading={loading}
      error={error}
      empty={empty}
      caption="Stock categories"
      minWidth={900}
      density="normal"
      onRowActivate={onEdit}
      searchInputRef={searchInputRef}
      keyboardResetKey={keyboardResetKey}
      sort={sort}
      onSort={onSort}
      rowClassName={(row) => cx(selectedIds.has(Number(row.stock_cat_id)) && 'bg-primary-light/40')}
    />
  )
}

export default StockCategoryTable
