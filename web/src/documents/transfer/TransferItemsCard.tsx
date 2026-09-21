import { Boxes, Download, Eraser, MoreVertical, Plus, ScanLine, Upload } from 'lucide-react'
import { Button } from '../../ui/Button'
import { Card } from '../../ui/Card'
import { IconTile } from '../../ui/IconTile'
import { MenuButton } from '../../ui/MenuButton'
import { Skeleton } from '../../ui/Skeleton'
import { cx } from '../../ui/cx'
import type { FormOptionWarehouse } from '../../services/items'
import type { BatchRow, ItemSearchRow } from '../../services/lookupApi'
import type { HeaderDraft, LineDraft } from '../formModel'
import { TransferItemRow } from './TransferItemRow'
import { issuesForLine } from './transferModel'
import type { LineStock, TransferIssue } from './transferModel'

export const TRANSFER_COLUMNS = 8

export interface TransferItemsCardProps {
  lines: LineDraft[]
  header: HeaderDraft
  warehouses: FormOptionWarehouse[]
  warehousesLoading: boolean
  stock: ReadonlyMap<string, LineStock>
  rates: ReadonlyMap<number, number> | null
  currencyCode: string | null
  issues: readonly TransferIssue[]
  disabled: boolean
  expandedKeys: ReadonlySet<string>
  focusKey: string | null
  warehouseName: (id: number | null | undefined) => string
  onToggleExpand: (key: string) => void
  onChangeLine: (key: string, patch: Partial<LineDraft>) => void
  onPickItem: (key: string, row: ItemSearchRow) => void
  onClearItem: (key: string) => void
  onDuplicate: (key: string) => void
  onRemove: (key: string) => void
  onBatchPicked: (key: string, batch: BatchRow | null) => void
  onAddLine: () => void
  onAddFromItems: () => void
  onScan: () => void
  onImport: () => void
  onRemoveEmpty: () => void
  onClearAll: () => void
  onExport: () => void
}

/* No `whitespace-nowrap`: a header that cannot wrap sets the column's minimum
   width from its own label, and "Available (source)" was then wider than the
   figures underneath it. */
const HEAD =
  'px-2 py-2 text-left text-[10px] font-bold uppercase tracking-wide text-gray-500 border-b border-gray-200 bg-gray-50'

/**
 * The lines of the transfer.
 *
 * A hand-built grid rather than SmartTable: SmartTable reads rows, this one
 * edits them — every cell is a control, rows expand, and there is nothing to
 * sort or paginate.
 */
