import { useEffect, useRef, useState } from 'react'
import { ScanBarcode } from 'lucide-react'
import { Modal } from '../../components/Modal'
import { Button } from '../../ui/Button'
import { Input } from '../../ui/Input'
import { AIC, cx } from '../../ui/cx'
import { errorMessage, isAbortError } from '../../services/api'
import { lookupApi } from '../../services/lookupApi'
import type { ItemSearchRow } from '../../services/lookupApi'

interface BarcodeScanDialogProps {
  open: boolean
  onClose: () => void
  warehouseId: number | null
  /** One scan, one line. The dialog stays open so a whole trolley can be scanned. */
  onScanned: (item: ItemSearchRow) => void
}

interface ScanLogEntry {
  code: string
  label: string
  ok: boolean
}

/**
 * Barcode entry for the usual warehouse setup: a USB scanner that types the code
 * and presses Enter.
 *
 * No camera and no scanner SDK — the hardware already behaves like a keyboard,
 * so the dialog is a focused input that looks the code up and adds a line. It
 * stays open and keeps a short log, because scanning is done in runs.
 */
export function BarcodeScanDialog({ open, onClose, warehouseId, onScanned }: BarcodeScanDialogProps) {
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [log, setLog] = useState<ScanLogEntry[]>([])
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (open) {
      setLog([])
      setCode('')
      setError(null)
      // The scanner "types" into whatever has focus, so the field must have it.
      const t = window.setTimeout(() => inputRef.current?.focus(), 50)
      return () => window.clearTimeout(t)
    }
    return undefined
  }, [open])

  const lookup = async (raw: string) => {
    const value = raw.trim()
    if (!value || busy) return
    setBusy(true)
    setError(null)
    try {
      const found = await lookupApi.searchItems(value, { warehouseId, limit: 5 })
      const exact =
        found.find((r) => r.item_upc && r.item_upc.toLowerCase() === value.toLowerCase()) ??
        found.find((r) => r.item_sku && r.item_sku.toLowerCase() === value.toLowerCase()) ??
        (found.length === 1 ? found[0] : null)
      if (!exact) {
        setError(`No item matches “${value}”.`)
        setLog((l) => [{ code: value, label: 'no match', ok: false }, ...l].slice(0, 8))
      } else {
        onScanned(exact)
        setLog((l) => [{ code: value, label: exact.item_name, ok: true }, ...l].slice(0, 8))
      }
    } catch (err) {
      if (!isAbortError(err)) setError(errorMessage(err, 'Could not look that code up.'))
    } finally {
      setBusy(false)
      setCode('')
      inputRef.current?.focus()
    }
  }

  return (
    <Modal
      open={open}
      title="Scan barcode"
      description="Scan or type a code and press Enter. Each match becomes a new line."
      onClose={onClose}
      size="md"
      footer={
        <Button variant="secondary" onClick={onClose}>
          Done
        </Button>
      }
    >
      <div className={cx(AIC, 'space-y-3')}>
        <div className="flex items-center gap-2 rounded-lg border border-dashed border-primary/40 bg-primary-light/40 px-3 py-3">
          <ScanBarcode className="h-5 w-5 shrink-0 text-primary" aria-hidden />
          <Input
            ref={inputRef}
            size="md"
            aria-label="Barcode"
            placeholder="Waiting for a scan…"
            value={code}
            disabled={busy}
            onChange={(e) => setCode(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault()
                void lookup(code)
              }
            }}
          />
        </div>

        {error ? <p className="text-xs text-red-600">{error}</p> : null}

        {log.length > 0 ? (
          <div>
            <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-gray-400">This session</p>
            <ul className="space-y-1">
              {log.map((entry, i) => (
                <li key={`${entry.code}-${i}`} className="flex items-center gap-2 text-xs">
                  <span className="font-mono text-gray-500">{entry.code}</span>
                  <span className={entry.ok ? 'text-emerald-700' : 'text-red-600'}>{entry.label}</span>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </div>
    </Modal>
  )
}
