import { useEffect, useRef, useState } from 'react'
import { AlertTriangle, CheckCircle2, FileUp } from 'lucide-react'
import { Button } from '../../ui/Button'
import { Drawer } from '../../ui/Drawer'
import { Notice } from '../../components/Notice'
import { cx } from '../../ui/cx'
import { isAbortError } from '../../services/api'
import { lookupApi } from '../../services/lookupApi'
import type { ItemSearchRow } from '../../services/lookupApi'
import { parseLinesCsv } from './parseLinesCsv'
import type { ParsedCsvRow } from './parseLinesCsv'
import type { ImportedLine } from './transferLines'

export interface ImportLinesDrawerProps {
  open: boolean
  onClose: () => void
  warehouseId: number | null
  onImport: (lines: ImportedLine[]) => void
}

interface Resolved {
  parsed: ParsedCsvRow
  match: ItemSearchRow | null
  reason: string | null
}

const CONCURRENCY = 5
const MAX_ROWS = 300

const SAMPLE = 'item_code,quantity,batch_no\nPRD-001,10\nRM-012,100,BCH-SEP26-01'

/**
 * Bring a list of items in from a spreadsheet.
 *
 * The file never reaches the server: it is read here and every code is resolved
 * against the live item master through `GET /v1/items/search`, then dropped into
 * the draft as ordinary lines the operator can still edit. Anything that does
 * not resolve is listed and left out — an import that silently invented an item
 * would post stock against the wrong one.
 */
