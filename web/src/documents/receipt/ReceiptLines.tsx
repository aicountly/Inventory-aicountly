import { useEffect, useRef } from 'react'
import { useMediaQuery } from '../../hooks/useMediaQuery'
import { Boxes, ClipboardList, FileInput, PackagePlus, Plus, ScanLine } from 'lucide-react'
import type { FormOptionWarehouse } from '../../services/items'
import type { ItemSearchRow } from '../../services/lookupApi'
import { Button } from '../../ui/Button'
import { EmptyState } from '../../ui/EmptyState'
import { Tooltip } from '../../ui/Tooltip'
import { FormSectionCard } from '../../ui/shell/FormSectionCard'
import { formatMoney, formatQty } from '../../utils/format'
import type { LineDraft } from '../formModel'
import { ReceiptLineCard, ReceiptLineRow } from './ReceiptLine'
import { issuesByField } from './receiptModel'
import type { LineIssue, ReceiptTotals } from './receiptModel'

export interface ReceiptLinesProps {
  lines: LineDraft[]
  issues: LineIssue[]
  warehouses: FormOptionWarehouse[]
  headerWarehouseId: number | null
  disabled?: boolean
  totals: ReceiptTotals
  currency: string
  /** Item search of the line with this key takes focus (a row just added). */
  focusKey: string | null
  /** Bumped by the parent so asking for the same row twice focuses twice. */
  focusNonce: number
  onPatchLine: (key: string, patch: Partial<LineDraft>) => void
  onPickItem: (key: string, item: ItemSearchRow) => void
  onClearItem: (key: string) => void
  onRemoveLine: (key: string) => void
  onDuplicateLine: (key: string) => void
  onAddLine: () => void
  onClearAll: () => void
  onScan: () => void
  onBulkAdd: () => void
  onAddFromPo: () => void
  poReason: string | null
}

const HEAD = 'px-2 py-2 text-left text-[11px] font-semibold uppercase tracking-wide text-gray-500 whitespace-nowrap'

/**
 * The goods themselves.
 *
 * A real grid on a desktop — ten columns, horizontally scrollable rather than
 * crushed — and a stack of cards on a phone, because the same ten columns at
 * 390px is a row nobody can read or tap. Both render the identical controls
 * (ReceiptLine.tsx), so a line behaves the same wherever it is edited.
 */
