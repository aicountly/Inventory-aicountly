import { useEffect, useRef, useState } from 'react'
import { CheckCircle2, ScanLine, XCircle } from 'lucide-react'
import { Modal } from '../../components/Modal'
import { errorMessage } from '../../services/api'
import { lookupApi } from '../../services/lookupApi'
import type { ItemSearchRow } from '../../services/lookupApi'
import { Button, Input, Spinner } from '../../ui'
import { AIC, cx } from '../../ui/cx'

export interface BarcodeScanDialogProps {
  open: boolean
  onClose: () => void
  warehouseId: number | null
  /** Adds the item, or bumps the quantity of a line that already has it. */
  onScanned: (row: ItemSearchRow) => void
}

interface ScanEntry {
  id: number
  code: string
  ok: boolean
  label: string
}

/**
 * Resolve one scanned code to one item.
 *
 * An exact SKU or barcode match wins outright. Failing that a single search
 * result is taken as the answer, because a scanner that read a partial code
 * still identified the item; two or more candidates are refused rather than
 * guessed, since issuing the wrong item is a stock error nobody catches until
 * the count.
 */
export function resolveScan(code: string, rows: ItemSearchRow[]): ItemSearchRow | null {
  const needle = code.trim().toLowerCase()
  if (!needle) return null
  const exact = rows.find(
    (r) => r.item_sku?.toLowerCase() === needle || r.item_upc?.toLowerCase() === needle,
  )
  if (exact) return exact
  return rows.length === 1 ? rows[0] : null
}

let scanSeq = 0

/** Scanner-input mode: the box keeps focus, every Enter is one scan. */
export function BarcodeScanDialog({ open, onClose, warehouseId, onScanned }: BarcodeScanDialogProps) {
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [log, setLog] = useState<ScanEntry[]>([])
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (open) {
      setCode('')
      setLog([])
    }
  }, [open])

  // A hardware scanner types into whatever holds focus, so the box takes it
  // back after every scan — otherwise the second barcode lands on the page.
  useEffect(() => {
    if (open && !busy) inputRef.current?.focus()
  }, [open, busy, log.length])

  const append = (entry: Omit<ScanEntry, 'id'>) => {
    scanSeq += 1
    setLog((prev) => [{ ...entry, id: scanSeq }, ...prev].slice(0, 25))
  }

  const submit = async () => {
    const scanned = code.trim()
    if (!scanned || busy) return
    setCode('')
    setBusy(true)
    try {
      const rows = await lookupApi.searchItems(scanned, { warehouseId, limit: 5 })
      const match = resolveScan(scanned, rows)
      if (match) {
        onScanned(match)
        append({ code: scanned, ok: true, label: match.item_name })
      } else {
        append({
          code: scanned,
          ok: false,
          label: rows.length > 1 ? `${rows.length} items match — type more of the code` : 'No item with that code',
        })
      }
    } catch (err) {
      append({ code: scanned, ok: false, label: errorMessage(err, 'Lookup failed') })
    } finally {
      setBusy(false)
    }
  }

  const added = log.filter((e) => e.ok).length

  return (
    <Modal
      open={open}
      title="Scan barcode"
      description="Scan or type a code and press Enter. Each scan adds a line, or adds one to a line already on the issue."
      onClose={onClose}
      size="md"
      footer={
        <Button variant="primary" onClick={onClose}>
          Done{added > 0 ? ` · ${added} scanned` : ''}
        </Button>
      }
    >
      <div className={cx(AIC, 'space-y-3')}>
        <Input
          ref={inputRef}
          size="md"
          leadingIcon={ScanLine}
          value={code}
          disabled={busy}
          autoComplete="off"
          placeholder="Waiting for a scan…"
          aria-label="Barcode"
          onChange={(e) => setCode(e.target.value)}
          onKeyDown={(e) => {
            if (e.key !== 'Enter') return
            e.preventDefault()
            void submit()
          }}
        />

        {busy ? (
          <p className="flex items-center gap-2 text-xs text-gray-500">
            <Spinner /> Looking the code up…
          </p>
        ) : null}

        <div className="max-h-56 overflow-y-auto rounded-lg border border-gray-200" aria-live="polite">
          {log.length === 0 ? (
            <p className="p-5 text-center text-xs text-gray-500">Scans appear here as they are read.</p>
          ) : (
            <ul>
              {log.map((entry) => (
                <li key={entry.id} className="flex items-center gap-2 border-b border-gray-100 px-3 py-2 last:border-b-0">
                  {entry.ok ? (
                    <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-600" aria-hidden />
                  ) : (
                    <XCircle className="h-4 w-4 shrink-0 text-red-500" aria-hidden />
                  )}
                  <span className="min-w-0 flex-1 truncate text-xs text-gray-700">{entry.label}</span>
                  <code className="shrink-0 rounded bg-gray-100 px-1.5 py-0.5 text-[10px] text-gray-600">{entry.code}</code>
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
