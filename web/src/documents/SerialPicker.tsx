import { useEffect, useMemo, useState } from 'react'
import { Modal } from '../components/Modal'
import { Notice } from '../components/Notice'
import { errorMessage, isAbortError } from '../services/api'
import { lookupApi } from '../services/lookupApi'
import type { SerialRow } from '../services/lookupApi'
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
      <button type="button" className={`btn btn-sm${mismatch ? ' btn-danger' : ''}`} onClick={() => setOpen(true)} disabled={disabled}>
        Serials {value.length}
        {requiredCount > 0 ? ` / ${requiredCount}` : ''}
      </button>
      <Modal open={open} title={`Serial numbers · ${itemName}`} onClose={() => setOpen(false)} size="lg" busy={registering} footer={
        <>
          <button type="button" className="btn" onClick={() => setOpen(false)}>
            Cancel
          </button>
          <button type="button" className="btn btn-primary" onClick={done}>
            Use {draft.length} serial{draft.length === 1 ? '' : 's'}
          </button>
        </>
      }>
        <p className="hint">
          {direction === 'out' ? 'Pick the serial numbers being issued (in stock at the selected warehouse).' : 'Pick registered serial numbers awaiting receipt, or register new ones.'}
          {requiredCount > 0 ? ` The line needs ${requiredCount}.` : ''}
        </p>
        {error ? <Notice kind="warning">{error}</Notice> : null}
        {draft.length > 0 ? (
          <div className="serial-chip-row">
            {draft.map((s) => (
              <span key={s.serial_id} className="chip">
                {s.serial_no ?? `#${s.serial_id}`}
                <button type="button" aria-label={`Remove ${s.serial_no ?? s.serial_id}`} onClick={() => setDraft((d) => d.filter((x) => x.serial_id !== s.serial_id))}>
                  ×
                </button>
              </span>
            ))}
          </div>
        ) : null}
        <input className="input" placeholder="Filter serial numbers…" value={filter} onChange={(e) => setFilter(e.target.value)} aria-label="Filter serial numbers" />
        <div className="picker-list">
          {loading ? <div className="typeahead-empty">Loading…</div> : null}
          {!loading && visible.length === 0 ? <div className="typeahead-empty">No serial numbers {direction === 'out' ? 'in stock here' : 'awaiting receipt'}.</div> : null}
          {visible.map((r) => (
            <label key={r.serial_id}>
              <input type="checkbox" checked={selectedIds.has(r.serial_id)} onChange={() => toggle(r)} />
              <span className="mono">{r.serial_no}</span>
              <span className="muted">
                {[r.batch_no, r.warehouse_name].filter(Boolean).join(' · ')}
              </span>
            </label>
          ))}
        </div>
        {direction === 'in' ? (
          <div className="stack" style={{ gap: '0.375rem' }}>
            <label className="field-label" htmlFor={`new-serials-${itemId}`}>
              Register new serial numbers (one per line)
            </label>
            <textarea id={`new-serials-${itemId}`} className="textarea" value={newSerials} onChange={(e) => setNewSerials(e.target.value)} placeholder={'SN-0001\nSN-0002'} />
            <div>
              <button type="button" className="btn btn-sm" onClick={() => void register()} disabled={registering || !newSerials.trim()}>
                {registering ? 'Registering…' : 'Register and select'}
              </button>
            </div>
          </div>
        ) : null}
      </Modal>
    </>
  )
}
