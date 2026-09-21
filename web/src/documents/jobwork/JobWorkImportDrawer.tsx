import { useEffect, useMemo, useState } from 'react'
import { AlertTriangle, CheckCircle2, Download, FileSpreadsheet } from 'lucide-react'
import { errorMessage, isAbortError } from '../../services/api'
import { lookupApi } from '../../services/lookupApi'
import type { ItemSearchRow } from '../../services/lookupApi'
import { Badge } from '../../ui/Badge'
import { Button } from '../../ui/Button'
import { Drawer } from '../../ui/Drawer'
import { Spinner } from '../../ui/Spinner'
import { AIC, cx } from '../../ui/cx'
import { FIELD_BASE, FIELD_OK } from '../../ui/Input'
import { formatQty, toNumber } from '../../utils/format'
import { PASTE_COLUMNS, parsePastedLines } from './jobWorkModel'
import type { PastedLine } from './jobWorkModel'

/** One pasted row after its code has been looked up. */
interface ResolvedLine extends PastedLine {
  index: number
  item: ItemSearchRow | null
  error: string | null
}

export interface JobWorkImportDrawerProps {
  open: boolean
  onClose: () => void
  /** Only valid rows are ever handed over. */
  onImport: (rows: { item: ItemSearchRow; qty: number; rate: number | null; batch: string; remarks: string }[]) => void
  title: string
}

const MAX_ROWS = 200

/**
 * Paste a block of spreadsheet cells, see exactly what will be added, then add
 * it.
 *
 * Nothing is ever imported straight onto the document: every code is resolved
 * against the item master first (`GET /v1/items/by-barcode/{code}`, which
 * matches SKU as well as barcode) and the preview says, row by row, what was
 * found and what was not. A row that cannot be resolved is not imported and is
 * not silently dropped either — it stays on screen with the reason.
 *
 * Batch and serial allocation are deliberately NOT part of a paste: they are
 * per-line decisions against live stock, and the grid's own pickers make them
 * against the warehouse the line ends up in.
 */
