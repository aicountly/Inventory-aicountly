import { useEffect, useRef, useState } from 'react'
import { Download, Upload } from 'lucide-react'
import { Modal } from '../components/Modal'
import { Notice } from '../components/Notice'
import type { FormOptionWarehouse } from '../services/items'
import type { ItemSearchRow } from '../services/lookupApi'
import { lookupApi } from '../services/lookupApi'
import { Badge } from '../ui/Badge'
import type { BadgeTone } from '../ui/Badge'
import { Button } from '../ui/Button'
import { EmptyState } from '../ui/EmptyState'
import { csvFilename, csvRecords, downloadCsv, parseCsv } from '../utils/csv'
import { formatMoney, formatQty } from '../utils/format'
import { LineItemPicker } from './LineItemPicker'
import type { LineDraft } from './formModel'
import {
  buildImportRow,
  buildImportTemplateCsv,
  importRowNotes,
  importRowStatus,
  lineFromImportRow,
  matchItemFromSearch,
} from './openingStock/openingStockHelpers'
import type { ImportRow, ImportRowStatus } from './openingStock/openingStockHelpers'
import type { DocumentTypeSpec } from './registry'

interface ImportLinesModalProps {
  open: boolean
  onClose: () => void
  spec: DocumentTypeSpec
  warehouses: FormOptionWarehouse[]
  defaultWarehouseId: number | null
  onConfirm: (lines: LineDraft[]) => void
}

/** Files larger than this are still parsed, but only the first N rows are offered for import. */
const MAX_IMPORT_ROWS = 300

const STATUS_BADGE: Record<ImportRowStatus, { label: string; tone: BadgeTone }> = {
  ok: { label: 'Ready', tone: 'success' },
  unresolved: { label: 'Pick item', tone: 'warning' },
  error: { label: 'Error', tone: 'danger' },
}

/**
 * Upload → parse → resolve each row's item against the live item search API → preview → confirm.
 * Nothing is added to the draft, nothing is created in the item/batch/serial masters, until the
 * user explicitly confirms — see openingStockHelpers.importRowNotes for what a batch/serial/expiry
 * column cannot do automatically.
 */