export function ImportLinesDrawer({ open, onClose, warehouseId, onImport }: ImportLinesDrawerProps) {
  const [text, setText] = useState('')
  const [resolved, setResolved] = useState<Resolved[] | null>(null)
  const [readErrors, setReadErrors] = useState<{ lineNo: number; message: string }[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (open) return
    setText('')
    setResolved(null)
    setReadErrors([])
    setError(null)
    setBusy(false)
  }, [open])

  const readFile = async (file: File) => {
    try {
      setText(await file.text())
      setResolved(null)
    } catch {
      setError('That file could not be read.')
    }
  }

  const resolveAll = async () => {
    const { rows, errors } = parseLinesCsv(text)
    setReadErrors(errors)
    if (rows.length === 0) {
      setResolved([])
      return
    }
    if (rows.length > MAX_ROWS) {
      setError(`That is ${rows.length} rows. Import at most ${MAX_ROWS} at a time so the lookup stays quick.`)
      return
    }
    setError(null)
    setBusy(true)
    const out: Resolved[] = []
    try {
      for (let i = 0; i < rows.length; i += CONCURRENCY) {
        const chunk = rows.slice(i, i + CONCURRENCY)
        const found = await Promise.all(
          chunk.map(async (parsed): Promise<Resolved> => {
            try {
              const hits = await lookupApi.searchItems(parsed.code, { warehouseId, limit: 5 })
              const needle = parsed.code.toLowerCase()
              const exact = hits.filter(
                (h) => (h.item_sku ?? '').toLowerCase() === needle || (h.item_upc ?? '').toLowerCase() === needle,
              )
              if (exact.length === 1) return { parsed, match: exact[0], reason: null }
              if (hits.length === 1) return { parsed, match: hits[0], reason: null }
              if (hits.length === 0) return { parsed, match: null, reason: 'No item carries this code' }
              return { parsed, match: null, reason: `${hits.length} items match this code` }
            } catch (err: unknown) {
              if (isAbortError(err)) return { parsed, match: null, reason: 'Lookup cancelled' }
              return { parsed, match: null, reason: 'The item could not be looked up' }
            }
          }),
        )
        out.push(...found)
      }
      setResolved(out)
    } finally {
      setBusy(false)
    }
  }

  const matched = resolved?.filter((r) => r.match) ?? []
  const unmatched = resolved?.filter((r) => !r.match) ?? []

  const confirm = () => {
    if (matched.length === 0) return
    onImport(matched.map((r) => ({ row: r.match as ItemSearchRow, qty: r.parsed.qty, batchNo: r.parsed.batchNo })))
    onClose()
  }

  return (
    <Drawer
      open={open}
      onClose={onClose}
      title="Import lines from a CSV"
      description="Item code in the first column, quantity in the second, batch number in an optional third."
      width="lg"
      footer={
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="text-xs text-gray-500">
            {resolved === null
              ? 'Nothing checked yet'
              : `${matched.length} of ${resolved.length} rows matched an item`}
          </span>
          <div className="flex gap-2">
            <Button variant="secondary" onClick={onClose}>
              Cancel
            </Button>
            {resolved === null ? (
              <Button variant="primary" onClick={() => void resolveAll()} loading={busy} disabled={!text.trim()}>
                Check against items
              </Button>
            ) : (
              <Button variant="primary" onClick={confirm} disabled={matched.length === 0}>
                Add {matched.length} line{matched.length === 1 ? '' : 's'}
              </Button>
            )}
          </div>
        </div>
      }
    >
      {error ? <Notice kind="error">{error}</Notice> : null}

      <div className="flex flex-wrap items-center gap-2">
        <input
          ref={fileRef}
          type="file"
          accept=".csv,text/csv,text/plain"
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
        <Button
          variant="ghost"
          size="sm"
          onClick={() => {
            setText(SAMPLE)
            setResolved(null)
          }}
        >
          Paste an example
        </Button>
      </div>

      <label className="mt-3 block text-[11px] font-semibold uppercase tracking-wide text-gray-500" htmlFor="transfer-csv">
        Or paste the rows
      </label>
      <textarea
        id="transfer-csv"
        className="aic mt-1.5 block h-36 w-full rounded-lg border border-gray-200 bg-white px-3 py-2 font-mono text-xs text-gray-900 placeholder:font-sans placeholder:text-gray-400 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30"
        value={text}
        placeholder={SAMPLE}
        onChange={(e) => {
          setText(e.target.value)
          setResolved(null)
        }}
      />

      {readErrors.length > 0 ? (
        <Notice kind="warning" className="mt-3" title={`${readErrors.length} row${readErrors.length === 1 ? '' : 's'} could not be read`}>
          <ul className="mt-1 space-y-0.5 text-xs">
            {readErrors.slice(0, 6).map((e) => (
              <li key={e.lineNo}>
                Line {e.lineNo}: {e.message}
              </li>
            ))}
            {readErrors.length > 6 ? <li>and {readErrors.length - 6} more</li> : null}
          </ul>
        </Notice>
      ) : null}

      {resolved !== null ? (
        <>
          <h3 className="mt-4 text-xs font-semibold uppercase tracking-wide text-gray-500">What will be added</h3>
          <ul className="mt-2 divide-y divide-gray-100 rounded-xl border border-gray-200">
            {resolved.length === 0 ? <li className="px-3 py-4 text-xs text-gray-500">No usable rows in that file.</li> : null}
            {resolved.map((r) => (
              <li key={`${r.parsed.lineNo}-${r.parsed.code}`} className="flex items-start gap-2 px-3 py-2">
                {r.match ? (
                  <CheckCircle2 className="mt-px h-4 w-4 shrink-0 text-emerald-600" aria-hidden />
                ) : (
                  <AlertTriangle className="mt-px h-4 w-4 shrink-0 text-amber-600" aria-hidden />
                )}
                <span className="min-w-0 flex-1">
                  <span className={cx('block truncate text-xs font-medium', r.match ? 'text-gray-900' : 'text-gray-500')}>
                    {r.match ? r.match.print_name || r.match.item_name : r.parsed.code}
                  </span>
                  <span className="block truncate text-[10px] text-gray-500">
                    {r.match ? `${r.parsed.code} · qty ${r.parsed.qty}${r.parsed.batchNo ? ` · batch ${r.parsed.batchNo}` : ''}` : r.reason}
                  </span>
                </span>
              </li>
            ))}
          </ul>
          {unmatched.length > 0 ? (
            <p className="mt-2 text-[11px] text-amber-700">
              {unmatched.length} row{unmatched.length === 1 ? '' : 's'} will be left out. Fix the codes and import again, or add
              those items by hand.
            </p>
          ) : null}
          <p className="mt-2 text-[11px] text-gray-500">
            A batch number in the third column is kept as a note on the line; pick the actual batch on the row so the transfer
            draws from the right one.
          </p>
        </>
      ) : null}
    </Drawer>
  )
}
