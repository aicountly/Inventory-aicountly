import { useMemo } from 'react'
import type { ReactNode, RefObject } from 'react'
import { Link } from 'react-router-dom'
import {
  CircleCheck,
  CircleMinus,
  Copy,
  ExternalLink,
  History,
  MoreVertical,
  Package,
  Pencil,
  Trash2,
} from 'lucide-react'
import { MenuButton } from '../../../ui/MenuButton'
import type { MenuAction } from '../../../ui/MenuButton'
import { SmartTable } from '../../../ui/shell/SmartTable'
import type { SmartColumn } from '../../../ui/shell/SmartTable'
import { StatusBadge } from '../../../ui/StatusBadge'
import { cx } from '../../../ui/cx'
import { formatDate, formatDateTime, formatInt, formatMoney } from '../../../utils/format'
import { actorIdentity } from '../../audit/auditPresentation'
import type { Brand } from '../../../services/masters'
import type { BrandSalesRow } from '../../../services/brandAnalyticsApi'
import { BrandAvatar } from './BrandAvatar'

/**
 * The brand grid.
 *
 * Built on the same SmartTable every register and list in Inventory renders, so
 * sorting, keyboard row navigation, the sticky header, the skeleton and the
 * error state all behave exactly as they do everywhere else. What is added here
 * is what a brand needs and no other master does: a selection column, an
 * avatar, a live revenue column that is only drawn when there is a live service
 * behind it, and a row menu that hides what this profile may not do.
 */

// ---------------------------------------------------------------------------
// Column catalogue — what the column chooser offers
// ---------------------------------------------------------------------------

export interface BrandColumnSpec {
  key: string
  label: string
  /** Not offered in the chooser: the row would stop making sense without it. */
  fixed?: boolean
  defaultVisible: boolean
}

export const BRAND_COLUMNS: readonly BrandColumnSpec[] = [
  { key: 'select', label: 'Selection', fixed: true, defaultVisible: true },
  { key: 'brand', label: 'Brand', fixed: true, defaultVisible: true },
  { key: 'alias', label: 'Alias', defaultVisible: true },
  { key: 'code', label: 'Brand code', defaultVisible: false },
  { key: 'items', label: 'Items', defaultVisible: true },
  { key: 'sales', label: 'Sales (FY)', defaultVisible: true },
  { key: 'status', label: 'Status', defaultVisible: true },
  { key: 'created', label: 'Created', defaultVisible: true },
  { key: 'updated', label: 'Updated', defaultVisible: false },
  { key: 'actions', label: 'Actions', fixed: true, defaultVisible: true },
]

export const DEFAULT_BRAND_COLUMN_KEYS: string[] = BRAND_COLUMNS.filter((c) => c.defaultVisible).map((c) => c.key)

/** Columns a reader may turn off. */
export const CONFIGURABLE_BRAND_COLUMNS = BRAND_COLUMNS.filter((c) => !c.fixed)

// ---------------------------------------------------------------------------
// Sparkline
// ---------------------------------------------------------------------------

/**
 * A trend, drawn only from points that were sent.
 *
 * Two points minimum, and no interpolation, no padding, no zero-filling: the
 * shape has to be the series Books reported or it is decoration pretending to
 * be data. A brand with no trend simply has no sparkline.
 */
function Sparkline({ points, rising }: { points: readonly number[]; rising: boolean }) {
  const path = useMemo(() => {
    const min = Math.min(...points)
    const max = Math.max(...points)
    const span = max - min || 1
    const stepX = 38 / Math.max(1, points.length - 1)
    return points
      .map((p, i) => `${i === 0 ? 'M' : 'L'}${(i * stepX).toFixed(1)},${(14 - ((p - min) / span) * 12).toFixed(1)}`)
      .join(' ')
  }, [points])

  return (
    <svg width="38" height="16" viewBox="0 0 38 16" aria-hidden className="shrink-0 overflow-visible">
      <path
        d={path}
        fill="none"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        className={rising ? 'stroke-emerald-500' : 'stroke-red-500'}
      />
    </svg>
  )
}

// ---------------------------------------------------------------------------
// Table
// ---------------------------------------------------------------------------

export interface BrandsTableProps {
  rows: readonly Brand[]
  loading: boolean
  error: { title: string; description?: string; onRetry?: () => void } | null
  empty: ReactNode
  visibleColumns: readonly string[]
  /** Live revenue by brand id. Empty when Sales is not connected. */
  salesByBrand: Map<number, BrandSalesRow>
  showSales: boolean
  salesCurrencySymbol: string
  selectedIds: ReadonlySet<number>
  onToggleRow: (id: number, selected: boolean) => void
  onToggleAll: (selected: boolean) => void
  canWrite: boolean
  canDelete: boolean
  canAudit: boolean
  onOpen: (brand: Brand) => void
  onEdit: (brand: Brand) => void
  onDuplicate: (brand: Brand) => void
  onToggleActive: (brand: Brand) => void
  onAudit: (brand: Brand) => void
  onViewItems: (brand: Brand) => void
  onDelete: (brand: Brand) => void
  sort: { key: string; order: 'asc' | 'desc' }
  onSort: (key: string) => void
  keyboardResetKey?: string | number
  searchInputRef?: RefObject<HTMLInputElement | null>
}

