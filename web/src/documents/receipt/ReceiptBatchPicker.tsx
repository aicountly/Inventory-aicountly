import { useEffect, useState } from 'react'
import { Plus } from 'lucide-react'
import { errorMessage, isAbortError } from '../../services/api'
import { lookupApi } from '../../services/lookupApi'
import type { BatchRow } from '../../services/lookupApi'
import { Button } from '../../ui/Button'
import { Input } from '../../ui/Input'
import { Select } from '../../ui/Select'
import { AIC, cx } from '../../ui/cx'
import { formatDate, formatQty } from '../../utils/format'

export interface ReceiptBatchPickerProps {
  itemId: number
  warehouseId: number | null
  value: number | null
  onChange: (batch: BatchRow | null) => void
  disabled?: boolean
  invalid?: boolean
}

/**
 * Batch (lot) for a receipt line: pick one that exists, or register the one
 * written on the drum in front of you without leaving the row.
 *
 * Creating from here is the point. A batch-tracked item arriving on a new lot
 * is the ordinary case at a goods-inward desk, and sending the clerk to Masters
 * to create it first is how a receipt ends up posted with no batch at all.
 * `POST /v1/batches` — the same endpoint the batch master uses.
 */
export function ReceiptBatchPicker({ itemId, warehouseId, value, onChange, disabled, invalid }: ReceiptBatchPickerProps) {
  const [rows, setRows] = useState<BatchRow[]>([])
  const [loading, setLoading] = useState(false)
  const [creating, setCreating] = useState(false)
  const [batchNo, setBatchNo] = useState('')
  const [expiry, setExpiry] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [tick, setTick] = useState(0)

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
    setSaving(true)
    try {
      const created = await lookupApi.createBatch({ item_id: itemId, batch_no: no, expiry_date: expiry || null })
      setCreating(false)
      setBatchNo('')
      setExpiry('')
      setTick((t) => t + 1)
      onChange(created)
    } catch (err) {
      setError(errorMessage(err, 'Could not create the batch.'))
    } finally {
      setSaving(false)
    }
  }

  if (creating) {
    return (
      <div className={cx(AIC, 'flex flex-col gap-1')}>
        <Input
          autoFocus
          size="sm"
          placeholder="Batch / lot no."
          aria-label="New batch number"
          value={batchNo}
          disabled={saving}
          onChange={(e) => setBatchNo(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              void create()
            } else if (e.key === 'Escape') {
              e.stopPropagation()
              setCreating(false)
            }
          }}
        />
        <Input size="sm" type="date" aria-label="Expiry date" value={expiry} disabled={saving} onChange={(e) => setExpiry(e.target.value)} />
        <div className="flex items-center gap-1">
          <Button size="xs" onClick={() => void create()} loading={saving} disabled={!batchNo.trim()}>
            Add
          </Button>
          <Button size="xs" variant="ghost" onClick={() => setCreating(false)} disabled={saving}>
            Cancel
          </Button>
        </div>
        {error ? <span className="text-[11px] text-red-600">{error}</span> : null}
      </div>
    )
  }

  return (
    <div className={cx(AIC, 'flex flex-col gap-0.5')}>
      <Select
        size="md"
        aria-label="Batch or lot"
        invalid={invalid}
        value={value ?? ''}
        disabled={disabled}
        onChange={(e) => {
          const id = e.target.value === '' ? null : Number(e.target.value)
          onChange(id === null ? null : (rows.find((b) => b.batch_id === id) ?? null))
        }}
      >
        <option value="">{loading ? 'Loading…' : rows.length === 0 ? 'No batches yet' : 'Select batch'}</option>
        {value !== null && !known ? <option value={value}>Batch #{value}</option> : null}
        {rows.map((b) => (
          <option key={b.batch_id} value={b.batch_id}>
            {b.batch_no}
            {b.expiry_date ? ` · exp ${formatDate(b.expiry_date)}` : ''}
            {b.stock ? ` · ${formatQty(b.stock.available)}` : ''}
          </option>
        ))}
      </Select>
      {!disabled ? (
        <button
          type="button"
          onClick={() => setCreating(true)}
          className="inline-flex items-center gap-0.5 self-start text-[11px] font-medium text-primary hover:underline"
        >
          <Plus className="w-3 h-3" aria-hidden />
          New batch
        </button>
      ) : null}
    </div>
  )
}

export default ReceiptBatchPicker
