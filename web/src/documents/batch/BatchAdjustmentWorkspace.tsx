import { CircleCheck, Layers, ListChecks, Plus, ScanBarcode, TriangleAlert, Upload, Wand2, Eraser, Trash2, MoreHorizontal } from 'lucide-react'
import type { ReactNode } from 'react'
import type { FormOptionWarehouse } from '../../services/items'
import type { BatchRow, ItemSearchRow } from '../../services/lookupApi'
import { Badge } from '../../ui/Badge'
import { Button } from '../../ui/Button'
import { Card } from '../../ui/Card'
import { EmptyState } from '../../ui/EmptyState'
import { MenuButton } from '../../ui/MenuButton'
import { SegmentedControl } from '../../ui/SegmentedControl'
import { AIC, cx } from '../../ui/cx'
import { formatQty } from '../../utils/format'
import type { LineDraft } from '../formModel'
import { BatchAdjustmentRow, BatchEmptyRow } from './BatchAdjustmentRow'
import type { BatchAdjustmentMetrics, BatchIssue, LineTab, LineTabCounts } from './batchAdjustmentModel'

/**
 * The table is `table-fixed`: these widths are the layout, not a suggestion.
 *
 * Left to itself the browser shares the shortfall between every column, and at 1440px that turns
 * Qty into a box too narrow to show "10" and Direction into "O". A fixed grid plus the horizontal
 * scroller keeps every column readable and lets the reader move sideways instead — which is what
 * a dense entry table should do.
 */
const COLUMNS: { key: string; label: ReactNode; className?: string }[] = [
  { key: 'n', label: '#', className: 'w-8 text-center' },
  { key: 'item', label: 'Item', className: 'w-[10.5rem]' },
  { key: 'warehouse', label: 'Warehouse', className: 'w-[8rem]' },
  { key: 'from', label: 'Current batch (from)', className: 'w-[8rem]' },
  { key: 'to', label: 'Revised batch (to)', className: 'w-[8rem]' },
  { key: 'unit', label: 'Unit', className: 'w-[5rem]' },
  { key: 'direction', label: 'Direction', className: 'w-[6rem]' },
  { key: 'qty', label: 'Qty', className: 'w-[5rem] text-right' },
  { key: 'serials', label: 'Serials / lots', className: 'w-[7rem]' },
  { key: 'notes', label: 'Notes', className: 'w-[8rem]' },
  { key: 'status', label: 'Status', className: 'w-[6.5rem]' },
  { key: 'actions', label: <span className="sr-only">Actions</span>, className: 'w-9' },
]

const EMPTY_ISSUES: BatchIssue[] = []

const TAB_EMPTY: Record<LineTab, string> = {
  all: 'No adjustment lines yet.',
  exceptions: 'No line has an open issue.',
  serials: 'Every serial-tracked line has its serial numbers mapped.',
  resolved: 'Nothing resolved in this session yet.',
}

export interface BatchAdjustmentWorkspaceProps {
  lines: readonly LineDraft[]
  visibleLines: readonly LineDraft[]
  /** Display number per line key, so a filtered tab still shows each line's real position. */
  numbering: ReadonlyMap<string, number>
  tab: LineTab
  counts: LineTabCounts
  onTabChange: (tab: LineTab) => void
  metrics: BatchAdjustmentMetrics
  issues: ReadonlyMap<string, BatchIssue[]>
  warehouses: readonly FormOptionWarehouse[]
  defaultWarehouseId: number | null
  batchesFor: (itemId: number | null, warehouseId: number | null) => readonly BatchRow[] | undefined
  batchesLoading: (itemId: number | null, warehouseId: number | null) => boolean
  disabled: boolean
  readOnly: boolean
  unpairedCount: number
  onAddLine: () => void
  onImport: () => void
  onScan: () => void
  onPairAll: () => void
  onRemoveEmpty: () => void
  onClearAll: () => void
  onPatch: (key: string, patch: Partial<LineDraft>) => void
  onPickItem: (key: string, row: ItemSearchRow) => void
  onClearItem: (key: string) => void
  onRemove: (key: string) => void
  onDuplicate: (key: string) => void
  onClearMapping: (key: string) => void
  onOpenItem: (itemId: number) => void
  onOpenSerials: (key: string) => void
  onCreateBatch: (key: string, body: { batch_no: string; expiry_date: string | null }) => Promise<BatchRow>
}

