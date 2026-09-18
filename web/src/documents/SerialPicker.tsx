import { useEffect, useMemo, useState } from 'react'
import { X } from 'lucide-react'
import { Modal } from '../components/Modal'
import { Notice } from '../components/Notice'
import { errorMessage, isAbortError } from '../services/api'
import { lookupApi } from '../services/lookupApi'
import type { SerialRow } from '../services/lookupApi'
import { Button } from '../ui/Button'
import { Input } from '../ui/Input'
import { Textarea } from '../ui/Textarea'
import { cx } from '../ui/cx'
import type { LineSerial } from './types'

interface SerialPickerProps {
  itemId: number
  itemName: string
  warehouseId: number | null
  batchId: number | null
  /** `out` picks from serials in stock; `in` picks expected serials or registers new ones. */
  direction: 'in' | 'out'
  value: LineSerial[]
  onChange: (serials: LineSerial[]) => void
  /** Base quantity of the line, to show n / required. */
  requiredCount: number
  disabled?: boolean
}

/**
 * Serial numbers for a line. Issues pick from `in_stock` serials at the warehouse; receipts
 * pick registered `expected` serials or register new ones through `POST /v1/serials/bulk`.
 */
export function SerialPicker({ itemId, itemName, warehouseId, batchId, direction, value, onChange, requiredCount, disabled }: SerialPickerProps) {
  const [open, setOpen] = useState(false)
  const [rows, setRows] = useState<SerialRow[]>([])
  const [loading, setLoading] = useState(false)
  const [filter, setFilter] = useState('')
  const [draft, setDraft] = useState<LineSerial[]>(value)
  const [newSerials, setNewSerials] = useState('')
  const [registering, setRegistering] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [tick, setTick] = useState(0)

  useEffect(() => {
    if (!open) return undefined
    setDraft(value)
    const controller = new AbortController()
    setLoading(true)
    setError(null)
    lookupApi
      .serials(itemId, { status: direction === 'out' ? 'in_stock' : 'expected', warehouseId: direction === 'out' ? warehouseId : null, batchId, limit: 500, signal: controller.signal })
      .then((res) => {
        if (controller.signal.aborted) return
        setRows(res.data)
        setLoading(false)
      })
      .catch((err: unknown) => {
        if (controller.signal.aborted || isAbortError(err)) return
        setError(errorMessage(err, 'Could not load serial numbers.'))
        setLoading(false)
      })
    return () => controller.abort()
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `value` seeds the draft only on open
  }, [open, itemId, warehouseId, batchId, direction, tick])

  const selectedIds = useMemo(() => new Set(draft.map((s) => s.serial_id)), [draft])
  const visible = useMemo(() => {
    const q = filter.trim().toLowerCase()
    return q ? rows.filter((r) => r.serial_no.toLowerCase().includes(q)) : rows
  }, [rows, filter])

  const toggle = (row: SerialRow) => {
    setDraft((d) => (selectedIds.has(row.serial_id) ? d.filter((s) => s.serial_id !== row.serial_id) : [...d, { serial_id: row.serial_id, serial_no: row.serial_no }]))
  }

  const register = async () => {
    const nos = newSerials
      .split(/[\n,;]+/)
      .map((s) => s.trim())
      .filter(Boolean)
    if (nos.length === 0) return
    setRegistering(true)
    setError(null)
    try {
      const res = await lookupApi.bulkCreateSerials({ item_id: itemId, serial_nos: nos, warehouse_id: warehouseId, batch_id: batchId })
      setDraft((d) => [...d, ...res.created.filter((c) => !d.some((s) => s.serial_id === c.serial_id))])
      setNewSerials('')
      setTick((t) => t + 1)
      if (res.skipped.length) setError(`${res.skipped.length} serial number(s) skipped: ${res.skipped.map((s) => `${s.serial_no} (${s.reason})`).join(', ')}`)
    } catch (err) {
      setError(errorMessage(err, 'Could not register serial numbers.'))
    } finally {
      setRegistering(false)
    }
  }

  const done = () => {
    onChange(draft)
    setOpen(false)
  }

  const mismatch = requiredCount > 0 && value.length > 0 && value.length !== requiredCount

  return (
    <>
      <Button variant={mismatch ? 'danger' : 'secondary'} size="xs" onClick={() => setOpen(true)} disabled={disabled}>
        Serials {value.length}
        {requiredCount > 0 ? ` / ${requiredCount}` : ''}
      </Button>
      <Modal open={open} title={`Serial numbers · ${itemName}`} onClose={() => setOpen(false)} size="lg" busy={registering} footer={
        <>
          <Button variant="secondary" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button variant="primary" onClick={done}>
            Use {draft.length} serial{draft.length === 1 ? '' : 's'}
          </Button>
        </>
      }>
        <div className="flex flex-col gap-3">
          <p className="text-xs text-gray-500">
            {direction === 'out' ? 'Pick the serial numbers being issued (in stock at the selected warehouse).' : 'Pick registered serial numbers awaiting receipt, or register new ones.'}
            {requiredCount > 0 ? ` The line needs ${requiredCount}.` : ''}
          </p>
          {error ? <Notice kind="warning">{error}</Notice> : null}
          {draft.length > 0 ? (
            <div className="flex flex-wrap gap-1.5">
              {draft.map((s) => (
                <span key={s.serial_id} className="inline-flex items-center gap-1 rounded-full border border-gray-200 bg-gray-50 py-0.5 pl-2.5 pr-1 text-xs">
                  {s.serial_no ?? `#${s.serial_id}`}
                  <button
                    type="button"
                    className="rounded-full p-0.5 text-gray-400 hover:bg-gray-200 hover:text-gray-700"
                    aria-label={`Remove ${s.serial_no ?? s.serial_id}`}
                    onClick={() => setDraft((d) => d.filter((x) => x.serial_id !== s.serial_id))}
                  >
                    <X className="h-3 w-3" aria-hidden />
                  </button>
                </span>
              ))}
            </div>
          ) : null}
          <Input placeholder="Filter serial numbers…" value={filter} onChange={(e) => setFilter(e.target.value)} aria-label="Filter serial numbers" />
          <div className="max-h-80 overflow-y-auto rounded-lg border border-gray-200">
            {loading ? <div className="px-3 py-2 text-sm text-gray-500">Loading…</div> : null}
            {!loading && visible.length === 0 ? <div className="px-3 py-2 text-sm text-gray-500">No serial numbers {direction === 'out' ? 'in stock here' : 'awaiting receipt'}.</div> : null}
            {visible.map((r, i) => (
              <label
                key={r.serial_id}
                className={cx('flex cursor-pointer items-center gap-2 px-3 py-1.5 text-sm hover:bg-gray-50', i > 0 && 'border-t border-gray-100')}
              >
                <input type="checkbox" className="h-3.5 w-3.5 rounded border-gray-300 text-primary focus:ring-primary/30" checked={selectedIds.has(r.serial_id)} onChange={() => toggle(r)} />
                <span className="font-mono text-xs">{r.serial_no}</span>
                <span className="text-xs text-gray-500">{[r.batch_no, r.warehouse_name].filter(Boolean).join(' · ')}</span>
              </label>
            ))}
          </div>
          {direction === 'in' ? (
            <div className="flex flex-col gap-1.5">
              <label className="text-[11px] font-semibold uppercase tracking-wide text-gray-500" htmlFor={`new-serials-${itemId}`}>
                Register new serial numbers (one per line)
              </label>
              <Textarea id={`new-serials-${itemId}`} value={newSerials} onChange={(e) => setNewSerials(e.target.value)} placeholder={'SN-0001\nSN-0002'} />
              <div>
                <Button variant="secondary" size="sm" onClick={() => void register()} disabled={registering || !newSerials.trim()}>
                  {registering ? 'Registering…' : 'Register and select'}
                </Button>
              </div>
            </div>
          ) : null}
        </div>
      </Modal>
    </>
  )
}
