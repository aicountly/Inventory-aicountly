import { useEffect, useRef, useState } from 'react'
import { ClipboardPaste, Columns3, LayoutGrid, Plus, ScanBarcode, Table2 } from 'lucide-react'
import type { FormOptionWarehouse } from '../../services/items'
import type { ItemSearchRow } from '../../services/lookupApi'
import type { AvailabilityCheckResult } from '../../services/stockApi'
import { Button } from '../../ui/Button'
import { Card } from '../../ui/Card'
import { EmptyState } from '../../ui/EmptyState'
import { MenuButton } from '../../ui/MenuButton'
import { AIC, cx } from '../../ui/cx'
import { formatQty } from '../../utils/format'
import type { LineDraft } from '../formModel'
import { StockJournalRow } from './StockJournalRow'
import { OPTIONAL_COLUMNS, errorsForLine, journalTotals, warningsForLine } from './model'
import type { ColumnVisibility, JournalError, JournalWarning, OptionalColumn } from './model'

export interface StockJournalLinesCardProps {
  lines: LineDraft[]
  warehouses: readonly FormOptionWarehouse[]
  availability: Record<string, AvailabilityCheckResult>
  checking: boolean
  errors: readonly JournalError[]
  warnings: readonly JournalWarning[]
  columns: ColumnVisibility
  onColumnsChange: (columns: ColumnVisibility) => void
  disabled?: boolean
  /** Key of the row to focus when it mounts (a freshly added line). */
  focusKey: string | null
  onPatch: (key: string, patch: Partial<LineDraft>) => void
  onPickItem: (key: string, row: ItemSearchRow) => void
  onClearItem: (key: string) => void
  onWarehouseChange: (key: string, id: number | null) => void
  onRemove: (key: string) => void
  onAddLine: () => void
  onAddMultiple: () => void
  onPasteExcel: () => void
  onScanBarcode: () => void
  onBulkDirection: (direction: 'in' | 'out') => void
  onBulkWarehouse: () => void
  onClearEmpty: () => void
}

/**
 * The grid.
 *
 * Dense on purpose — this is the part of the screen an operator lives in — but
 * every control is a real form control with a label, so it is as usable from the
 * keyboard as it is from the mouse.
 */
