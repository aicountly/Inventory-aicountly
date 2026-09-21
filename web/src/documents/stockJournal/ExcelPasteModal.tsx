import { useMemo, useState } from 'react'
import { AlertTriangle, Check, Info } from 'lucide-react'
import { Modal } from '../../components/Modal'
import { Button } from '../../ui/Button'
import { Textarea } from '../../ui/Textarea'
import { Badge } from '../../ui/Badge'
import { AIC, cx } from '../../ui/cx'
import { errorMessage, isAbortError } from '../../services/api'
import type { FormOptionWarehouse } from '../../services/items'
import { lookupApi } from '../../services/lookupApi'
import type { ItemSearchRow } from '../../services/lookupApi'
import { PASTE_TEMPLATE_HEADERS, itemKey, itemTokensOf, parseGrid, resolveRows } from './excelPaste'
import type { ResolveResult, ResolvedRow } from './excelPaste'

interface ExcelPasteModalProps {
  open: boolean
  onClose: () => void
  warehouses: readonly FormOptionWarehouse[]
  defaultWarehouseId: number | null
  /** Called with the rows that resolved cleanly; the page turns them into lines. */
  onInsert: (rows: ResolvedRow[]) => void
}

/**
 * Paste a block of spreadsheet cells.
 *
 * Nothing is inserted until the preview has been read: every row is shown with
 * what it resolved to, and a row that could not resolve is shown with the reason
 * rather than dropped. Inserting is offered for the rows that are ready, and the
 * count of the ones that are not is stated plainly beside it.
 */
