import { useRef, useState } from 'react'
import { AlertTriangle, Check, CircleCheck, CircleX, FileUp, Search } from 'lucide-react'
import { Modal } from '../../components/Modal'
import { Notice } from '../../components/Notice'
import type { FormOptionWarehouse } from '../../services/items'
import { errorMessage } from '../../services/api'
import { lookupApi } from '../../services/lookupApi'
import type { ItemSearchRow } from '../../services/lookupApi'
import { Badge } from '../../ui/Badge'
import { Button } from '../../ui/Button'
import { Textarea } from '../../ui/Textarea'
import { cx } from '../../ui/cx'
import { formatQty } from '../../utils/format'
import { unitOptionsFrom } from '../LineEditor'
import type { EntryAdd } from './ItemEntryBar'
import { exactMatch } from './ItemSearchInput'
import { PASTE_EXAMPLE, parseItemText, parseQty } from './pasteItems'
import type { ParsedRow } from './pasteItems'

export type PasteMode = 'paste' | 'csv'

interface ResolvedRow {
  parsed: ParsedRow
  item: ItemSearchRow | null
  qty: number | null
  warehouseId: number | null
  status: 'matched' | 'not_found' | 'no_qty' | 'no_code'
}

interface PasteImportDialogProps {
  open: boolean
  mode: PasteMode
  onClose: () => void
  warehouses: FormOptionWarehouse[]
  defaultWarehouseId: number | null
  onAdd: (entries: EntryAdd[]) => void
}

const CONCURRENCY = 4
const MAX_ROWS = 300

/** Resolve up to `CONCURRENCY` codes at a time so a 200-row paste does not open 200 sockets. */
async function resolveCodes(codes: string[], warehouseId: number | null): Promise<Map<string, ItemSearchRow | null>> {
  const out = new Map<string, ItemSearchRow | null>()
  const queue = [...codes]
  const workers = Array.from({ length: Math.min(CONCURRENCY, queue.length) }, async () => {
    for (;;) {
      const code = queue.shift()
      if (code === undefined) return
      try {
        const rows = await lookupApi.searchItems(code, { warehouseId, limit: 5 })
        out.set(code, exactMatch(rows, code))
      } catch {
        out.set(code, null)
      }
    }
  })
  await Promise.all(workers)
  return out
}

function matchWarehouse(name: string, warehouses: FormOptionWarehouse[]): number | null {
  const needle = name.trim().toLowerCase()
  if (!needle) return null
  const hit = warehouses.find((w) => w.warehouse_name.toLowerCase() === needle || (w.warehouse_code ?? '').toLowerCase() === needle)
  return hit?.warehouse_id ?? null
}

const STATUS: Record<ResolvedRow['status'], { tone: 'success' | 'danger' | 'warning'; label: string }> = {
  matched: { tone: 'success', label: 'Matched' },
  not_found: { tone: 'danger', label: 'Not found' },
  no_qty: { tone: 'warning', label: 'No quantity' },
  no_code: { tone: 'danger', label: 'No item code' },
}

/**
 * Paste a SKU/quantity block or import a CSV, review what matched, then add.
 *
 * Nothing is added until the reader has seen the preview, and a code that does
 * not resolve to exactly one existing item is reported as "Not found" — an
 * import never creates an item, and it never posts stock: these become draft
 * lines like any other, and stock moves only when the document does.
 */