export function ReceiptLines(props: ReceiptLinesProps) {
  const {
    lines,
    issues,
    warehouses,
    headerWarehouseId,
    disabled,
    totals,
    currency,
    focusKey,
    focusNonce,
    onPatchLine,
    onPickItem,
    onClearItem,
    onRemoveLine,
    onDuplicateLine,
    onAddLine,
    onClearAll,
    onScan,
    onBulkAdd,
    onAddFromPo,
    poReason,
  } = props

  // `lg` in the Tailwind scale. One tree or the other, never both: a hidden
  // copy of every row would mount a second typeahead and a second batch picker
  // per line, and make their requests twice.
  const wide = useMediaQuery('(min-width: 1024px)', true)
  const focusRef = useRef<HTMLInputElement | null>(null)
  useEffect(() => {
    if (!focusKey) return
    // The row mounts in the same commit; focus once it is in the document.
    const id = window.setTimeout(() => focusRef.current?.focus(), 0)
    return () => window.clearTimeout(id)
  }, [focusKey, focusNonce])

  const lineProps = (line: LineDraft, index: number) => ({
    line,
    row: index + 1,
    issues: issuesByField(issues, line.key),
    warehouses,
    headerWarehouseId,
    disabled,
    onPatch: (patch: Partial<LineDraft>) => onPatchLine(line.key, patch),
    onPickItem: (item: ItemSearchRow) => onPickItem(line.key, item),
    onClearItem: () => onClearItem(line.key),
    onRemove: () => onRemoveLine(line.key),
    onDuplicate: () => onDuplicateLine(line.key),
    // Enter on the last field of the LAST row starts the next one. Pressing it
    // halfway up the grid must not append a row at the bottom and jump there.
    onAdvance: () => {
      if (index === lines.length - 1) onAddLine()
    },
    itemInputRef: line.key === focusKey ? focusRef : undefined,
  })

  const addFromPo = (
    <Button variant="secondary" size="sm" icon={FileInput} onClick={onAddFromPo} disabled={disabled || Boolean(poReason)}>
      Add from PO
    </Button>
  )

  return (
    <FormSectionCard
      title="Items received"
      description="What physically arrived, and what it cost."
      icon={PackagePlus}
      action={
        <div className="flex items-center flex-wrap gap-2">
          <Button variant="secondary" size="sm" icon={ClipboardList} onClick={onBulkAdd} disabled={disabled}>
            Add multiple
          </Button>
          <Button variant="secondary" size="sm" icon={ScanLine} onClick={onScan} disabled={disabled}>
            Scan barcode
          </Button>
          <Button size="sm" icon={Plus} onClick={onAddLine} disabled={disabled} kbd="Alt A">
            Add item
          </Button>
        </div>
      }
      bodyClassName="space-y-3"
    >
      {lines.length === 0 ? (
        <EmptyState
          icon={Boxes}
          size="sm"
          title="No items on this receipt yet"
          description="Add a line by hand, scan the carton, or paste the delivery note in with Add multiple."
          action={
            <div className="flex items-center gap-2">
              <Button size="sm" icon={Plus} onClick={onAddLine} disabled={disabled}>
                Add item
              </Button>
              <Button variant="secondary" size="sm" icon={ScanLine} onClick={onScan} disabled={disabled}>
                Scan barcode
              </Button>
            </div>
          }
        />
      ) : (
        wide ? (
          <div className="overflow-x-auto rounded-xl border border-gray-200">
            <table className="w-full min-w-[68rem] border-collapse">
              <thead>
                <tr className="bg-gray-50 border-b border-gray-200">
                  <th scope="col" className={`${HEAD} w-12`}>#</th>
                  <th scope="col" className={HEAD}>Item</th>
                  <th scope="col" className={HEAD}>Warehouse</th>
                  <th scope="col" className={HEAD}>Batch / lot</th>
                  <th scope="col" className={HEAD}>Unit</th>
                  <th scope="col" className={`${HEAD} text-right`}>Qty</th>
                  <th scope="col" className={`${HEAD} text-right`}>Rate ({currency})</th>
                  <th scope="col" className={`${HEAD} text-right`}>Amount ({currency})</th>
                  <th scope="col" className={HEAD}>Serials</th>
                  <th scope="col" className={HEAD}>Expiry</th>
                  <th scope="col" className={`${HEAD} text-right`}>
                    <span className="sr-only">Row actions</span>
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {lines.map((line, i) => (
                  <ReceiptLineRow key={line.key} {...lineProps(line, i)} />
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="space-y-2">
            {lines.map((line, i) => (
              <ReceiptLineCard key={line.key} {...lineProps(line, i)} />
            ))}
          </div>
        )
      )}

      <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
        <div className="flex items-center flex-wrap gap-2">
          <Button variant="secondary" size="sm" icon={Plus} onClick={onAddLine} disabled={disabled}>
            Add item
          </Button>
          {poReason ? <Tooltip label={poReason}>{addFromPo}</Tooltip> : addFromPo}
        </div>
        <div className="flex items-center flex-wrap gap-3 text-xs text-gray-500">
          <span>
            Lines <strong className="text-gray-900 tabular-nums">{totals.lines}</strong>
          </span>
          <span>
            Quantity <strong className="text-gray-900 tabular-nums">{formatQty(totals.quantity, '0')}</strong>
          </span>
          <span>
            Amount <strong className="text-gray-900 tabular-nums">{formatMoney(totals.amount, '0.00')}</strong>
          </span>
          {lines.length > 0 ? (
            <Button variant="ghost" size="xs" onClick={onClearAll} disabled={disabled} className="text-red-600 hover:bg-red-50">
              Clear all
            </Button>
          ) : null}
        </div>
      </div>
    </FormSectionCard>
  )
}

export default ReceiptLines
