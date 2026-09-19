import { useMemo } from 'react'
import { Link } from 'react-router-dom'
import { Columns3, Layers3, MoreHorizontal } from 'lucide-react'
import type { MenuAction } from '../../../ui/MenuButton'
import { MenuButton } from '../../../ui/MenuButton'
import { SmartTable } from '../../../ui/shell/SmartTable'
import type { SmartColumn, SmartTableError } from '../../../ui/shell/SmartTable'
import { ServerTablePagination } from '../../../ui/shell/TablePagination'
import { cx } from '../../../ui/cx'
import type { ListMeta, SortOrder } from '../../../services/api'
import type { CostLayerRow } from '../../../services/valuationApi'
import { layerStatusOf } from '../../../services/valuationApi'
import { formatDate, formatInt, formatMoney, formatQty } from '../../../utils/format'
import { CostLayerStatusBadge } from './CostLayerStatusBadge'
import { LAYER_STATUS_LABEL } from './costLayersModel'

export interface CostLayersTableProps {
  rows: readonly CostLayerRow[]
  meta: ListMeta | null
  limit: number
  loading: boolean
  error: SmartTableError
  sort: { key: string; order: SortOrder }
  onSort: (key: string) => void
  onPage: (page: number) => void
  onLimit: (limit: number) => void
  /** Which columns to draw, from the shared column configurator. */
  columns: readonly SmartColumn<CostLayerRow>[]
  onRowOpen: (row: CostLayerRow) => void
  openLayerId: number | null
  selected: ReadonlySet<number>
  onToggleRow: (layerId: number) => void
  onToggleAll: () => void
  headerAction?: React.ReactNode
  empty?: React.ReactNode
  /** Rows the reader has ticked, for the bulk bar above the table. */
  selectionBar?: React.ReactNode
}

export interface BuildColumnsOptions {
  itemName: string | null
  unitSymbol: string | null
  /** Row actions the profile may actually take. */
  actionsFor: (row: CostLayerRow) => MenuAction[]
  selected: ReadonlySet<number>
  onToggleRow: (layerId: number) => void
  onToggleAll: () => void
  allSelected: boolean
  someSelected: boolean
}

/**
 * The grid's columns, declared once and shared with the column configurator,
 * the CSV and the print sheet — a column switched off is off in all four.
 *
 * Numbers are right-aligned and tabular so a column of figures can be read down
 * rather than across, and money never carries a symbol here: Aicountly is
 * multi-currency and the company's base currency is stated once, above the
 * table, instead of being assumed sixty times inside it.
 */
