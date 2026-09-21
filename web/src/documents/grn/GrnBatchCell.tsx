import { useEffect, useState } from 'react'
import { Check, Plus, X } from 'lucide-react'
import { Button } from '../../ui/Button'
import { Input } from '../../ui/Input'
import { Select } from '../../ui/Select'
import { errorMessage, isAbortError } from '../../services/api'
import { lookupApi } from '../../services/lookupApi'
import type { BatchRow } from '../../services/lookupApi'
import { formatDate, formatQty } from '../../utils/format'

export interface GrnBatchCellProps {
  itemId: number
  warehouseId: number | null
  value: number | null
  batchNo: string | null
  /** Expiry typed in the row's Expiry column; a new batch is created with it. */
  expiryDraft: string | null
  creating: boolean
  onCreatingChange: (creating: boolean) => void
  onSelect: (batch: BatchRow | null) => void
  disabled?: boolean
  invalid?: boolean
}

/**
 * The batch (lot) a received line goes into.
 *
 * Receiving is the one moment a batch that does not exist yet legitimately appears, so creating
 * one is inline rather than a trip to Masters — `POST /v1/batches`, the same endpoint the batch
 * master uses, with the expiry taken from the row's own Expiry column so the two never disagree.
 * Choosing an existing batch copies its expiry back into that column, read-only, because expiry
 * belongs to the batch and a line may not quietly claim a different one.
 */
export function GrnBatchCell({
  itemId,
  warehouseId,
  value,
  batchNo,
  expiryDraft,
  creating,
  onCreatingChange,
  onSelect,
  disabled,
  invalid,
}: GrnBatchCellProps) {
  const [rows, setRows] = useState<BatchRow[]>([])
  const [loading, setLoading] = useState(false)
  const [draftNo, setDraftNo] = useState('')
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
    const no = draftNo.trim()
    if (!no) return
    setSaving(true)
    setError(null)
    try {
      const created = await lookupApi.createBatch({ item_id: itemId, batch_no: no, expiry_date: expiryDraft || null })
      setDraftNo('')
      onCreatingChange(false)
      setTick((t) => t + 1)
      onSelect(created)
    } catch (err) {
      setError(errorMessage(err, 'Could not create the batch.'))
    } finally {
      setSaving(false)
    }
  }

  if (creating) {
    return (
      <div className="flex flex-col gap-1">
        <div className="flex items-center gap-1">
          <Input
            size="sm"
            className="w-full"
            autoFocus
            placeholder="New batch no."
            aria-label="New batch number"
            value={draftNo}
            disabled={saving}
            onChange={(e) => setDraftNo(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault()
                void create()
              } else if (e.key === 'Escape') {
                e.preventDefault()
                e.stopPropagation()
                onCreatingChange(false)
              }
            }}
          />
          <Button variant="ghost" size="xs" icon={Check} aria-label="Create batch" loading={saving} disabled={!draftNo.trim()} onClick={() => void create()} />
          <Button variant="ghost" size="xs" icon={X} aria-label="Cancel new batch" disabled={saving} onClick={() => onCreatingChange(false)} />
        </div>
        {error ? <span className="text-[10px] text-red-600">{error}</span> : null}
      </div>
    )
  }

  return (
    <div className="flex items-center gap-1">
      <Select
        className="min-w-0 flex-1"
        aria-label="Batch or lot"
        value={value ?? ''}
        disabled={disabled}
        invalid={invalid}
        onChange={(e) => {
          const id = e.target.value === '' ? null : Number(e.target.value)
          onSelect(id === null ? null : (rows.find((b) => b.batch_id === id) ?? null))
        }}
      >
        <option value="">{loading ? 'Loading…' : rows.length === 0 ? 'No batches yet' : 'Select batch…'}</option>
        {value !== null && !known ? <option value={value}>{batchNo ?? `Batch #${value}`}</option> : null}
        {rows.map((batch) => (
          <option key={batch.batch_id} value={batch.batch_id}>
            {batch.batch_no}
            {batch.expiry_date ? ` · exp ${formatDate(batch.expiry_date)}` : ''}
            {batch.stock ? ` · ${formatQty(batch.stock.available)}` : ''}
          </option>
        ))}
      </Select>
      {!disabled ? (
        <Button variant="ghost" size="xs" icon={Plus} aria-label="Create a new batch" onClick={() => onCreatingChange(true)} />
      ) : null}
    </div>
  )
}

export default GrnBatchCell
