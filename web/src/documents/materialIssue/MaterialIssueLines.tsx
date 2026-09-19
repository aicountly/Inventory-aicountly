import { useCallback, useRef, useState } from 'react'
import { FileSpreadsheet, ListPlus, ScanLine } from 'lucide-react'
import { ConfirmDialog } from '../../components/ConfirmDialog'
import type { FormOptionWarehouse } from '../../services/items'
import type { ItemSearchRow } from '../../services/lookupApi'
import type { AvailabilityCheckResult } from '../../services/stockApi'
import { Button } from '../../ui'
import { AIC, cx } from '../../ui/cx'
import { formatQty } from '../../utils/format'
import { LineItemPicker } from '../LineItemPicker'
import { isBlankLine } from '../formModel'
import type { HeaderDraft, LineDraft } from '../formModel'
import { MaterialIssueLineRow } from './MaterialIssueLineRow'

export interface MaterialIssueLinesProps {
  header: HeaderDraft
  lines: LineDraft[]
  warehouses: FormOptionWarehouse[]
  availability: Record<string, AvailabilityCheckResult>
  checking: boolean
  offendingKeys: ReadonlySet<string>
  /** Per-line validation messages, keyed by line key. */
  lineErrors: Record<string, string>
  disabled?: boolean
  /** Builds a fresh line carrying the header's defaults. */
  makeLine: (partial?: Partial<LineDraft>) => LineDraft
  /** Applies a picked search row onto a line (units, tracking flags, warehouse). */
  applyPick: (line: LineDraft, row: ItemSearchRow) => Partial<LineDraft>
  onChange: (lines: LineDraft[]) => void
  onAddMultiple: () => void
  onScan: () => void
  onImport: () => void
}

const HEAD = 'px-2 py-2.5 text-left text-[10px] font-bold uppercase tracking-wider text-gray-500'

/** Enough entered that losing it to a stray click would be a real loss. */
function carriesWork(line: LineDraft): boolean {
  return !isBlankLine(line) || line.description.trim() !== '' || line.serials.length > 0
}

