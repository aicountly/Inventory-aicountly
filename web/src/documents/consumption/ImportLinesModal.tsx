import { useRef, useState } from 'react'
import { AlertCircle, CheckCircle2, Upload } from 'lucide-react'
import { Modal } from '../../components/Modal'
import { Notice } from '../../components/Notice'
import { Button } from '../../ui/Button'
import { Textarea } from '../../ui/Textarea'
import { lookupApi } from '../../services/lookupApi'
import type { ItemSearchRow } from '../../services/lookupApi'
import type { FormOptionWarehouse } from '../../services/items'
import { formatQty, toNumber } from '../../utils/format'
import { unitOptionsFrom } from '../LineEditor'
import { newLine } from '../formModel'
import type { LineDraft } from '../formModel'
import type { DocumentTypeSpec } from '../registry'

const MAX_IMPORT_ROWS = 200

interface ParsedImportRow {
  rowNumber: number
  itemQuery: string
  warehouseQuery: string
  batchText: string
  qtyText: string
  unitText: string
  remarks: string
}

type ParsedField = Exclude<keyof ParsedImportRow, 'rowNumber'>

const HEADER_ALIASES: Record<string, ParsedField> = {
  item: 'itemQuery',
  sku: 'itemQuery',
  item_code: 'itemQuery',
  itemcode: 'itemQuery',
  code: 'itemQuery',
  barcode: 'itemQuery',
  warehouse: 'warehouseQuery',
  batch: 'batchText',
  'batch no': 'batchText',
  batch_no: 'batchText',
  qty: 'qtyText',
  quantity: 'qtyText',
  unit: 'unitText',
  uom: 'unitText',
  remarks: 'remarks',
  remark: 'remarks',
  notes: 'remarks',
}

function splitDelimited(line: string, delimiter: string): string[] {
  const out: string[] = []
  let cur = ''
  let inQuotes = false
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          cur += '"'
          i++
        } else {
          inQuotes = false
        }
      } else {
        cur += ch
      }
    } else if (ch === '"') {
      inQuotes = true
    } else if (ch === delimiter) {
      out.push(cur.trim())
      cur = ''
    } else {
      cur += ch
    }
  }
  out.push(cur.trim())
  return out
}

export function parseImportText(text: string): { rows: ParsedImportRow[]; error: string | null } {
  const lines = text.split(/\r\n|\n|\r/).filter((l) => l.trim() !== '')
  if (lines.length === 0) return { rows: [], error: 'Paste a header row and at least one item row.' }
  const delimiter = lines[0].includes('\t') ? '\t' : ','
  const header = splitDelimited(lines[0], delimiter).map((h) => h.toLowerCase())
  const fieldForCol = header.map((h) => HEADER_ALIASES[h] ?? null)
  if (!fieldForCol.includes('itemQuery')) {
    return { rows: [], error: 'The first row must be a header with an "Item" (or SKU / code / barcode) column.' }
  }
  const rows: ParsedImportRow[] = []
  for (let i = 1; i < lines.length && rows.length < MAX_IMPORT_ROWS; i++) {
    const cells = splitDelimited(lines[i], delimiter)
    const row: ParsedImportRow = { rowNumber: i + 1, itemQuery: '', warehouseQuery: '', batchText: '', qtyText: '', unitText: '', remarks: '' }
    fieldForCol.forEach((field, idx) => {
      if (field) row[field] = (cells[idx] ?? '').trim()
    })
    if (row.itemQuery) rows.push(row)
  }
  return { rows, error: rows.length === 0 ? 'No item rows found under the header.' : null }
}

interface ImportPreviewRow extends ParsedImportRow {
  status: 'ok' | 'error'
  error?: string
  item?: ItemSearchRow
  warehouseId: number | null
  qty: number | null
  unitId: number | null
}

async function resolveItem(query: string, cache: Map<string, ItemSearchRow | null>): Promise<ItemSearchRow | null> {
  const key = query.trim().toLowerCase()
  if (cache.has(key)) return cache.get(key) ?? null
  const found = await lookupApi.searchItems(query, { limit: 8 }).catch(() => [])
  const exact = found.find((it) => [it.item_sku, it.item_upc].some((v) => (v ?? '').toLowerCase() === key)) ?? (found.length === 1 ? found[0] : null)
  cache.set(key, exact ?? null)
  return exact ?? null
}

