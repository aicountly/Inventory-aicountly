import { useRef, useState } from 'react'
import { AlertTriangle, CheckCircle2, CircleSlash, Upload } from 'lucide-react'
import { Modal } from '../../components/Modal'
import { Notice } from '../../components/Notice'
import { isApiError } from '../../services/api'
import { lookupApi } from '../../services/lookupApi'
import type { ItemSearchRow } from '../../services/lookupApi'
import { Button } from '../../ui/Button'
import { Textarea } from '../../ui/Textarea'
import { cx } from '../../ui/cx'
import { formatQty } from '../../utils/format'
import { parseImportText } from './templates'
import type { ImportedRow } from './templates'

export interface ResolvedImportRow extends ImportedRow {
  status: 'ready' | 'ambiguous' | 'missing'
  item: ItemSearchRow | null
  note: string
}

export interface ImportDialogProps {
  open: boolean
  onClose: () => void
  warehouseId: number | null
  onApply: (rows: ResolvedImportRow[]) => void
}

/**
 * Import component lines from a spreadsheet.
 *
 * One column is required — the item's barcode, SKU or code — with quantity optional in the
 * second. Every code is resolved against the LIVE item master (`by-barcode`, falling back to
 * `items/search`); nothing is created, and a code that matches nothing or matches several items
 * is reported as such rather than guessed at. Only the rows marked ready are added.
 */
export function ImportDialog({ open, onClose, warehouseId, onApply }: ImportDialogProps) {
  const [text, setText] = useState('')
  const [rows, setRows] = useState<ResolvedImportRow[] | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  const reset = () => {
    setText('')
    setRows(null)
    setError(null)
  }

  const readFile = async (file: File) => {
    try {
      const content = await file.text()
      setText(content)
      setRows(null)
    } catch {
      setError('Could not read that file.')
    }
  }

  const resolve = async () => {
    const parsed = parseImportText(text)
    if (parsed.length === 0) {
      setError('Nothing to import — paste at least one row of item code and quantity.')
      return
    }
    setBusy(true)
    setError(null)
    const out: ResolvedImportRow[] = []
    for (const row of parsed) {
      try {
        const item = await lookupApi.byBarcode(row.code, { warehouseId })
        out.push({ ...row, status: 'ready', item, note: item.item_name })
        continue
      } catch (err) {
        if (!isApiError(err) || err.status !== 404) {
          out.push({ ...row, status: 'missing', item: null, note: 'Lookup failed' })
          continue
        }
      }
      try {
        const found = await lookupApi.searchItems(row.code, { warehouseId, limit: 5 })
        const exact = found.filter(
          (i) => (i.item_sku ?? '').toLowerCase() === row.code.toLowerCase() || (i.item_upc ?? '').toLowerCase() === row.code.toLowerCase(),
        )
        if (exact.length === 1) out.push({ ...row, status: 'ready', item: exact[0], note: exact[0].item_name })
        else if (found.length === 1) out.push({ ...row, status: 'ready', item: found[0], note: found[0].item_name })
        else if (found.length > 1) out.push({ ...row, status: 'ambiguous', item: null, note: `${found.length} items match this code` })
        else out.push({ ...row, status: 'missing', item: null, note: 'No item with that code' })
      } catch {
        out.push({ ...row, status: 'missing', item: null, note: 'Lookup failed' })
      }
    }
    setRows(out)
    setBusy(false)
  }

  const ready = rows?.filter((r) => r.status === 'ready') ?? []

  return (
    <Modal
      open={open}
      title="Import components"
      description="One row per component: item code, quantity. Tab, comma or semicolon separated — paste straight from a spreadsheet."
      onClose={() => {
        reset()
        onClose()
      }}
      size="lg"
      busy={busy}
      footer={
        <>
          <Button
            variant="secondary"
            onClick={() => {
              reset()
              onClose()
            }}
            disabled={busy}
          >
            Cancel
          </Button>
          {rows === null ? (
            <Button onClick={() => void resolve()} loading={busy} disabled={!text.trim()}>
              Check items
            </Button>
          ) : (
            <Button
              onClick={() => {
                onApply(ready)
                reset()
                onClose()
              }}
              disabled={ready.length === 0}
            >
              Add {ready.length} component{ready.length === 1 ? '' : 's'}
            </Button>
          )}
        </>
      }
    >
      {error ? <Notice kind="error">{error}</Notice> : null}

      {rows === null ? (
        <>
          <div className="mb-2 flex flex-wrap items-center gap-2">
            <Button
              variant="secondary"
              size="xs"
              icon={Upload}
              onClick={() => fileRef.current?.click()}
            >
              Choose a CSV file
            </Button>
            <span className="text-[11px] text-gray-500">or paste below</span>
            <input
              ref={fileRef}
              type="file"
              accept=".csv,.tsv,.txt,text/csv,text/plain"
              className="sr-only"
              onChange={(e) => {
                const file = e.target.files?.[0]
                if (file) void readFile(file)
                e.target.value = ''
              }}
            />
          </div>
          <Textarea
            rows={8}
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder={'MB-001,1\nDP-001,1\nKB-001,2'}
            aria-label="Component rows to import"
            monospace
          />
        </>
      ) : (
        <div className="overflow-hidden rounded-lg border border-gray-200">
          <table className="w-full text-[12px]">
            <thead>
              <tr className="bg-gray-50 text-left text-[10px] font-semibold uppercase tracking-wide text-gray-500">
                <th className="px-3 py-1.5">Code</th>
                <th className="px-3 py-1.5">Resolved item</th>
                <th className="px-3 py-1.5 text-right">Qty</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={`${row.line}-${row.code}`} className="border-t border-gray-100">
                  <td className="px-3 py-1.5 font-mono text-gray-700">{row.code}</td>
                  <td className="px-3 py-1.5">
                    <span
                      className={cx(
                        'inline-flex items-center gap-1',
                        row.status === 'ready' ? 'text-emerald-700' : row.status === 'ambiguous' ? 'text-amber-700' : 'text-red-600',
                      )}
                    >
                      {row.status === 'ready' ? (
                        <CheckCircle2 className="h-3.5 w-3.5" aria-hidden />
                      ) : row.status === 'ambiguous' ? (
                        <AlertTriangle className="h-3.5 w-3.5" aria-hidden />
                      ) : (
                        <CircleSlash className="h-3.5 w-3.5" aria-hidden />
                      )}
                      {row.note}
                    </span>
                  </td>
                  <td className="px-3 py-1.5 text-right tabular-nums">{row.qty === null ? '1' : formatQty(row.qty)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Modal>
  )
}
