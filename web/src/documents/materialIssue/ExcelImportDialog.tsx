import { useRef, useState } from 'react'
import { AlertTriangle, Download, FileSpreadsheet, Upload } from 'lucide-react'
import { Modal } from '../../components/Modal'
import type { FormOptionWarehouse } from '../../services/items'
import { lookupApi } from '../../services/lookupApi'
import type { ItemSearchRow } from '../../services/lookupApi'
import { errorMessage } from '../../services/api'
import { Button, Spinner } from '../../ui'
import { AIC, cx } from '../../ui/cx'
import { downloadCsv, toCsv } from '../../utils/csv'
import { IMPORT_TEMPLATE_HEADERS, parseDelimited, parseImportSheet } from './importRows'
import type { ImportIssue, ImportedRow } from './importRows'

/** Above this the import is refused: it is one item lookup per row. */
const MAX_ROWS = 500
/** Lookups in flight at once — fast enough on a 200-row file, gentle on the API. */
const CONCURRENCY = 5

export interface ResolvedImportLine {
  source: ImportedRow
  item: ItemSearchRow
  warehouseId: number | null
}

export interface ExcelImportDialogProps {
  open: boolean
  onClose: () => void
  warehouses: FormOptionWarehouse[]
  defaultWarehouseId: number | null
  onImport: (lines: ResolvedImportLine[]) => void
}

interface Review {
  ready: ResolvedImportLine[]
  issues: ImportIssue[]
}

/** The sheet as rows of cells — xlsx is loaded only when an xlsx is chosen. */
async function readSheet(file: File): Promise<unknown[][]> {
  const isText = /\.(csv|tsv|txt)$/i.test(file.name)
  if (isText) return parseDelimited(await file.text())
  const XLSX = await import('xlsx-js-style')
  const wb = XLSX.read(await file.arrayBuffer(), { type: 'array' })
  const first = wb.SheetNames[0]
  if (!first) return []
  return XLSX.utils.sheet_to_json(wb.Sheets[first], { header: 1, blankrows: false, defval: '' }) as unknown[][]
}

/** Run `task` over `items` a few at a time, in order. */
async function mapLimited<T, R>(items: readonly T[], limit: number, task: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = []
  for (let i = 0; i < items.length; i += limit) {
    out.push(...(await Promise.all(items.slice(i, i + limit).map(task))))
  }
  return out
}

