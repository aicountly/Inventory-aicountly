import { useEffect, useMemo, useState } from 'react'
import { Hash } from 'lucide-react'
import { Modal } from '../../components/Modal'
import { errorMessage, isAbortError } from '../../services/api'
import { lookupApi } from '../../services/lookupApi'
import type { SerialRow } from '../../services/lookupApi'
import { Button } from '../../ui/Button'
import { Input } from '../../ui/Input'
import { Textarea } from '../../ui/Textarea'
import { AIC, cx } from '../../ui/cx'
import type { LineSerial } from '../types'

interface SerialSelectProps {
  itemId: number
  itemName: string
  warehouseId: number | null
  batchId: number | null
  direction: 'in' | 'out'
  value: LineSerial[]
  onChange: (serials: LineSerial[]) => void
  /** Base quantity of the line: exactly how many numbers it needs. */
  requiredCount: number
  /** Serial ids already claimed by other lines of this journal. */
  usedElsewhere: ReadonlySet<number>
  disabled?: boolean
}

/**
 * Serial numbers for a line.
 *
 * Out picks from what is in stock at that warehouse; In picks registered
 * "expected" numbers or registers new ones. A number already used by another
 * line of the same journal is shown but cannot be chosen twice — the server
 * would reject the document, and finding that out on post means retyping the
 * whole grid.
 */
