import { useEffect, useRef, useState } from 'react'
import { AlertCircle, CheckCircle2, Loader2, ScanBarcode } from 'lucide-react'
import { errorMessage, isAbortError } from '../../services/api'
import { lookupApi } from '../../services/lookupApi'
import type { ItemSearchRow } from '../../services/lookupApi'
import { cx } from '../../ui/cx'

interface BarcodeScanBarProps {
  autoFocus?: boolean
  warehouseId: number | null
  disabled?: boolean
  onResolved: (row: ItemSearchRow) => void
  onNotFound: (code: string, message: string) => void
}

type ScanStatus = 'idle' | 'looking' | 'ok' | 'error'

/**
 * Barcode entry built for a keyboard-wedge scanner: it types the code into a plain focused
 * input and sends Enter, so this is nothing more than a text field that looks the item up on
 * Enter and refocuses itself — no camera, no extra library. `GET /v1/items/by-barcode/{code}`
 * matches on UPC or SKU; a miss reports back to the caller rather than failing silently.
 */
export function BarcodeScanBar({ autoFocus, warehouseId, disabled, onResolved, onNotFound }: BarcodeScanBarProps) {
  const [code, setCode] = useState('')
  const [status, setStatus] = useState<ScanStatus>('idle')
  const inputRef = useRef<HTMLInputElement>(null)
  const resetTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    if (autoFocus) inputRef.current?.focus()
  }, [autoFocus])

  useEffect(() => () => {
    if (resetTimer.current) clearTimeout(resetTimer.current)
  }, [])

  const flash = (next: ScanStatus) => {
    setStatus(next)
    if (resetTimer.current) clearTimeout(resetTimer.current)
    resetTimer.current = setTimeout(() => setStatus('idle'), 1600)
  }

  const submit = async () => {
    const value = code.trim()
    if (!value || disabled) return
    setCode('')
    setStatus('looking')
    try {
      const row = await lookupApi.byBarcode(value, { warehouseId })
      flash('ok')
      onResolved(row)
    } catch (err) {
      if (isAbortError(err)) return
      flash('error')
      onNotFound(value, errorMessage(err, `No item found for "${value}".`))
    } finally {
      inputRef.current?.focus()
    }
  }

  return (
    <div
      className={cx(
        'flex min-h-[2.5rem] items-center gap-2 rounded-xl border px-3 transition-colors duration-150',
        status === 'ok' && 'border-emerald-200 bg-emerald-50',
        status === 'error' && 'border-red-300 bg-red-50',
        status === 'idle' || status === 'looking' ? 'border-gray-200 bg-gray-50 focus-within:border-primary/50 focus-within:bg-white' : '',
      )}
    >
      <ScanBarcode className="h-4 w-4 shrink-0 text-gray-400" aria-hidden />
      <input
        ref={inputRef}
        type="text"
        inputMode="text"
        value={code}
        disabled={disabled}
        placeholder="Scan or type a barcode / SKU, then press Enter…"
        aria-label="Scan barcode or SKU"
        className="min-w-0 flex-1 bg-transparent text-sm text-gray-800 outline-none placeholder:text-gray-400"
        onChange={(e) => setCode(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault()
            void submit()
          }
        }}
      />
      {status === 'looking' ? <Loader2 className="h-4 w-4 shrink-0 animate-spin text-gray-400" aria-hidden /> : null}
      {status === 'ok' ? <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-600" aria-hidden /> : null}
      {status === 'error' ? <AlertCircle className="h-4 w-4 shrink-0 text-red-500" aria-hidden /> : null}
    </div>
  )
}

export default BarcodeScanBar
