import { useState } from 'react'
import type { KeyboardEvent, RefObject } from 'react'
import { ScanLine, Search, Sparkles, X } from 'lucide-react'
import { Kbd } from '../../../ui/Kbd'
import { Tooltip } from '../../../ui/Tooltip'
import { BarcodeScanDialog, barcodeScanSupported } from './BarcodeScanDialog'

export interface ItemsCommandBarProps {
  value: string
  onChange: (value: string) => void
  /**
   * Enter pressed in the box. The page tries an exact barcode / SKU match and
   * opens the item when there is one, falling back to an ordinary search.
   */
  onSubmit: (value: string) => void
  onScanned: (code: string) => void
  inputRef: RefObject<HTMLInputElement | null>
  busy?: boolean
}

/**
 * One box for finding anything in the catalogue.
 *
 * It searches NOW — name, alias, SKU and barcode, server-side, on the endpoint
 * that already does it. The sparkle marks the field as the place a question
 * will eventually be asked in words, and the placeholder invites it, but
 * nothing here pretends to understand a sentence it cannot: there is no
 * natural-language endpoint yet, so typing "items below reorder level" performs
 * a literal search rather than silently returning something and calling it
 * understanding. The filters and the KPI cards answer that question today, in
 * one click, honestly.
 *
 * A hardware scanner needs no support code: it types the code and presses
 * Enter, which is exactly `onSubmit`. The camera button appears only where the
 * browser can honour it.
 */
export function ItemsCommandBar({ value, onChange, onSubmit, onScanned, inputRef, busy }: ItemsCommandBarProps) {
  const [scanOpen, setScanOpen] = useState(false)
  const canScan = barcodeScanSupported()

  const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      onSubmit(value.trim())
    }
    if (e.key === 'Escape' && value) {
      e.preventDefault()
      onChange('')
    }
  }

  return (
    <>
      <div className="flex min-h-[46px] shrink-0 items-center gap-2 rounded-xl border border-gray-200 bg-white px-3 shadow-card transition-colors focus-within:border-primary/60 focus-within:ring-2 focus-within:ring-primary/15 print:hidden">
        <Search className="h-4 w-4 shrink-0 text-gray-400" aria-hidden />
        <Sparkles className="hidden h-3.5 w-3.5 shrink-0 text-primary sm:block" aria-hidden />
        <input
          ref={inputRef}
          type="search"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={handleKeyDown}
          aria-label="Search inventory items"
          placeholder="Search items, SKU, barcode, HSN or brand…"
          className="h-11 min-w-0 flex-1 border-0 bg-transparent text-sm text-gray-900 outline-none placeholder:text-gray-400 [&::-webkit-search-cancel-button]:hidden"
        />
        {value ? (
          <button
            type="button"
            onClick={() => onChange('')}
            aria-label="Clear search"
            className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-gray-500 hover:bg-gray-100 hover:text-gray-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
          >
            <X className="h-4 w-4" aria-hidden />
          </button>
        ) : null}
        {canScan ? (
          <Tooltip label="Scan a barcode with the camera">
            <button
              type="button"
              onClick={() => setScanOpen(true)}
              aria-label="Scan barcode"
              className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-gray-500 hover:bg-gray-100 hover:text-gray-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
            >
              <ScanLine className="h-4 w-4" aria-hidden />
            </button>
          </Tooltip>
        ) : null}
        <span className="hidden shrink-0 sm:block">
          <Kbd>/</Kbd>
        </span>
        {busy ? <span className="sr-only">Searching…</span> : null}
      </div>

      {canScan ? (
        <BarcodeScanDialog
          open={scanOpen}
          onClose={() => setScanOpen(false)}
          onDetected={(code) => {
            setScanOpen(false)
            onScanned(code)
          }}
        />
      ) : null}
    </>
  )
}
