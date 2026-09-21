import { useMemo } from 'react'
import { ExternalLink, MinusCircle, Package, PlusCircle, SearchX, SquareCheckBig } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { Badge } from '../../../ui/Badge'
import { EmptyState } from '../../../ui/EmptyState'
import { MenuButton } from '../../../ui/MenuButton'
import { SmartTable } from '../../../ui/shell/SmartTable'
import type { SmartColumn } from '../../../ui/shell/SmartTable'
import { ServerTablePagination } from '../../../ui/shell/TablePagination'
import { ExportCsvButton } from '../../../components/ExportCsvButton'
import type { CsvColumn } from '../../../utils/csv'
import { csvFilename } from '../../../utils/csv'
import { formatDateTime, formatInt } from '../../../utils/format'
import type { ListMeta } from '../../../services/api'
import type { ItemFormOptions } from '../../../services/items'
import type { BulkFieldSpec } from './bulkEditFields'
import { formatCurrentValue, formatFieldValue } from './bulkEditFields'
import type { BulkEditPlan, RowPlan, RowPlanStatus } from './bulkEditModel'
import { headerSelectState } from './bulkEditModel'

/**
 * Step two: every row the change would touch, with what it holds now and what
 * it would become.
 *
 * The status column is the point of the screen. "Will update" and "Unchanged"
 * are different outcomes and are counted differently everywhere else on the
 * page, so they are different words here — the badge tone is never the only
 * thing carrying the difference.
 */

const STATUS_PRESENTATION: Record<RowPlanStatus, { label: string; tone: 'success' | 'neutral' | 'danger' | 'warning' }> = {
  will_update: { label: 'Will update', tone: 'success' },
  unchanged: { label: 'Unchanged', tone: 'neutral' },
  invalid: { label: 'Invalid value', tone: 'danger' },
  locked: { label: 'Read only', tone: 'warning' },
  not_selected: { label: 'Not selected', tone: 'neutral' },
}

export interface BulkEditItemsTableProps {
  /** The rows on this page of the catalogue. */
  plan: BulkEditPlan
  /**
   * Every ticked row, across every page the selection was made on.
   *
   * "Show only selected" renders THESE, not the ticked rows of the page that
   * happens to be loaded: a reader who ticked four items over two pages and
   * then asked to see their selection must be shown four, or the toggle is
   * quietly lying about what Apply is going to write.
   */
  selectedRows: readonly RowPlan[]
  field: BulkFieldSpec
  options: ItemFormOptions | null
  /** The editor's value in comparable form, for the "New value" column. */
  nextKey: string | null
  loading: boolean
  error: Error | null
  onRetry: () => void
  meta: ListMeta | null
  limit: number
  onPage: (page: number) => void
  onLimit: (limit: number) => void
  showOnlySelected: boolean
  onShowOnlySelected: (value: boolean) => void
  onToggleRow: (row: RowPlan) => void
  onToggleVisible: () => void
  /** The server's count for the current filters — the heading says it plainly. */
  filteredTotal: number | null
  scopeLabel: string
  hasFilters: boolean
  onClearFilters: () => void
}

