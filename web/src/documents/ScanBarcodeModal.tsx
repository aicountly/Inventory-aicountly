import { useEffect, useRef, useState } from 'react'
import { CheckCircle2, ScanBarcode as ScanIcon, XCircle } from 'lucide-react'
import { Modal } from '../components/Modal'
import { isAbortError } from '../services/api'
import { lookupApi, pickExactMatch } from '../services/lookupApi'
import type { ItemSearchRow } from '../services/lookupApi'
import { Button } from '../ui/Button'
import { Input } from '../ui/Input'
import { cx } from '../ui/cx'

interface ScanEvent {
  id: string
  code: string
  ok: boolean
  label: string
}

interface ScanBarcodeModalProps {
  open: boolean
  onClose: () => void
  warehouseId: number | null
  /** Called once per resolved scan; the caller decides whether to bump an existing line or add one. */
  onResolved: (row: ItemSearchRow) => void
}

/**
 * USB / handheld scanners emulate keyboard input, so this is a plain autofocused
 * text field: a scan types the code and sends Enter, exactly like a fast typist.
 * Resolves through the same `items/search` the manual picker uses, so a scanned
 * SKU or barcode is matched the identical way whether it was typed or scanned.
 */
export function ScanBarcodeModal({ open, onClose, warehouseId, onResolved }: ScanBarcodeModalProps) {
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [log, setLog] = useState<ScanEvent[]>([])
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (open) {
      setCode('')
      setLog([])
      // Modal's own focus trap lands on the first focusable element, which is this input.
      requestAnimationFrame(() => inputRef.current?.focus())
    }
  }, [open])

  const resolve = async () => {
    const scanned = code.trim()
    if (!scanned || busy) return
    setBusy(true)
    setCode('')
    try {
      const rows = await lookupApi.searchItems(scanned, { warehouseId, limit: 5 })
      const exact = pickExactMatch(rows, scanned)
      if (exact) {
        onResolved(exact)
        setLog((l) => [{ id: `${Date.now()}`, code: scanned, ok: true, label: exact.print_name || exact.item_name }, ...l].slice(0, 8))
      } else {
        setLog((l) => [{ id: `${Date.now()}`, code: scanned, ok: false, label: rows.length > 1 ? 'Matches more than one item — search manually' : 'No item found for that code' }, ...l].slice(0, 8))
      }
    } catch (err) {
      if (isAbortError(err)) return
      setLog((l) => [{ id: `${Date.now()}`, code: scanned, ok: false, label: 'Lookup failed — try again' }, ...l].slice(0, 8))
    } finally {
      setBusy(false)
      requestAnimationFrame(() => inputRef.current?.focus())
    }
  }

  return (
    <Modal open={open} title="Scan barcode" description="Point the scanner at an item — each scan appends (or bumps) a line." onClose={onClose} size="sm">
      <div className="flex flex-col gap-3">
        <div className="flex items-center gap-2">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary-light text-primary">
            <ScanIcon className="h-4 w-4" aria-hidden />
          </span>
          <Input
            ref={inputRef}
            value={code}
            onChange={(e) => setCode(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault()
                void resolve()
              }
            }}
            placeholder="Waiting for scan…"
            aria-label="Scanned barcode, SKU or UPC"
            disabled={busy}
            autoComplete="off"
          />
        </div>
        {log.length > 0 ? (
          <ul className="flex flex-col gap-1 rounded-lg border border-gray-200 p-1.5">
            {log.map((entry) => (
              <li key={entry.id} className={cx('flex items-center gap-2 rounded-md px-2 py-1 text-xs', entry.ok ? 'text-emerald-700' : 'text-red-600')}>
                {entry.ok ? <CheckCircle2 className="h-3.5 w-3.5 shrink-0" aria-hidden /> : <XCircle className="h-3.5 w-3.5 shrink-0" aria-hidden />}
                <span className="truncate font-mono text-[11px] text-gray-500">{entry.code}</span>
                <span className="truncate">{entry.label}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-xs text-gray-500">Scanned items appear here as they resolve.</p>
        )}
        <div className="flex justify-end">
          <Button variant="secondary" onClick={onClose}>
            Done
          </Button>
        </div>
      </div>
    </Modal>
  )
}
