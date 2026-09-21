import { useState } from 'react'
import type { FormOptionWarehouse } from '../../services/items'
import type { BatchRow } from '../../services/lookupApi'
import { errorMessage } from '../../services/api'
import { Button } from '../../ui/Button'
import { Input } from '../../ui/Input'
import { Select } from '../../ui/Select'
import { formatDate, formatQty } from '../../utils/format'

export interface WarehouseFieldProps {
  id?: string
  value: number | null
  onChange: (id: number | null) => void
  warehouses: readonly FormOptionWarehouse[]
  emptyLabel?: string
  size?: 'sm' | 'md'
  disabled?: boolean
  invalid?: boolean
  'aria-label'?: string
  className?: string
}

/**
 * Warehouse picker in the Books-language `Select`.
 *
 * `documents/WarehouseSelect` renders the legacy `.select` element, which every other document
 * editor still uses; mixing the two inside one card puts two different focus rings and two
 * different corner radii side by side. Same options, same contract, the workspace's styling.
 */
export function WarehouseField({ id, value, onChange, warehouses, emptyLabel = 'Select warehouse…', size = 'sm', disabled, invalid, className, ...rest }: WarehouseFieldProps) {
  const known = value !== null && warehouses.some((w) => w.warehouse_id === value)
  return (
    <Select
      id={id}
      size={size}
      value={value ?? ''}
      disabled={disabled}
      invalid={invalid}
      className={className}
      aria-label={rest['aria-label']}
      onChange={(e) => onChange(e.target.value === '' ? null : Number(e.target.value))}
    >
      <option value="">{emptyLabel}</option>
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

/** Sentinel option value: picking it opens the inline create form rather than selecting a batch. */
const NEW_BATCH = '__new__'

export interface BatchFieldProps {
  value: number | null
  valueLabel: string | null
  rows: readonly BatchRow[] | undefined
  loading: boolean
  onChange: (batch: Pick<BatchRow, 'batch_id' | 'batch_no'> | null) => void
  /** Register a batch that does not exist yet — only where the inventory rules allow it. */
  onCreate?: (body: { batch_no: string; expiry_date: string | null }) => Promise<BatchRow>
  disabled?: boolean
  invalid?: boolean
  placeholder?: string
  'aria-label': string
}

/**
 * One end of a line's batch mapping. Options carry what the operator needs to choose between two
 * lots — how much is on hand and when it expires — straight from `GET /v1/batches?with_stock=1`.
 */
export function BatchField({ value, valueLabel, rows, loading, onChange, onCreate, disabled, invalid, placeholder = 'Select batch…', ...rest }: BatchFieldProps) {
  const [creating, setCreating] = useState(false)
  const [batchNo, setBatchNo] = useState('')
  const [expiry, setExpiry] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const known = value !== null && (rows ?? []).some((b) => b.batch_id === value)

  const submit = async () => {
    const no = batchNo.trim()
    if (!no || !onCreate) return
    setBusy(true)
    setError(null)
    try {
      const created = await onCreate({ batch_no: no, expiry_date: expiry || null })
      onChange(created)
      setCreating(false)
      setBatchNo('')
      setExpiry('')
    } catch (err) {
      setError(errorMessage(err, 'Could not create the batch.'))
    } finally {
      setBusy(false)
    }
  }

  if (creating) {
    return (
      <div className="flex flex-col gap-1">
        <Input value={batchNo} onChange={(e) => setBatchNo(e.target.value)} placeholder="Batch no." aria-label="New batch number" autoFocus />
        <Input type="date" value={expiry} onChange={(e) => setExpiry(e.target.value)} aria-label="New batch expiry date" />
        <div className="flex items-center gap-1">
          <Button size="xs" onClick={() => void submit()} loading={busy} disabled={!batchNo.trim()}>
            Add
          </Button>
          <Button size="xs" variant="ghost" onClick={() => setCreating(false)} disabled={busy}>
            Cancel
          </Button>
        </div>
        {error ? <span className="text-[10px] text-red-600">{error}</span> : null}
      </div>
    )
  }

  return (
    <Select
      value={value ?? ''}
      disabled={disabled}
      invalid={invalid}
      aria-label={rest['aria-label']}
      onChange={(e) => {
        if (e.target.value === NEW_BATCH) {
          setCreating(true)
          return
        }
        const id = e.target.value === '' ? null : Number(e.target.value)
        onChange(id === null ? null : ((rows ?? []).find((b) => b.batch_id === id) ?? null))
      }}
    >
      <option value="">{loading ? 'Loading batches…' : (rows?.length ?? 0) === 0 ? 'No batches' : placeholder}</option>
      {value !== null && !known ? <option value={value}>{valueLabel ?? `Batch #${value}`}</option> : null}
      {(rows ?? []).map((b) => (
        <option key={b.batch_id} value={b.batch_id}>
          {b.batch_no}
          {b.stock ? ` · avail ${formatQty(b.stock.available)}` : ''}
          {b.expiry_date ? ` · exp ${formatDate(b.expiry_date)}` : ''}
        </option>
      ))}
      {/* An option rather than a link under the select: a control that appears below one cell
          makes that row taller than its neighbours, and a table of unequal rows is harder to
          read down than any one row is to fill in. */}
      {onCreate && !disabled ? <option value={NEW_BATCH}>+ Register a new batch…</option> : null}
    </Select>
  )
}
