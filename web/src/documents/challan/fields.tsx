import { useEffect, useState } from 'react'
import { isAbortError } from '../../services/api'
import type { FormOptionWarehouse } from '../../services/items'
import { lookupApi } from '../../services/lookupApi'
import type { BatchRow } from '../../services/lookupApi'
import { Select } from '../../ui/Select'
import { formatDate, formatQty } from '../../utils/format'

/**
 * Warehouse and batch selects in the Books design language.
 *
 * `documents/WarehouseSelect` and `documents/BatchPicker` do the same job for
 * the shared document editor, but they are styled by the legacy stylesheet
 * (`components/ui.css`) — a 36px, square-cornered control that reads as a
 * different app beside the 32px rounded fields this screen is built from. The
 * behaviour is the same and deliberately so; only the skin differs.
 */

interface WarehouseSelectProps {
  value: number | null
  onChange: (id: number | null) => void
  warehouses: FormOptionWarehouse[]
  emptyLabel?: string
  id?: string
  disabled?: boolean
  invalid?: boolean
  className?: string
  'aria-label'?: string
}

export function ChallanWarehouseSelect({
  value,
  onChange,
  warehouses,
  emptyLabel = 'Select warehouse…',
  id,
  disabled,
  invalid,
  className,
  'aria-label': ariaLabel,
}: WarehouseSelectProps) {
  const known = value !== null && warehouses.some((w) => w.warehouse_id === value)
  return (
    <Select
      id={id}
      value={value ?? ''}
      disabled={disabled}
      invalid={invalid}
      aria-label={ariaLabel}
      className={className}
      onChange={(e) => onChange(e.target.value === '' ? null : Number(e.target.value))}
    >
      <option value="">{emptyLabel}</option>
      {/* A warehouse the profile may no longer post to still has to render, or
          editing an old draft silently moves its line to another store. */}
      {value !== null && !known ? <option value={value}>Warehouse #{value}</option> : null}
      {warehouses.map((w) => (
        <option key={w.warehouse_id} value={w.warehouse_id}>
          {w.warehouse_name}
          {w.warehouse_code ? ` (${w.warehouse_code})` : ''}
        </option>
      ))}
    </Select>
  )
}

interface BatchSelectProps {
  itemId: number
  warehouseId: number | null
  value: number | null
  onChange: (batch: BatchRow | null) => void
  disabled?: boolean
  invalid?: boolean
  className?: string
}

/** Batches in stock for one item and warehouse (`GET /v1/batches?with_stock=1`). */
export function ChallanBatchSelect({ itemId, warehouseId, value, onChange, disabled, invalid, className }: BatchSelectProps) {
  const [rows, setRows] = useState<BatchRow[]>([])
  const [loading, setLoading] = useState(false)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    const controller = new AbortController()
    setLoading(true)
    setFailed(false)
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
        setFailed(true)
        setLoading(false)
      })
    return () => controller.abort()
  }, [itemId, warehouseId])

  const known = value !== null && rows.some((b) => b.batch_id === value)

  return (
    <Select
      value={value ?? ''}
      disabled={disabled}
      invalid={invalid}
      aria-label="Batch"
      className={className}
      onChange={(e) => {
        const id = e.target.value === '' ? null : Number(e.target.value)
        onChange(id === null ? null : (rows.find((b) => b.batch_id === id) ?? null))
      }}
    >
      <option value="">{loading ? 'Loading…' : failed ? 'Could not load' : rows.length === 0 ? 'No batches here' : 'Select batch…'}</option>
      {value !== null && !known ? <option value={value}>Batch #{value}</option> : null}
      {rows.map((b) => (
        <option key={b.batch_id} value={b.batch_id}>
          {b.batch_no}
          {b.expiry_date ? ` · exp ${formatDate(b.expiry_date)}` : ''}
          {b.stock ? ` · ${formatQty(b.stock.available)} avail` : ''}
        </option>
      ))}
    </Select>
  )
}
