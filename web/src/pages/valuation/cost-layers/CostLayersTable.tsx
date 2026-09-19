import { useMemo } from 'react'
import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import {
  Boxes,
  FileClock,
  FilePenLine,
  GitCompareArrows,
  PackageOpen,
  ReceiptText,
  ScrollText,
} from 'lucide-react'
import { MenuButton } from '../../../ui/MenuButton'
import type { MenuAction } from '../../../ui/MenuButton'
import { SmartTable } from '../../../ui/shell/SmartTable'
import type { SmartColumn } from '../../../ui/shell/SmartTable'
import { EmptyState } from '../../../ui/EmptyState'
import { Tooltip } from '../../../ui/Tooltip'
import { cx } from '../../../ui/cx'
import type { SortOrder } from '../../../services/api'
import type { CostLayerRow } from '../../../services/valuationApi'
import { formatDate, formatMoney, formatQty, humanize } from '../../../utils/format'
import { CostLayerStatusBadge } from './CostLayerStatusBadge'
import { consumedQty, layerStatus } from '../costLayerModel'

export interface CostLayerTableCallbacks {
  onOpenLayer: (row: CostLayerRow) => void
  onCompareCost: () => void
  onCreateRevision: (row: CostLayerRow) => void
  /** Null when the reader may not queue a recalculation. */
  onRecalculate: ((row: CostLayerRow) => void) | null
  /**
   * Router navigation, handed down rather than reached for.
   *
   * A menu item that set `window.location` would reload the whole app — losing
   * the company scope, the access profile and the form options the shell has
   * already fetched — to reach a route react-router can render in place.
   */
  onNavigate: (to: string) => void
}

export interface CostLayerColumnDeps extends CostLayerTableCallbacks {
  itemLabel: string
  itemSku: string | null
  batchName: (batchId: number | null) => string | null
  selected: ReadonlySet<number>
  onToggle: (layerId: number) => void
  onToggleAll: () => void
  allSelected: boolean
  someSelected: boolean
  pageRowCount: number
}

/**
 * The grid's columns.
 *
 * Every quantity and money column is right-aligned and tabular: a reader adds
 * these up down the column, and proportional digits make two figures of the
 * same magnitude look different lengths. The two that carry the answer —
 * balance and layer value — are the ones set in the darker weight, because a
 * table where everything is emphasised has emphasised nothing.
 *
 * `item` ships hidden. `item_id` is required by the endpoint, so every row on
 * this screen is the same item and the column would repeat one name down the
 * page; it stays available in Configure columns for anyone pasting the grid
 * somewhere it has lost its heading.
 */
