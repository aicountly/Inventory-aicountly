import type { ReactNode } from 'react'
import {
  Copy,
  Eye,
  GitCompare,
  IndianRupee,
  MoreVertical,
  Package,
  PauseCircle,
  Pencil,
  PlayCircle,
  Printer,
  Trash2,
} from 'lucide-react'
import type { Bom } from '../../../services/masters'
import { Button } from '../../../ui/Button'
import { MenuButton } from '../../../ui/MenuButton'
import type { MenuAction } from '../../../ui/MenuButton'
import { SmartTable } from '../../../ui/shell/SmartTable'
import type { SmartColumn } from '../../../ui/shell/SmartTable'
import { Tooltip } from '../../../ui/Tooltip'
import { cx } from '../../../ui/cx'
import type { SortOrder } from '../../../services/api'
import { formatDate } from '../../../utils/format'
import { BomComponentsPreview } from './BomComponentsPreview'
import { BomHealthChip, BomStatusBadge } from './BomStatusBadge'
import { bomCode, bomHealth, bomStatus, yieldLabel } from './bomPresentation'

/**
 * The bill-of-materials list.
 *
 * Built on the shared SmartTable so it inherits sortable headers with
 * `aria-sort`, keyboard row navigation, the skeleton loading body and the error
 * and empty states every other list in Inventory uses. What is BOM-specific is
 * the cells: a code badge, the finished item with its SKU, component chips, and
 * a row of actions gated on what the profile may do.
 *
 * The table stays deliberately narrow — code, name, finished item, components,
 * yield, status, updated, actions. Cost, wastage, effective dates and version
 * history live in the detail drawer: a reader scanning forty bills is looking
 * for one of them, not reading all forty.
 */

export interface BomRowActions {
  onView: (row: Bom) => void
  onEdit: (row: Bom) => void
  onDuplicate: (row: Bom) => void
  onCompare: (row: Bom) => void
  onCost: (row: Bom) => void
  onToggleActive: (row: Bom) => void
  /** Opens the detail drawer, where the sheet actions for one bill live. */
  onSheet: (row: Bom) => void
  onDelete: (row: Bom) => void
}

export interface BomTableProps extends BomRowActions {
  rows: Bom[]
  loading: boolean
  error: Error | null
  onRetry: () => void
  empty: ReactNode
  sort: { key: string; order: SortOrder }
  onSort: (key: string) => void
  selected: Set<number>
  onToggleRow: (id: number, checked: boolean) => void
  onToggleAll: (checked: boolean) => void
  canWrite: boolean
  canDelete: boolean
  canViewCost: boolean
  /** Reset key for keyboard navigation — page, filters, sort. */
  resetKey: string
}

function FinishedItemCell({ row }: { row: Bom }) {
  const inactive = Number(row.finished_item_is_active) === 0
  return (
    <div className="flex min-w-0 items-center gap-2">
      <span
        className={cx(
          'grid h-8 w-8 shrink-0 place-items-center rounded-lg border',
          inactive ? 'border-amber-200 bg-amber-50 text-amber-600' : 'border-gray-200 bg-gray-50 text-gray-400',
        )}
        aria-hidden
      >
        <Package className="h-4 w-4" />
      </span>
      <span className="min-w-0">
        <span className="block truncate text-[12px] font-semibold text-gray-900">
          {row.finished_item_name ?? `#${row.finished_item_id}`}
        </span>
        <span className="block truncate text-[10.5px] text-gray-400">
          {row.finished_item_sku ?? `Item #${row.finished_item_id}`}
        </span>
      </span>
    </div>
  )
}

function UpdatedCell({ row }: { row: Bom }) {
  const who = row.updated_by_name ?? row.created_by_name
  return (
    <div className="min-w-0">
      <span className="block whitespace-nowrap text-[11.5px] font-medium text-gray-700">
        {formatDate(row.updated_at ?? row.created_at)}
      </span>
      <span className="block truncate text-[10px] text-gray-400">{who ? `by ${who}` : 'by the system'}</span>
    </div>
  )
}