/** The lines card: what to enter, filtered by what still needs attention, and what it adds up to. */
export function BatchAdjustmentWorkspace(props: BatchAdjustmentWorkspaceProps) {
  const { lines, visibleLines, numbering, tab, counts, metrics, issues, readOnly, disabled } = props
  const noLines = counts.all === 0
  /*
   * The empty state stands in for the table only on a document nobody has touched. A second, still
   * blank row means the user has asked for one — and they asked for somewhere to type, so showing
   * them the invitation again instead of the row would read as the button having done nothing.
   */
  const pristine = noLines && lines.length <= 1

  return (
    <Card padding="none">
      <header className="flex flex-wrap items-start justify-between gap-3 border-b border-gray-100 px-4 py-3">
        <div className="flex min-w-0 items-start gap-3">
          <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary-light">
            <Layers className="h-4 w-4 text-primary" aria-hidden />
          </span>
          <div className="min-w-0">
            <h3 className="truncate text-sm font-semibold text-gray-900">Adjustment lines</h3>
            <p className="mt-0.5 text-xs text-gray-500">Specify the items and batch reallocations.</p>
          </div>
        </div>
        {readOnly ? null : (
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="secondary" size="sm" icon={Upload} onClick={props.onImport} disabled={disabled}>
              Import from file
            </Button>
            <Button variant="secondary" size="sm" icon={ScanBarcode} onClick={props.onScan} disabled={disabled}>
              Scan &amp; add
            </Button>
            <MenuButton
              label="More line actions"
              icon={MoreHorizontal}
              variant="secondary"
              size="sm"
              width={240}
              actions={[
                {
                  key: 'pair',
                  label: props.unpairedCount > 0 ? `Create ${props.unpairedCount} matching in line${props.unpairedCount === 1 ? '' : 's'}` : 'Create matching in lines',
                  icon: Wand2,
                  onSelect: props.onPairAll,
                  disabled: disabled || props.unpairedCount === 0,
                },
                { key: 'empty', label: 'Remove empty lines', icon: Eraser, onSelect: props.onRemoveEmpty, disabled: disabled || lines.length === 0 },
                { key: 'clear', label: 'Clear all lines', icon: Trash2, onSelect: props.onClearAll, danger: true, separated: true, disabled: disabled || noLines },
              ]}
            />
          </div>
        )}
      </header>

      <div className="flex flex-wrap items-center gap-3 border-b border-gray-100 px-4 py-2">
        <SegmentedControl<LineTab>
          value={tab}
          onChange={props.onTabChange}
          options={[
            { value: 'all', label: `All lines (${counts.all})`, title: 'Every line on the document' },
            {
              value: 'exceptions',
              label: (
                <span className="inline-flex items-center gap-1">
                  <TriangleAlert className="h-3 w-3" aria-hidden />
                  Exceptions ({counts.exceptions})
                </span>
              ),
              title: 'Lines carrying a warning or an error',
            },
            { value: 'serials', label: `Needs serial mapping (${counts.serials})`, title: 'Serial-tracked lines whose allocation is incomplete' },
            {
              value: 'resolved',
              label: (
                <span className="inline-flex items-center gap-1">
                  <CircleCheck className="h-3 w-3" aria-hidden />
                  Resolved ({counts.resolved})
                </span>
              ),
              title: 'Lines that were flagged earlier in this session and are clean now',
            },
          ]}
        />
        <span className="ml-auto inline-flex items-center gap-1.5 text-[11px] text-gray-500" aria-live="polite">
          <ListChecks className="h-3.5 w-3.5" aria-hidden />
          {metrics.readyLines} of {metrics.totalLines} line{metrics.totalLines === 1 ? '' : 's'} clean
        </span>
      </div>

      {pristine && tab === 'all' ? (
        <EmptyState
          icon={Layers}
          size="sm"
          title="No adjustment lines yet"
          description="Search an item, scan a barcode, or import lines to begin."
          action={
            readOnly ? undefined : (
              <div className="flex items-center gap-2">
                <Button size="sm" icon={Plus} onClick={props.onAddLine}>
                  Add line
                </Button>
                <Button size="sm" variant="secondary" icon={ScanBarcode} onClick={props.onScan}>
                  Scan &amp; add
                </Button>
              </div>
            )
          }
        />
      ) : (
        /* `relative`: the header's sr-only label is absolutely positioned, and without a
           positioned ancestor it resolves against the page and drags the document's scroll
           width out to the table's, which is exactly the sideways page scroll the scroller
           exists to prevent. */
        <div className={cx(AIC, 'relative w-full overflow-x-auto')}>
          <table className="w-full min-w-[76.5rem] table-fixed border-collapse text-xs">
            <thead>
              <tr className="bg-gray-50">
                {COLUMNS.map((col) => (
                  <th
                    key={col.key}
                    scope="col"
                    // Wrapping, not nowrap: "Current batch (from)" over two lines reads; the same
                    // words running under the next column do not.
                    className={cx('border-b border-gray-200 px-2 py-2 text-left align-bottom text-[10px] font-semibold uppercase leading-tight tracking-wide text-gray-500', col.className)}
                  >
                    {col.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {visibleLines.length === 0 ? (
                <BatchEmptyRow colSpan={COLUMNS.length} message={TAB_EMPTY[tab]} />
              ) : (
                visibleLines.map((line) => (
                  <BatchAdjustmentRow
                    key={line.key}
                    line={line}
                    index={numbering.get(line.key) ?? 0}
                    defaultWarehouseId={props.defaultWarehouseId}
                    warehouses={props.warehouses}
                    batches={props.batchesFor(line.item_id, line.warehouse_id ?? props.defaultWarehouseId)}
                    batchesLoading={props.batchesLoading(line.item_id, line.warehouse_id ?? props.defaultWarehouseId)}
                    issues={issues.get(line.key) ?? EMPTY_ISSUES}
                    disabled={disabled}
                    readOnly={readOnly}
                    onPatch={props.onPatch}
                    onPickItem={props.onPickItem}
                    onClearItem={props.onClearItem}
                    onRemove={props.onRemove}
                    onDuplicate={props.onDuplicate}
                    onClearMapping={props.onClearMapping}
                    onOpenItem={props.onOpenItem}
                    onOpenSerials={props.onOpenSerials}
                    onCreateBatch={props.onCreateBatch}
                  />
                ))
              )}
            </tbody>
          </table>
        </div>
      )}

      <footer className="flex flex-wrap items-center justify-between gap-3 border-t border-gray-100 px-4 py-2.5">
        {readOnly ? (
          <span />
        ) : (
          <Button variant="outline" size="sm" icon={Plus} onClick={props.onAddLine} disabled={disabled} kbd="Alt N">
            Add line
          </Button>
        )}
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] font-semibold text-gray-600">
          <span>
            {metrics.totalLines} line{metrics.totalLines === 1 ? '' : 's'}
          </span>
          <span className="text-gray-300" aria-hidden>
            |
          </span>
          <span className="tabular-nums">{formatQty(metrics.totalQtyOut, '0')} out</span>
          <span className="text-gray-300" aria-hidden>
            |
          </span>
          <span className="tabular-nums">{formatQty(metrics.totalQtyIn, '0')} in</span>
          {metrics.variance !== 0 ? (
            <Badge tone="warning" size="xs">
              Variance {metrics.variance > 0 ? '+' : ''}
              {formatQty(metrics.variance)}
            </Badge>
          ) : null}
        </div>
      </footer>
    </Card>
  )
}

export default BatchAdjustmentWorkspace
