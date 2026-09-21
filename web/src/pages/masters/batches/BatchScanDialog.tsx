import { useEffect, useRef, useState } from 'react'
import { ScanLine, Search } from 'lucide-react'
import { Button } from '../../../ui/Button'
import { Modal } from '../../../components/Modal'
import { Notice } from '../../../components/Notice'
import { isAbortError } from '../../../services/api'
import { batchesApi } from '../../../services/masters'
import type { Batch } from '../../../services/masters'
import { formatDate } from '../../../utils/format'

/**
 * Scan or type a batch code and open that batch.
 *
 * A scanner gun is a keyboard: it types the code and presses Enter. That is the
 * whole interaction, so the dialog is an input that submits — no camera, and no
 * camera dependency added to the bundle for the look of one. A phone camera
 * scanner would be a real feature, not a decoration, and it belongs behind a
 * capability the app does not have yet.
 *
 * It never creates anything. Scanning is a lookup: the code goes to the same
 * `GET /v1/batches` the table reads, and a match opens the batch drawer.
 */

export interface BatchScanDialogProps {
  open: boolean
  onClose: () => void
  onFound: (batch: Batch) => void
}

export function BatchScanDialog({ open, onClose, onFound }: BatchScanDialogProps) {
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [matches, setMatches] = useState<Batch[] | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!open) return
    setCode('')
    setError(null)
    setMatches(null)
    // The scanner starts typing the moment the dialog opens, so the field has
    // to already have focus or the first characters are lost.
    const id = window.setTimeout(() => inputRef.current?.focus(), 30)
    return () => window.clearTimeout(id)
  }, [open])

  const lookup = async () => {
    const needle = code.trim()
    if (!needle) return
    setBusy(true)
    setError(null)
    setMatches(null)
    try {
      const res = await batchesApi.list({ q: needle, limit: 10, with_stock: 1 })
      if (res.data.length === 0) {
        setError(`No batch matches “${needle}” in this company.`)
      } else if (res.data.length === 1) {
        onFound(res.data[0])
      } else {
        setMatches(res.data)
      }
    } catch (err: unknown) {
      if (!isAbortError(err)) setError('The lookup failed. Check your connection and try again.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal
      open={open}
      title="Scan batch"
      onClose={onClose}
      size="md"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Close
          </Button>
          <Button icon={Search} loading={busy} disabled={!code.trim()} onClick={() => void lookup()}>
            Find batch
          </Button>
        </>
      }
    >
      <form
        onSubmit={(e) => {
          e.preventDefault()
          void lookup()
        }}
      >
        <label htmlFor="batch-scan-input" className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wide text-gray-500">
          Batch, lot or item code
        </label>
        <div className="relative">
          <ScanLine className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" aria-hidden />
          <input
            id="batch-scan-input"
            ref={inputRef}
            value={code}
            onChange={(e) => setCode(e.target.value)}
            placeholder="Scan a label or type a code"
            autoComplete="off"
            className="block h-11 w-full rounded-lg border border-gray-200 bg-white pl-9 pr-3 font-mono text-sm text-gray-900 transition-colors placeholder:font-sans placeholder:text-gray-400 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30"
          />
        </div>
        <p className="mt-2 text-xs text-gray-500">
          A barcode scanner types the code and presses Enter. Nothing is created — the matching batch opens for review.
        </p>
      </form>

      {error ? (
        <Notice kind="warning" className="mt-3">
          {error}
        </Notice>
      ) : null}

      {matches ? (
        <div className="mt-3">
          <p className="mb-1.5 text-xs text-gray-500">{matches.length} batches match — pick one:</p>
          <ul className="max-h-60 divide-y divide-gray-100 overflow-y-auto rounded-lg border border-gray-200">
            {matches.map((b) => (
              <li key={b.batch_id}>
                <button
                  type="button"
                  onClick={() => onFound(b)}
                  className="flex w-full items-center justify-between gap-3 px-3 py-2 text-left transition-colors hover:bg-gray-50 focus:outline-none focus-visible:bg-gray-50"
                >
                  <span className="min-w-0">
                    <span className="block font-mono text-[13px] font-semibold text-gray-900">{b.batch_no}</span>
                    <span className="block truncate text-[11px] text-gray-500">
                      {b.item_name ?? `Item #${b.item_id}`}
                      {b.lot_no ? ` · ${b.lot_no}` : ''}
                    </span>
                  </span>
                  <span className="shrink-0 text-[11px] text-gray-500">
                    {b.expiry_date ? formatDate(b.expiry_date) : '—'}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </Modal>
  )
}

export default BatchScanDialog
