import { useEffect, useState } from 'react'
import { Plus } from 'lucide-react'
import { errorMessage, isAbortError } from '../../services/api'
import { lookupApi } from '../../services/lookupApi'
import type { BatchRow } from '../../services/lookupApi'
import { formatDate, formatQty } from '../../utils/format'
import { Button } from '../../ui/Button'
import { Input } from '../../ui/Input'
import { Select } from '../../ui/Select'
import { AIC, cx } from '../../ui/cx'

interface BatchSelectProps {
  itemId: number
  warehouseId: number | null
  value: number | null
  onChange: (batch: BatchRow | null) => void
  /** Inward lines may register a batch on the spot; outward lines pick what exists. */
  allowCreate: boolean
  disabled?: boolean
  invalid?: boolean
}

/**
 * Batch (lot) for a line — `GET /v1/batches?item_id&with_stock=1&warehouse_id`.
 *
 * Outward lines see what each batch actually has available at that warehouse, so
 * a batch with nothing in it is visibly a dead end before it is chosen. Inward
 * lines get quick-create, because receiving a new lot is the normal case.
 */
export function BatchSelect({ itemId, warehouseId, value, onChange, allowCreate, disabled, invalid }: BatchSelectProps) {
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
    setSaving(true)
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
    } finally {
      setSaving(false)
    }
  }

  if (creating) {
    return (
      <div className={cx(AIC, 'flex flex-col gap-1')}>
        <Input placeholder="Batch no." aria-label="New batch number" value={batchNo} onChange={(e) => setBatchNo(e.target.value)} />
        <Input type="date" aria-label="Expiry date" value={expiry} onChange={(e) => setExpiry(e.target.value)} />
        <div className="flex gap-1">
          <Button size="xs" loading={saving} disabled={!batchNo.trim()} onClick={() => void create()}>
            Add
          </Button>
          <Button size="xs" variant="ghost" onClick={() => setCreating(false)}>
            Cancel
          </Button>
        </div>
        {error ? <span className="text-[10px] text-red-600">{error}</span> : null}
      </div>
    )
  }

  return (
    <div className={cx(AIC, 'flex flex-col gap-0.5')}>
      <Select
        aria-label="Batch"
        disabled={disabled}
        invalid={invalid}
        value={value ?? ''}
        onChange={(e) => {
          const id = e.target.value === '' ? null : Number(e.target.value)
          onChange(id === null ? null : (rows.find((b) => b.batch_id === id) ?? null))
        }}
      >
        <option value="">{loading ? 'Loading batches…' : rows.length === 0 ? 'No batches' : 'Select batch'}</option>
        {value !== null && !known ? <option value={value}>Batch #{value}</option> : null}
        {rows.map((b) => (
          <option key={b.batch_id} value={b.batch_id}>
            {b.batch_no}
            {b.expiry_date ? ` · exp ${formatDate(b.expiry_date)}` : ''}
            {b.stock ? ` · ${formatQty(b.stock.available)} avail` : ''}
          </option>
        ))}
      </Select>
      {allowCreate && !disabled ? (
        <button
          type="button"
          onClick={() => setCreating(true)}
          className="inline-flex items-center gap-0.5 self-start text-[10px] font-medium text-primary hover:underline"
        >
          <Plus className="h-3 w-3" aria-hidden /> New batch
        </button>
      ) : null}
    </div>
  )
}