export function MaterialIssueLines({
  header,
  lines,
  warehouses,
  availability,
  checking,
  offendingKeys,
  lineErrors,
  disabled = false,
  makeLine,
  applyPick,
  onChange,
  onAddMultiple,
  onScan,
  onImport,
}: MaterialIssueLinesProps) {
  const bodyRef = useRef<HTMLTableSectionElement>(null)
  const [focusKey, setFocusKey] = useState<string | null>(null)
  const [pendingRemoval, setPendingRemoval] = useState<LineDraft | null>(null)

  const update = (key: string, patch: Partial<LineDraft>) => onChange(lines.map((l) => (l.key === key ? { ...l, ...patch } : l)))

  const appendLines = useCallback(
    (count: number) => {
      const fresh = Array.from({ length: count }, () => makeLine())
      onChange([...lines, ...fresh])
      setFocusKey(fresh[0]?.key ?? null)
    },
    [lines, makeLine, onChange],
  )

  const removeLine = (line: LineDraft) => onChange(lines.filter((l) => l.key !== line.key))

  const requestRemove = (line: LineDraft) => {
    if (carriesWork(line)) setPendingRemoval(line)
    else removeLine(line)
  }

  /**
   * Fast entry: Enter on a quantity moves to the next line — its item box when
   * it is still empty, its quantity when it already has an item — and adds a
   * line when there is no next one. Queried off the DOM rather than held in a
   * ref map because the pickers are shared components with no imperative handle,
   * and a row is addressed here by the key it already carries.
   */
  const jumpFromQty = (index: number) => {
    const next = lines[index + 1]
    if (!next) {
      appendLines(1)
      return
    }
    const row = bodyRef.current?.querySelector<HTMLElement>(`[data-line-key="${next.key}"]`)
    const target =
      row?.querySelector<HTMLInputElement>('input[role="combobox"]') ??
      row?.querySelector<HTMLInputElement>('input[inputmode="decimal"]')
    target?.focus()
    target?.select?.()
  }

  /**
   * Fill the first empty row rather than always appending — a fresh document
   * opens with one, and appending past it leaves a stray blank line 1 above
   * everything the user just entered.
   */
  const addFromSearch = (row: ItemSearchRow) => {
    const at = lines.findIndex(isBlankLine)
    if (at === -1) {
      const base = makeLine()
      onChange([...lines, { ...base, ...applyPick(base, row), qty: '1' }])
      return
    }
    onChange(lines.map((l, i) => (i === at ? { ...l, ...applyPick(l, row), qty: '1' } : l)))
  }

  const activeCount = lines.filter((l) => !isBlankLine(l)).length
  const totalQty = lines.reduce((sum, l) => sum + (Number(l.qty) || 0), 0)

  return (
    <section className={cx(AIC, 'rounded-xl border border-gray-200 bg-white shadow-card')}>
      <div className="flex flex-col gap-3 border-b border-gray-100 p-4 md:flex-row md:items-center md:justify-between">
        <div className="min-w-0">
          <h3 className="text-sm font-semibold text-gray-900">Item lines</h3>
          <p className="mt-0.5 text-xs text-gray-500">Add items to be issued from inventory</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="secondary" icon={ListPlus} onClick={onAddMultiple} disabled={disabled}>
            Add multiple
          </Button>
          <Button variant="secondary" icon={ScanLine} onClick={onScan} disabled={disabled}>
            Scan barcode
          </Button>
          <Button variant="secondary" icon={FileSpreadsheet} onClick={onImport} disabled={disabled}>
            Import
          </Button>
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full min-w-[68rem] border-collapse">
          <thead>
            <tr className="border-b border-gray-200 bg-gray-50/80">
              <th scope="col" className={cx(HEAD, 'text-center')}>
                #
              </th>
              <th scope="col" className={HEAD}>
                Item / SKU
              </th>
              <th scope="col" className={HEAD}>
                Warehouse
              </th>
              <th scope="col" className={HEAD}>
                Batch
              </th>
              <th scope="col" className={HEAD}>
                Serials
              </th>
              <th scope="col" className={HEAD}>
                Qty
              </th>
              <th scope="col" className={HEAD}>
                Unit
              </th>
              <th scope="col" className={HEAD}>
                Available
              </th>
              <th scope="col" className={HEAD}>
                Remarks
              </th>
              <th scope="col" className={cx(HEAD, 'text-center')}>
                <span className="sr-only">Actions</span>
              </th>
            </tr>
          </thead>
          <tbody ref={bodyRef}>
            {lines.length === 0 ? (
              <tr>
                <td colSpan={10} className="px-4 py-10 text-center text-sm text-gray-500">
                  No lines yet. Search below, scan a barcode, or add several items at once.
                </td>
              </tr>
            ) : (
              lines.map((line, index) => (
                <MaterialIssueLineRow
                  key={line.key}
                  line={line}
                  index={index}
                  defaultWarehouseId={header.default_warehouse_id}
                  warehouses={warehouses}
                  availability={availability[line.key]}
                  checking={checking}
                  offending={offendingKeys.has(line.key)}
                  error={lineErrors[line.key]}
                  disabled={disabled}
                  autoFocus={focusKey === line.key}
                  onChange={(patch) => update(line.key, patch)}
                  onPick={(row) => update(line.key, applyPick(line, row))}
                  onClear={() =>
                    update(line.key, {
                      item_id: null,
                      item_name: '',
                      item_sku: null,
                      track_batch: false,
                      track_serial: false,
                      units: [],
                      unit_id: null,
                      batch_id: null,
                      batch_no: null,
                      serials: [],
                    })
                  }
                  onRemove={() => requestRemove(line)}
                  onQtyEnter={() => jumpFromQty(index)}
                />
              ))
            )}
          </tbody>
        </table>
      </div>

      <div className="flex flex-col gap-2 rounded-b-xl border-t border-emerald-100 bg-emerald-50/50 p-3 lg:flex-row lg:items-center">
        <Button variant="outline" onClick={() => appendLines(1)} disabled={disabled} kbd="Alt A">
          + Add new line
        </Button>
        <div className="min-w-0 flex-1">
          {/* Picking here appends a line already filled in — the quickest path
              from "what am I issuing" to a costed line. */}
          <LineItemPicker
            itemId={null}
            itemName=""
            itemSku={null}
            warehouseId={header.default_warehouse_id}
            onPick={addFromSearch}
            onClear={() => {}}
            disabled={disabled}
          />
        </div>
        <div className="flex shrink-0 items-center gap-3">
          <button
            type="button"
            onClick={() => appendLines(5)}
            disabled={disabled}
            className="rounded text-xs font-semibold text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 disabled:opacity-50"
          >
            Add 5 rows
          </button>
          <span className="text-xs text-gray-400" aria-hidden>
            |
          </span>
          <span className="text-xs text-gray-600">
            Lines <strong className="tabular-nums text-gray-900">{activeCount}</strong>
          </span>
          <span className="text-xs text-gray-600">
            Qty <strong className="tabular-nums text-gray-900">{formatQty(totalQty, '0')}</strong>
          </span>
        </div>
      </div>

      <ConfirmDialog
        open={pendingRemoval !== null}
        title="Remove this line?"
        message={
          pendingRemoval
            ? `${pendingRemoval.item_name || 'This line'} and everything entered on it will be removed from the issue.`
            : ''
        }
        confirmLabel="Remove line"
        danger
        onCancel={() => setPendingRemoval(null)}
        onConfirm={() => {
          if (pendingRemoval) removeLine(pendingRemoval)
          setPendingRemoval(null)
        }}
      />
    </section>
  )
}

export default MaterialIssueLines
