import { useEffect, useState } from 'react'
import { errorMessage, isAbortError } from '../services/api'
import { lookupApi } from '../services/lookupApi'
import type { BatchRow } from '../services/lookupApi'
import { Button } from '../ui/Button'
import { Input } from '../ui/Input'
import { Select } from '../ui/Select'
import { formatDate, formatQty } from '../utils/format'

interface BatchPickerProps {
  itemId: number
  warehouseId: number | null
  value: number | null
  onChange: (batch: BatchRow | null) => void
  /** Inward lines may register a new batch on the spot. */
  allowCreate: boolean
  disabled?: boolean
  invalid?: boolean
  /**
   * Which field styling to use.
   *
   * `legacy` is the hand-written `.select` / `.btn` of components/ui.css that the existing
   * document editors are laid out against, and stays the default so their rows do not move.
   * `field` renders the Books-language primitives, for screens built on the new design system.
   * One picker, two skins — the same arrangement as WarehouseSelect.
   */
  variant?: 'legacy' | 'field'
  /** Shown as the empty option when the item takes a new batch on posting (inward lines). */
  autoLabel?: string
}

/** Batch (lot) select for a line: `GET /v1/batches?item_id&with_stock=1&warehouse_id`, plus quick-create for receipts. */
export function BatchPicker({ itemId, warehouseId, value, onChange, allowCreate, disabled, invalid, variant = 'legacy', autoLabel }: BatchPickerProps) {
  const [rows, setRows] = useState<BatchRow[]>([])
  const [loading, setLoading] = useState(false)
  const [creating, setCreating] = useState(false)
  const [batchNo, setBatchNo] = useState('')
  const [expiry, setExpiry] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [tick, setTick] = useState(0)
  const modern = variant === 'field'

  useEffect(() => {
    const controller = new AbortController()
    setLoading(true)
    lookupApi
      .batches(itemId, { warehouseId, signal: controller.signal })
      .then((res) => {
        if (controller.signal.aborted) return
        setRows(res.data)
        setLoading(false)
      })
      .catch((err: unknown) => {
        if (controller.signal.aborted || isAbortError(err)) return
        setRows([])
        setLoading(false)
      })
    return () => controller.abort()
  }, [itemId, warehouseId, tick])

  const known = value !== null && rows.some((b) => b.batch_id === value)

  const create = async () => {
    const no = batchNo.trim()
    if (!no) return
    setError(null)
    try {
      const created = await lookupApi.createBatch({ item_id: itemId, batch_no: no, expiry_date: expiry || null })
      setCreating(false)
      setBatchNo('')
      setExpiry('')
      setTick((t) => t + 1)
      onChange(created)
    } catch (err) {
      setError(errorMessage(err, 'Could not create the batch.'))
    }
  }

  if (creating) {
    return (
      <div className="stack" style={{ gap: '0.25rem' }}>
        {modern ? (
          <>
            <Input placeholder="Batch no." value={batchNo} onChange={(e) => setBatchNo(e.target.value)} aria-label="New batch number" />
            <Input type="date" value={expiry} onChange={(e) => setExpiry(e.target.value)} aria-label="Expiry date" />
            <div className="flex gap-1">
              <Button size="xs" onClick={() => void create()} disabled={!batchNo.trim()}>
                Add
              </Button>
              <Button size="xs" variant="ghost" onClick={() => setCreating(false)}>
                Cancel
              </Button>
            </div>
          </>
        ) : (
          <>
            <input className="input input-sm" placeholder="Batch no." value={batchNo} onChange={(e) => setBatchNo(e.target.value)} aria-label="New batch number" />
            <input className="input input-sm" type="date" value={expiry} onChange={(e) => setExpiry(e.target.value)} aria-label="Expiry date" />
            <div className="row" style={{ gap: '0.25rem' }}>
              <button type="button" className="btn btn-sm btn-primary" onClick={() => void create()} disabled={!batchNo.trim()}>
                Add
              </button>
              <button type="button" className="btn btn-sm btn-ghost" onClick={() => setCreating(false)}>
                Cancel
              </button>
            </div>
          </>
        )}
        {error ? <span className={modern ? 'text-[11px] text-red-600' : 'field-error'}>{error}</span> : null}
      </div>
    )
  }

  const emptyLabel = loading ? 'Loading batches…' : rows.length === 0 ? (autoLabel ?? 'No batches') : (autoLabel ?? 'Select batch…')
  const options = (
    <>
      <option value="">{emptyLabel}</option>
      {value !== null && !known ? <option value={value}>Batch #{value}</option> : null}
      {rows.map((b) => (
        <option key={b.batch_id} value={b.batch_id}>
          {b.batch_no}
          {b.expiry_date ? ` · exp ${formatDate(b.expiry_date)}` : ''}
          {b.stock ? ` · avail ${formatQty(b.stock.available)}` : ''}
        </option>
      ))}
    </>
  )
  const choose = (raw: string) => {
    const id = raw === '' ? null : Number(raw)
    onChange(id === null ? null : (rows.find((b) => b.batch_id === id) ?? null))
  }

  return (
    <div className="stack" style={{ gap: '0.125rem' }}>
      {modern ? (
        <Select value={value ?? ''} disabled={disabled} invalid={invalid} aria-label="Batch" onChange={(e) => choose(e.target.value)}>
          {options}
        </Select>
      ) : (
        <select className="select" value={value ?? ''} disabled={disabled} aria-invalid={invalid || undefined} aria-label="Batch" onChange={(e) => choose(e.target.value)}>
          {options}
        </select>
      )}
      {allowCreate && !disabled ? (
        modern ? (
          <button type="button" className="self-start text-[11px] font-semibold text-primary hover:underline" onClick={() => setCreating(true)}>
            + New batch
          </button>
        ) : (
          <button type="button" className="btn-link" style={{ fontSize: '0.75rem', alignSelf: 'flex-start' }} onClick={() => setCreating(true)}>
            + New batch
          </button>
        )
      ) : null}
    </div>
  )
}
