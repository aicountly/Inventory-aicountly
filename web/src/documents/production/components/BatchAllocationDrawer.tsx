import { useEffect, useMemo, useState } from 'react'
import { Layers, Search } from 'lucide-react'
import { Badge } from '../../../ui/Badge'
import { Button } from '../../../ui/Button'
import { Drawer } from '../../../ui/Drawer'
import { EmptyState } from '../../../ui/EmptyState'
import { ErrorState } from '../../../ui/ErrorState'
import { Input } from '../../../ui/Input'
import { SkeletonRows } from '../../../ui/Skeleton'
import { cx } from '../../../ui/cx'
import { errorMessage, isAbortError } from '../../../services/api'
import { lookupApi } from '../../../services/lookupApi'
import type { BatchRow } from '../../../services/lookupApi'
import { formatDate, formatQty } from '../../../utils/format'

export interface BatchAllocationDrawerProps {
  open: boolean
  itemId: number | null
  itemName: string
  warehouseId: number | null
  warehouseLabel: string
  requiredBase: number
  selectedBatchId: number | null
  fefoEnabled: boolean
  onClose: () => void
  onSelect: (batch: BatchRow | null) => void
}

/** Days ahead of the document date a batch is called out as expiring soon. */
export const EXPIRY_WINDOW_DAYS = 30

export function expiresSoon(expiry: string | null | undefined, today = new Date()): boolean {
  if (!expiry) return false
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(expiry)
  if (!match) return false
  const due = Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]))
  const now = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate())
  const days = (due - now) / 86_400_000
  return days <= EXPIRY_WINDOW_DAYS
}

/**
 * Pick the lot this line is issued from.
 *
 * Batches are read live for the item AND the warehouse the line issues from, so a lot sitting in
 * another store is never offered here — it would post a consumption against stock that is not
 * there. Selection is the user's: FEFO is surfaced as an ordering and a hint, never applied
 * behind their back, because an allocation nobody made is one nobody can explain to a recall
 * auditor.
 */
export function BatchAllocationDrawer({
  open,
  itemId,
  itemName,
  warehouseId,
  warehouseLabel,
  requiredBase,
  selectedBatchId,
  fefoEnabled,
  onClose,
  onSelect,
}: BatchAllocationDrawerProps) {
  const [rows, setRows] = useState<BatchRow[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [filter, setFilter] = useState('')
  const [tick, setTick] = useState(0)

  useEffect(() => {
    if (!open || itemId === null) return undefined
    const controller = new AbortController()
    setLoading(true)
    setError(null)
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
        setError(errorMessage(err, 'Batches could not be loaded.'))
        setLoading(false)
      })
    return () => controller.abort()
  }, [open, itemId, warehouseId, tick])

  const visible = useMemo(() => {
    const q = filter.trim().toLowerCase()
    const list = q ? rows.filter((b) => b.batch_no.toLowerCase().includes(q) || (b.lot_no ?? '').toLowerCase().includes(q)) : rows
    // Earliest expiry first — the order FEFO would consume in. Batches with no expiry come last.
    return [...list].sort((a, b) => {
      if (!a.expiry_date && !b.expiry_date) return a.batch_no.localeCompare(b.batch_no)
      if (!a.expiry_date) return 1
      if (!b.expiry_date) return -1
      return a.expiry_date.localeCompare(b.expiry_date)
    })
  }, [rows, filter])

  return (
    <Drawer
      open={open}
      onClose={onClose}
      width="md"
      title="Allocate a batch"
      description={`${itemName} — ${formatQty(requiredBase)} required from ${warehouseLabel || 'the selected warehouse'}`}
      footer={
        <div className="flex items-center justify-between gap-3">
          <Button variant="ghost" size="sm" onClick={() => onSelect(null)} disabled={selectedBatchId === null}>
            Clear allocation
          </Button>
          <Button variant="secondary" size="sm" onClick={onClose}>
            Done
          </Button>
        </div>
      }
    >
      <div className="space-y-3">
        <Input
          value={filter}
          leadingIcon={Search}
          placeholder="Filter by batch or lot number…"
          aria-label="Filter batches"
          onChange={(e) => setFilter(e.target.value)}
        />

        {fefoEnabled ? (
          <p className="rounded-lg bg-primary-light px-3 py-2 text-[11px] leading-relaxed text-primary">
            FEFO is enabled for this company. Batches are listed earliest-expiry first; choosing the top one keeps the
            shelf-life order.
          </p>
        ) : null}

        {error ? (
          <ErrorState size="sm" title="Batches could not be loaded" description={error} onRetry={() => setTick((t) => t + 1)} />
        ) : loading ? (
          <SkeletonRows rows={5} />
        ) : visible.length === 0 ? (
          <EmptyState
            icon={Layers}
            size="sm"
            title="No batch in this warehouse"
            description={
              warehouseId === null
                ? 'Choose the warehouse this line issues from and the batches held there will be listed.'
                : 'This item has no active batch with stock in the selected warehouse. It can still be issued at warehouse level.'
            }
          />
        ) : (
          <ul className="flex flex-col gap-1.5">
            {visible.map((batch) => {
              const available = batch.stock?.available ?? 0
              const covers = available + 0.0001 >= requiredBase
              const selected = batch.batch_id === selectedBatchId
              const soon = expiresSoon(batch.expiry_date)
              return (
                <li key={batch.batch_id}>
                  <button
                    type="button"
                    onClick={() => onSelect(batch)}
                    aria-pressed={selected}
                    className={cx(
                      'flex w-full items-center justify-between gap-3 rounded-xl border px-3 py-2.5 text-left transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/30',
                      selected ? 'border-primary bg-primary-light' : 'border-gray-200 hover:border-gray-300 hover:bg-gray-50',
                    )}
                  >
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold text-gray-900">{batch.batch_no}</p>
                      <p className="mt-0.5 text-[11px] text-gray-500">
                        {batch.expiry_date ? `Expires ${formatDate(batch.expiry_date)}` : 'No expiry'}
                        {batch.lot_no ? ` · lot ${batch.lot_no}` : ''}
                        {' · available '}
                        <span className="font-semibold tabular-nums text-gray-700">{formatQty(available)}</span>
                      </p>
                    </div>
                    <div className="flex shrink-0 flex-col items-end gap-1">
                      {soon ? <Badge tone="warning" size="xs">Expiring soon</Badge> : null}
                      <Badge tone={covers ? 'success' : 'warning'} size="xs">
                        {covers ? 'Covers the line' : 'Partial'}
                      </Badge>
                    </div>
                  </button>
                </li>
              )
            })}
          </ul>
        )}

        <p className="rounded-lg bg-gray-50 px-3 py-2.5 text-[11px] leading-relaxed text-gray-600">
          Leaving a batch-controlled component unallocated is allowed — the posting engine records the issue at
          warehouse level — but the batch trail for this consumption stops at this document.
        </p>
      </div>
    </Drawer>
  )
}

export default BatchAllocationDrawer
