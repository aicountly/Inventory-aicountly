import { useState } from 'react'
import { CheckCircle2, ClipboardList, Download, Loader2, Upload, XCircle } from 'lucide-react'
import { Modal } from '../../components/Modal'
import { errorMessage } from '../../services/api'
import { lookupApi } from '../../services/lookupApi'
import type { ItemSearchRow } from '../../services/lookupApi'
import { Button } from '../../ui/Button'
import { Textarea } from '../../ui/Textarea'
import { cx } from '../../ui/cx'
import { downloadCsv } from '../../utils/csv'
import { toNumber } from '../../utils/format'
import { parseBulkRows } from './receiptSources'
import type { BulkRow } from './receiptSources'

export interface ResolvedBulkLine {
  item: ItemSearchRow
  qty: string
  rate: string
  batchNo: string
}

export interface BulkAddDialogProps {
  open: boolean
  onClose: () => void
  warehouseId: number | null
  onAdd: (lines: ResolvedBulkLine[]) => void
}

interface Preview extends BulkRow {
  status: 'ok' | 'not_found' | 'ambiguous' | 'bad_qty' | 'blank'
  item: ItemSearchRow | null
  message: string
}

const SAMPLE = 'SKU / barcode,Qty,Rate,Batch\nCEM-001,100,420,B00124\nSTL-012,500,62.50,LOT-8876'

/**
 * Add many lines at once: paste the delivery note, or open the CSV the supplier
 * sent.
 *
 * Every code is resolved against this company's own item master before
 * anything reaches the grid, and the result of each row is shown — matched,
 * not found, or ambiguous — so nothing is added on a guess. Rows that did not
 * resolve stay in the list with the reason instead of disappearing.
 *
 * `SKU / barcode, qty, rate, batch`, with or without a header row, comma or tab
 * separated, which covers a spreadsheet export and a block copied out of one.
 */