export function buildCostLayerColumns({
  itemName,
  unitSymbol,
  actionsFor,
  selected,
  onToggleRow,
  onToggleAll,
  allSelected,
  someSelected,
}: BuildColumnsOptions): SmartColumn<CostLayerRow>[] {
  return [
    {
      key: 'select',
      alwaysVisible: true,
      width: 36,
      headerClassName: 'w-9',
      header: (
        <input
          type="checkbox"
          aria-label="Select every layer on this page"
          checked={allSelected}
          ref={(el) => {
            if (el) el.indeterminate = !allSelected && someSelected
          }}
          onChange={onToggleAll}
          className="h-3.5 w-3.5 align-middle"
        />
      ),
      render: (row) => (
        <input
          type="checkbox"
          aria-label={`Select layer ${row.layer_id}`}
          checked={selected.has(row.layer_id)}
          onChange={() => onToggleRow(row.layer_id)}
          onClick={(e) => e.stopPropagation()}
          className="h-3.5 w-3.5 align-middle"
        />
      ),
    },
    {
      key: 'received_at',
      header: 'Layer date',
      sortKey: 'received_at',
      alwaysVisible: true,
      render: (row) => <span className="whitespace-nowrap">{formatDate(row.received_at)}</span>,
      csv: (row) => row.received_at ?? '',
      csvHeader: 'Layer date',
    },
    {
      key: 'source_document_no',
      header: 'Receipt ref',
      configureHint: 'The document that opened the layer.',
      render: (row) =>
        row.source_document_id ? (
          <Link
            to={`/documents/${row.source_document_id}`}
            onClick={(e) => e.stopPropagation()}
            className="whitespace-nowrap font-semibold text-gray-700 no-underline hover:text-primary hover:underline"
          >
            {row.source_document_no ?? `#${row.source_document_id}`}
          </Link>
        ) : (
          <span className="text-gray-400">—</span>
        ),
      csv: (row) => row.source_document_no ?? (row.source_document_id ? `#${row.source_document_id}` : ''),
      csvHeader: 'Receipt ref',
    },
    {
      key: 'item',
      header: 'Item',
      // Off by default: every row on this screen belongs to the one item the
      // filter names, so the column repeats it forty times. It exists for the
      // export, where the sheet has no filter bar above it to say which item
      // the rows are.
      defaultVisible: false,
      configureHint: 'The same item in every row — useful in the export, rarely on screen.',
      render: () => <span className="text-gray-600">{itemName ?? '—'}</span>,
      csv: () => itemName ?? '',
      csvHeader: 'Item',
    },
    {
      key: 'warehouse_name',
      header: 'Warehouse',
      render: (row) =>
        row.warehouse_name ? (
          <span className="whitespace-nowrap">{row.warehouse_name}</span>
        ) : (
          <span className="text-gray-400">Company scope</span>
        ),
      csv: (row) => row.warehouse_name ?? 'Company scope',
      csvHeader: 'Warehouse',
    },
    {
      key: 'batch_no',
      header: 'Batch / lot',
      render: (row) =>
        row.batch_no ? (
          <span className="whitespace-nowrap">
            {row.batch_no}
            {row.lot_no ? <span className="text-gray-400"> · {row.lot_no}</span> : null}
          </span>
        ) : row.batch_id ? (
          <span className="text-gray-500">#{row.batch_id}</span>
        ) : (
          <span className="text-gray-400">—</span>
        ),
      csv: (row) => row.batch_no ?? (row.batch_id ? `#${row.batch_id}` : ''),
      csvHeader: 'Batch / lot',
    },
    {
      key: 'qty_received',
      header: 'Qty in',
      align: 'right',
      sortKey: 'qty_received',
      render: (row) => formatQty(row.qty_received),
      csv: (row) => row.qty_received ?? '',
      csvHeader: `Qty in${unitSymbol ? ` (${unitSymbol})` : ''}`,
    },
    {
      key: 'qty_consumed',
      header: 'Qty out',
      align: 'right',
      render: (row) => formatQty(row.qty_consumed),
      csv: (row) => row.qty_consumed ?? '',
      csvHeader: `Qty out${unitSymbol ? ` (${unitSymbol})` : ''}`,
    },
    {
      key: 'qty_remaining',
      header: 'Balance qty',
      align: 'right',
      sortKey: 'qty_remaining',
      alwaysVisible: true,
      render: (row) => (
        <strong className={cx('font-semibold', row.qty_remaining < 0 ? 'text-red-600' : 'text-gray-900')}>
          {formatQty(row.qty_remaining)}
        </strong>
      ),
      csv: (row) => row.qty_remaining,
      csvHeader: `Balance qty${unitSymbol ? ` (${unitSymbol})` : ''}`,
    },
    {
      key: 'unit_cost',
      header: 'Unit cost',
      align: 'right',
      sortKey: 'unit_cost',
      amount: true,
      render: (row) => formatMoney(row.unit_cost),
      csv: (row) => row.unit_cost,
      csvHeader: 'Unit cost (valuation)',
    },
    {
      key: 'remaining_value',
      header: 'Layer value',
      align: 'right',
      sortKey: 'remaining_value',
      amount: true,
      alwaysVisible: true,
      configureHint: 'Balance quantity at the layer’s unit cost — what this layer still holds.',
      render: (row) => (
        <strong className={cx('font-semibold', row.remaining_value < 0 ? 'text-red-600' : 'text-gray-900')}>
          {formatMoney(row.remaining_value)}
        </strong>
      ),
      csv: (row) => row.remaining_value,
      csvHeader: 'Remaining value (valuation)',
    },
    {
      key: 'layer_status',
      header: 'Status',
      alwaysVisible: true,
      render: (row) => <CostLayerStatusBadge status={layerStatusOf(row)} />,
      // The sheet has no tooltip, so it writes the state in full.
      csv: (row) => LAYER_STATUS_LABEL[layerStatusOf(row)],
      csvHeader: 'Status',
    },
    {
      key: 'consumptions',
      header: 'Issues',
      align: 'right',
      // Off by default: the count is on the layer's own panel next to the trail
      // it counts, and the twelve columns left are already what a 1280px screen
      // can hold beside the contextual rail.
      defaultVisible: false,
      configureHint: 'How many issues have drawn from this layer.',
      render: (row) =>
        row.consumptions?.length ? (
          <span className="tabular-nums text-gray-600">{formatInt(row.consumptions.length)}</span>
        ) : (
          <span className="text-gray-400">—</span>
        ),
      csv: (row) => row.consumptions?.length ?? 0,
      csvHeader: 'Issues',
    },
    {
      key: 'actions',
      header: '',
      alwaysVisible: true,
      width: 44,
      cellClassName: 'text-right',
      render: (row) => {
        const actions = actionsFor(row)
        if (actions.length === 0) return null
        return (
          <span onClick={(e) => e.stopPropagation()} role="presentation">
            <MenuButton
              actions={actions}
              icon={MoreHorizontal}
              label={`Actions for layer ${row.layer_id}`}
            />
          </span>
        )
      },
      csv: () => '',
      csvHeader: '',
    },
  ]
}

