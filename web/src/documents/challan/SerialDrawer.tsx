import { useEffect, useMemo, useState } from 'react'
import { Check, Hash, RotateCcw, Search, X } from 'lucide-react'
import { errorMessage, isAbortError } from '../../services/api'
import { lookupApi } from '../../services/lookupApi'
import type { SerialRow } from '../../services/lookupApi'
import { Badge } from '../../ui/Badge'
import { Button } from '../../ui/Button'
import { Drawer } from '../../ui/Drawer'
import { EmptyState } from '../../ui/EmptyState'
import { Input } from '../../ui/Input'
import { Spinner } from '../../ui/Spinner'
import { cx } from '../../ui/cx'
import { formatQty } from '../../utils/format'
import type { LineSerial } from '../types'

interface SerialDrawerProps {
  open: boolean
  onClose: () => void
  itemId: number
  itemName: string
  warehouseId: number | null
  batchId: number | null
  /** Base quantity of the line — how many serials the line needs. */
  requiredCount: number
  value: LineSerial[]
  onChange: (serials: LineSerial[]) => void
}

/**
 * Serial numbers for one dispatch line.
 *
 * A challan issues stock, so the list is what is physically in stock at the
 * line's warehouse (`GET /v1/serials?status=in_stock`) — never a free-text box,
 * and never a serial the warehouse does not hold. Registering new serials is a
 * receipt's job and is deliberately absent here.
 */
export function SerialDrawer({ open, onClose, itemId, itemName, warehouseId, batchId, requiredCount, value, onChange }: SerialDrawerProps) {
  const [rows, setRows] = useState<SerialRow[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [filter, setFilter] = useState('')
  const [draft, setDraft] = useState<LineSerial[]>(value)
  const [tick, setTick] = useState(0)

  useEffect(() => {
    if (!open) return undefined
    setDraft(value)
    setFilter('')
    const controller = new AbortController()
    setLoading(true)
    setError(null)
    lookupApi
      .serials(itemId, { status: 'in_stock', warehouseId, batchId, limit: 500, signal: controller.signal })
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
    // `value` seeds the draft when the drawer opens and must not re-run the read.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, itemId, warehouseId, batchId, tick])

  const selectedIds = useMemo(() => new Set(draft.map((s) => s.serial_id)), [draft])
  const visible = useMemo(() => {
    const q = filter.trim().toLowerCase()
    return q ? rows.filter((r) => r.serial_no.toLowerCase().includes(q)) : rows
  }, [rows, filter])

  const toggle = (row: SerialRow) => {
    setDraft((d) => (selectedIds.has(row.serial_id) ? d.filter((s) => s.serial_id !== row.serial_id) : [...d, { serial_id: row.serial_id, serial_no: row.serial_no }]))
  }

  const fillToRequired = () => {
    if (requiredCount <= 0) return
    setDraft((d) => {
      const have = new Set(d.map((s) => s.serial_id))
      const next = [...d]
      for (const row of visible) {
        if (next.length >= requiredCount) break
        if (have.has(row.serial_id)) continue
        next.push({ serial_id: row.serial_id, serial_no: row.serial_no })
      }
      return next
    })
  }

  const exact = requiredCount > 0 && draft.length === requiredCount

  return (
    <Drawer
      open={open}
      onClose={onClose}
      title="Select serial numbers"
      description={itemName}
      width="md"
      badge={
        <Badge tone={exact ? 'success' : draft.length > requiredCount ? 'danger' : 'warning'} size="xs">
          {draft.length} / {formatQty(requiredCount)}
        </Badge>
      }
      footer={
        <div className="flex items-center justify-between gap-3">
          <span className={cx('text-xs', exact ? 'text-emerald-700' : 'text-amber-700')}>
            {requiredCount <= 0
              ? 'Enter a quantity on the line first.'
              : exact
                ? 'Every unit on this line has a serial number.'
                : draft.length > requiredCount
                  ? `${draft.length - requiredCount} more selected than the line dispatches.`
                  : `${formatQty(requiredCount - draft.length)} more needed.`}
          </span>
          <span className="flex shrink-0 items-center gap-2">
            <Button variant="secondary" onClick={onClose}>
              Cancel
            </Button>
            <Button
              variant="primary"
              icon={Check}
              onClick={() => {
                onChange(draft)
                onClose()
              }}
            >
              Use {draft.length}
            </Button>
          </span>
        </div>
      }
    >
      <div className="space-y-3">
        {draft.length > 0 ? (
          <div className="flex flex-wrap gap-1.5">
            {draft.map((s) => (
              <span key={s.serial_id} className="inline-flex items-center gap-1 rounded-md border border-primary/20 bg-primary-light px-1.5 py-0.5 font-mono text-[11px] text-primary">
                {s.serial_no ?? `#${s.serial_id}`}
                <button
                  type="button"
                  className="rounded p-0.5 hover:bg-white/60"
                  aria-label={`Remove ${s.serial_no ?? s.serial_id}`}
                  onClick={() => setDraft((d) => d.filter((x) => x.serial_id !== s.serial_id))}
                >
                  <X className="h-3 w-3" />
                </button>
              </span>
            ))}
          </div>
        ) : null}

        <div className="flex items-center gap-2">
          <Input className="flex-1" leadingIcon={Search} placeholder="Filter serial numbers…" value={filter} onChange={(e) => setFilter(e.target.value)} aria-label="Filter serial numbers" />
          <Button variant="secondary" size="sm" disabled={requiredCount <= 0 || draft.length >= requiredCount || visible.length === 0} onClick={fillToRequired}>
            Fill to {formatQty(requiredCount)}
          </Button>
        </div>

        {loading ? (
          <div className="flex items-center gap-2 py-6 text-sm text-gray-500">
            <Spinner /> Loading serial numbers…
          </div>
        ) : error ? (
          <div className="flex items-center justify-between gap-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
            <span className="min-w-0">{error}</span>
            <Button variant="secondary" size="xs" icon={RotateCcw} onClick={() => setTick((t) => t + 1)}>
              Retry
            </Button>
          </div>
        ) : visible.length === 0 ? (
          <EmptyState
            icon={Hash}
            title={filter.trim() ? 'No serial matches that filter' : 'No serial numbers in stock here'}
            description={filter.trim() ? undefined : 'Nothing is in stock for this item at the selected warehouse and batch.'}
          />
        ) : (
          <ul className="divide-y divide-gray-100 overflow-hidden rounded-lg border border-gray-200">
            {visible.map((row) => {
              const checked = selectedIds.has(row.serial_id)
              return (
                <li key={row.serial_id}>
                  <label className={cx('flex cursor-pointer items-center gap-2.5 px-3 py-2 transition-colors', checked ? 'bg-primary-light/60' : 'hover:bg-gray-50')}>
                    <input type="checkbox" checked={checked} onChange={() => toggle(row)} className="h-3.5 w-3.5 shrink-0 accent-[rgb(var(--color-primary))]" />
                    <span className="min-w-0 flex-1 truncate font-mono text-xs text-gray-900">{row.serial_no}</span>
                    <span className="shrink-0 truncate text-[11px] text-gray-500">{[row.batch_no, row.warehouse_name].filter(Boolean).join(' · ')}</span>
                  </label>
                </li>
              )
            })}
          </ul>
        )}
      </div>
    </Drawer>
  )
}
