import { useState } from 'react'
import { AlertTriangle, CheckCircle2, ListPlus, Wand2 } from 'lucide-react'
import { Badge } from '../../ui/Badge'
import { Button } from '../../ui/Button'
import { Drawer } from '../../ui/Drawer'
import { Textarea } from '../../ui/Textarea'
import { cx } from '../../ui/cx'
import { errorMessage } from '../../services/api'
import { lookupApi } from '../../services/lookupApi'
import type { ItemSearchRow } from '../../services/lookupApi'
import { formatQty } from '../../utils/format'
import { parseBulkEntries } from './grnLines'

export interface BulkAddResolution {
  code: string
  qty: number
  row: ItemSearchRow | null
  error: string | null
}

export interface BulkAddDrawerProps {
  open: boolean
  onClose: () => void
  warehouseId: number | null
  warehouseName: string
  onAdd: (resolved: { row: ItemSearchRow; qty: number }[]) => void
}

/**
 * Receiving a long list at once.
 *
 * A store team usually has the consignment as text already — an emailed packing list, a column
 * copied out of a spreadsheet, a scanner's export. This takes that text as it is: one code a
 * line, with an optional quantity after a comma, a tab or a space.
 *
 * Every code is resolved against the item master BEFORE anything is added, and the result is
 * shown line by line. Codes that match nothing are listed rather than skipped, because a bulk
 * import that quietly drops three rows is worse than one that fails.
 */
export function BulkAddDrawer({ open, onClose, warehouseId, warehouseName, onAdd }: BulkAddDrawerProps) {
  const [text, setText] = useState('')
  const [resolved, setResolved] = useState<BulkAddResolution[] | null>(null)
  const [busy, setBusy] = useState(false)

  const reset = () => {
    setText('')
    setResolved(null)
  }

  const resolve = async () => {
    const entries = parseBulkEntries(text)
    if (entries.length === 0) return
    setBusy(true)
    try {
      const out: BulkAddResolution[] = []
      for (const entry of entries) {
        try {
          const byCode = await lookupApi.itemByBarcode(entry.code, { warehouseId })
          if (byCode) {
            out.push({ ...entry, row: byCode, error: null })
            continue
          }
          // Not a barcode or SKU: fall back to the same search the line picker uses, and accept
          // it only when exactly one item matches — a guess between two is not an import.
          const found = await lookupApi.searchItems(entry.code, { warehouseId, limit: 2 })
          if (found.length === 1) out.push({ ...entry, row: found[0], error: null })
          else if (found.length > 1) out.push({ ...entry, row: null, error: 'Matches more than one item — use the SKU or barcode.' })
          else out.push({ ...entry, row: null, error: 'No item found.' })
        } catch (err) {
          out.push({ ...entry, row: null, error: errorMessage(err, 'Lookup failed.') })
        }
      }
      setResolved(out)
    } finally {
      setBusy(false)
    }
  }

  const found = resolved?.filter((r): r is BulkAddResolution & { row: ItemSearchRow } => r.row !== null) ?? []
  const missing = resolved?.filter((r) => r.row === null) ?? []

  return (
    <Drawer
      open={open}
      onClose={onClose}
      width="lg"
      title="Bulk add items"
      description={`Paste codes and quantities. Items are received into ${warehouseName || 'the default warehouse'}.`}
      footer={
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="text-xs text-gray-500">
            {resolved === null ? 'Nothing resolved yet' : `${found.length} ready · ${missing.length} not found`}
          </span>
          <div className="flex items-center gap-2">
            <Button variant="secondary" onClick={onClose}>
              Cancel
            </Button>
            {resolved === null ? (
              <Button icon={Wand2} loading={busy} disabled={!text.trim()} onClick={() => void resolve()}>
                Resolve codes
              </Button>
            ) : (
              <Button
                icon={ListPlus}
                disabled={found.length === 0}
                onClick={() => {
                  onAdd(found.map((r) => ({ row: r.row, qty: r.qty })))
                  reset()
                  onClose()
                }}
              >
                Add {found.length} item{found.length === 1 ? '' : 's'}
              </Button>
            )}
          </div>
        </div>
      }
    >
      <div className="space-y-3">
        <div>
          <label htmlFor="grn-bulk-text" className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-gray-500">
            Codes and quantities
          </label>
          <Textarea
            id="grn-bulk-text"
            rows={8}
            monospace
            value={text}
            placeholder={'TS-12MM, 10\nUTC-50\t200\n8901234567890 50'}
            onChange={(e) => {
              setText(e.target.value)
              setResolved(null)
            }}
          />
          <p className="mt-1 text-[11px] text-gray-500">
            One item per line: SKU or barcode, then the quantity. A line with no quantity is received as 1.
          </p>
        </div>

        {resolved !== null ? (
          <section>
            <h3 className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-gray-500">Resolved ({resolved.length})</h3>
            <ul className="divide-y divide-gray-100 rounded-lg border border-gray-200">
              {resolved.map((entry, index) => (
                <li key={`${entry.code}-${index}`} className={cx('flex items-start gap-2 px-3 py-2', entry.row ? '' : 'bg-red-50/50')}>
                  {entry.row ? (
                    <CheckCircle2 className="mt-px h-4 w-4 shrink-0 text-emerald-600" aria-hidden />
                  ) : (
                    <AlertTriangle className="mt-px h-4 w-4 shrink-0 text-red-600" aria-hidden />
                  )}
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-mono text-[11px] text-gray-500">{entry.code}</span>
                    <span className={cx('block truncate text-sm', entry.row ? 'text-gray-900' : 'text-red-700')}>
                      {entry.row ? entry.row.print_name || entry.row.item_name : entry.error}
                    </span>
                  </span>
                  {entry.row ? (
                    <span className="flex shrink-0 items-center gap-1.5">
                      {Number(entry.row.track_batch) === 1 ? (
                        <Badge tone="warning" size="xs">
                          Batch
                        </Badge>
                      ) : null}
                      {Number(entry.row.track_serial) === 1 ? (
                        <Badge tone="violet" size="xs">
                          Serial
                        </Badge>
                      ) : null}
                      <span className="text-sm font-semibold tabular-nums text-gray-900">{formatQty(entry.qty)}</span>
                    </span>
                  ) : null}
                </li>
              ))}
            </ul>
            {found.some((r) => Number(r.row.track_batch) === 1 || Number(r.row.track_serial) === 1) ? (
              <p className="mt-2 text-[11px] text-amber-700">
                Some of these items need a batch or serial numbers. They will be added as lines for you to complete before posting.
              </p>
            ) : null}
          </section>
        ) : null}
      </div>
    </Drawer>
  )
}

export default BulkAddDrawer