interface ImportLinesModalProps {
  open: boolean
  onClose: () => void
  spec: DocumentTypeSpec
  warehouses: FormOptionWarehouse[]
  defaultWarehouseId: number | null
  onInsert: (lines: LineDraft[]) => void
}

/**
 * CSV / TSV / clipboard-paste line import. There is no existing reusable "import a document's
 * lines" component in the app to lean on (only CSV *export* helpers exist), so this is a small,
 * self-contained parser scoped to Consumption's own line shape rather than a new app-wide import
 * framework. Every row is resolved against the real item/warehouse masters and shown for review
 * before anything is added — nothing is inserted silently, and unresolved rows are reported, not dropped quietly.
 */
export function ImportLinesModal({ open, onClose, spec, warehouses, defaultWarehouseId, onInsert }: ImportLinesModalProps) {
  const [text, setText] = useState('')
  const [parseError, setParseError] = useState<string | null>(null)
  const [preview, setPreview] = useState<ImportPreviewRow[] | null>(null)
  const [resolving, setResolving] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  const reset = () => {
    setText('')
    setParseError(null)
    setPreview(null)
  }

  const close = () => {
    reset()
    onClose()
  }

  const runPreview = async () => {
    const { rows, error } = parseImportText(text)
    setParseError(error)
    if (error || rows.length === 0) {
      setPreview(null)
      return
    }
    setResolving(true)
    try {
      const cache = new Map<string, ItemSearchRow | null>()
      const resolved: ImportPreviewRow[] = []
      for (const row of rows) {
        const item = await resolveItem(row.itemQuery, cache)
        const qty = toNumber(row.qtyText)
        let warehouseId = defaultWarehouseId
        if (row.warehouseQuery) {
          const w = warehouses.find((x) => x.warehouse_name.toLowerCase() === row.warehouseQuery.toLowerCase() || (x.warehouse_code ?? '').toLowerCase() === row.warehouseQuery.toLowerCase())
          warehouseId = w?.warehouse_id ?? null
        }
        let error2: string | undefined
        if (!item) error2 = `No exact SKU/barcode match for "${row.itemQuery}".`
        else if (qty === null || qty <= 0) error2 = 'Quantity must be greater than zero.'
        else if (row.warehouseQuery && warehouseId === null) error2 = `Warehouse "${row.warehouseQuery}" not found.`
        const units = item ? unitOptionsFrom(item) : []
        const unit = row.unitText ? units.find((u) => (u.unit_symbol ?? '').toLowerCase() === row.unitText.toLowerCase()) : units.find((u) => u.is_default)
        resolved.push({ ...row, status: error2 ? 'error' : 'ok', error: error2, item: item ?? undefined, warehouseId, qty, unitId: unit?.unit_id ?? item?.unit_id ?? null })
      }
      setPreview(resolved)
    } finally {
      setResolving(false)
    }
  }

  const validCount = preview?.filter((r) => r.status === 'ok').length ?? 0

  const doImport = () => {
    if (!preview) return
    const drafts = preview
      .filter((r): r is ImportPreviewRow & { item: ItemSearchRow; qty: number } => r.status === 'ok' && !!r.item && r.qty !== null)
      .map((r) =>
        newLine(spec, {
          item_id: r.item.item_id,
          item_name: r.item.print_name || r.item.item_name,
          item_sku: r.item.item_sku,
          track_batch: Number(r.item.track_batch) === 1,
          track_serial: Number(r.item.track_serial) === 1,
          units: unitOptionsFrom(r.item),
          unit_id: r.unitId,
          warehouse_id: r.warehouseId,
          qty: String(r.qty),
          description: r.remarks || undefined,
        }),
      )
    onInsert(drafts)
    close()
  }

  const onFile = (file: File) => {
    const reader = new FileReader()
    reader.onload = () => setText(String(reader.result ?? ''))
    reader.readAsText(file)
  }

  return (
    <Modal open={open} onClose={close} title="Import items" description="Paste rows from a spreadsheet, or upload a CSV." size="xl">
      {!preview ? (
        <div className="space-y-3">
          <p className="text-xs text-gray-500">
            First row is the header. Recognised columns: <code className="rounded bg-gray-100 px-1">Item</code> (SKU, code or barcode — required),{' '}
            <code className="rounded bg-gray-100 px-1">Warehouse</code>, <code className="rounded bg-gray-100 px-1">Batch</code>, <code className="rounded bg-gray-100 px-1">Qty</code>,{' '}
            <code className="rounded bg-gray-100 px-1">Unit</code>, <code className="rounded bg-gray-100 px-1">Remarks</code>.
          </p>
          <Textarea
            rows={10}
            monospace
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder={'Item,Warehouse,Qty,Unit,Remarks\nRM-STEEL-001,Main,10,Kg,Production use'}
          />
          <div className="flex items-center gap-2">
            <input ref={fileRef} type="file" accept=".csv,.tsv,text/csv,text/tab-separated-values,text/plain" className="hidden" onChange={(e) => e.target.files?.[0] && onFile(e.target.files[0])} />
            <Button variant="secondary" icon={Upload} onClick={() => fileRef.current?.click()}>
              Choose CSV file
            </Button>
          </div>
          {parseError ? <Notice kind="error">{parseError}</Notice> : null}
        </div>
      ) : (
        <div className="space-y-3">
          <div className="flex items-center justify-between text-xs">
            <span className="text-gray-600">
              <strong className="text-gray-900">{validCount}</strong> of {preview.length} row{preview.length === 1 ? '' : 's'} ready to import
            </span>
            <button type="button" className="font-medium text-primary hover:underline" onClick={() => setPreview(null)}>
              Back to paste
            </button>
          </div>
          <div className="max-h-96 overflow-y-auto rounded-lg border border-gray-200">
            <table className="w-full text-xs">
              <thead className="sticky top-0 bg-gray-50 text-[10px] uppercase tracking-wide text-gray-500">
                <tr>
                  <th className="px-2 py-1.5 text-left">#</th>
                  <th className="px-2 py-1.5 text-left">Item</th>
                  <th className="px-2 py-1.5 text-left">Warehouse</th>
                  <th className="px-2 py-1.5 text-right">Qty</th>
                  <th className="px-2 py-1.5 text-left">Issue</th>
                </tr>
              </thead>
              <tbody>
                {preview.map((r) => (
                  <tr key={r.rowNumber} className={`border-t border-gray-100 ${r.status === 'error' ? 'bg-red-50/60' : ''}`}>
                    <td className="px-2 py-1.5 text-gray-400">{r.rowNumber}</td>
                    <td className="px-2 py-1.5">
                      <div className="flex items-center gap-1.5">
                        {r.status === 'ok' ? <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-emerald-600" aria-hidden /> : <AlertCircle className="h-3.5 w-3.5 shrink-0 text-red-500" aria-hidden />}
                        <span className="truncate">{r.item?.print_name || r.item?.item_name || r.itemQuery}</span>
                      </div>
                    </td>
                    <td className="px-2 py-1.5 text-gray-600">{warehouses.find((w) => w.warehouse_id === r.warehouseId)?.warehouse_name ?? r.warehouseQuery ?? '—'}</td>
                    <td className="px-2 py-1.5 text-right tabular-nums">{r.qty !== null ? formatQty(r.qty) : r.qtyText || '—'}</td>
                    <td className="px-2 py-1.5 text-red-600">{r.error ?? ''}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
      <div className="mt-4 flex justify-end gap-2">
        <Button variant="secondary" onClick={close}>
          Cancel
        </Button>
        {!preview ? (
          <Button variant="primary" onClick={() => void runPreview()} loading={resolving} disabled={!text.trim()}>
            Preview
          </Button>
        ) : (
          <Button variant="primary" onClick={doImport} disabled={validCount === 0}>
            Import {validCount} line{validCount === 1 ? '' : 's'}
          </Button>
        )}
      </div>
    </Modal>
  )
}

export default ImportLinesModal