export function BulkAddDialog({ open, onClose, warehouseId, onAdd }: BulkAddDialogProps) {
  const [text, setText] = useState('')
  const [rows, setRows] = useState<Preview[] | null>(null)
  const [checking, setChecking] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const reset = () => {
    setText('')
    setRows(null)
    setError(null)
  }

  const close = () => {
    reset()
    onClose()
  }

  const readFile = async (file: File) => {
    setError(null)
    try {
      const content = await file.text()
      setText(content)
      setRows(null)
    } catch {
      setError('That file could not be read.')
    }
  }

  const check = async () => {
    const parsed = parseBulkRows(text)
    if (parsed.length === 0) {
      setError('Nothing to add — paste at least one line.')
      return
    }
    setError(null)
    setChecking(true)
    try {
      const out: Preview[] = []
      for (const row of parsed) {
        if (!row.code) {
          out.push({ ...row, status: 'blank', item: null, message: 'No item code on this line.' })
          continue
        }
        const qty = toNumber(row.qty)
        let item = await lookupApi.itemByBarcode(row.code, { warehouseId })
        let status: Preview['status'] = 'ok'
        let message = ''
        if (!item) {
          const found = await lookupApi.searchItems(row.code, { warehouseId, limit: 5 })
          if (found.length === 1) item = found[0]
          else if (found.length > 1) {
            status = 'ambiguous'
            message = `${found.length} items match “${row.code}”. Use the exact SKU or barcode.`
          } else {
            status = 'not_found'
            message = `No item found for “${row.code}”.`
          }
        }
        if (item && (qty === null || qty <= 0)) {
          status = 'bad_qty'
          message = 'Quantity must be more than zero.'
        }
        out.push({ ...row, status, item, message: message || (item ? (item.print_name || item.item_name) : '') })
      }
      setRows(out)
    } catch (err) {
      setError(errorMessage(err, 'Could not check those lines.'))
    } finally {
      setChecking(false)
    }
  }

  const usable = (rows ?? []).filter((r) => r.status === 'ok' && r.item)

  const add = () => {
    onAdd(
      usable.map((r) => ({
        item: r.item as ItemSearchRow,
        qty: r.qty,
        rate: r.rate,
        batchNo: r.batch,
      })),
    )
    close()
  }

  return (
    <Modal
      open={open}
      title="Add multiple items"
      description="Paste the delivery note or open a CSV. Every code is checked against the item master before it is added."
      onClose={close}
      size="lg"
      busy={checking}
      footer={
        <>
          <Button variant="secondary" onClick={close} disabled={checking}>
            Cancel
          </Button>
          {rows === null ? (
            <Button onClick={() => void check()} loading={checking} disabled={!text.trim()}>
              Check lines
            </Button>
          ) : (
            <Button onClick={add} disabled={usable.length === 0}>
              Add {usable.length} line{usable.length === 1 ? '' : 's'}
            </Button>
          )}
        </>
      }
    >
      {rows === null ? (
        <div className="space-y-2">
          <label htmlFor="mr_bulk_text" className="block text-[11px] font-semibold uppercase tracking-wide text-gray-500">
            SKU or barcode, quantity, rate, batch — one item per line
          </label>
          <Textarea
            id="mr_bulk_text"
            rows={8}
            monospace
            value={text}
            placeholder={SAMPLE}
            onChange={(e) => setText(e.target.value)}
          />
          <div className="flex flex-wrap items-center gap-2">
            <label className="inline-flex">
              <input
                type="file"
                accept=".csv,.txt,.tsv,text/csv,text/plain"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0]
                  if (file) void readFile(file)
                  e.target.value = ''
                }}
              />
              <span className="inline-flex items-center gap-1.5 h-8 px-3 rounded-lg border border-gray-200 bg-white text-sm font-medium text-gray-700 cursor-pointer hover:border-primary/40 hover:bg-primary-light hover:text-primary transition-colors">
                <Upload className="w-4 h-4" aria-hidden />
                Open CSV
              </span>
            </label>
            <Button
              variant="ghost"
              size="sm"
              icon={Download}
              onClick={() =>
                downloadCsv('material-receipt-lines-template.csv', 'SKU / barcode,Qty,Rate,Batch\r\nCEM-001,100,420,B00124\r\n')
              }
            >
              Template
            </Button>
          </div>
          {error ? <p className="text-xs font-medium text-red-600 m-0">{error}</p> : null}
        </div>
      ) : (
        <div className="space-y-2">
          <p className="text-xs text-gray-600 m-0">
            {usable.length} of {rows.length} line{rows.length === 1 ? '' : 's'} can be added.
          </p>
          <ul className="space-y-1 list-none p-0 m-0 max-h-80 overflow-y-auto">
            {rows.map((row) => (
              <li
                key={`${row.sourceRow}-${row.code}`}
                className={cx(
                  'flex items-start gap-2 rounded-lg px-2.5 py-1.5 text-xs',
                  row.status === 'ok' ? 'bg-emerald-50 text-emerald-800' : 'bg-red-50 text-red-700',
                )}
              >
                {row.status === 'ok' ? (
                  <CheckCircle2 className="w-3.5 h-3.5 mt-0.5 shrink-0" aria-hidden />
                ) : (
                  <XCircle className="w-3.5 h-3.5 mt-0.5 shrink-0" aria-hidden />
                )}
                <span className="min-w-0">
                  <span className="font-medium">Line {row.sourceRow}</span>
                  <span className="font-mono"> · {row.code || '—'}</span>
                  {row.qty ? <span> · {row.qty}</span> : null}
                  <span className="block truncate">{row.message}</span>
                </span>
              </li>
            ))}
          </ul>
          <Button variant="ghost" size="sm" icon={ClipboardList} onClick={() => setRows(null)}>
            Edit the list
          </Button>
        </div>
      )}
      {checking ? (
        <p className="mt-2 text-[11px] text-gray-500 inline-flex items-center gap-1.5">
          <Loader2 className="w-3 h-3 animate-spin" aria-hidden /> Checking each code against the item master…
        </p>
      ) : null}
    </Modal>
  )
}

export default BulkAddDialog