/**
 * The layers themselves.
 *
 * Paging, sorting and every filter are the server's: the footer counts the
 * whole filtered result, not the rows in memory, so "1–25 of 1,028" is a fact
 * rather than a page-local guess. A click opens the layer beside the list
 * instead of navigating away, because a reader comparing two layers should not
 * have to close one to find the other.
 */
export function CostLayersTable({
  rows,
  meta,
  limit,
  loading,
  error,
  sort,
  onSort,
  onPage,
  onLimit,
  columns,
  onRowOpen,
  openLayerId,
  headerAction,
  empty,
  selectionBar,
}: CostLayersTableProps) {
  const footer = useMemo(
    () => (
      <ServerTablePagination meta={meta} limit={limit} onPage={onPage} onLimit={onLimit} numbered />
    ),
    [meta, limit, onPage, onLimit],
  )

  return (
    <>
      {selectionBar}
      <SmartTable<CostLayerRow>
        columns={columns}
        rows={rows}
        rowKey={(row) => row.layer_id}
        loading={loading}
        error={error}
        empty={empty}
        size="xs"
        density="compact"
        stickyHeader
        hover
        minWidth={900}
        title="Valuation layers"
        description="Cost layers for this item's receipts and the issues that consumed them"
        headerAction={headerAction}
        onRowActivate={onRowOpen}
        activateOnSingleClick
        sort={sort}
        onSort={onSort}
        keyboardResetKey={`${sort.key}:${sort.order}:${meta?.offset ?? 0}`}
        rowClassName={(row) => (row.layer_id === openLayerId ? 'bg-primary-light/60' : undefined)}
        footer={footer}
        caption="Cost layers with quantity in, quantity out, balance, unit cost and remaining value"
      />
    </>
  )
}

export const COST_LAYERS_TABLE_ICON = Layers3
export const COST_LAYERS_COLUMNS_ICON = Columns3

export default CostLayersTable