export function PasteImportDialog({ open, mode, onClose, warehouses, defaultWarehouseId, onAdd }: PasteImportDialogProps) {
  const [text, setText] = useState('')
  const [fileName, setFileName] = useState<string | null>(null)
  const [rows, setRows] = useState<ResolvedRow[] | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  const reset = () => {
    setText('')
    setFileName(null)
    setRows(null)
    setError(null)
    setBusy(false)
  }

  const close = () => {
    reset()
    onClose()
  }

  const readFile = async (file: File) => {
    setError(null)
    try {
      const content = await file.text()
      setFileName(file.name)
      setText(content)
      setRows(null)
    } catch (err) {
      setError(errorMessage(err, 'Could not read that file.'))
    }
  }

  const preview = async () => {
    setError(null)
    const parsed = parseItemText(text, { maxRows: MAX_ROWS })
    if (parsed.rows.length === 0) {
      setRows([])
      return
    }
    setBusy(true)
    try {
      const codes = [...new Set(parsed.rows.map((r) => r.code.trim()).filter(Boolean))]
      const found = await resolveCodes(codes, defaultWarehouseId)
      setRows(
        parsed.rows.map((row) => {
          if (!row.code.trim()) return { parsed: row, item: null, qty: null, warehouseId: null, status: 'no_code' }
          const item = found.get(row.code.trim()) ?? null
          const qty = row.qty.trim() === '' ? 1 : parseQty(row.qty)
          const warehouseId = matchWarehouse(row.warehouse, warehouses) ?? defaultWarehouseId
          const status: ResolvedRow['status'] = !item ? 'not_found' : qty === null || qty <= 0 ? 'no_qty' : 'matched'
          return { parsed: row, item, qty, warehouseId, status }
        }),
      )
    } catch (err) {
      setError(errorMessage(err, 'Could not look the codes up.'))
    } finally {
      setBusy(false)
    }
  }

  const matched = (rows ?? []).filter((r) => r.status === 'matched')

  const commit = () => {
    const entries: EntryAdd[] = matched.map((r) => {
      const item = r.item as ItemSearchRow
      const units = unitOptionsFrom(item)
      const def = units.find((u) => u.is_default) ?? units[0]
      return {
        item,
        units,
        unitId: def?.unit_id ?? item.unit_id ?? null,
        warehouseId: r.warehouseId,
        batchId: null,
        batchNo: null,
        batchExpiry: null,
        batchAvailable: null,
        qty: String(r.qty ?? 1),
      }
    })
    if (entries.length) onAdd(entries)
    close()
  }

  return (
    <Modal
      open={open}
      onClose={close}
      size="xl"
      busy={busy}
      title={mode === 'csv' ? 'Import items from CSV' : 'Paste items'}
      description={
        mode === 'csv'
          ? 'Columns: item SKU, quantity, warehouse, batch. A header row is detected automatically.'
          : 'One item per line: SKU (or barcode), then quantity. Tab, comma, semicolon and pipe all work.'
      }
      footer={
        <>
          <Button variant="secondary" onClick={close} disabled={busy}>
            Cancel
          </Button>
          {rows === null ? (
            <Button variant="primary" icon={Search} loading={busy} disabled={!text.trim()} onClick={() => void preview()}>
              Preview
            </Button>
          ) : (
            <Button variant="primary" icon={Check} disabled={matched.length === 0} onClick={commit}>
              Add {matched.length} matched row{matched.length === 1 ? '' : 's'}
            </Button>
          )}
        </>
      }
    >
      <div className="space-y-3">
        {error ? <Notice kind="error">{error}</Notice> : null}

        {mode === 'csv' ? (
          <div className="flex flex-wrap items-center gap-2">
            <input
              ref={fileRef}
              type="file"
              accept=".csv,.txt,.tsv,text/csv,text/plain,text/tab-separated-values"
              className="sr-only"
              onChange={(e) => {
                const file = e.target.files?.[0]
                if (file) void readFile(file)
                e.target.value = ''
              }}
            />
            <Button variant="secondary" size="sm" icon={FileUp} onClick={() => fileRef.current?.click()}>
              Choose a CSV file
            </Button>
            {fileName ? <span className="truncate text-xs text-gray-600">{fileName}</span> : <span className="text-xs text-gray-400">No file chosen</span>}
          </div>
        ) : null}

        <Textarea
          rows={mode === 'csv' ? 6 : 8}
          monospace
          value={text}
          aria-label={mode === 'csv' ? 'CSV contents' : 'Items to paste'}
          placeholder={PASTE_EXAMPLE}
          onChange={(e) => {
            setText(e.target.value)
            setRows(null)
          }}
        />

        {rows !== null ? (
          rows.length === 0 ? (
            <Notice kind="warning">Nothing to read — no rows were found in that text.</Notice>
          ) : (
            <>
              <div className="flex flex-wrap items-center gap-2 text-xs text-gray-600">
                <Badge tone="success" size="xs">
                  {matched.length} matched
                </Badge>
                {rows.length - matched.length > 0 ? (
                  <Badge tone="warning" size="xs">
                    {rows.length - matched.length} need attention
                  </Badge>
                ) : null}
                <span>Only matched rows are added. Nothing is created and no stock moves until the challan is saved.</span>
              </div>
              <div className="max-h-72 overflow-y-auto scrollbar-thin rounded-lg border border-gray-200">
                <table className="w-full border-collapse text-left text-xs">
                  <thead className="sticky top-0 bg-gray-50">
                    <tr className="text-[10px] font-semibold uppercase tracking-wide text-gray-500">
                      <th scope="col" className="w-10 px-2 py-1.5 text-center">
                        #
                      </th>
                      <th scope="col" className="px-2 py-1.5">
                        Code
                      </th>
                      <th scope="col" className="px-2 py-1.5">
                        Item
                      </th>
                      <th scope="col" className="w-20 px-2 py-1.5 text-right">
                        Qty
                      </th>
                      <th scope="col" className="w-28 px-2 py-1.5">
                        Status
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {rows.map((r, i) => {
                      const meta = STATUS[r.status]
                      return (
                        <tr key={`${r.parsed.index}-${i}`} className={cx(r.status === 'matched' ? '' : 'bg-amber-50')}>
                          <td className="px-2 py-1.5 text-center tabular-nums text-gray-400">{r.parsed.index}</td>
                          <td className="px-2 py-1.5 font-mono text-gray-700">{r.parsed.code || '—'}</td>
                          <td className="px-2 py-1.5 text-gray-900">{r.item ? r.item.print_name || r.item.item_name : <span className="text-gray-400">—</span>}</td>
                          <td className="px-2 py-1.5 text-right tabular-nums text-gray-700">{r.qty === null ? '—' : formatQty(r.qty)}</td>
                          <td className="px-2 py-1.5">
                            <span className="inline-flex items-center gap-1">
                              {r.status === 'matched' ? (
                                <CircleCheck className="h-3 w-3 text-emerald-600" aria-hidden />
                              ) : r.status === 'no_qty' ? (
                                <AlertTriangle className="h-3 w-3 text-amber-600" aria-hidden />
                              ) : (
                                <CircleX className="h-3 w-3 text-red-600" aria-hidden />
                              )}
                              <Badge tone={meta.tone} size="xs">
                                {meta.label}
                              </Badge>
                            </span>
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            </>
          )
        ) : null}
      </div>
    </Modal>
  )
}
