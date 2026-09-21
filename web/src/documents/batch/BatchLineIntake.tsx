import { useCallback, useRef, useState } from 'react'
import { CircleCheck, Download, FileUp, ScanBarcode, TriangleAlert } from 'lucide-react'
import { Modal } from '../../components/Modal'
import { Notice } from '../../components/Notice'
import { errorMessage } from '../../services/api'
import { lookupApi } from '../../services/lookupApi'
import type { BatchRow, ItemSearchRow } from '../../services/lookupApi'
import { Badge } from '../../ui/Badge'
import { Button } from '../../ui/Button'
import { Input } from '../../ui/Input'
import { Textarea } from '../../ui/Textarea'
import { cx } from '../../ui/cx'
import { formatQty } from '../../utils/format'
import { IMPORT_ROW_LIMIT, IMPORT_TEMPLATE, parseImportRows } from './batchImport'
import type { ImportRow } from './batchImport'

export interface IntakeLine {
  item: ItemSearchRow
  qty?: string
  direction?: 'in' | 'out' | null
  fromBatch?: Pick<BatchRow, 'batch_id' | 'batch_no'> | null
  toBatch?: Pick<BatchRow, 'batch_id' | 'batch_no'> | null
  note?: string
}

/** One item for a code, when the code names exactly one. `null` where it is ambiguous or unknown. */
async function resolveItem(code: string, warehouseId: number | null): Promise<{ item: ItemSearchRow | null; candidates: ItemSearchRow[] }> {
  const query = code.trim()
  if (!query) return { item: null, candidates: [] }
  const candidates = await lookupApi.searchItems(query, { warehouseId, limit: 8 })
  const lower = query.toLowerCase()
  const exact = candidates.find((r) => (r.item_sku ?? '').toLowerCase() === lower || (r.item_upc ?? '').toLowerCase() === lower || r.item_name.toLowerCase() === lower)
  return { item: exact ?? (candidates.length === 1 ? candidates[0] : null), candidates }
}

// ---------------------------------------------------------------------------
// Scan & add
// ---------------------------------------------------------------------------

export interface ScanAddDialogProps {
  open: boolean
  warehouseId: number | null
  onClose: () => void
  onAdd: (lines: IntakeLine[]) => void
}

/**
 * Keyboard-wedge intake.
 *
 * A hardware scanner types the code and presses Enter, which is exactly what this listens for.
 * There is no scanner SDK in Inventory to reuse and no camera permission asked for: the field
 * accepts a typed SKU, barcode or batch code equally, and resolves it through the item search the
 * line typeahead already uses.
 */
