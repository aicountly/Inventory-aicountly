import { useEffect, useState } from 'react'
import { isAbortError } from '../services/api'
import { lookupApi } from '../services/lookupApi'
import type { BatchRow } from '../services/lookupApi'
import { FilterField } from '../ui/shell/FilterBar'
import { Select } from '../ui/Select'
import { formatDate } from '../utils/format'

export interface BatchFilterProps {
  label: string
  value: string
  /** Batches belong to an item, so there is nothing to offer until one is picked. */
  itemId: number | null
  warehouseId: number | null
  onChange: (batchId: string) => void
}

/**
 * Batch select for a register toolbar.
 *
 * "Which of these rows is batch B-102?" is the question a batch column invites
 * and could not answer: the endpoints have read `batch_id` all along, and the
 * filter bar had no control that could send one.
 *
 * It loads the item's batches (`GET /v1/batches?item_id&with_stock=1`) the same
 * way the document line editor does, so the list is the one the reader already
 * knows — newest expiry first, batch number and expiry on the row.
 */
export function BatchFilter({ label, value, itemId, warehouseId, onChange }: BatchFilterProps) {
  const [rows, setRows] = useState<BatchRow[]>([])

  useEffect(() => {
    if (!itemId) {
      setRows([])
      return undefined
    }
    const controller = new AbortController()
    lookupApi
      // No status filter: a register lists closed and expired batches too, and
      // the picker has to be able to name the one in front of the reader.
      .batches(itemId, { warehouseId, status: '', signal: controller.signal })
      .then((res) => {
        if (!controller.signal.aborted) setRows(res.data)
      })
      .catch((err: unknown) => {
        if (controller.signal.aborted || isAbortError(err)) return
        setRows([])
      })
    return () => controller.abort()
  }, [itemId, warehouseId])

  // A stale batch_id from the URL would filter the register to nothing while the
  // control showed "All batches", so it is cleared with the item it belonged to.
  useEffect(() => {
    if (!itemId && value) onChange('')
  }, [itemId, value, onChange])

  return (
    <FilterField label={label}>
      <Select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        aria-label={label}
        disabled={!itemId}
        className="w-auto min-w-[9rem]"
        title={itemId ? undefined : 'Pick an item first — batches belong to one item'}
      >
        <option value="">{itemId ? 'All batches' : 'Pick an item first'}</option>
        {rows.map((b) => (
          <option key={b.batch_id} value={b.batch_id}>
            {b.batch_no}
            {b.expiry_date ? ` · exp ${formatDate(b.expiry_date)}` : ''}
          </option>
        ))}
      </Select>
    </FilterField>
  )
}

export default BatchFilter