export function ExcelImportDialog({ open, onClose, warehouses, defaultWarehouseId, onImport }: ExcelImportDialogProps) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(false)
  const [fileName, setFileName] = useState('')
  const [review, setReview] = useState<Review | null>(null)
  const [fatal, setFatal] = useState<string | null>(null)

  const reset = () => {
    setReview(null)
    setFatal(null)
    setFileName('')
    if (inputRef.current) inputRef.current.value = ''
  }

  const warehouseIdFor = (name: string): number | null => {
    const needle = name.trim().toLowerCase()
    if (!needle) return defaultWarehouseId
    const hit = warehouses.find(
      (w) => w.warehouse_name.toLowerCase() === needle || (w.warehouse_code ?? '').toLowerCase() === needle,
    )
    return hit?.warehouse_id ?? null
  }

  const handleFile = async (file: File) => {
    setBusy(true)
    setFatal(null)
    setReview(null)
    setFileName(file.name)
    try {
      const sheet = await readSheet(file)
      const parsed = parseImportSheet(sheet)
      if (parsed.rows.length === 0) {
        setReview({ ready: [], issues: parsed.issues })
        return
      }
      if (parsed.rows.length > MAX_ROWS) {
        setFatal(`${parsed.rows.length} rows is over the ${MAX_ROWS}-row limit for one import. Split the file.`)
        return
      }

      const issues = [...parsed.issues]
      const ready: ResolvedImportLine[] = []

      const resolved = await mapLimited(parsed.rows, CONCURRENCY, async (row) => {
        const needle = row.sku || row.itemName
        try {
          const found = await lookupApi.searchItems(needle, { warehouseId: defaultWarehouseId, limit: 5 })
          const exact = found.find(
            (f) =>
              f.item_sku?.toLowerCase() === row.sku.toLowerCase() ||
              f.item_upc?.toLowerCase() === row.sku.toLowerCase() ||
              f.item_name.toLowerCase() === row.itemName.toLowerCase(),
          )
          return { row, item: exact ?? (found.length === 1 ? found[0] : null), candidates: found.length }
        } catch (err) {
          return { row, item: null, candidates: -1, error: errorMessage(err, 'lookup failed') as string }
        }
      })

      for (const r of resolved) {
        if (!r.item) {
          issues.push({
            row: r.row.row,
            message:
              r.candidates === -1
                ? `${r.row.sku || r.row.itemName}: ${'error' in r ? r.error : 'could not be looked up'}.`
                : r.candidates > 1
                  ? `${r.row.sku || r.row.itemName}: ${r.candidates} items match — use the exact SKU.`
                  : `${r.row.sku || r.row.itemName}: no such item.`,
          })
          continue
        }
        const warehouseId = warehouseIdFor(r.row.warehouse)
        if (r.row.warehouse && warehouseId === null) {
          issues.push({ row: r.row.row, message: `${r.row.warehouse}: no warehouse with that name or code.` })
          continue
        }
        ready.push({ source: r.row, item: r.item, warehouseId })
      }

      issues.sort((a, b) => a.row - b.row)
      setReview({ ready, issues })
    } catch (err) {
      setFatal(errorMessage(err, 'The file could not be read.'))
    } finally {
      setBusy(false)
    }
  }

  const downloadTemplate = () => {
    const columns = IMPORT_TEMPLATE_HEADERS.map((header) => ({ header, value: () => '' }))
    downloadCsv('material-issue-import-template.csv', toCsv([{}], columns))
  }

  return (
    <Modal
      open={open}
      title="Import item lines"
      description="Excel (.xlsx) or CSV. The first row must be a header."
      onClose={() => {
        reset()
        onClose()
      }}
      size="lg"
      busy={busy}
      footer={
        <>
          <Button variant="secondary" onClick={() => { reset(); onClose() }} disabled={busy}>
            Cancel
          </Button>
          <Button
            variant="primary"
            disabled={busy || !review || review.ready.length === 0}
            onClick={() => {
              if (!review) return
              onImport(review.ready)
              reset()
              onClose()
            }}
          >
            Add {review?.ready.length ?? 0} {review?.ready.length === 1 ? 'line' : 'lines'}
          </Button>
        </>
      }
    >
      <div className={cx(AIC, 'space-y-3')}>
        <div className="flex flex-wrap items-center gap-2">
          <input
            ref={inputRef}
            type="file"
            accept=".xlsx,.xls,.csv,.tsv,.txt"
            className="sr-only"
            id="mi-import-file"
            onChange={(e) => {
              const file = e.target.files?.[0]
              if (file) void handleFile(file)
            }}
          />
          <Button variant="secondary" icon={Upload} onClick={() => inputRef.current?.click()} disabled={busy}>
            Choose file
          </Button>
          <Button variant="link" icon={Download} onClick={downloadTemplate} disabled={busy}>
            Download template
          </Button>
          {fileName ? (
            <span className="inline-flex min-w-0 items-center gap-1.5 text-xs text-gray-600">
              <FileSpreadsheet className="h-3.5 w-3.5 shrink-0 text-gray-400" aria-hidden />
              <span className="truncate">{fileName}</span>
            </span>
          ) : null}
        </div>

        <p className="text-xs text-gray-500">
          Columns read: {IMPORT_TEMPLATE_HEADERS.join(', ')}. Items are matched on SKU (or barcode, or exact name);
          warehouse on name or code, falling back to the document default.
        </p>

        {busy ? (
          <p className="flex items-center gap-2 text-sm text-gray-600">
            <Spinner /> Reading the file and matching items…
          </p>
        ) : null}

        {fatal ? (
          <p role="alert" className="rounded-lg border border-red-100 bg-red-50/60 p-3 text-xs text-red-700">
            {fatal}
          </p>
        ) : null}

        {review ? (
          <div className="space-y-2">
            <div className="flex flex-wrap gap-2">
              <span className="rounded-lg border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-xs font-semibold text-emerald-700">
                {review.ready.length} ready to add
              </span>
              {review.issues.length > 0 ? (
                <span className="rounded-lg border border-amber-200 bg-amber-50 px-2.5 py-1 text-xs font-semibold text-amber-700">
                  {review.issues.length} skipped
                </span>
              ) : null}
            </div>

            {review.issues.length > 0 ? (
              <div className="max-h-48 overflow-y-auto rounded-lg border border-amber-200 bg-amber-50/40 p-2">
                <p className="mb-1 flex items-center gap-1.5 text-xs font-semibold text-amber-800">
                  <AlertTriangle className="h-3.5 w-3.5" aria-hidden />
                  These rows are not imported
                </p>
                <ul className="space-y-0.5">
                  {review.issues.map((issue, i) => (
                    <li key={`${issue.row}-${i}`} className="text-[11px] text-amber-900">
                      Row {issue.row}: {issue.message}
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}

            {review.ready.length > 0 ? (
              <div className="max-h-56 overflow-y-auto rounded-lg border border-gray-200">
                <table className="w-full text-xs">
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="px-2 py-1.5 text-left font-semibold text-gray-600">Item</th>
                      <th className="px-2 py-1.5 text-left font-semibold text-gray-600">SKU</th>
                      <th className="px-2 py-1.5 text-right font-semibold text-gray-600">Qty</th>
                    </tr>
                  </thead>
                  <tbody>
                    {review.ready.map((line) => (
                      <tr key={line.source.row} className="border-t border-gray-100">
                        <td className="truncate px-2 py-1.5 text-gray-900">{line.item.item_name}</td>
                        <td className="px-2 py-1.5 text-gray-500">{line.item.item_sku ?? '—'}</td>
                        <td className="px-2 py-1.5 text-right tabular-nums text-gray-900">{line.source.qty}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : null}
          </div>
        ) : null}
      </div>
    </Modal>
  )
}

export default ExcelImportDialog
