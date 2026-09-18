import { useRef, useState } from 'react'
import { AlertTriangle, Download, Upload } from 'lucide-react'
import { Modal } from '../components/Modal'
import { Notice } from '../components/Notice'
import { errorMessage } from '../services/api'
import { lookupApi, pickExactMatch } from '../services/lookupApi'
import type { ItemSearchRow } from '../services/lookupApi'
import { Button } from '../ui/Button'
import { cx } from '../ui/cx'
import { downloadCsv, parseCsv, toCsv } from '../utils/csv'

export interface ImportedLine {
  row: ItemSearchRow
  qty: string
}

interface ImportLinesModalProps {
  open: boolean
  onClose: () => void
  warehouseId: number | null
  onImport: (rows: ImportedLine[]) => void
}

const SKU_HEADERS = ['sku', 'item_sku', 'code', 'barcode', 'item_code']
const QTY_HEADERS = ['qty', 'quantity', 'qty_out', 'write_off_qty']
const MAX_ROWS = 300
const CONCURRENCY = 8

function findColumn(header: string[], candidates: string[]): number {
  const lower = header.map((h) => h.trim().toLowerCase())
  for (const c of candidates) {
    const idx = lower.indexOf(c)
    if (idx !== -1) return idx
  }
  return -1
}

async function resolveInBatches(codes: string[], warehouseId: number | null): Promise<Map<string, ItemSearchRow | null>> {
  const out = new Map<string, ItemSearchRow | null>()
  for (let i = 0; i < codes.length; i += CONCURRENCY) {
    const batch = codes.slice(i, i + CONCURRENCY)
    const results = await Promise.all(
      batch.map(async (code) => {
        try {
          const rows = await lookupApi.searchItems(code, { warehouseId, limit: 5 })
          return pickExactMatch(rows, code) ?? null
        } catch {
          return null
        }
      }),
    )
    batch.forEach((code, i2) => out.set(code, results[i2]))
  }
  return out
}

/**
 * A first, real CSV import: two columns (`sku`, `qty`), each SKU resolved through the same
 * `items/search` the rest of the form uses. There is no server-side import job to hand this off
 * to, so matching happens here, in the browser, before the rows ever become draft lines.
 */
export function ImportLinesModal({ open, onClose, warehouseId, onImport }: ImportLinesModalProps) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [matched, setMatched] = useState<ImportedLine[]>([])
  const [unmatched, setUnmatched] = useState<string[]>([])
  const [fileName, setFileName] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  const reset = () => {
    setError(null)
    setMatched([])
    setUnmatched([])
    setFileName(null)
  }

  const handleFile = async (file: File) => {
    reset()
    setFileName(file.name)
    setBusy(true)
    try {
      const text = await file.text()
      const rows = parseCsv(text)
      if (rows.length === 0) throw new Error('That file has no rows.')
      const header = rows[0]
      const looksLikeHeader = findColumn(header, SKU_HEADERS) !== -1 || findColumn(header, QTY_HEADERS) !== -1
      const skuCol = looksLikeHeader ? findColumn(header, SKU_HEADERS) : 0
      const qtyCol = looksLikeHeader ? findColumn(header, QTY_HEADERS) : 1
      const dataRows = (looksLikeHeader ? rows.slice(1) : rows).slice(0, MAX_ROWS)
      if (skuCol === -1) throw new Error('Could not find a "sku" column. Expected a header like sku,qty.')

      const entries = dataRows.map((r) => ({ sku: (r[skuCol] ?? '').trim(), qty: (r[qtyCol >= 0 ? qtyCol : 1] ?? '1').trim() || '1' })).filter((e) => e.sku)
      const codes = [...new Set(entries.map((e) => e.sku))]
      const resolved = await resolveInBatches(codes, warehouseId)

      const ok: ImportedLine[] = []
      const bad: string[] = []
      for (const entry of entries) {
        const row = resolved.get(entry.sku)
        if (row) ok.push({ row, qty: entry.qty })
        else bad.push(entry.sku)
      }
      setMatched(ok)
      setUnmatched(bad)
    } catch (err) {
      setError(errorMessage(err, 'Could not read that file.'))
    } finally {
      setBusy(false)
    }
  }

  const confirm = () => {
    if (matched.length === 0) return
    onImport(matched)
    onClose()
  }

  const downloadTemplate = () => {
    downloadCsv('write-off-import-template.csv', toCsv([{ sku: 'SKU-0001', qty: 1 }], [{ header: 'sku', value: (r) => r.sku }, { header: 'qty', value: (r) => r.qty }]))
  }

  return (
    <Modal
      open={open}
      title="Import lines from CSV"
      description="Two columns: sku, qty. Each SKU is matched against the item master before anything is added."
      onClose={onClose}
      busy={busy}
      size="md"
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button variant="primary" onClick={confirm} disabled={busy || matched.length === 0}>
            Add {matched.length || ''} matched line{matched.length === 1 ? '' : 's'}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <div className="flex items-center justify-between gap-2 rounded-lg border border-dashed border-gray-300 bg-gray-50/60 px-3 py-3">
          <div className="flex min-w-0 items-center gap-2">
            <Upload className="h-4 w-4 shrink-0 text-gray-400" aria-hidden />
            <span className="truncate text-sm text-gray-600">{fileName ?? 'Choose a .csv file to import'}</span>
          </div>
          <Button variant="secondary" size="sm" onClick={() => inputRef.current?.click()} disabled={busy}>
            Browse
          </Button>
          <input
            ref={inputRef}
            type="file"
            accept=".csv,text/csv"
            className="sr-only"
            onChange={(e) => {
              const file = e.target.files?.[0]
              if (file) void handleFile(file)
              e.target.value = ''
            }}
          />
        </div>
        <button type="button" onClick={downloadTemplate} className="inline-flex w-fit items-center gap-1 text-xs font-medium text-primary hover:underline">
          <Download className="h-3 w-3" aria-hidden />
          Download a template
        </button>

        {error ? <Notice kind="error">{error}</Notice> : null}

        {matched.length > 0 || unmatched.length > 0 ? (
          <div className="flex flex-col gap-2">
            {matched.length > 0 ? (
              <div className="max-h-48 overflow-y-auto rounded-lg border border-gray-200">
                {matched.map((m, i) => (
                  <div key={`${m.row.item_id}-${i}`} className={cx('flex items-center justify-between gap-2 px-3 py-1.5 text-sm', i > 0 && 'border-t border-gray-100')}>
                    <span className="truncate text-gray-800">{m.row.print_name || m.row.item_name}</span>
                    <span className="shrink-0 tabular-nums text-gray-500">qty {m.qty}</span>
                  </div>
                ))}
              </div>
            ) : null}
            {unmatched.length > 0 ? (
              <Notice kind="warning" title={`${unmatched.length} row${unmatched.length === 1 ? '' : 's'} could not be matched`}>
                <span className="inline-flex items-start gap-1.5">
                  <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
                  {unmatched.slice(0, 12).join(', ')}
                  {unmatched.length > 12 ? `, +${unmatched.length - 12} more` : ''}
                </span>
              </Notice>
            ) : null}
          </div>
        ) : null}
      </div>
    </Modal>
  )
}
