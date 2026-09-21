import { useEffect, useMemo, useState } from 'react'
import { ScanLine, Search, X } from 'lucide-react'
import { Badge } from '../../../ui/Badge'
import { Button } from '../../../ui/Button'
import { Drawer } from '../../../ui/Drawer'
import { EmptyState } from '../../../ui/EmptyState'
import { ErrorState } from '../../../ui/ErrorState'
import { Input } from '../../../ui/Input'
import { SkeletonRows } from '../../../ui/Skeleton'
import { Textarea } from '../../../ui/Textarea'
import { cx } from '../../../ui/cx'
import { errorMessage, isAbortError } from '../../../services/api'
import { lookupApi } from '../../../services/lookupApi'
import type { SerialRow } from '../../../services/lookupApi'
import { formatQty } from '../../../utils/format'
import type { LineSerial } from '../../types'

export interface SerialAllocationDrawerProps {
  open: boolean
  itemId: number | null
  itemName: string
  warehouseId: number | null
  batchId: number | null
  /** `out` picks units in stock; `in` picks expected units or registers new ones (by-products). */
  direction: 'in' | 'out'
  requiredBase: number
  value: LineSerial[]
  onClose: () => void
  onChange: (serials: LineSerial[]) => void
}

/**
 * Serial numbers for one line, picked against live stock.
 *
 * For a consumption line only serials `in_stock` at that warehouse are offered — the same set the
 * posting engine will accept, so a selection made here cannot fail at post for a reason the
 * screen could have shown. The count is stated against the line's base quantity because the
 * server rejects a partial allocation, and nothing is auto-selected: which physical unit went
 * into which finished good is a fact the operator knows and the system does not.
 */