export function useCostLayerColumns(deps: CostLayerColumnDeps): SmartColumn<CostLayerRow>[] {
  const {
    itemLabel,
    itemSku,
    batchName,
    selected,
    onToggle,
    onToggleAll,
    allSelected,
    someSelected,
    pageRowCount,
    onOpenLayer,
    onCompareCost,
    onCreateRevision,
    onRecalculate,
    onNavigate,
  } = deps

  return useMemo<SmartColumn<CostLayerRow>[]>(
    () => [
      {
        key: '__select',
        alwaysVisible: true,
        width: 36,
        configureLabel: 'Selection',
        header: (
          <input
            type="checkbox"
            aria-label={allSelected ? 'Clear selection' : 'Select every layer on this page'}
            checked={allSelected && pageRowCount > 0}
            ref={(el) => {
              if (el) el.indeterminate = someSelected && !allSelected
            }}
            disabled={pageRowCount === 0}
            onChange={onToggleAll}
            className="h-3.5 w-3.5 rounded border-gray-300 text-primary focus:ring-primary/30"
          />
        ),
        render: (row) => (
          <input
            type="checkbox"
            aria-label={`Select the layer received ${formatDate(row.received_at)}`}
            checked={selected.has(row.layer_id)}
            // The row itself opens the drawer; ticking a box must not also open it.
            onClick={(e) => e.stopPropagation()}
            onChange={() => onToggle(row.layer_id)}
            className="h-3.5 w-3.5 rounded border-gray-300 text-primary focus:ring-primary/30"
          />
        ),
      },
      {
        key: 'received_at',
        header: 'Layer date',
        sortKey: 'received_at',
        alwaysVisible: true,
        render: (row) => (
          <span className="whitespace-nowrap font-medium text-gray-900">
            {formatDate(row.received_at)}
          </span>
        ),
      },
      {
        /*
         * Widths, not `whitespace-nowrap`: a document number breaks at its own
         * hyphens, so `GRN-2026-0401` in an auto-sized column becomes three
         * lines and triples the height of every row. A floor lets the column
         * hold one line while still letting the table compress around it.
         */
        key: 'source',
        header: 'Receipt ref',
        alwaysVisible: true,
        minWidth: 112,
        cellClassName: 'whitespace-nowrap',
        render: (row) =>
          row.source_document_id ? (
            <Link
              to={`/documents/${row.source_document_id}`}
              onClick={(e) => e.stopPropagation()}
              className="font-semibold text-gray-700 no-underline hover:text-primary hover:underline"
            >
              {row.source_document_no ?? `#${row.source_document_id}`}
            </Link>
          ) : (
            <Tooltip label="This layer has no source document — it cannot be traced to a receipt on audit">
              <span className="text-gray-400">{humanize(row.layer_kind)}</span>
            </Tooltip>
          ),
      },
      {
        key: 'item',
        header: 'Item',
        defaultVisible: false,
        configureHint: 'Every row on this screen is the selected item, so this repeats.',
        render: () => (
          <span className="whitespace-nowrap">
            {itemLabel}
            {itemSku ? <span className="text-gray-400"> · {itemSku}</span> : null}
          </span>
        ),
      },
      {
        key: 'warehouse_name',
        header: 'Warehouse',
        minWidth: 104,
        render: (row) =>
          row.warehouse_name ? (
            <span className="block truncate" title={row.warehouse_name}>
              {row.warehouse_name}
            </span>
          ) : null,
      },
      {
        key: 'batch',
        header: 'Batch / lot',
        render: (row) => {
          const name = batchName(row.batch_id)
          return name ? <span className="whitespace-nowrap tabular-nums">{name}</span> : null
        },
      },
      {
        key: 'qty_received',
        header: 'Qty in',
        align: 'right',
        render: (row) => formatQty(row.qty_received),
      },
      {
        key: 'qty_consumed',
        header: 'Qty out',
        align: 'right',
        render: (row) => formatQty(consumedQty(row)),
      },
      {
        key: 'qty_remaining',
        header: 'Balance qty',
        align: 'right',
        sortKey: 'qty_remaining',
        alwaysVisible: true,
        render: (row) => (
          <span
            className={cx(
              'font-semibold',
              (row.qty_remaining ?? 0) < 0 ? 'text-red-600' : 'text-gray-900',
            )}
          >
            {formatQty(row.qty_remaining)}
          </span>
        ),
      },
      {
        key: 'unit_cost',
        header: 'Unit cost',
        align: 'right',
        sortKey: 'unit_cost',
        amount: true,
        render: (row) => formatMoney(row.unit_cost),
      },
      {
        key: 'remaining_value',
        header: 'Layer value',
        align: 'right',
        amount: true,
        alwaysVisible: true,
        render: (row) => (
          <span className="font-semibold text-gray-900">{formatMoney(row.remaining_value)}</span>
        ),
      },
      {
        key: 'consumptions',
        header: 'Consumed by',
        defaultVisible: false,
        align: 'right',
        configureHint: 'How many issues have drawn on this layer. The detail is in the layer panel.',
        render: (row) =>
          row.consumptions?.length ? (
            <span className="tabular-nums text-gray-600">
              {row.consumptions.length} issue{row.consumptions.length === 1 ? '' : 's'}
            </span>
          ) : null,
      },
      {
        key: 'status',
        header: 'Status',
        alwaysVisible: true,
        render: (row) => <CostLayerStatusBadge row={row} compact />,
      },
      {
        key: '__actions',
        header: '',
        align: 'right',
        alwaysVisible: true,
        configureLabel: 'Row actions',
        width: 44,
        headerClassName: 'print:hidden',
        cellClassName: 'print:hidden',
        render: (row) => (
          <div onClick={(e) => e.stopPropagation()} role="presentation">
            <MenuButton
              label={`Actions for the layer received ${formatDate(row.received_at)}`}
              actions={rowActions(row, {
                onOpenLayer,
                onCompareCost,
                onCreateRevision,
                onRecalculate,
                onNavigate,
              })}
              width={232}
            />
          </div>
        ),
      },
    ],
    [
      itemLabel,
      itemSku,
      batchName,
      selected,
      onToggle,
      onToggleAll,
      allSelected,
      someSelected,
      pageRowCount,
      onOpenLayer,
      onCompareCost,
      onCreateRevision,
      onRecalculate,
      onNavigate,
    ],
  )
}