export function JobWorkImportDrawer({ open, onClose, onImport, title }: JobWorkImportDrawerProps) {
  const [text, setText] = useState('')
  const [resolved, setResolved] = useState<ResolvedLine[] | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (open) return
    setText('')
    setResolved(null)
    setError(null)
  }, [open])

  const parsed = useMemo(() => parsePastedLines(text), [text])

  const resolve = async () => {
    setBusy(true)
    setError(null)
    const controller = new AbortController()
    try {
      const rows = parsed.slice(0, MAX_ROWS)
      const cache = new Map<string, ItemSearchRow | null>()
      const out: ResolvedLine[] = []
      for (const [index, row] of rows.entries()) {
        const key = row.code.toLowerCase()
        if (!cache.has(key)) {
          cache.set(key, await lookupApi.itemByBarcode(row.code, { signal: controller.signal }))
        }
        const item = cache.get(key) ?? null
        const qty = toNumber(row.qty)
        let rowError: string | null = null
        if (!item) rowError = 'No item with that SKU or barcode.'
        else if (qty === null || qty <= 0) rowError = 'Quantity must be a number greater than zero.'
        out.push({ ...row, index, item, error: rowError })
      }
      setResolved(out)
    } catch (err) {
      if (!isAbortError(err)) setError(errorMessage(err, 'Could not check the pasted rows against the item master.'))
    } finally {
      setBusy(false)
    }
  }

  const valid = (resolved ?? []).filter((r) => r.error === null && r.item !== null)
  const invalid = (resolved ?? []).filter((r) => r.error !== null)

  const downloadTemplate = () => {
    const csv = `${PASTE_COLUMNS.join(',')}\n`
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }))
    const a = document.createElement('a')
    a.href = url
    a.download = 'job-work-lines-template.csv'
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <Drawer
      open={open}
      onClose={onClose}
      width="lg"
      title={title}
      description="Paste rows straight out of a spreadsheet. Nothing is added until you have seen the preview."
      footer={
        <div className="flex flex-wrap items-center justify-between gap-3">
          <span className="text-xs text-gray-600">
            {resolved === null
              ? `${parsed.length} row${parsed.length === 1 ? '' : 's'} pasted`
              : `${valid.length} valid · ${invalid.length} to fix`}
          </span>
          <div className="flex items-center gap-2">
            <Button variant="secondary" onClick={onClose}>
              Cancel
            </Button>
            {resolved === null ? (
              <Button onClick={() => void resolve()} disabled={parsed.length === 0 || busy} loading={busy}>
                Check rows
              </Button>
            ) : (
              <Button
                disabled={valid.length === 0}
                onClick={() => {
                  onImport(
                    valid.map((r) => ({
                      item: r.item as ItemSearchRow,
                      qty: toNumber(r.qty) ?? 0,
                      rate: toNumber(r.rate),
                      batch: r.batch,
                      remarks: r.remarks,
                    })),
                  )
                  onClose()
                }}
              >
                Add {valid.length} line{valid.length === 1 ? '' : 's'}
              </Button>
            )}
          </div>
        </div>
      }
    >
      <div className={cx(AIC, 'space-y-3')}>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-xs text-gray-500">
            Columns, in order: <strong className="font-semibold text-gray-700">{PASTE_COLUMNS.join(' · ')}</strong>
          </p>
          <Button variant="secondary" size="xs" icon={Download} onClick={downloadTemplate}>
            Download template
          </Button>
        </div>

        <label className="block">
          <span className="sr-only">Pasted rows</span>
          <textarea
            value={text}
            onChange={(e) => {
              setText(e.target.value)
              setResolved(null)
            }}
            rows={8}
            spellCheck={false}
            placeholder={'FG-001\t50\t250\tAUTO-01\tFirst lot\nFG-002\t25\t480'}
            className={cx(FIELD_BASE, FIELD_OK, 'px-3 py-2 font-mono text-xs')}
          />
        </label>

        {error ? (
          <p role="alert" className="flex items-start gap-1.5 text-xs text-red-700">
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
            {error}
          </p>
        ) : null}

        {busy ? (
          <p className="flex items-center gap-2 text-xs text-gray-500">
            <Spinner size="sm" /> Checking each code against the item master…
          </p>
        ) : null}

        {resolved !== null && resolved.length > 0 ? (
          <div className="overflow-x-auto rounded-xl border border-gray-200">
            <table className="w-full border-collapse text-xs">
              <caption className="sr-only">Import preview</caption>
              <thead>
                <tr className="border-b border-gray-200 bg-gray-50 text-left text-[10px] font-bold uppercase tracking-wide text-gray-500">
                  <th scope="col" className="px-2.5 py-2">
                    Row
                  </th>
                  <th scope="col" className="px-2.5 py-2">
                    Item
                  </th>
                  <th scope="col" className="px-2.5 py-2 text-right">
                    Qty
                  </th>
                  <th scope="col" className="px-2.5 py-2 text-right">
                    Rate
                  </th>
                  <th scope="col" className="px-2.5 py-2">
                    Status
                  </th>
                </tr>
              </thead>
              <tbody>
                {resolved.map((row) => (
                  <tr key={row.index} className={cx('border-b border-gray-100 last:border-b-0', row.error ? 'bg-red-50/60' : undefined)}>
                    <td className="px-2.5 py-1.5 tabular-nums text-gray-400">{row.index + 1}</td>
                    <td className="px-2.5 py-1.5">
                      <span className="block truncate text-gray-900">{row.item?.item_name ?? row.code}</span>
                      <span className="text-[10px] text-gray-500">{row.item?.item_sku ?? row.code}</span>
                    </td>
                    <td className="px-2.5 py-1.5 text-right tabular-nums text-gray-700">{formatQty(row.qty)}</td>
                    <td className="px-2.5 py-1.5 text-right tabular-nums text-gray-700">{row.rate || '—'}</td>
                    <td className="px-2.5 py-1.5">
                      {row.error ? (
                        <span className="text-red-700">{row.error}</span>
                      ) : (
                        <Badge tone="success" size="xs">
                          <CheckCircle2 className="h-3 w-3" aria-hidden />
                          Ready
                        </Badge>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}

        {resolved !== null && resolved.length === 0 ? (
          <p className="flex items-center gap-2 text-xs text-gray-500">
            <FileSpreadsheet className="h-4 w-4" aria-hidden />
            Nothing to import — the pasted text has no data rows.
          </p>
        ) : null}

        {parsed.length > MAX_ROWS ? (
          <p className="text-xs text-amber-700">
            Only the first {MAX_ROWS} rows are checked. Split a longer sheet across more than one document.
          </p>
        ) : null}
      </div>
    </Drawer>
  )
}