export function BrandsTable({
  rows,
  loading,
  error,
  empty,
  visibleColumns,
  salesByBrand,
  showSales,
  salesCurrencySymbol,
  selectedIds,
  onToggleRow,
  onToggleAll,
  canWrite,
  canDelete,
  canAudit,
  onOpen,
  onEdit,
  onDuplicate,
  onToggleActive,
  onAudit,
  onViewItems,
  onDelete,
  sort,
  onSort,
  keyboardResetKey,
  searchInputRef,
}: BrandsTableProps) {
  const allSelected = rows.length > 0 && rows.every((r) => selectedIds.has(r.brand_id))
  const someSelected = rows.some((r) => selectedIds.has(r.brand_id)) && !allSelected

  const columns = useMemo<SmartColumn<Brand>[]>(() => {
    const shown = (key: string) => visibleColumns.includes(key)
    const all: (SmartColumn<Brand> | null)[] = [
      {
        key: 'select',
        width: 40,
        headerClassName: 'w-10',
        header: (
          <>
            <input
              type="checkbox"
              checked={allSelected}
              ref={(el) => {
                // The third state: some but not all. Without it the header box
                // reads "nothing selected" while four rows are ticked.
                if (el) el.indeterminate = someSelected
              }}
              onChange={(e) => onToggleAll(e.target.checked)}
              aria-label={allSelected ? 'Clear selection' : 'Select all brands on this page'}
              className="h-3.5 w-3.5 cursor-pointer accent-[rgb(var(--color-primary))]"
            />
            <span className="sr-only">Select</span>
          </>
        ),
        render: (row) => (
          <input
            type="checkbox"
            checked={selectedIds.has(row.brand_id)}
            onChange={(e) => onToggleRow(row.brand_id, e.target.checked)}
            // The row is itself activatable; without this a tick would also
            // open the drawer over the list the reader is still picking from.
            onClick={(e) => e.stopPropagation()}
            aria-label={`Select ${row.brand_name}`}
            className="h-3.5 w-3.5 cursor-pointer accent-[rgb(var(--color-primary))]"
          />
        ),
      },
      {
        key: 'brand',
        header: 'Brand',
        sortKey: 'brand_name',
        minWidth: 200,
        render: (row) => (
          <div className="flex items-center gap-2.5">
            <BrandAvatar name={row.brand_name} />
            <span className="min-w-0">
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation()
                  onOpen(row)
                }}
                className="block max-w-full truncate text-left font-semibold text-gray-900 transition-colors hover:text-primary focus:outline-none focus-visible:text-primary focus-visible:underline"
              >
                {row.brand_name}
              </button>
              {/* The code rides under the name only while it has no column of
                  its own — the same value twice in one row is noise. */}
              {!shown('code') && row.brand_code ? (
                <span className="block truncate font-mono text-[10px] uppercase text-gray-400">
                  {row.brand_code}
                </span>
              ) : null}
            </span>
          </div>
        ),
      },
      shown('alias')
        ? {
            key: 'alias',
            header: 'Alias',
            sortKey: 'brand_alias',
            render: (row) =>
              row.brand_alias ? (
                <span className="uppercase tracking-wide text-gray-600">{row.brand_alias}</span>
              ) : null,
          }
        : null,
      shown('code')
        ? {
            key: 'code',
            header: 'Code',
            sortKey: 'brand_code',
            render: (row) =>
              row.brand_code ? <span className="font-mono text-xs uppercase">{row.brand_code}</span> : null,
          }
        : null,
      shown('items')
        ? {
            key: 'items',
            header: 'Items',
            align: 'right',
            sortKey: 'item_count',
            width: 90,
            render: (row) => {
              const count = row.item_count ?? 0
              if (count === 0) {
                return <span className="text-gray-400">0</span>
              }
              return (
                <Link
                  to={`/items?brand_id=${row.brand_id}`}
                  onClick={(e) => e.stopPropagation()}
                  className="font-semibold text-primary no-underline hover:underline"
                  aria-label={`View the ${count} ${count === 1 ? 'item' : 'items'} filed under ${row.brand_name}`}
                >
                  {formatInt(count)}
                </Link>
              )
            },
          }
        : null,
      showSales && shown('sales')
        ? {
            key: 'sales',
            header: 'Sales (FY)',
            align: 'right',
            minWidth: 140,
            render: (row) => {
              const sale = salesByBrand.get(row.brand_id)
              if (!sale) {
                return <span className="text-gray-300" title="Not reported by Sales for this period">—</span>
              }
              const trend = sale.trend
              const rising = !trend || trend.length < 2 || trend[trend.length - 1] >= trend[0]
              return (
                <span className="inline-flex items-center justify-end gap-2 whitespace-nowrap">
                  <strong className="font-semibold tabular-nums text-gray-900">
                    {salesCurrencySymbol} {formatMoney(sale.sales)}
                  </strong>
                  {trend && trend.length >= 2 ? <Sparkline points={trend} rising={rising} /> : null}
                </span>
              )
            },
          }
        : null,
      shown('status')
        ? {
            key: 'status',
            header: 'Status',
            width: 110,
            render: (row) => (
              <StatusBadge value={Number(row.is_active) === 1 ? 'active' : 'inactive'} dot />
            ),
          }
        : null,
      shown('created')
        ? {
            key: 'created',
            header: 'Created',
            sortKey: 'created_at',
            minWidth: 130,
            render: (row) => {
              const actor = actorIdentity({ actor_uuid: row.created_by ?? null })
              return (
                <span className="flex flex-col gap-0.5">
                  <span className="text-xs font-medium text-gray-700" title={formatDateTime(row.created_at)}>
                    {formatDate(row.created_at)}
                  </span>
                  <span className="text-[10px] text-gray-400" title={actor.title}>
                    by {actor.label}
                  </span>
                </span>
              )
            },
          }
        : null,
      shown('updated')
        ? {
            key: 'updated',
            header: 'Updated',
            sortKey: 'updated_at',
            minWidth: 130,
            render: (row) => {
              const actor = actorIdentity({ actor_uuid: row.updated_by ?? null })
              return (
                <span className="flex flex-col gap-0.5">
                  <span className="text-xs font-medium text-gray-700" title={formatDateTime(row.updated_at)}>
                    {formatDate(row.updated_at)}
                  </span>
                  <span className="text-[10px] text-gray-400" title={actor.title}>
                    by {actor.label}
                  </span>
                </span>
              )
            },
          }
        : null,
      {
        key: 'actions',
        header: <span className="sr-only">Actions</span>,
        align: 'right',
        width: 56,
        render: (row) => {
          const active = Number(row.is_active) === 1
          const actions: MenuAction[] = [
            { key: 'view', label: 'View details', icon: ExternalLink, onSelect: () => onOpen(row) },
          ]
          if (canWrite) {
            actions.push({ key: 'edit', label: 'Edit brand', icon: Pencil, onSelect: () => onEdit(row) })
            actions.push({ key: 'duplicate', label: 'Duplicate', icon: Copy, onSelect: () => onDuplicate(row) })
            actions.push({
              key: 'toggle',
              label: active ? 'Deactivate' : 'Activate',
              icon: active ? CircleMinus : CircleCheck,
              onSelect: () => onToggleActive(row),
            })
          }
          actions.push({
            key: 'items',
            label: 'View items',
            icon: Package,
            separated: true,
            disabled: (row.item_count ?? 0) === 0,
            onSelect: () => onViewItems(row),
          })
          if (canAudit) {
            actions.push({ key: 'audit', label: 'Audit trail', icon: History, onSelect: () => onAudit(row) })
          }
          if (canDelete) {
            actions.push({
              key: 'delete',
              label: 'Delete brand',
              icon: Trash2,
              separated: true,
              danger: true,
              onSelect: () => onDelete(row),
            })
          }
          return (
            <span onClick={(e) => e.stopPropagation()} role="presentation">
              <MenuButton
                actions={actions}
                icon={MoreVertical}
                label={`More actions for ${row.brand_name}`}
                width={208}
              />
            </span>
          )
        },
      },
    ]
    return all.filter((c): c is SmartColumn<Brand> => c !== null)
  }, [
    visibleColumns,
    allSelected,
    someSelected,
    selectedIds,
    onToggleAll,
    onToggleRow,
    onOpen,
    onEdit,
    onDuplicate,
    onToggleActive,
    onAudit,
    onViewItems,
    onDelete,
    canWrite,
    canDelete,
    canAudit,
    salesByBrand,
    showSales,
    salesCurrencySymbol,
  ])

  return (
    <SmartTable<Brand>
      columns={columns}
      rows={rows}
      rowKey={(row) => row.brand_id}
      caption="Brands in this company"
      loading={loading}
      error={error}
      empty={empty}
      density="normal"
      stickyHeader
      minWidth={880}
      sort={sort}
      onSort={onSort}
      onRowActivate={onOpen}
      keyboardResetKey={keyboardResetKey}
      searchInputRef={searchInputRef}
      rowClassName={(row) =>
        cx(
          selectedIds.has(row.brand_id) && 'bg-primary-light/40',
          Number(row.is_active) !== 1 && 'text-gray-500',
        )
      }
    />
  )
}

export default BrandsTable