/**
 * What a row offers.
 *
 * Actions the reader cannot perform are absent rather than present-and-dead:
 * "Recalculate from this date" is only built when the caller passed a handler,
 * which it only does when the member holds `valuation.recalculate`. Links to
 * records that do not exist on this row (no receipt, no batch) are left out for
 * the same reason.
 */
function rowActions(row: CostLayerRow, cb: CostLayerTableCallbacks): MenuAction[] {
  const actions: MenuAction[] = [
    { key: 'layer', label: 'View layer detail', icon: PackageOpen, onSelect: () => cb.onOpenLayer(row) },
  ]
  if (row.source_document_id) {
    actions.push({
      key: 'receipt',
      label: 'Open receipt document',
      icon: ReceiptText,
      onSelect: () => cb.onNavigate(`/documents/${row.source_document_id}`),
    })
  }
  if (row.consumptions?.length) {
    actions.push({
      key: 'consumption',
      label: `View ${row.consumptions.length} consumption${row.consumptions.length === 1 ? '' : 's'}`,
      icon: ScrollText,
      onSelect: () => cb.onOpenLayer(row),
    })
  }
  actions.push({
    key: 'compare',
    label: 'Compare cost methods',
    icon: GitCompareArrows,
    onSelect: cb.onCompareCost,
    separated: true,
  })
  actions.push({
    key: 'audit',
    label: 'View valuation revisions',
    icon: FileClock,
    onSelect: () => cb.onNavigate(`/valuation/revisions?item_id=${row.item_id}`),
  })
  if (cb.onRecalculate) {
    actions.push({
      key: 'revision',
      label: 'Create revision from this layer',
      icon: FilePenLine,
      onSelect: () => cb.onCreateRevision(row),
      separated: true,
    })
  }
  return actions
}

export interface CostLayersTableProps {
  columns: SmartColumn<CostLayerRow>[]
  rows: CostLayerRow[]
  loading: boolean
  error: Error | null
  onRetry: () => void
  sort: { key: string; order: SortOrder }
  onSort: (key: string) => void
  onRowClick: (row: CostLayerRow) => void
  activeLayerId: number | null
  /** Rendered instead of "no rows" when filters, not data, are the reason. */
  empty: ReactNode
  resetKey: string
}

export function CostLayersTable({
  columns,
  rows,
  loading,
  error,
  onRetry,
  sort,
  onSort,
  onRowClick,
  activeLayerId,
  empty,
  resetKey,
}: CostLayersTableProps) {
  return (
    <SmartTable<CostLayerRow>
      columns={columns}
      rows={rows}
      rowKey={(row) => row.layer_id}
      loading={loading}
      error={
        error
          ? {
              title: 'Unable to load valuation layers',
              description: error.message,
              onRetry,
            }
          : null
      }
      empty={empty ?? <EmptyState size="sm" icon={Boxes} title="No valuation layers found" />}
      sort={sort}
      onSort={onSort}
      onRowActivate={onRowClick}
      activateOnSingleClick
      keyboardResetKey={resetKey}
      // The open row stays marked while the drawer is up, so closing it does
      // not leave the reader hunting for where they were in 200 rows.
      rowClassName={(row) =>
        cx(
          row.layer_id === activeLayerId && 'bg-primary-light/50',
          layerStatus(row) === 'negative' && 'bg-red-50/60',
        )
      }
      stickyHeader
      scrollBody
      fillAvailable
      fillAt="taller"
      // Twelve columns of quantities and costs. At the default `sm` the grid
      // wanted 1,040px and scrolled sideways beside the rail on a 1600px
      // screen; `xs` is the 12px register type the rest of Inventory's dense
      // tables use and it fits.
      size="xs"
      density="compact"
      minWidth={820}
      caption="Cost layers for the selected item, with the quantity received, consumed and remaining in each."
    />
  )
}

export default CostLayersTable