export function ExcelPasteModal({ open, onClose, warehouses, defaultWarehouseId, onInsert }: ExcelPasteModalProps) {
  const [text, setText] = useState('')
  const [result, setResult] = useState<ResolveResult | null>(null)
  const [checking, setChecking] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const grid = useMemo(() => (text.trim() ? parseGrid(text) : null), [text])

  const check = async () => {
    if (!grid || grid.rows.length === 0) {
      setError('Nothing to read — paste some rows first.')
      return
    }
    setChecking(true)
    setError(null)
    const controller = new AbortController()
    try {
      // One search per DISTINCT token, resolved against the real item index — the
      // parser never invents an item id. Run a few at a time: a 200-line count
      // sheet can name a hundred items, and a hundred serial round trips is a
      // minute of staring at a spinner, while a hundred at once is a thundering
      // herd on the search endpoint.
      const tokens = itemTokensOf(grid)
      const items = new Map<string, ItemSearchRow>()
      const CONCURRENCY = 6
      let cursor = 0
      const worker = async () => {
        while (cursor < tokens.length) {
          const token = tokens[cursor]
          cursor += 1
          if (controller.signal.aborted) return
          const found = await lookupApi.searchItems(token, { limit: 5, signal: controller.signal })
          const key = itemKey(token)
          const exact =
            found.find((r) => r.item_sku && itemKey(r.item_sku) === key) ??
            found.find((r) => r.item_upc && itemKey(r.item_upc) === key) ??
            found.find((r) => itemKey(r.item_name) === key) ??
            (found.length === 1 ? found[0] : null)
          if (exact) items.set(key, exact)
        }
      }
      await Promise.all(Array.from({ length: Math.min(CONCURRENCY, tokens.length) }, worker))
      setResult(resolveRows(grid, { warehouses, defaultWarehouseId, items }))
    } catch (err) {
      if (!isAbortError(err)) setError(errorMessage(err, 'Could not check those rows.'))
    } finally {
      setChecking(false)
    }
  }

  const reset = () => {
    setText('')
    setResult(null)
    setError(null)
  }

  const close = () => {
    reset()
    onClose()
  }

  const ready = result?.rows.filter((r) => r.errors.length === 0) ?? []

  return (
    <Modal
      open={open}
      title="Paste from Excel"
      description="Copy the cells from your spreadsheet and paste them below. Nothing is added until you confirm."
      onClose={close}
      size="xl"
      busy={checking}
      footer={
        <>
          <Button variant="secondary" onClick={close}>
            Cancel
          </Button>
          {result ? (
            <Button variant="secondary" onClick={() => setResult(null)}>
              Edit paste
            </Button>
          ) : null}
          {result ? (
            <Button
              disabled={ready.length === 0}
              onClick={() => {
                onInsert(ready)
                close()
              }}
            >
              Insert {ready.length} line{ready.length === 1 ? '' : 's'}
            </Button>
          ) : (
            <Button loading={checking} disabled={!text.trim()} onClick={() => void check()}>
              Check rows
            </Button>
          )}
        </>
      }
    >
      <div className={cx(AIC, 'space-y-3')}>
        {!result ? (
          <>
            <div className="rounded-lg border border-gray-200 bg-gray-50 p-3">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-500">Expected columns</p>
              <p className="mt-1 font-mono text-[11px] text-gray-700">{PASTE_TEMPLATE_HEADERS.join('  |  ')}</p>
              <p className="mt-1.5 text-[11px] leading-relaxed text-gray-500">
                A header row is detected automatically. Without one the columns are read in the order above.
                Warehouse, rate and remarks may be left blank; a blank warehouse uses the header default.
              </p>
            </div>
            <Textarea
              rows={10}
              monospace
              autoFocus
              aria-label="Pasted spreadsheet rows"
              placeholder={'ITEM-001\tMain\t\tOut\t10\t120\tDamaged\nITEM-002\tMain\t\tIn\t4\t95\tFound in bay 3'}
              value={text}
              onChange={(e) => setText(e.target.value)}
            />
            {grid ? (
              <p className="text-[11px] text-gray-500">
                {grid.rows.length} row{grid.rows.length === 1 ? '' : 's'} detected
                {grid.hadHeader ? ', first row read as a header' : ', no header row'}.
              </p>
            ) : null}
            {error ? <p className="text-xs text-red-600">{error}</p> : null}
          </>
        ) : (
          <>
            <div className="flex flex-wrap items-center gap-2">
              <Badge tone="success">{result.okCount} ready</Badge>
              {result.errorCount > 0 ? <Badge tone="danger">{result.errorCount} need attention</Badge> : null}
            </div>
            <div className="max-h-[22rem] overflow-auto rounded-lg border border-gray-200">
              <table className="w-full border-collapse text-xs">
                <thead className="sticky top-0 bg-gray-50">
                  <tr className="border-b border-gray-200 text-left">
                    <th className="px-2 py-1.5 text-[10px] font-bold uppercase tracking-wide text-gray-500">Row</th>
                    <th className="px-2 py-1.5 text-[10px] font-bold uppercase tracking-wide text-gray-500">Item</th>
                    <th className="px-2 py-1.5 text-[10px] font-bold uppercase tracking-wide text-gray-500">Warehouse</th>
                    <th className="px-2 py-1.5 text-[10px] font-bold uppercase tracking-wide text-gray-500">Dir.</th>
                    <th className="px-2 py-1.5 text-right text-[10px] font-bold uppercase tracking-wide text-gray-500">Qty</th>
                    <th className="px-2 py-1.5 text-right text-[10px] font-bold uppercase tracking-wide text-gray-500">Rate</th>
                    <th className="px-2 py-1.5 text-[10px] font-bold uppercase tracking-wide text-gray-500">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {result.rows.map((row) => (
                    <tr key={row.rowNumber} className={cx('border-b border-gray-100', row.errors.length ? 'bg-red-50/60' : '')}>
                      <td className="px-2 py-1.5 text-gray-400">{row.rowNumber}</td>
                      <td className="px-2 py-1.5">
                        {row.item ? (
                          <span className="font-medium text-gray-900">{row.item.item_name}</span>
                        ) : (
                          <span className="text-gray-500">{row.raw.join(' ').slice(0, 40) || '—'}</span>
                        )}
                      </td>
                      <td className="px-2 py-1.5 text-gray-700">{row.warehouseName || '—'}</td>
                      <td className="px-2 py-1.5">
                        {row.direction ? (
                          <span className={row.direction === 'in' ? 'text-emerald-700' : 'text-red-600'}>
                            {row.direction === 'in' ? 'In' : 'Out'}
                          </span>
                        ) : (
                          '—'
                        )}
                      </td>
                      <td className="px-2 py-1.5 text-right tabular-nums">{row.qty || '—'}</td>
                      <td className="px-2 py-1.5 text-right tabular-nums">{row.rate || '—'}</td>
                      <td className="px-2 py-1.5">
                        {row.errors.length > 0 ? (
                          <ul className="space-y-0.5">
                            {row.errors.map((e) => (
                              <li key={e} className="flex items-start gap-1 text-[11px] text-red-700">
                                <AlertTriangle className="mt-px h-3 w-3 shrink-0" aria-hidden />
                                {e}
                              </li>
                            ))}
                          </ul>
                        ) : row.notes.length > 0 ? (
                          <ul className="space-y-0.5">
                            {row.notes.map((n) => (
                              <li key={n} className="flex items-start gap-1 text-[11px] text-gray-500">
                                <Info className="mt-px h-3 w-3 shrink-0" aria-hidden />
                                {n}
                              </li>
                            ))}
                          </ul>
                        ) : (
                          <span className="inline-flex items-center gap-1 text-[11px] text-emerald-700">
                            <Check className="h-3 w-3" aria-hidden /> Ready
                          </span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {result.errorCount > 0 ? (
              <p className="text-[11px] text-gray-500">
                Rows that need attention are not inserted. Fix them in the spreadsheet and paste again, or add them by hand.
              </p>
            ) : null}
          </>
        )}
      </div>
    </Modal>
  )
}