export function StockJournalLinesCard(props: StockJournalLinesCardProps) {
  const {
    lines,
    warehouses,
    availability,
    checking,
    errors,
    warnings,
    columns,
    onColumnsChange,
    disabled,
    focusKey,
    onPatch,
    onPickItem,
    onClearItem,
    onWarehouseChange,
    onRemove,
    onAddLine,
    onAddMultiple,
    onPasteExcel,
    onScanBarcode,
    onBulkDirection,
    onBulkWarehouse,
    onClearEmpty,
  } = props

  const [columnsOpen, setColumnsOpen] = useState(false)
  const columnsRef = useRef<HTMLDivElement>(null)
  const totals = journalTotals(lines)

  // A popover that only closes through its own Done button is a popover that
  // gets left open over the first row of the grid.
  useEffect(() => {
    if (!columnsOpen) return undefined
    const onPointerDown = (e: MouseEvent) => {
      if (columnsRef.current && e.target instanceof Node && !columnsRef.current.contains(e.target)) setColumnsOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setColumnsOpen(false)
    }
    document.addEventListener('mousedown', onPointerDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onPointerDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [columnsOpen])

  // Serial numbers are unique across the whole document, so each row must know
  // what the others already claimed.
  const usedSerialsByLine = new Map<string, Set<number>>()
  const allSerials = lines.flatMap((l) => l.serials.map((s) => ({ key: l.key, id: s.serial_id })))
  for (const line of lines) {
    usedSerialsByLine.set(line.key, new Set(allSerials.filter((s) => s.key !== line.key).map((s) => s.id)))
  }

  return (
    <Card padding="lg">
      <div className="mb-3 flex flex-wrap items-start justify-between gap-3 border-b border-gray-100 pb-3">
        <div className="min-w-0">
          <h3 className="text-sm font-semibold text-gray-900">Stock Journal Lines</h3>
          <p className="mt-0.5 text-xs text-gray-500">
            Add items to adjust stock. You can select batches, serials and specify rates.
          </p>
        </div>
        <div className="relative flex shrink-0 items-center gap-2" ref={columnsRef}>
          <Button
            variant="secondary"
            icon={Columns3}
            aria-expanded={columnsOpen}
            onClick={() => setColumnsOpen((o) => !o)}
          >
            Column Settings
          </Button>
          <MenuButton
            variant="secondary"
            size="sm"
            label="Bulk actions"
            actions={[
              { key: 'in', label: 'Set every line to In', onSelect: () => onBulkDirection('in') },
              { key: 'out', label: 'Set every line to Out', onSelect: () => onBulkDirection('out') },
              { key: 'wh', label: 'Apply the default warehouse to all', onSelect: onBulkWarehouse },
              { key: 'clear', label: 'Remove empty lines', onSelect: onClearEmpty, separated: true },
            ]}
          >
            Bulk Actions
          </MenuButton>

          {columnsOpen ? (
            <div
              className="absolute right-0 top-full z-40 mt-1 w-60 rounded-lg border border-gray-200 bg-white p-2 shadow-overlay"
              role="group"
              aria-label="Column settings"
            >
              <p className="px-1 pb-1.5 text-[11px] font-semibold uppercase tracking-wide text-gray-400">Show columns</p>
              {OPTIONAL_COLUMNS.map((col) => (
                <label key={col.key} className="flex cursor-pointer items-start gap-2 rounded-md px-1 py-1 hover:bg-gray-50">
                  <input
                    type="checkbox"
                    className="mt-0.5"
                    checked={columns[col.key]}
                    onChange={(e) => onColumnsChange({ ...columns, [col.key as OptionalColumn]: e.target.checked })}
                  />
                  <span className="min-w-0">
                    <span className="block text-xs font-medium text-gray-800">{col.label}</span>
                    <span className="block text-[10px] leading-tight text-gray-500">{col.hint}</span>
                  </span>
                </label>
              ))}
              <div className="mt-1 border-t border-gray-100 pt-1.5 text-right">
                <Button size="xs" variant="ghost" onClick={() => setColumnsOpen(false)}>
                  Done
                </Button>
              </div>
            </div>
          ) : null}
        </div>
      </div>

      {lines.length === 0 ? (
        <EmptyState
          icon={LayoutGrid}
          title="No stock journal lines yet."
          description="Search an item, scan a barcode, paste from Excel or use the AI Assistant."
          action={
            <div className="flex flex-wrap items-center justify-center gap-2">
              <Button icon={Plus} onClick={onAddLine} disabled={disabled}>
                Add Item
              </Button>
              <Button variant="secondary" icon={ScanBarcode} onClick={onScanBarcode} disabled={disabled}>
                Scan Barcode
              </Button>
              <Button variant="secondary" icon={ClipboardPaste} onClick={onPasteExcel} disabled={disabled}>
                Paste from Excel
              </Button>
            </div>
          }
        />
      ) : (
        <div className={cx(AIC, 'overflow-x-auto rounded-xl border border-gray-200')}>
          <table className="w-full min-w-[68rem] border-collapse text-xs">
            <thead>
              <tr className="border-b border-gray-200 bg-gray-50 text-left">
                <th scope="col" className="w-10 px-2 py-2 text-center text-[10px] font-bold uppercase tracking-wide text-gray-500">#</th>
                <th scope="col" className="px-2 py-2 text-[10px] font-bold uppercase tracking-wide text-gray-500">
                  Item <span className="text-red-500">*</span>
                </th>
                <th scope="col" className="px-2 py-2 text-[10px] font-bold uppercase tracking-wide text-gray-500">
                  Warehouse <span className="text-red-500">*</span>
                </th>
                {columns.batch ? <th scope="col" className="px-2 py-2 text-[10px] font-bold uppercase tracking-wide text-gray-500">Batch / Serial</th> : null}
                {columns.unit ? <th scope="col" className="px-2 py-2 text-[10px] font-bold uppercase tracking-wide text-gray-500">Unit</th> : null}
                <th scope="col" className="px-2 py-2 text-[10px] font-bold uppercase tracking-wide text-gray-500">
                  Direction <span className="text-red-500">*</span>
                </th>
                <th scope="col" className="px-2 py-2 text-right text-[10px] font-bold uppercase tracking-wide text-gray-500">
                  Qty <span className="text-red-500">*</span>
                </th>
                {columns.rate ? <th scope="col" className="px-2 py-2 text-right text-[10px] font-bold uppercase tracking-wide text-gray-500">Rate</th> : null}
                {columns.amount ? <th scope="col" className="px-2 py-2 text-right text-[10px] font-bold uppercase tracking-wide text-gray-500">Amount</th> : null}
                {columns.remarks ? <th scope="col" className="px-2 py-2 text-[10px] font-bold uppercase tracking-wide text-gray-500">Remarks</th> : null}
                {columns.availability ? <th scope="col" className="px-2 py-2 text-[10px] font-bold uppercase tracking-wide text-gray-500">Availability</th> : null}
                <th scope="col" className="w-10 px-2 py-2">
                  <span className="sr-only">Delete</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {lines.map((line, i) => (
                <StockJournalRow
                  key={line.key}
                  line={line}
                  index={i}
                  columns={columns}
                  warehouses={warehouses}
                  availability={availability[line.key]}
                  checking={checking}
                  errors={errorsForLine(errors, line.key)}
                  warnings={warningsForLine(warnings, line.key)}
                  usedSerialIds={usedSerialsByLine.get(line.key) ?? new Set()}
                  disabled={disabled}
                  autoFocus={focusKey === line.key}
                  onPatch={(patch) => onPatch(line.key, patch)}
                  onPickItem={(row) => onPickItem(line.key, row)}
                  onClearItem={() => onClearItem(line.key)}
                  onWarehouseChange={(id) => onWarehouseChange(line.key, id)}
                  onRemove={() => onRemove(line.key)}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="outline" icon={Plus} kbd="Alt N" onClick={onAddLine} disabled={disabled} title="Add line (Alt+N)">
            Add Line
          </Button>
          <Button variant="secondary" icon={Table2} onClick={onAddMultiple} disabled={disabled}>
            Add Multiple Items
          </Button>
          <Button variant="secondary" icon={ClipboardPaste} onClick={onPasteExcel} disabled={disabled}>
            Paste from Excel
          </Button>
        </div>

        <dl className="flex flex-wrap items-center gap-x-5 gap-y-1 text-xs text-gray-500" aria-live="polite">
          <div className="flex items-center gap-1.5">
            <dt>Lines</dt>
            <dd className="font-semibold tabular-nums text-gray-900">{totals.lines}</dd>
          </div>
          <div className="flex items-center gap-1.5">
            <dt>Total In</dt>
            <dd className="font-semibold tabular-nums text-emerald-700">{formatQty(totals.qtyIn, '0')}</dd>
          </div>
          <div className="flex items-center gap-1.5">
            <dt>Total Out</dt>
            <dd className="font-semibold tabular-nums text-red-600">{formatQty(totals.qtyOut, '0')}</dd>
          </div>
          <div className="flex items-center gap-1.5">
            <dt>Net</dt>
            <dd className="font-semibold tabular-nums text-gray-900">{formatQty(totals.netQty, '0')}</dd>
          </div>
        </dl>
      </div>
    </Card>
  )
}