export function ImportLinesModal({ open, onClose, spec, warehouses, defaultWarehouseId, onConfirm }: ImportLinesModalProps) {
  const [fileName, setFileName] = useState<string | null>(null)
  const [rows, setRows] = useState<ImportRow[]>([])
  const [truncated, setTruncated] = useState(false)
  const [resolving, setResolving] = useState(false)
  const [parseError, setParseError] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const runId = useRef(0)

  useEffect(() => {
    if (!open) return
    setFileName(null)
    setRows([])
    setTruncated(false)
    setParseError(null)
    if (fileInputRef.current) fileInputRef.current.value = ''
  }, [open])

  const resolveAll = async (built: ImportRow[], myRun: number) => {
    setResolving(true)
    const cache = new Map<string, ItemSearchRow[]>()
    const next = [...built]
    for (let i = 0; i < next.length; i++) {
      if (runId.current !== myRun) return
      const row = next[i]
      if (row.errors.length > 0) continue
      const key = `${row.itemCode.trim().toLowerCase()}|${row.itemName.trim().toLowerCase()}`
      try {
        let found = cache.get(key)
        if (!found) {
          found = await lookupApi.searchItems(row.itemCode || row.itemName, { limit: 8 })
          cache.set(key, found)
        }
        next[i] = { ...row, item: matchItemFromSearch(found, row.itemCode, row.itemName) }
      } catch {
        // Leave unresolved — the row's own item picker lets the user find it by hand.
      }
      if (runId.current === myRun) setRows([...next])
    }
    if (runId.current === myRun) setResolving(false)
  }

  const handleFile = async (file: File) => {
    runId.current += 1
    const myRun = runId.current
    setFileName(file.name)
    setParseError(null)
    setRows([])
    setTruncated(false)
    let text: string
    try {
      text = await file.text()
    } catch {
      setParseError('Could not read that file.')
      return
    }
    const parsed = parseCsv(text)
    if (parsed.headers.length === 0) {
      setParseError('That file has no header row. Use Download Template to see the expected columns.')
      return
    }
    const records = csvRecords(parsed)
    const capped = records.slice(0, MAX_IMPORT_ROWS)
    setTruncated(records.length > MAX_IMPORT_ROWS)
    const built = capped.map((record, i) => buildImportRow(record, i + 1, warehouses, defaultWarehouseId))
    setRows(built)
    void resolveAll(built, myRun)
  }

  const setRow = (index: number, patch: Partial<ImportRow>) => setRows((rs) => rs.map((r, i) => (i === index ? { ...r, ...patch } : r)))

  const readyRows = rows.filter((r) => importRowStatus(r) === 'ok')

  const confirm = () => {
    const lines = readyRows.map((r) => lineFromImportRow(spec, defaultWarehouseId, r)).filter((l): l is LineDraft => l !== null)
    if (lines.length === 0) return
    onConfirm(lines)
    onClose()
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Import items from CSV"
      description="Upload a file in the template's column layout — you'll review every row before anything is added."
      size="xl"
      footer={
        <>
          <Button type="button" variant="secondary" icon={Download} onClick={() => downloadCsv(csvFilename(`${spec.slug}-import-template`), buildImportTemplateCsv())}>
            Download template
          </Button>
          <span className="flex-1" />
          <Button type="button" variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="button" variant="primary" onClick={confirm} disabled={resolving || readyRows.length === 0}>
            Import {readyRows.length} line{readyRows.length === 1 ? '' : 's'}
          </Button>
        </>
      }
    >
      <label className="flex cursor-pointer flex-col items-center gap-2 rounded-xl border-2 border-dashed border-gray-200 px-4 py-6 text-center transition-colors hover:border-primary/40 hover:bg-primary-light/30">
        <Upload className="h-6 w-6 text-gray-400" aria-hidden />
        <span className="text-sm font-medium text-gray-700">{fileName ?? 'Choose a CSV file'}</span>
        <span className="text-xs text-gray-400">Item Code, Warehouse, Quantity and Rate columns — see Download Template.</span>
        <input
          ref={fileInputRef}
          type="file"
          accept=".csv,text/csv"
          className="sr-only"
          onChange={(e) => {
            const file = e.target.files?.[0]
            if (file) void handleFile(file)
          }}
        />
      </label>

      {parseError ? (
        <Notice kind="error" className="mt-3">
          {parseError}
        </Notice>
      ) : null}
      {truncated ? (
        <Notice kind="warning" className="mt-3">
          This file has more than {MAX_IMPORT_ROWS} rows — only the first {MAX_IMPORT_ROWS} are shown. Import in batches.
        </Notice>
      ) : null}

      {rows.length > 0 ? (
        <div className="mt-4">
          <p className="mb-2 text-xs text-gray-500">
            {readyRows.length} of {rows.length} row{rows.length === 1 ? '' : 's'} ready{resolving ? ' — matching items…' : '.'}
          </p>
          <div className="max-h-96 overflow-y-auto rounded-lg border border-gray-200">
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-gray-50 text-left text-[11px] uppercase tracking-wide text-gray-500">
                <tr>
                  <th className="px-2 py-2">#</th>
                  <th className="px-2 py-2">Item</th>
                  <th className="px-2 py-2 text-right">Qty</th>
                  <th className="px-2 py-2 text-right">Rate</th>
                  <th className="px-2 py-2">Status</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row, i) => {
                  const status = importRowStatus(row)
                  const notes = [...row.warnings, ...importRowNotes(row)]
                  return (
                    <tr key={row.rowNumber} className="border-t border-gray-100 align-top">
                      <td className="px-2 py-2 text-gray-400">{row.rowNumber}</td>
                      <td className="min-w-[16rem] px-2 py-2">
                        {row.item ? (
                          <div>
                            <div className="font-medium text-gray-900">{row.item.print_name || row.item.item_name}</div>
                            <div className="text-xs text-gray-400">{row.item.item_sku ?? row.itemCode}</div>
                          </div>
                        ) : status === 'error' ? (
                          <div className="text-gray-500">{row.itemCode || row.itemName || <span className="italic text-gray-400">no item named</span>}</div>
                        ) : (
                          <LineItemPicker
                            itemId={null}
                            itemName=""
                            itemSku={null}
                            warehouseId={row.warehouseId}
                            onPick={(picked) => setRow(i, { item: picked })}
                            onClear={() => setRow(i, { item: null })}
                          />
                        )}
                        {row.errors.map((e) => (
                          <div key={e} className="mt-0.5 text-xs text-red-600">
                            {e}
                          </div>
                        ))}
                        {notes.map((n) => (
                          <div key={n} className="mt-0.5 text-xs text-amber-600">
                            {n}
                          </div>
                        ))}
                      </td>
                      <td className="px-2 py-2 text-right tabular-nums">{row.quantity !== null ? formatQty(row.quantity) : '—'}</td>
                      <td className="px-2 py-2 text-right tabular-nums">{row.rate !== null ? formatMoney(row.rate) : '—'}</td>
                      <td className="px-2 py-2">
                        <Badge tone={STATUS_BADGE[status].tone} size="xs">
                          {STATUS_BADGE[status].label}
                        </Badge>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      ) : !parseError ? (
        <EmptyState size="sm" className="mt-2" title="No file selected yet" description="Choose a CSV file above to see a preview here." />
      ) : null}
    </Modal>
  )
}

export default ImportLinesModal