export function BomTable({
  rows,
  loading,
  error,
  onRetry,
  empty,
  sort,
  onSort,
  selected,
  onToggleRow,
  onToggleAll,
  canWrite,
  canDelete,
  canViewCost,
  resetKey,
  onView,
  onEdit,
  onDuplicate,
  onCompare,
  onCost,
  onToggleActive,
  onSheet,
  onDelete,
}: BomTableProps) {
  const allSelected = rows.length > 0 && rows.every((r) => selected.has(r.bom_id))
  const someSelected = rows.some((r) => selected.has(r.bom_id))

  const menuFor = (row: Bom): MenuAction[] => {
    const active = bomStatus(row) === 'active'
    const actions: MenuAction[] = [
      { key: 'view', label: 'View details', icon: Eye, onSelect: () => onView(row) },
    ]
    if (canWrite) {
      actions.push({ key: 'duplicate', label: 'Duplicate', icon: Copy, onSelect: () => onDuplicate(row) })
    }
    actions.push({ key: 'compare', label: 'Compare with…', icon: GitCompare, onSelect: () => onCompare(row) })
    if (canViewCost) {
      actions.push({ key: 'cost', label: 'Cost breakdown', icon: IndianRupee, onSelect: () => onCost(row) })
    }
    /*
     * One entry, not a Print and an Export that both land in the same place.
     * The four outputs — CSV, Excel, PDF and the letterheaded print sheet —
     * live together in the detail drawer, over that bill's own lines.
     */
    actions.push({
      key: 'sheet',
      label: 'Print or export…',
      icon: Printer,
      onSelect: () => onSheet(row),
      separated: true,
    })
    if (canWrite) {
      actions.push({
        key: 'toggle',
        label: active ? 'Deactivate' : 'Activate',
        icon: active ? PauseCircle : PlayCircle,
        onSelect: () => onToggleActive(row),
        separated: true,
      })
    }
    if (canDelete) {
      actions.push({ key: 'delete', label: 'Delete', icon: Trash2, danger: true, onSelect: () => onDelete(row) })
    }
    return actions
  }

  const columns: SmartColumn<Bom>[] = [
    {
      key: '__select',
      width: 42,
      headerClassName: 'print:hidden',
      cellClassName: 'print:hidden',
      header: (
        <input
          type="checkbox"
          className="h-3.5 w-3.5 accent-[rgb(var(--color-primary))]"
          aria-label={allSelected ? 'Clear selection' : 'Select every bill on this page'}
          checked={allSelected}
          ref={(el) => {
            if (el) el.indeterminate = !allSelected && someSelected
          }}
          onChange={(e) => onToggleAll(e.target.checked)}
        />
      ),
      render: (row) => (
        <input
          type="checkbox"
          className="h-3.5 w-3.5 accent-[rgb(var(--color-primary))]"
          aria-label={`Select ${row.bom_name}`}
          checked={selected.has(row.bom_id)}
          onClick={(e) => e.stopPropagation()}
          onChange={(e) => onToggleRow(row.bom_id, e.target.checked)}
        />
      ),
    },
    {
      key: 'bom_code',
      header: 'BOM code',
      sortKey: 'bom_code',
      width: 108,
      render: (row) => (
        <span className="inline-flex items-center rounded-md bg-slate-100 px-1.5 py-1 text-[10.5px] font-semibold text-slate-700">
          {bomCode(row)}
        </span>
      ),
    },
    {
      key: 'bom_name',
      header: 'BOM name',
      sortKey: 'bom_name',
      minWidth: 180,
      render: (row) => (
        <span className="block min-w-0">
          <span className="block truncate text-[12.5px] font-semibold text-gray-900">{row.bom_name}</span>
          {row.finished_item_group_name ? (
            <span className="block truncate text-[10px] text-gray-400">{row.finished_item_group_name}</span>
          ) : null}
        </span>
      ),
    },
    {
      key: 'finished_item_name',
      header: 'Finished item',
      sortKey: 'finished_item_name',
      width: 210,
      render: (row) => <FinishedItemCell row={row} />,
    },
    {
      key: 'components',
      header: 'Components',
      sortKey: 'component_count',
      width: 230,
      render: (row) => <BomComponentsPreview row={row} />,
    },
    {
      key: 'yield_qty',
      header: 'Yield',
      sortKey: 'yield_qty',
      align: 'right',
      width: 92,
      render: (row) => <span className="whitespace-nowrap tabular-nums">{yieldLabel(row)}</span>,
    },
    {
      key: 'is_active',
      header: 'Status',
      sortKey: 'is_active',
      width: 132,
      render: (row) => (
        <div className="flex flex-wrap items-center gap-1">
          <BomStatusBadge status={bomStatus(row)} />
          <BomHealthChip health={bomHealth(row)} />
        </div>
      ),
    },
    {
      key: 'updated_at',
      header: 'Updated',
      sortKey: 'updated_at',
      width: 150,
      render: (row) => <UpdatedCell row={row} />,
    },
    {
      key: '__actions',
      header: '',
      align: 'right',
      width: 108,
      headerClassName: 'print:hidden',
      cellClassName: 'print:hidden',
      render: (row) => (
        <div
          className="flex items-center justify-end gap-0.5"
          onClick={(e) => e.stopPropagation()}
          role="presentation"
        >
          <Tooltip label="View bill of materials">
            <Button variant="ghost" size="xs" icon={Eye} aria-label={`View ${row.bom_name}`} onClick={() => onView(row)} />
          </Tooltip>
          <Tooltip label={canWrite ? 'Edit bill of materials' : 'Open bill of materials'}>
            <Button
              variant="ghost"
              size="xs"
              icon={Pencil}
              aria-label={`${canWrite ? 'Edit' : 'Open'} ${row.bom_name}`}
              onClick={() => onEdit(row)}
            />
          </Tooltip>
          <MenuButton
            label={`More actions for ${row.bom_name}`}
            icon={MoreVertical}
            actions={menuFor(row)}
            width={210}
          />
        </div>
      ),
    },
  ]

  return (
    <SmartTable<Bom>
      columns={columns}
      rows={rows}
      rowKey={(row) => row.bom_id}
      loading={loading}
      error={error ? { title: 'Could not load bills of materials', description: error.message, onRetry } : null}
      empty={empty}
      sort={sort}
      onSort={onSort}
      onRowActivate={onView}
      activateOnSingleClick
      keyboardResetKey={resetKey}
      caption="Bills of materials"
      density="normal"
      minWidth={1080}
      cardPadding="none"
    />
  )
}

export default BomTable