export function BulkEditItemsTable({
  plan,
  selectedRows,
  field,
  options,
  nextKey,
  loading,
  error,
  onRetry,
  meta,
  limit,
  onPage,
  onLimit,
  showOnlySelected,
  onShowOnlySelected,
  onToggleRow,
  onToggleVisible,
  filteredTotal,
  scopeLabel,
  hasFilters,
  onClearFilters,
}: BulkEditItemsTableProps) {
  const navigate = useNavigate()

  const visible = useMemo(
    () => (showOnlySelected ? selectedRows : plan.rows),
    [plan.rows, selectedRows, showOnlySelected],
  )

  const headerState = headerSelectState(
    visible.map((p) => p.row),
    new Set(visible.filter((p) => p.selected).map((p) => p.row.item_id)),
  )

  const newValueText = nextKey === null ? null : nextKey === '' ? 'Cleared' : formatFieldValue(field, nextKey, options)

  const columns = useMemo<SmartColumn<RowPlan>[]>(() => {
    const cols: SmartColumn<RowPlan>[] = [
      {
        key: 'select',
        width: 36,
        headerClassName: 'w-9',
        header: (
          <input
            type="checkbox"
            className="h-4 w-4 cursor-pointer accent-emerald-600"
            checked={headerState === 'all'}
            ref={(el) => {
              if (el) el.indeterminate = headerState === 'some'
            }}
            onChange={onToggleVisible}
            aria-label={
              showOnlySelected
                ? `Clear all ${visible.length} selected items`
                : headerState === 'all'
                  ? `Clear the ${plan.rows.length} items on this page`
                  : `Select the ${plan.rows.length} items on this page`
            }
          />
        ),
        render: (p) => (
          <input
            type="checkbox"
            className="h-4 w-4 cursor-pointer accent-emerald-600"
            checked={p.selected}
            onChange={() => onToggleRow(p)}
            onClick={(e) => e.stopPropagation()}
            aria-label={`Select ${p.row.item_name}`}
          />
        ),
      },
      {
        key: 'item',
        header: 'Item',
        minWidth: 190,
        render: (p) => (
          <span className="flex items-center gap-2">
            <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-sky-50" aria-hidden>
              <Package className="h-3.5 w-3.5 text-sky-600" />
            </span>
            <span className="min-w-0">
              <span className="block truncate text-xs font-semibold text-gray-900">{p.row.item_name}</span>
              {p.row.item_alias ? (
                <span className="block truncate text-[10px] text-gray-500">{p.row.item_alias}</span>
              ) : null}
            </span>
          </span>
        ),
        csv: (p) => p.row.item_name,
      },
      { key: 'alias', header: 'Alias', accessor: (p) => p.row.item_alias || '—', csv: (p) => p.row.item_alias ?? '' },
      {
        key: 'sku',
        header: 'SKU',
        cellClassName: 'tabular-nums',
        accessor: (p) => p.row.item_sku || '—',
        csv: (p) => p.row.item_sku ?? '',
      },
    ]

    // The dedicated Group column is dropped when the group IS the field being
    // changed — two columns of the same value, one headed "Group" and one
    // "Current group", is a table asking the reader which one to believe.
    if (field.key !== 'item_grp_id') {
      cols.push({
        key: 'group',
        header: 'Group',
        accessor: (p) => p.row.grp_name || '—',
        csv: (p) => p.row.grp_name ?? '',
      })
    }

    cols.push(
      {
        key: 'current',
        header: field.columnLabel,
        render: (p) => <span className="tabular-nums">{formatCurrentValue(p.row, field, options)}</span>,
        csvHeader: field.columnLabel,
        csv: (p) => formatCurrentValue(p.row, field, options),
      },
      {
        key: 'next',
        header: 'New value',
        render: (p) =>
          p.status === 'will_update' && newValueText ? (
            <span className="inline-flex min-h-[1.5rem] items-center rounded-md bg-emerald-50 px-2 text-[10px] font-semibold tabular-nums text-emerald-800">
              {newValueText}
            </span>
          ) : (
            <span className="text-gray-400">—</span>
          ),
        csv: (p) => (p.status === 'will_update' && newValueText ? newValueText : ''),
      },
      {
        key: 'status',
        header: 'Status',
        render: (p) => {
          const preset = STATUS_PRESENTATION[p.status]
          return (
            <Badge tone={preset.tone} size="xs" dot>
              {preset.label}
            </Badge>
          )
        },
        csv: (p) => STATUS_PRESENTATION[p.status].label,
      },
      {
        key: 'updated_at',
        header: 'Last updated',
        cellClassName: 'whitespace-nowrap',
        accessor: (p) => formatDateTime(p.row.updated_at),
        csv: (p) => formatDateTime(p.row.updated_at),
      },
      {
        key: 'actions',
        header: <span className="sr-only">Actions</span>,
        align: 'right',
        width: 44,
        render: (p) => (
          <MenuButton
            variant="ghost"
            size="xs"
            label={`Actions for ${p.row.item_name}`}
            align="end"
            width={200}
            actions={[
              {
                key: 'open',
                label: 'Open item',
                icon: ExternalLink,
                onSelect: () => navigate(`/items/${p.row.item_id}`),
              },
              {
                key: 'toggle',
                label: p.selected ? 'Remove from selection' : 'Add to selection',
                icon: p.selected ? MinusCircle : PlusCircle,
                onSelect: () => onToggleRow(p),
              },
            ]}
          />
        ),
      },
    )

    return cols
  }, [field, options, newValueText, headerState, plan.rows.length, visible.length, showOnlySelected, onToggleRow, onToggleVisible, navigate])

  const csvColumns = useMemo<CsvColumn<RowPlan>[]>(
    () =>
      columns
        .filter((c) => c.key !== 'select' && c.key !== 'actions')
        .map((c) => ({
          header: c.csvHeader ?? (typeof c.header === 'string' ? c.header : c.key),
          value: (p: RowPlan) => (c.csv ? c.csv(p) : ''),
        })),
    [columns],
  )

  const heading = (
    <>
      2. Review affected items{' '}
      <span className="font-medium text-gray-500">
        ({formatInt(visible.length)}
        {filteredTotal !== null && !showOnlySelected && filteredTotal > visible.length
          ? ` of ${formatInt(filteredTotal)}`
          : ''}{' '}
        {showOnlySelected ? 'selected' : 'item'}
        {visible.length === 1 && !showOnlySelected ? '' : 's'})
      </span>
    </>
  )

  return (
    <SmartTable<RowPlan>
      title={heading}
      headerAction={
        <div className="flex flex-wrap items-center gap-3">
          <label className="inline-flex cursor-pointer items-center gap-2 text-[11px] text-gray-600">
            <input
              type="checkbox"
              className="h-4 w-4 cursor-pointer accent-emerald-600"
              checked={showOnlySelected}
              onChange={(e) => onShowOnlySelected(e.target.checked)}
            />
            Show only selected
          </label>
          <ExportCsvButton
            filename={csvFilename('items-bulk-edit', scopeLabel)}
            columns={csvColumns}
            rows={visible}
            label={`Export (${formatInt(visible.length)})`}
            disabled={visible.length === 0}
          />
        </div>
      }
      columns={columns}
      rows={visible}
      rowKey={(p) => p.row.item_id}
      loading={loading}
      error={
        error
          ? { title: 'Couldn’t load items.', description: error.message, onRetry }
          : null
      }
      empty={
        showOnlySelected ? (
          <EmptyState
            icon={SquareCheckBig}
            title="Nothing selected yet"
            description="Turn off “Show only selected”, or tick the items you want to change."
          />
        ) : hasFilters ? (
          <EmptyState
            icon={SearchX}
            title="No matching items"
            description="Try changing your search, group or status filters."
            action="Clear filters"
            onAction={onClearFilters}
          />
        ) : (
          <EmptyState icon={Package} title="No items yet" description="Create an item before running a bulk edit." />
        )
      }
      density="compact"
      stickyHeader
      scrollBody
      hover
      keyboardNav
      onRowActivate={(p) => onToggleRow(p)}
      rowClassName={(p) => (p.selected ? 'table-row-selected' : undefined)}
      minWidth={860}
      footer={
        /* Server paging describes the catalogue, not a selection. With "show
           only selected" on, the table is no longer a page of anything — a
           pager there would read "1–25 of 248" over four rows. */
        showOnlySelected ? (
          <p className="text-xs text-gray-500">
            Showing {formatInt(visible.length)} selected item{visible.length === 1 ? '' : 's'}
            {filteredTotal !== null ? ` from ${formatInt(filteredTotal)} matching` : ''}.
          </p>
        ) : (
          <ServerTablePagination meta={meta} limit={limit} onPage={onPage} onLimit={onLimit} numbered />
        )
      }
    />
  )
}