export function ScanAddDialog({ open, warehouseId, onClose, onAdd }: ScanAddDialogProps) {
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [candidates, setCandidates] = useState<ItemSearchRow[]>([])
  const [added, setAdded] = useState<string[]>([])
  const inputRef = useRef<HTMLInputElement>(null)

  const accept = (item: ItemSearchRow) => {
    onAdd([{ item }])
    setAdded((a) => [`${item.item_sku ?? item.item_name}`, ...a].slice(0, 8))
    setCandidates([])
    setCode('')
    inputRef.current?.focus()
  }

  const submit = async () => {
    const query = code.trim()
    if (!query || busy) return
    setBusy(true)
    setError(null)
    setCandidates([])
    try {
      const { item, candidates: found } = await resolveItem(query, warehouseId)
      if (item) accept(item)
      else if (found.length > 1) setCandidates(found)
      else setError(`Nothing matches “${query}”.`)
    } catch (err) {
      setError(errorMessage(err, 'The item lookup failed.'))
    } finally {
      setBusy(false)
    }
  }

  const close = () => {
    setCode('')
    setError(null)
    setCandidates([])
    setAdded([])
    onClose()
  }

  return (
    <Modal
      open={open}
      onClose={close}
      size="md"
      title="Scan & add"
      description="Scan or type a SKU, barcode or item code. Each accepted code becomes a new adjustment line."
      footer={
        <Button variant="secondary" onClick={close}>
          Done
        </Button>
      }
    >
      <div className="space-y-3">
        <Input
          ref={inputRef}
          size="md"
          autoFocus
          leadingIcon={ScanBarcode}
          value={code}
          placeholder="Scan or type a code…"
          aria-label="Scan or type an item code"
          disabled={busy}
          onChange={(e) => setCode(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              void submit()
            }
          }}
        />
        {error ? <Notice kind="warning">{error}</Notice> : null}

        {candidates.length > 0 ? (
          <div>
            <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-gray-500">More than one match — pick one</p>
            <ul className="divide-y divide-gray-100 rounded-lg border border-gray-200">
              {candidates.map((row) => (
                <li key={row.item_id}>
                  <button type="button" onClick={() => accept(row)} className="flex w-full items-center justify-between gap-2 px-3 py-1.5 text-left text-xs transition-colors hover:bg-gray-50">
                    <span className="min-w-0">
                      <span className="block truncate font-semibold text-gray-900">{row.item_name}</span>
                      <span className="block truncate text-[10px] text-gray-500">{[row.item_sku, row.unit_symbol].filter(Boolean).join(' · ') || '—'}</span>
                    </span>
                    {row.stock ? <span className="shrink-0 text-[10px] tabular-nums text-gray-500">avail {formatQty(row.stock.available)}</span> : null}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        {added.length > 0 ? (
          <div>
            <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-gray-500">Added in this session</p>
            <div className="flex flex-wrap gap-1.5">
              {added.map((label, i) => (
                <Badge key={`${label}-${i}`} tone="success" size="xs">
                  {label}
                </Badge>
              ))}
            </div>
          </div>
        ) : null}
      </div>
    </Modal>
  )
}

// ---------------------------------------------------------------------------
// Import from file
// ---------------------------------------------------------------------------

type ResolvedStatus = 'ok' | 'warning' | 'error'

interface ResolvedRow {
  source: ImportRow
  item: ItemSearchRow | null
  fromBatch: BatchRow | null
  toBatch: BatchRow | null
  status: ResolvedStatus
  message: string
}

export interface ImportLinesDialogProps {
  open: boolean
  warehouseId: number | null
  onClose: () => void
  onAdd: (lines: IntakeLine[]) => void
}

/** Resolve every parsed row against the item and batch lookups, one request per distinct key. */
async function resolveRows(rows: ImportRow[], warehouseId: number | null): Promise<ResolvedRow[]> {
  const itemCache = new Map<string, ItemSearchRow | null>()
  const batchCache = new Map<number, BatchRow[]>()

  const out: ResolvedRow[] = []
  for (const source of rows) {
    const key = source.sku.toLowerCase()
    if (!itemCache.has(key)) {
      const { item } = await resolveItem(source.sku, warehouseId)
      itemCache.set(key, item)
    }
    const item = itemCache.get(key) ?? null
    if (!item) {
      out.push({ source, item: null, fromBatch: null, toBatch: null, status: 'error', message: `No item matches “${source.sku}”.` })
      continue
    }
    if (!batchCache.has(item.item_id) && (source.fromBatch || source.toBatch)) {
      const res = await lookupApi.batches(item.item_id, { warehouseId })
      batchCache.set(item.item_id, res.data)
    }
    const batches = batchCache.get(item.item_id) ?? []
    const find = (no: string) => (no ? (batches.find((b) => b.batch_no.toLowerCase() === no.toLowerCase()) ?? null) : null)
    const fromBatch = find(source.fromBatch)
    const toBatch = find(source.toBatch)

    const missing: string[] = []
    if (source.fromBatch && !fromBatch) missing.push(source.fromBatch)
    if (source.toBatch && !toBatch) missing.push(source.toBatch)
    const noQty = source.qty.trim() === '' || Number(source.qty) <= 0

    out.push({
      source,
      item,
      fromBatch,
      toBatch,
      status: missing.length > 0 || noQty ? 'warning' : 'ok',
      message: [missing.length > 0 ? `Batch ${missing.join(' and ')} not found at this warehouse` : '', noQty ? 'No quantity' : ''].filter(Boolean).join(' · '),
    })
  }
  return out
}

const STATUS_TONE = { ok: 'success', warning: 'warning', error: 'danger' } as const

/**
 * Spreadsheet intake. Rows land as ordinary editable lines, resolved through the same lookups the
 * typeahead uses, with anything unresolved shown before a single line is added.
 */
export function ImportLinesDialog({ open, warehouseId, onClose, onAdd }: ImportLinesDialogProps) {
  const [text, setText] = useState('')
  const [rows, setRows] = useState<ResolvedRow[] | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  const reset = useCallback(() => {
    setText('')
    setRows(null)
    setError(null)
  }, [])

  const readFile = async (file: File) => {
    setError(null)
    try {
      setText(await file.text())
      setRows(null)
    } catch {
      setError('That file could not be read as text. Export the sheet as CSV and try again.')
    }
  }

  const resolve = async () => {
    const parsed = parseImportRows(text)
    if (parsed.length === 0) {
      setError('Nothing to import — the text has no data rows.')
      return
    }
    setBusy(true)
    setError(null)
    try {
      setRows(await resolveRows(parsed, warehouseId))
    } catch (err) {
      setError(errorMessage(err, 'The lookups failed while resolving the rows.'))
    } finally {
      setBusy(false)
    }
  }

  const usable = (rows ?? []).filter((r) => r.item !== null)

  const apply = () => {
    onAdd(
      usable.map((r) => ({
        item: r.item as ItemSearchRow,
        qty: r.source.qty,
        direction: r.source.direction,
        fromBatch: r.fromBatch,
        toBatch: r.toBatch,
        note: r.source.note,
      })),
    )
    reset()
    onClose()
  }

  const close = () => {
    reset()
    onClose()
  }

  return (
    <Modal
      open={open}
      onClose={close}
      busy={busy}
      size="lg"
      title="Import lines from a file"
      description={`Paste rows or choose a CSV / TSV file. Up to ${IMPORT_ROW_LIMIT} rows per import.`}
      footer={
        <>
          <Button variant="secondary" onClick={close} disabled={busy}>
            Cancel
          </Button>
          {rows === null ? (
            <Button onClick={() => void resolve()} loading={busy} disabled={!text.trim()}>
              Resolve rows
            </Button>
          ) : (
            <Button onClick={apply} disabled={usable.length === 0}>
              Add {usable.length} line{usable.length === 1 ? '' : 's'}
            </Button>
          )}
        </>
      }
    >
      <div className="space-y-3">
        {error ? <Notice kind="error">{error}</Notice> : null}

        {rows === null ? (
          <>
            <div className="flex flex-wrap items-center gap-2">
              <input
                ref={fileRef}
                type="file"
                accept=".csv,.tsv,.txt,text/csv,text/plain,text/tab-separated-values"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0]
                  if (file) void readFile(file)
                  e.target.value = ''
                }}
              />
              <Button variant="secondary" size="sm" icon={FileUp} onClick={() => fileRef.current?.click()}>
                Choose file
              </Button>
              <Button variant="ghost" size="sm" icon={Download} onClick={() => setText(IMPORT_TEMPLATE)}>
                Paste the template
              </Button>
            </div>
            <Textarea
              rows={8}
              monospace
              value={text}
              onChange={(e) => setText(e.target.value)}
              aria-label="Rows to import"
              placeholder={IMPORT_TEMPLATE}
            />
            <p className="text-[11px] leading-snug text-gray-500">
              Columns: <span className="font-mono">sku, qty, direction, from_batch, to_batch, note</span>. A header row is used when present; otherwise the columns are read in that order.
            </p>
          </>
        ) : (
          <div className="max-h-80 overflow-y-auto rounded-lg border border-gray-200">
            <table className="w-full border-collapse text-xs">
              <thead className="sticky top-0 bg-gray-50">
                <tr>
                  {['Row', 'Item', 'Qty', 'Dir.', 'From', 'To', 'Status'].map((h) => (
                    <th key={h} className="whitespace-nowrap border-b border-gray-200 px-2 py-1.5 text-left text-[10px] font-semibold uppercase tracking-wide text-gray-500">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.source.row} className={cx('border-b border-gray-100 last:border-0', r.status === 'error' && 'bg-red-50/40', r.status === 'warning' && 'bg-amber-50/60')}>
                    <td className="px-2 py-1.5 tabular-nums text-gray-400">{r.source.row}</td>
                    <td className="px-2 py-1.5">
                      <span className="block truncate font-semibold text-gray-800">{r.item?.item_name ?? r.source.sku}</span>
                      {r.item?.item_sku ? <span className="block truncate text-[10px] text-gray-500">{r.item.item_sku}</span> : null}
                    </td>
                    <td className="px-2 py-1.5 text-right tabular-nums">{r.source.qty || '—'}</td>
                    <td className="px-2 py-1.5">{r.source.direction ?? '—'}</td>
                    <td className="px-2 py-1.5">{r.fromBatch?.batch_no ?? r.source.fromBatch ?? '—'}</td>
                    <td className="px-2 py-1.5">{r.toBatch?.batch_no ?? r.source.toBatch ?? '—'}</td>
                    <td className="px-2 py-1.5">
                      <span className="inline-flex items-center gap-1.5">
                        {r.status === 'ok' ? <CircleCheck className="h-3 w-3 text-emerald-600" aria-hidden /> : <TriangleAlert className={cx('h-3 w-3', r.status === 'error' ? 'text-red-600' : 'text-amber-600')} aria-hidden />}
                        <Badge tone={STATUS_TONE[r.status]} size="xs">
                          {r.status === 'ok' ? 'Ready' : r.status === 'warning' ? 'Check' : 'Skipped'}
                        </Badge>
                        {r.message ? <span className="truncate text-[10px] text-gray-500">{r.message}</span> : null}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </Modal>
  )
}
