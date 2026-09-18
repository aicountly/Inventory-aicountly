import { useCallback, useEffect, useRef, useState } from 'react'
import { AlertTriangle, CheckCircle2, ScanBarcode } from 'lucide-react'
import { Modal } from '../../components/Modal'
import { Notice } from '../../components/Notice'
import { isApiError } from '../../services/api'
import { lookupApi } from '../../services/lookupApi'
import type { ItemSearchRow } from '../../services/lookupApi'
import { Button } from '../../ui/Button'
import { Input } from '../../ui/Input'
import { SegmentedControl } from '../../ui/SegmentedControl'
import { cx } from '../../ui/cx'
import { formatQty } from '../../utils/format'
import type { DisassemblyRole } from './model'

export interface ScanDialogProps {
  open: boolean
  onClose: () => void
  warehouseId: number | null
  /** Adds the scanned item to the given side and returns once the row exists. */
  onScanned: (role: DisassemblyRole, item: ItemSearchRow) => void
  /** A finished product is already picked, so scans default to components. */
  hasFinished: boolean
}

interface ScanLog {
  id: number
  code: string
  status: 'added' | 'ambiguous' | 'missing'
  message: string
}

/**
 * Barcode entry for a warehouse workflow.
 *
 * A hardware scanner is a keyboard: it types the code and presses Enter. So this is one focused
 * text field that never loses focus, resolves each code against `GET /v1/items/by-barcode/{code}`
 * and adds a row — no mouse needed between scans. A code that matches nothing falls back to the
 * item search, and if that returns more than one candidate the dialog shows them and waits: a
 * scanner reading one digit wrong must never pick a neighbouring item on its own.
 */
export function ScanDialog({ open, onClose, warehouseId, onScanned, hasFinished }: ScanDialogProps) {
  const [role, setRole] = useState<DisassemblyRole>(hasFinished ? 'component' : 'finished')
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [log, setLog] = useState<ScanLog[]>([])
  const [choices, setChoices] = useState<ItemSearchRow[]>([])
  const inputRef = useRef<HTMLInputElement>(null)
  const nextId = useRef(1)

  useEffect(() => {
    if (!open) return
    setRole(hasFinished ? 'component' : 'finished')
    setChoices([])
    setCode('')
    // The field has to hold focus for a scanner to work at all.
    const timer = setTimeout(() => inputRef.current?.focus(), 50)
    return () => clearTimeout(timer)
  }, [open, hasFinished])

  const note = useCallback((code: string, status: ScanLog['status'], message: string) => {
    setLog((l) => [{ id: nextId.current++, code, status, message }, ...l].slice(0, 12))
  }, [])

  const accept = useCallback(
    (item: ItemSearchRow, scanned: string) => {
      onScanned(role, item)
      note(scanned, 'added', `${item.item_name} added`)
      setChoices([])
    },
    [note, onScanned, role],
  )

  const resolve = async () => {
    const value = code.trim()
    if (!value || busy) return
    setBusy(true)
    setChoices([])
    try {
      const item = await lookupApi.itemByBarcode(value, warehouseId)
      accept(item, value)
      setCode('')
    } catch (err) {
      if (isApiError(err) && err.status === 404) {
        try {
          const found = await lookupApi.searchItems(value, { warehouseId, limit: 8 })
          if (found.length === 1) {
            accept(found[0], value)
            setCode('')
          } else if (found.length > 1) {
            setChoices(found)
            note(value, 'ambiguous', `${found.length} items match — pick one`)
          } else {
            note(value, 'missing', 'No item with that barcode, SKU or name')
            setCode('')
          }
        } catch {
          note(value, 'missing', 'Could not search for that code')
        }
      } else {
        note(value, 'missing', 'Could not look that code up')
      }
    } finally {
      setBusy(false)
      inputRef.current?.focus()
    }
  }

  return (
    <Modal
      open={open}
      title="Scan barcode"
      description="Scan or type a barcode, SKU or item code and press Enter. The field keeps focus so you can scan one after another."
      onClose={onClose}
      size="md"
      footer={
        <Button variant="secondary" onClick={onClose}>
          Done
        </Button>
      }
    >
      <SegmentedControl
        label="Add to"
        value={role}
        onChange={(v) => setRole(v)}
        options={[
          { value: 'finished', label: 'Finished product' },
          { value: 'component', label: 'Component' },
        ]}
      />
      <form
        className="mt-3 flex gap-2"
        onSubmit={(e) => {
          e.preventDefault()
          void resolve()
        }}
      >
        <Input
          ref={inputRef}
          value={code}
          onChange={(e) => setCode(e.target.value)}
          placeholder="Barcode / SKU"
          aria-label="Barcode or SKU"
          leadingIcon={ScanBarcode}
          className="flex-1"
          autoComplete="off"
        />
        <Button type="submit" loading={busy} disabled={!code.trim()}>
          Add
        </Button>
      </form>

      {choices.length > 0 ? (
        <div className="mt-3">
          <Notice kind="warning">More than one item matches that code. Pick the right one.</Notice>
          <ul className="mt-2 divide-y divide-gray-100 rounded-lg border border-gray-200">
            {choices.map((item) => (
              <li key={item.item_id}>
                <button
                  type="button"
                  className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left hover:bg-gray-50"
                  onClick={() => {
                    accept(item, code.trim())
                    setCode('')
                    inputRef.current?.focus()
                  }}
                >
                  <span className="min-w-0">
                    <span className="block truncate text-[13px] font-medium text-gray-900">{item.item_name}</span>
                    <span className="block truncate text-[11px] text-gray-500">
                      {[item.item_sku, item.unit_symbol].filter(Boolean).join(' · ')}
                      {item.stock ? ` · avail ${formatQty(item.stock.available)}` : ''}
                    </span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {log.length > 0 ? (
        <ul className="mt-3 max-h-48 space-y-1 overflow-auto" aria-live="polite">
          {log.map((row) => (
            <li key={row.id} className={cx('flex items-start gap-1.5 text-[12px]', row.status === 'added' ? 'text-emerald-700' : 'text-amber-700')}>
              {row.status === 'added' ? (
                <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
              ) : (
                <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
              )}
              <span>
                <span className="font-mono">{row.code}</span> — {row.message}
              </span>
            </li>
          ))}
        </ul>
      ) : null}
    </Modal>
  )
}
