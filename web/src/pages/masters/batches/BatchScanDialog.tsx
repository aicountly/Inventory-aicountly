import { useCallback, useEffect, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import { ScanLine, Search } from 'lucide-react'
import { Modal } from '../../../components/Modal'
import { Notice } from '../../../components/Notice'
import { Button } from '../../../ui/Button'
import { Input } from '../../../ui/Input'
import { StatusBadge } from '../../../ui/StatusBadge'
import { cx } from '../../../ui/cx'
import { useCompany } from '../../../company/CompanyContext'
import { batchWorkspaceApi } from '../../../services/batchesApi'
import { errorMessage, isAbortError } from '../../../services/api'
import type { Batch } from '../../../services/masters'
import { formatDate, formatQty } from '../../../utils/format'

/**
 * Find a batch from its code, typed or scanned.
 *
 * A handheld barcode scanner is a keyboard: it types the code and presses
 * Enter. So this is one focused field and a submit — which is also exactly what
 * someone reading a carton by eye needs, and it works on a phone, on a laptop
 * with no camera, and over a remote desktop.
 *
 * No camera dependency is added for this. A webcam scanner is a real feature
 * worth having, but it is a library, a permission prompt and a decode loop, and
 * pulling one in so the button looks impressive would cost every user of the
 * page bundle size for something a £20 scanner already does better.
 *
 * The lookup is the ordinary list endpoint with `q` — the same sweep the search
 * box runs, so a code that matches a lot number or an item SKU is found too.
 * Nothing is created here: scanning identifies a batch, it never registers one.
 */

const MAX_MATCHES = 8

export interface BatchScanDialogProps {
  open: boolean
  onClose: () => void
  /** Hand the identified batch back to the page, which opens its drawer. */
  onFound: (batch: Batch) => void
}

export function BatchScanDialog({ open, onClose, onFound }: BatchScanDialogProps) {
  const { scope } = useCompany()
  const [code, setCode] = useState('')
  const [matches, setMatches] = useState<Batch[] | null>(null)
  const [searching, setSearching] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const abortRef = useRef<AbortController | null>(null)

  useEffect(() => {
    if (!open) return undefined
    setCode('')
    setMatches(null)
    setError(null)
    // The dialog traps focus on its first control already; this also selects,
    // so a second scan overwrites the first without a manual clear.
    const id = window.setTimeout(() => inputRef.current?.focus(), 0)
    return () => window.clearTimeout(id)
  }, [open])

  useEffect(
    () => () => {
      abortRef.current?.abort()
    },
    [],
  )

  const lookup = useCallback(
    async (raw: string) => {
      const value = raw.trim()
      if (!value || !scope) return
      abortRef.current?.abort()
      const controller = new AbortController()
      abortRef.current = controller
      setSearching(true)
      setError(null)
      setMatches(null)
      try {
        const res = await batchWorkspaceApi.list(
          { q: value, limit: MAX_MATCHES, with_stock: 1, sort: 'batch_no' },
          controller.signal,
        )
        if (controller.signal.aborted) return
        const rows = res.data
        // Exactly one answer needs no second question.
        if (rows.length === 1) {
          onFound(rows[0])
          return
        }
        setMatches(rows)
      } catch (err) {
        if (controller.signal.aborted || isAbortError(err)) return
        setError(errorMessage(err, 'The batch could not be looked up.'))
      } finally {
        if (!controller.signal.aborted) setSearching(false)
      }
    },
    [onFound, scope],
  )

  const submit = (e: FormEvent) => {
    e.preventDefault()
    void lookup(code)
  }

  return (
    <Modal
      open={open}
      title="Scan a batch"
      description="Scan a batch label, or type a batch, lot or item code and press Enter."
      onClose={onClose}
      size="md"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Close
          </Button>
          <Button icon={Search} loading={searching} onClick={() => void lookup(code)} disabled={!code.trim()}>
            Find batch
          </Button>
        </>
      }
    >
      <form onSubmit={submit} className="space-y-3">
        <Input
          ref={inputRef}
          size="md"
          value={code}
          onChange={(e) => {
            setCode(e.target.value)
            setMatches(null)
          }}
          leadingIcon={ScanLine}
          placeholder="BCH-2026-001"
          aria-label="Batch, lot or item code"
          autoComplete="off"
          className="w-full [&_input]:font-mono [&_input]:tracking-wide"
        />

        {error ? <Notice kind="error">{error}</Notice> : null}

        {matches !== null && matches.length === 0 ? (
          <Notice kind="warning" title="No match.">
            Nothing in this company, branch and financial year matches{' '}
            <span className="font-mono">{code.trim()}</span>.
          </Notice>
        ) : null}

        {matches !== null && matches.length > 0 ? (
          <div>
            <p className="mb-1.5 text-xs text-gray-500">
              {matches.length === MAX_MATCHES ? `First ${MAX_MATCHES} matches` : `${matches.length} matches`} — pick one.
            </p>
            <ul className="divide-y divide-gray-100 overflow-hidden rounded-lg border border-gray-200" role="list">
              {matches.map((b) => (
                <li key={b.batch_id}>
                  <button
                    type="button"
                    onClick={() => onFound(b)}
                    className={cx(
                      'flex w-full items-center justify-between gap-3 px-3 py-2 text-left transition-colors',
                      'hover:bg-primary-light/50 focus:outline-none focus-visible:bg-primary-light/50',
                    )}
                  >
                    <span className="min-w-0">
                      <span className="block truncate font-mono text-[13px] font-semibold text-gray-900">
                        {b.batch_no}
                      </span>
                      <span className="block truncate text-[11px] text-gray-500">
                        {b.item_name ?? `Item #${b.item_id}`}
                        {b.lot_no ? ` · Lot ${b.lot_no}` : ''}
                        {b.expiry_date ? ` · expires ${formatDate(b.expiry_date)}` : ''}
                      </span>
                    </span>
                    <span className="flex shrink-0 items-center gap-2">
                      <span className="tabular-nums text-[12px] text-gray-700">
                        {b.stock ? formatQty(b.stock.on_hand) : '—'}
                        {b.unit_symbol ? ` ${b.unit_symbol}` : ''}
                      </span>
                      <StatusBadge value={b.status} size="xs" />
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </form>
    </Modal>
  )
}

export default BatchScanDialog