export function SerialAllocationDrawer({
  open,
  itemId,
  itemName,
  warehouseId,
  batchId,
  direction,
  requiredBase,
  value,
  onClose,
  onChange,
}: SerialAllocationDrawerProps) {
  const [rows, setRows] = useState<SerialRow[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [filter, setFilter] = useState('')
  const [newSerials, setNewSerials] = useState('')
  const [registering, setRegistering] = useState(false)
  const [tick, setTick] = useState(0)

  useEffect(() => {
    if (!open || itemId === null) return undefined
    const controller = new AbortController()
    setLoading(true)
    setError(null)
    lookupApi
      .serials(itemId, {
        status: direction === 'out' ? 'in_stock' : 'expected',
        warehouseId: direction === 'out' ? warehouseId : null,
        batchId,
        limit: 500,
        signal: controller.signal,
      })
      .then((res) => {
        if (controller.signal.aborted) return
        setRows(res.data)
        setLoading(false)
      })
      .catch((err: unknown) => {
        if (controller.signal.aborted || isAbortError(err)) return
        setRows([])
        setError(errorMessage(err, 'Serial numbers could not be loaded.'))
        setLoading(false)
      })
    return () => controller.abort()
  }, [open, itemId, warehouseId, batchId, direction, tick])

  const selected = useMemo(() => new Set(value.map((s) => s.serial_id)), [value])
  const visible = useMemo(() => {
    const q = filter.trim().toLowerCase()
    return q ? rows.filter((r) => r.serial_no.toLowerCase().includes(q)) : rows
  }, [rows, filter])

  const toggle = (row: SerialRow) => {
    onChange(
      selected.has(row.serial_id)
        ? value.filter((s) => s.serial_id !== row.serial_id)
        : [...value, { serial_id: row.serial_id, serial_no: row.serial_no }],
    )
  }

  const register = async () => {
    const nos = newSerials
      .split(/[\n,;]+/)
      .map((s) => s.trim())
      .filter(Boolean)
    if (nos.length === 0 || itemId === null) return
    setRegistering(true)
    setError(null)
    try {
      const res = await lookupApi.bulkCreateSerials({ item_id: itemId, serial_nos: nos, warehouse_id: warehouseId, batch_id: batchId })
      onChange([...value, ...res.created.filter((c) => !value.some((s) => s.serial_id === c.serial_id))])
      setNewSerials('')
      setTick((t) => t + 1)
      if (res.skipped.length) {
        setError(`${res.skipped.length} serial number(s) skipped: ${res.skipped.map((s) => `${s.serial_no} (${s.reason})`).join(', ')}`)
      }
    } catch (err) {
      setError(errorMessage(err, 'Serial numbers could not be registered.'))
    } finally {
      setRegistering(false)
    }
  }

  const complete = requiredBase > 0 && value.length === requiredBase

  return (
    <Drawer
      open={open}
      onClose={onClose}
      width="md"
      title="Select serial numbers"
      badge={
        <Badge tone={value.length === 0 ? 'neutral' : complete ? 'success' : 'warning'} size="xs">
          {`${value.length} / ${formatQty(requiredBase, '0')}`}
        </Badge>
      }
      description={`${itemName} — ${direction === 'out' ? 'units issued from this warehouse' : 'units received into this warehouse'}`}
      footer={
        <div className="flex items-center justify-between gap-3">
          <Button variant="ghost" size="sm" onClick={() => onChange([])} disabled={value.length === 0}>
            Clear selection
          </Button>
          <Button variant="secondary" size="sm" onClick={onClose}>
            Done
          </Button>
        </div>
      }
    >
      <div className="space-y-3">
        {requiredBase > 0 && value.length > 0 && !complete ? (
          <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] leading-relaxed text-amber-800" role="status">
            {value.length} selected for a quantity of {formatQty(requiredBase)}. The server refuses a partial
            allocation — select all of them, or none.
          </p>
        ) : null}

        {value.length > 0 ? (
          <ul className="flex flex-wrap gap-1.5">
            {value.map((s) => (
              <li key={s.serial_id}>
                <span className="inline-flex items-center gap-1 rounded-full border border-gray-200 bg-gray-50 py-0.5 pl-2 pr-1 text-[11px] text-gray-700">
                  {s.serial_no ?? `#${s.serial_id}`}
                  <button
                    type="button"
                    aria-label={`Remove ${s.serial_no ?? s.serial_id}`}
                    onClick={() => onChange(value.filter((x) => x.serial_id !== s.serial_id))}
                    className="rounded-full p-0.5 text-gray-400 hover:bg-gray-200 hover:text-gray-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/30"
                  >
                    <X className="h-3 w-3" aria-hidden />
                  </button>
                </span>
              </li>
            ))}
          </ul>
        ) : null}

        <Input value={filter} leadingIcon={Search} placeholder="Filter or scan a serial number…" aria-label="Filter serial numbers" onChange={(e) => setFilter(e.target.value)} />

        {error ? <ErrorState size="sm" title="Serial numbers" description={error} onRetry={() => setTick((t) => t + 1)} /> : null}

        {loading ? (
          <SkeletonRows rows={6} />
        ) : visible.length === 0 && !error ? (
          <EmptyState
            icon={ScanLine}
            size="sm"
            title={direction === 'out' ? 'No serial numbers in stock here' : 'No serial numbers awaiting receipt'}
            description={direction === 'out' ? 'Only units in stock at the selected warehouse can be issued.' : 'Register the units below to receive them.'}
          />
        ) : (
          <ul className="max-h-72 overflow-y-auto rounded-xl border border-gray-200">
            {visible.map((row) => (
              <li key={row.serial_id} className="border-b border-gray-100 last:border-b-0">
                <label className={cx('flex cursor-pointer items-center gap-2.5 px-3 py-2 transition-colors', selected.has(row.serial_id) ? 'bg-primary-light' : 'hover:bg-gray-50')}>
                  <input
                    type="checkbox"
                    checked={selected.has(row.serial_id)}
                    onChange={() => toggle(row)}
                    className="h-3.5 w-3.5 shrink-0 accent-[rgb(var(--color-primary))]"
                  />
                  <span className="min-w-0 flex-1 truncate font-mono text-xs text-gray-900">{row.serial_no}</span>
                  <span className="shrink-0 truncate text-[11px] text-gray-500">
                    {[row.batch_no, row.warehouse_name].filter(Boolean).join(' · ')}
                  </span>
                </label>
              </li>
            ))}
          </ul>
        )}

        {direction === 'in' ? (
          <div className="space-y-2 rounded-xl border border-gray-200 p-3">
            <label htmlFor="new-serials" className="text-[11px] font-semibold uppercase tracking-wide text-gray-500">
              Register new serial numbers (one per line)
            </label>
            <Textarea id="new-serials" rows={3} value={newSerials} placeholder={'SN-0001\nSN-0002'} onChange={(e) => setNewSerials(e.target.value)} />
            <Button variant="secondary" size="sm" loading={registering} disabled={!newSerials.trim()} onClick={() => void register()}>
              Register and select
            </Button>
          </div>
        ) : null}
      </div>
    </Drawer>
  )
}

export default SerialAllocationDrawer
