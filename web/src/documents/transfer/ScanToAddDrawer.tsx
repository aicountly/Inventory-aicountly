import { useEffect, useRef, useState } from 'react'
import { AlertTriangle, CheckCircle2, ScanLine } from 'lucide-react'
import { Button } from '../../ui/Button'
import { Drawer } from '../../ui/Drawer'
import { cx } from '../../ui/cx'
import { isAbortError } from '../../services/api'
import { lookupApi } from '../../services/lookupApi'
import type { ItemSearchRow } from '../../services/lookupApi'
import { formatQty } from '../../utils/format'

export interface ScanToAddDrawerProps {
  open: boolean
  onClose: () => void
  warehouseId: number | null
  /** Adds the item, or adds 1 to the row it is already on. */
  onScanned: (row: ItemSearchRow) => void
}

interface LogEntry {
  id: number
  code: string
  status: 'added' | 'not_found' | 'ambiguous' | 'error'
  label: string
  detail?: string
}

/**
 * Scan items straight onto the transfer.
 *
 * There is no camera and no scanner SDK here, and none is needed: a warehouse
 * barcode scanner is a keyboard. It types the code and presses Enter, which is
 * exactly what this box reads. The code is then resolved through the item
 * search endpoint the pickers already use — which matches SKU, barcode (UPC)
 * and alias — so a scan can only ever add a real item.
 */
export function ScanToAddDrawer({ open, onClose, warehouseId, onScanned }: ScanToAddDrawerProps) {
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [log, setLog] = useState<LogEntry[]>([])
  const inputRef = useRef<HTMLInputElement>(null)
  const nextId = useRef(1)

  useEffect(() => {
    if (!open) {
      setCode('')
      setLog([])
      return undefined
    }
    const raf = requestAnimationFrame(() => inputRef.current?.focus())
    return () => cancelAnimationFrame(raf)
  }, [open])

  const push = (entry: Omit<LogEntry, 'id'>) => setLog((list) => [{ ...entry, id: nextId.current++ }, ...list].slice(0, 40))

  const resolve = async (raw: string) => {
    const value = raw.trim()
    if (!value || busy) return
    setBusy(true)
    const controller = new AbortController()
    try {
      const rows = await lookupApi.searchItems(value, { warehouseId, limit: 5, signal: controller.signal })
      const exact = rows.filter(
        (r) =>
          (r.item_sku ?? '').toLowerCase() === value.toLowerCase() ||
          (r.item_upc ?? '').toLowerCase() === value.toLowerCase(),
      )
      const hit = exact.length === 1 ? exact[0] : rows.length === 1 ? rows[0] : null
      if (hit) {
        onScanned(hit)
        push({
          code: value,
          status: 'added',
          label: hit.print_name || hit.item_name,
          detail: hit.stock ? `${formatQty(hit.stock.available)} free at the source` : undefined,
        })
      } else if (rows.length === 0) {
        push({ code: value, status: 'not_found', label: 'No item carries this code' })
      } else {
        push({ code: value, status: 'ambiguous', label: `${rows.length} items match — add it from the search instead` })
      }
    } catch (err: unknown) {
      if (!isAbortError(err)) push({ code: value, status: 'error', label: 'The item could not be looked up' })
    } finally {
      setBusy(false)
      setCode('')
      inputRef.current?.focus()
    }
  }

  const added = log.filter((l) => l.status === 'added').length

  return (
    <Drawer
      open={open}
      onClose={onClose}
      title="Scan items in"
      description="Point a barcode scanner at the box below. Each scan lands on the transfer straight away."
      width="md"
      footer={
        <div className="flex items-center justify-between gap-2">
          <span className="text-xs text-gray-500">
            {added === 0 ? 'Nothing scanned yet' : `${added} scan${added === 1 ? '' : 's'} added`}
          </span>
          <Button variant="primary" onClick={onClose}>
            Done
          </Button>
        </div>
      }
    >
      <div className="relative">
        <ScanLine className="pointer-events-none absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 text-primary" aria-hidden />
        <input
          ref={inputRef}
          className="aic block h-12 w-full rounded-xl border-2 border-dashed border-primary/40 bg-primary-light/40 pl-11 pr-3 font-mono text-base text-gray-900 placeholder:font-sans placeholder:text-sm placeholder:text-gray-400 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30"
          value={code}
          disabled={busy}
          autoComplete="off"
          aria-label="Barcode or item code"
          placeholder="Scan or type a barcode, then press Enter"
          onChange={(e) => setCode(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              void resolve(code)
            }
          }}
        />
      </div>
      <p className="mt-2 text-[11px] text-gray-500">
        Codes are matched against the item master by SKU, barcode and alias. Scanning the same item again adds one more to its
        row.
      </p>

      {log.length > 0 ? (
        <ul className="mt-4 space-y-1.5">
          {log.map((entry) => (
            <li
              key={entry.id}
              className={cx(
                'flex items-start gap-2 rounded-lg border px-2.5 py-1.5',
                entry.status === 'added' ? 'border-emerald-100 bg-emerald-50' : 'border-amber-100 bg-amber-50',
              )}
            >
              {entry.status === 'added' ? (
                <CheckCircle2 className="mt-px h-3.5 w-3.5 shrink-0 text-emerald-600" aria-hidden />
              ) : (
                <AlertTriangle className="mt-px h-3.5 w-3.5 shrink-0 text-amber-600" aria-hidden />
              )}
              <span className="min-w-0 flex-1">
                <span className="block truncate text-xs font-medium text-gray-900">{entry.label}</span>
                <span className="block truncate text-[10px] text-gray-500">
                  {entry.code}
                  {entry.detail ? ` · ${entry.detail}` : ''}
                </span>
              </span>
            </li>
          ))}
        </ul>
      ) : null}
    </Drawer>
  )
}