export function TransferItemsCard({
  lines,
  header,
  warehouses,
  warehousesLoading,
  stock,
  rates,
  currencyCode,
  issues,
  disabled,
  expandedKeys,
  focusKey,
  warehouseName,
  onToggleExpand,
  onChangeLine,
  onPickItem,
  onClearItem,
  onDuplicate,
  onRemove,
  onBatchPicked,
  onAddLine,
  onAddFromItems,
  onScan,
  onImport,
  onRemoveEmpty,
  onClearAll,
  onExport,
}: TransferItemsCardProps) {
  return (
    <Card padding="md">
      <div className="mb-3 flex flex-wrap items-start justify-between gap-3 border-b border-gray-100 pb-3">
        <div className="flex min-w-0 items-start gap-3">
          <IconTile icon={Boxes} tone="primary" size="md" />
          <div className="min-w-0">
            <h2 className="text-sm font-semibold text-gray-900">Items</h2>
            <p className="mt-0.5 text-xs text-gray-500">
              Add what is being moved. Live stock at the source warehouse is shown for every line.
            </p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="outline" size="md" icon={Plus} onClick={onAddFromItems} disabled={disabled}>
            Add from Items
          </Button>
          <Button variant="secondary" size="md" icon={ScanLine} onClick={onScan} disabled={disabled}>
            Scan Barcode
          </Button>
          <Button variant="secondary" size="md" icon={Upload} onClick={onImport} disabled={disabled}>
            Import (CSV)
          </Button>
          <MenuButton
            label="More line actions"
            icon={MoreVertical}
            variant="secondary"
            size="md"
            actions={[
              { key: 'export', label: 'Export these lines to CSV', icon: Download, onSelect: onExport, disabled: lines.length === 0 },
              { key: 'empty', label: 'Remove empty lines', icon: Eraser, onSelect: onRemoveEmpty, disabled: disabled },
              { key: 'clear', label: 'Clear all lines', icon: Eraser, onSelect: onClearAll, danger: true, separated: true, disabled: disabled || lines.length === 0 },
            ]}
          />
        </div>
      </div>

      <div className="scrollbar-thin relative overflow-x-auto rounded-xl border border-gray-200">
        <table className="st-grid w-full min-w-[47rem] table-fixed border-collapse">
          <caption className="sr-only">Items on this stock transfer</caption>
          <thead>
            <tr>
              {/* `table-fixed` with the widths on the header row. Under auto
                  layout a long item name widens its column past whatever it is
                  given and pushes Est. value and the row actions off the card;
                  fixed layout sizes the columns from this row and leaves the
                  rest to Item details, which is the one that should flex. */}
              <th scope="col" className={cx(HEAD, 'w-8')}>
                #
              </th>
              <th scope="col" className={HEAD}>
                Item details
              </th>
              <th scope="col" className={cx(HEAD, 'w-[8rem]')}>
                Batch / Serial
              </th>
              <th scope="col" className={cx(HEAD, 'w-[5.25rem]')}>
                Unit
              </th>
              <th scope="col" className={cx(HEAD, 'w-[4.75rem] text-right')}>
                Qty
              </th>
              <th scope="col" className={cx(HEAD, 'w-[5.5rem]')}>
                Available
              </th>
              <th scope="col" className={cx(HEAD, 'w-[6.75rem] text-right')}>
                Est. value
              </th>
              {/* Plain text, not an `sr-only` label beside an aria-hidden one:
                  `sr-only` is `position:absolute`, and inside a table this wide
                  it escapes the scroll container and drags the whole page
                  sideways on a phone. "Action" reads fine either way. */}
              <th scope="col" className={cx(HEAD, 'w-[4rem] text-right')}>
                Action
              </th>
            </tr>
          </thead>
          <tbody>
            {warehousesLoading && lines.length === 0
              ? [0, 1, 2].map((i) => (
                  <tr key={`skeleton-${i}`}>
                    <td colSpan={TRANSFER_COLUMNS} className="border-b border-gray-100 px-2.5 py-3">
                      <Skeleton className="h-9 w-full" rounded="md" />
                    </td>
                  </tr>
                ))
              : lines.map((line, index) => (
                  <TransferItemRow
                    key={line.key}
                    index={index}
                    line={line}
                    header={header}
                    warehouses={warehouses}
                    stock={stock.get(line.key)}
                    rates={rates}
                    currencyCode={currencyCode}
                    issues={issuesForLine(issues, line.key)}
                    disabled={disabled}
                    expanded={expandedKeys.has(line.key)}
                    autoFocus={focusKey === line.key}
                    columnCount={TRANSFER_COLUMNS}
                    warehouseName={warehouseName}
                    onToggleExpand={() => onToggleExpand(line.key)}
                    onChange={(patch) => onChangeLine(line.key, patch)}
                    onPick={(row) => onPickItem(line.key, row)}
                    onClear={() => onClearItem(line.key)}
                    onDuplicate={() => onDuplicate(line.key)}
                    onRemove={() => onRemove(line.key)}
                    onBatchPicked={(batch) => onBatchPicked(line.key, batch)}
                  />
                ))}
            {!warehousesLoading && lines.length === 0 ? (
              <tr>
                <td colSpan={TRANSFER_COLUMNS} className="px-4 py-10 text-center">
                  <p className="text-sm font-medium text-gray-700">No items on this transfer yet</p>
                  <p className="mt-1 text-xs text-gray-500">
                    Search by item name, SKU or barcode, scan one in, or import a CSV of what is moving.
                  </p>
                  <Button variant="outline" size="sm" icon={Plus} className="mt-3" onClick={onAddLine} disabled={disabled}>
                    Add the first item
                  </Button>
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>

      {lines.length > 0 ? (
        <div className="mt-2.5">
          <Button variant="outline" size="sm" icon={Plus} onClick={onAddLine} disabled={disabled}>
            Add another item
          </Button>
        </div>
      ) : null}
    </Card>
  )
}
