import { useEffect, useRef, useState } from 'react'
import { CheckCircle2, ScanBarcode, XCircle } from 'lucide-react'
import { Modal } from '../components/Modal'
import type { ItemSearchRow } from '../services/lookupApi'
import { Button } from '../ui/Button'
import { cx } from '../ui/cx'
import { resolveByCode } from './lineImport'

interface ScanEntry {
  code: string
  status: 'added' | 'not_found'
  itemName?: string
}

export interface BarcodeScanDialogProps {
  open: boolean
  onClose: () => void
  warehouseId: number | null
  /** Called once per resolved item; the caller appends a line and keeps the dialog open for the next scan. */
  onResolved: (row: ItemSearchRow) => void
  disabled?: boolean
}

/**
 * Barcode entry for the line table. Works with any keyboard-wedge / USB scanner (they type the
 * code and an Enter) as well as manual typing or paste — there is no camera integration in this
 * build, so that stays a clean extension point rather than a half-built dependency.
 */
export function BarcodeScanDialog({ open, onClose, warehouseId, onResolved, disabled }: BarcodeScanDialogProps) {
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [candidates, setCandidates] = useState<ItemSearchRow[]>([])
  const [log, setLog] = useState<ScanEntry[]>([])
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!open) return undefined
    setCode('')
    setCandidates([])
    setLog([])
    const id = window.setTimeout(() => inputRef.current?.focus(), 30)
    return () => window.clearTimeout(id)
  }, [open])

  const record = (entry: ScanEntry) => setLog((l) => [entry, ...l].slice(0, 8))

  const submit = async () => {
    const value = code.trim()
    if (!value || busy) return
    setBusy(true)
    setCandidates([])
    try {
      const { item, candidates: found } = await resolveByCode(value, warehouseId)
      if (item) {
        onResolved(item)
        record({ code: value, status: 'added', itemName: item.print_name || item.item_name })
        setCode('')
      } else if (found.length > 1) {
        setCandidates(found)
      } else {
        record({ code: value, status: 'not_found' })
      }
    } finally {
      setBusy(false)
      inputRef.current?.focus()
    }
  }

  const pick = (row: ItemSearchRow) => {
    onResolved(row)
    record({ code, status: 'added', itemName: row.print_name || row.item_name })
    setCandidates([])
    setCode('')
    inputRef.current?.focus()
  }

  return (
    <Modal
      open={open}
      title="Scan barcode"
      description="Scan with a handheld or keyboard-wedge scanner, or type a barcode / SKU and press Enter."
      onClose={onClose}
      size="md"
      footer={
        <Button variant="secondary" onClick={onClose}>
          Done
        </Button>
      }
    >
      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault()
          void submit()
        }}
      >
        <input
          ref={inputRef}
          className="input"
          placeholder="Scan or type a barcode / SKU…"
          value={code}
          disabled={disabled}
          onChange={(e) => setCode(e.target.value)}
          autoComplete="off"
          aria-label="Barcode or SKU"
        />
        <Button type="submit" icon={ScanBarcode} loading={busy} disabled={disabled || !code.trim()}>
          Add
        </Button>
      </form>

      {candidates.length > 0 ? (
        <div className="mt-3">
          <p className="text-xs text-gray-500 mb-1.5">Multiple items match — pick one:</p>
          <ul className="border border-gray-200 rounded-lg divide-y divide-gray-100 max-h-56 overflow-y-auto">
            {candidates.map((row) => (
              <li key={row.item_id}>
                <button type="button" className="w-full text-left px-3 py-2 hover:bg-gray-50 text-sm" onClick={() => pick(row)}>
                  <div className="font-medium text-gray-900">{row.item_name}</div>
                  <div className="text-xs text-gray-500">{[row.item_sku, row.item_upc].filter(Boolean).join(' · ') || '—'}</div>
                </button>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {log.length > 0 ? (
        <div className="mt-3 space-y-1 max-h-40 overflow-y-auto">
          {log.map((entry, i) => (
            <div key={`${entry.code}-${i}`} className={cx('flex items-center gap-1.5 text-xs', entry.status === 'added' ? 'text-emerald-700' : 'text-gray-500')}>
              {entry.status === 'added' ? <CheckCircle2 className="w-3.5 h-3.5 shrink-0" aria-hidden /> : <XCircle className="w-3.5 h-3.5 shrink-0" aria-hidden />}
              <span className="truncate">{entry.status === 'added' ? `Added ${entry.itemName ?? entry.code}` : `No matching item for "${entry.code}"`}</span>
            </div>
          ))}
        </div>
      ) : null}
    </Modal>
  )
}

export default BarcodeScanDialog
