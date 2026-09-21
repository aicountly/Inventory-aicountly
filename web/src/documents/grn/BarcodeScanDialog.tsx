import { useEffect, useRef, useState } from 'react'
import { AlertTriangle, CheckCircle2, ScanLine } from 'lucide-react'
import { Button } from '../../ui/Button'
import { Input } from '../../ui/Input'
import { Modal } from '../../components/Modal'
import { cx } from '../../ui/cx'
import { errorMessage } from '../../services/api'
import { lookupApi } from '../../services/lookupApi'
import type { ItemSearchRow } from '../../services/lookupApi'

export interface BarcodeScanDialogProps {
  open: boolean
  onClose: () => void
  warehouseId: number | null
  warehouseName: string
  /** Returns how the line was applied, so the log can say "added" vs "increased to 4". */
  onScanned: (row: ItemSearchRow, qty: number) => { merged: boolean; qty: number }
}

interface ScanEntry {
  id: number
  code: string
  ok: boolean
  message: string
}

/**
 * Continuous barcode receiving.
 *
 * Built for the hardware scanners a store actually has: they behave as a keyboard, type the code
 * and send Enter, so the dialog is one always-focused input that clears itself and stays open.
 * No camera permission, no library, nothing to install — and the same
 * `GET /v1/items/by-barcode/{code}` lookup the line picker falls back to, so a code that works
 * in one place works in the other.
 *
 * Every scan is logged with its outcome. A scanner that silently does nothing on an unknown code
 * is how twenty cartons get received as nineteen.
 */
export function BarcodeScanDialog({ open, onClose, warehouseId, warehouseName, onScanned }: BarcodeScanDialogProps) {
  const [code, setCode] = useState('')
  const [qty, setQty] = useState('1')
  const [busy, setBusy] = useState(false)
  const [log, setLog] = useState<ScanEntry[]>([])
  const inputRef = useRef<HTMLInputElement>(null)
  const nextId = useRef(1)

  useEffect(() => {
    if (!open) {
      setCode('')
      setLog([])
      setQty('1')
      return
    }
    const timer = window.setTimeout(() => inputRef.current?.focus(), 30)
    return () => window.clearTimeout(timer)
  }, [open])

  const push = (entry: Omit<ScanEntry, 'id'>) => setLog((current) => [{ ...entry, id: nextId.current++ }, ...current].slice(0, 12))

  const submit = async () => {
    const scanned = code.trim()
    if (!scanned || busy) return
    const amount = Number(qty) > 0 ? Number(qty) : 1
    setBusy(true)
    try {
      const row = await lookupApi.itemByBarcode(scanned, { warehouseId })
      if (!row) {
        push({ code: scanned, ok: false, message: 'No item with that barcode or SKU.' })
      } else {
        const result = onScanned(row, amount)
        push({
          code: scanned,
          ok: true,
          message: result.merged
            ? `${row.print_name || row.item_name} — now ${result.qty}`
            : `${row.print_name || row.item_name} — added ${amount}`,
        })
      }
    } catch (err) {
      push({ code: scanned, ok: false, message: errorMessage(err, 'Lookup failed.') })
    } finally {
      setBusy(false)
      setCode('')
      inputRef.current?.focus()
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="md"
      title="Scan &amp; add"
      description={`Scanned items are received into ${warehouseName || 'the default warehouse'}.`}
      footer={
        <Button variant="secondary" onClick={onClose}>
          Done
        </Button>
      }
    >
      <div className="space-y-3">
        <div className="flex items-end gap-2">
          <label className="min-w-0 flex-1">
            <span className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-gray-500">Barcode or SKU</span>
            <Input
              ref={inputRef}
              size="md"
              leadingIcon={ScanLine}
              autoComplete="off"
              placeholder="Scan now…"
              value={code}
              disabled={busy}
              onChange={(e) => setCode(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault()
                  void submit()
                }
              }}
            />
          </label>
          <label className="w-24">
            <span className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-gray-500">Qty</span>
            <Input
              size="md"
              inputMode="decimal"
              className="text-right tabular-nums"
              value={qty}
              onChange={(e) => setQty(e.target.value)}
            />
          </label>
          <Button size="md" loading={busy} disabled={!code.trim()} onClick={() => void submit()}>
            Add
          </Button>
        </div>

        <p className="text-[11px] text-gray-500">
          The box stays focused, so a hardware scanner can run straight through a pallet. A serialised item always gets its own
          line; anything else adds to the line it is already on.
        </p>

        <div className="max-h-56 overflow-y-auto rounded-lg border border-gray-200">
          {log.length === 0 ? (
            <p className="px-3 py-6 text-center text-xs text-gray-500">Nothing scanned yet.</p>
          ) : (
            <ul className="divide-y divide-gray-100">
              {log.map((entry) => (
                <li key={entry.id} className="flex items-start gap-2 px-3 py-1.5">
                  {entry.ok ? (
                    <CheckCircle2 className="mt-px h-3.5 w-3.5 shrink-0 text-emerald-600" aria-hidden />
                  ) : (
                    <AlertTriangle className="mt-px h-3.5 w-3.5 shrink-0 text-red-600" aria-hidden />
                  )}
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-mono text-[11px] text-gray-500">{entry.code}</span>
                    <span className={cx('block truncate text-xs', entry.ok ? 'text-gray-800' : 'text-red-700')}>{entry.message}</span>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </Modal>
  )
}

export default BarcodeScanDialog