export function SerialSelect({
  itemId,
  itemName,
  warehouseId,
  batchId,
  direction,
  value,
  onChange,
  requiredCount,
  usedElsewhere,
  disabled,
}: SerialSelectProps) {
  const [open, setOpen] = useState(false)
  const [rows, setRows] = useState<SerialRow[]>([])
  const [loading, setLoading] = useState(false)
  const [filter, setFilter] = useState('')
  const [draft, setDraft] = useState<LineSerial[]>(value)
  const [newSerials, setNewSerials] = useState('')
  const [registering, setRegistering] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [tick, setTick] = useState(0)

  useEffect(() => {
    if (!open) return undefined
    setDraft(value)
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
        setError(errorMessage(err, 'Could not load serial numbers.'))
        setLoading(false)
      })
    return () => controller.abort()
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `value` seeds the draft only on open
  }, [open, itemId, warehouseId, batchId, direction, tick])

  const selectedIds = useMemo(() => new Set(draft.map((s) => s.serial_id)), [draft])
  const visible = useMemo(() => {
    const q = filter.trim().toLowerCase()
    return q ? rows.filter((r) => r.serial_no.toLowerCase().includes(q)) : rows
  }, [rows, filter])

  const toggle = (row: SerialRow) => {
    if (usedElsewhere.has(row.serial_id) && !selectedIds.has(row.serial_id)) return
    setDraft((d) =>
      selectedIds.has(row.serial_id)
        ? d.filter((s) => s.serial_id !== row.serial_id)
        : [...d, { serial_id: row.serial_id, serial_no: row.serial_no }],
    )
  }

  const register = async () => {
    const nos = newSerials.split(/[\n,;]+/).map((s) => s.trim()).filter(Boolean)
    if (nos.length === 0) return
    setRegistering(true)
    setError(null)
    try {
      const res = await lookupApi.bulkCreateSerials({ item_id: itemId, serial_nos: nos, warehouse_id: warehouseId, batch_id: batchId })
      setDraft((d) => [...d, ...res.created.filter((c) => !d.some((s) => s.serial_id === c.serial_id))])
      setNewSerials('')
      setTick((t) => t + 1)
      if (res.skipped.length) {
        setError(`${res.skipped.length} skipped: ${res.skipped.map((s) => `${s.serial_no} (${s.reason})`).join(', ')}`)
      }
    } catch (err) {
      setError(errorMessage(err, 'Could not register serial numbers.'))
    } finally {
      setRegistering(false)
    }
  }

  const mismatch = requiredCount > 0 && value.length > 0 && value.length !== requiredCount
  const missing = requiredCount > 0 && value.length === 0

  return (
    <>
      <button
        type="button"
        disabled={disabled}
        onClick={() => setOpen(true)}
        className={cx(
          AIC,
          'inline-flex h-8 w-full items-center justify-center gap-1 rounded-lg border px-2 text-[11px] font-semibold transition-colors disabled:opacity-60',
          mismatch || missing
            ? 'border-red-300 bg-red-50 text-red-700 hover:bg-red-100'
            : value.length > 0
              ? 'border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100'
              : 'border-gray-200 bg-white text-gray-600 hover:bg-gray-50',
        )}
      >
        <Hash className="h-3 w-3" aria-hidden />
        {value.length}
        {requiredCount > 0 ? ` / ${requiredCount}` : ''}
      </button>

      <Modal
        open={open}
        title={`Serial numbers · ${itemName}`}
        description={
          direction === 'out'
            ? 'Pick the serial numbers being issued — only those in stock at the selected warehouse are listed.'
            : 'Pick registered serial numbers awaiting receipt, or register new ones.'
        }
        onClose={() => setOpen(false)}
        size="lg"
        busy={registering}
        footer={
          <>
            <Button variant="secondary" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button
              onClick={() => {
                onChange(draft)
                setOpen(false)
              }}
            >
              Use {draft.length} serial{draft.length === 1 ? '' : 's'}
            </Button>
          </>
        }
      >
        <div className={cx(AIC, 'space-y-3')}>
          {requiredCount > 0 ? (
            <p className={cx('text-xs', draft.length === requiredCount ? 'text-emerald-700' : 'text-amber-700')}>
              This line needs <strong>{requiredCount}</strong> serial number{requiredCount === 1 ? '' : 's'}; {draft.length} selected.
            </p>
          ) : null}
          {error ? <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">{error}</p> : null}

          {draft.length > 0 ? (
            <div className="flex flex-wrap gap-1">
              {draft.map((s) => (
                <span key={s.serial_id} className="inline-flex items-center gap-1 rounded-full border border-gray-200 bg-gray-50 px-2 py-0.5 font-mono text-[11px]">
                  {s.serial_no ?? `#${s.serial_id}`}
                  <button
                    type="button"
                    aria-label={`Remove ${s.serial_no ?? s.serial_id}`}
                    className="text-gray-400 hover:text-red-600"
                    onClick={() => setDraft((d) => d.filter((x) => x.serial_id !== s.serial_id))}
                  >
                    ×
                  </button>
                </span>
              ))}
            </div>
          ) : null}

          <Input placeholder="Filter serial numbers…" aria-label="Filter serial numbers" value={filter} onChange={(e) => setFilter(e.target.value)} />

          <div className="max-h-72 overflow-y-auto rounded-lg border border-gray-200">
            {loading ? <p className="px-3 py-2 text-xs text-gray-500">Loading…</p> : null}
            {!loading && visible.length === 0 ? (
              <p className="px-3 py-2 text-xs text-gray-500">
                No serial numbers {direction === 'out' ? 'in stock here' : 'awaiting receipt'}.
              </p>
            ) : null}
            {visible.map((r) => {
              const taken = usedElsewhere.has(r.serial_id) && !selectedIds.has(r.serial_id)
              return (
                <label
                  key={r.serial_id}
                  className={cx(
                    'flex items-center gap-2 border-b border-gray-100 px-3 py-1.5 text-xs last:border-b-0',
                    taken ? 'cursor-not-allowed opacity-50' : 'cursor-pointer hover:bg-gray-50',
                  )}
                >
                  <input type="checkbox" checked={selectedIds.has(r.serial_id)} disabled={taken} onChange={() => toggle(r)} />
                  <span className="font-mono">{r.serial_no}</span>
                  <span className="ml-auto text-[11px] text-gray-500">
                    {taken ? 'used on another line' : [r.batch_no, r.warehouse_name].filter(Boolean).join(' · ')}
                  </span>
                </label>
              )
            })}
          </div>

          {direction === 'in' ? (
            <div className="space-y-1.5">
              <label className="text-[11px] font-semibold uppercase tracking-wide text-gray-500" htmlFor={`sj-new-serials-${itemId}`}>
                Register new serial numbers (one per line)
              </label>
              <Textarea
                id={`sj-new-serials-${itemId}`}
                value={newSerials}
                onChange={(e) => setNewSerials(e.target.value)}
                placeholder={'SN-0001\nSN-0002'}
                monospace
              />
              <Button size="sm" variant="secondary" loading={registering} disabled={!newSerials.trim()} onClick={() => void register()}>
                Register and select
              </Button>
            </div>
          ) : null}
        </div>
      </Modal>
    </>
  )
}
