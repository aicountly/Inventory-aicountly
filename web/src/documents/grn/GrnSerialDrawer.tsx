import { useEffect, useMemo, useRef, useState } from 'react'
import { AlertTriangle, Barcode, Check, ScanLine, X } from 'lucide-react'
import { Badge } from '../../ui/Badge'
import { Button } from '../../ui/Button'
import { Drawer } from '../../ui/Drawer'
import { Input } from '../../ui/Input'
import { Spinner } from '../../ui/Spinner'
import { Textarea } from '../../ui/Textarea'
import { cx } from '../../ui/cx'
import { errorMessage, isAbortError } from '../../services/api'
import { lookupApi } from '../../services/lookupApi'
import type { SerialRow } from '../../services/lookupApi'
import type { LineSerial } from '../types'

export interface GrnSerialDrawerProps {
  open: boolean
  onClose: () => void
  itemId: number
  itemName: string
  warehouseId: number | null
  batchId: number | null
  /** Base quantity on the line — how many serials the receipt owes. */
  requiredCount: number
  value: LineSerial[]
  /** Serials already captured on OTHER lines of this document. */
  usedElsewhere: ReadonlySet<string>
  onChange: (serials: LineSerial[]) => void
}

/**
 * Serial numbers for one receiving line.
 *
 * Receipts pick from serials already registered as `expected` for the item, or register new ones
 * on the spot (`POST /v1/serials/bulk`) — one paste of a scanner's output is the normal case, so
 * the box splits on newlines, commas and semicolons alike.
 *
 * The count is the point of the screen: a serialised line must carry exactly one serial per unit
 * received, and the header says so at all times rather than waiting for the post to be refused.
 * A serial already captured on another line of the same document is called out here, where it can
 * be fixed, instead of surfacing as a server error minutes later.
 */
export function GrnSerialDrawer({
  open,
  onClose,
  itemId,
  itemName,
  warehouseId,
  batchId,
  requiredCount,
  value,
  usedElsewhere,
  onChange,
}: GrnSerialDrawerProps) {
  const [rows, setRows] = useState<SerialRow[]>([])
  const [loading, setLoading] = useState(false)
  const [filter, setFilter] = useState('')
  const [draft, setDraft] = useState<LineSerial[]>(value)
  const [pasted, setPasted] = useState('')
  const [registering, setRegistering] = useState(false)
  const [note, setNote] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [tick, setTick] = useState(0)
  const pasteRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    if (!open) return undefined
    setDraft(value)
    setNote(null)
    setError(null)
    const controller = new AbortController()
    setLoading(true)
    lookupApi
      .serials(itemId, { status: 'expected', batchId, limit: 500, signal: controller.signal })
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
    // `value` seeds the draft only when the drawer opens; re-seeding on every keystroke
    // in the parent would throw away what is being picked here.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, itemId, batchId, tick])

  const selectedIds = useMemo(() => new Set(draft.map((s) => s.serial_id)), [draft])
  const visible = useMemo(() => {
    const needle = filter.trim().toLowerCase()
    return needle ? rows.filter((r) => r.serial_no.toLowerCase().includes(needle)) : rows
  }, [rows, filter])

  const clashes = useMemo(
    () => draft.filter((s) => usedElsewhere.has((s.serial_no ?? `#${s.serial_id}`).trim().toLowerCase())),
    [draft, usedElsewhere],
  )

  const toggle = (row: SerialRow) =>
    setDraft((current) =>
      selectedIds.has(row.serial_id)
        ? current.filter((s) => s.serial_id !== row.serial_id)
        : [...current, { serial_id: row.serial_id, serial_no: row.serial_no }],
    )

  const register = async () => {
    const numbers = pasted
      .split(/[\n,;]+/)
      .map((s) => s.trim())
      .filter(Boolean)
    if (numbers.length === 0) return
    setRegistering(true)
    setError(null)
    setNote(null)
    try {
      const res = await lookupApi.bulkCreateSerials({ item_id: itemId, serial_nos: numbers, warehouse_id: warehouseId, batch_id: batchId })
      setDraft((current) => [...current, ...res.created.filter((c) => !current.some((s) => s.serial_id === c.serial_id))])
      setPasted('')
      setTick((t) => t + 1)
      if (res.skipped.length) {
        setNote(`${res.skipped.length} skipped: ${res.skipped.map((s) => `${s.serial_no} (${s.reason})`).join(', ')}`)
      }
    } catch (err) {
      setError(errorMessage(err, 'Could not register those serial numbers.'))
    } finally {
      setRegistering(false)
    }
  }

  const exact = requiredCount > 0 && draft.length === requiredCount
  const tone = requiredCount === 0 ? 'neutral' : exact ? 'success' : 'warning'

  return (
    <Drawer
      open={open}
      onClose={onClose}
      width="lg"
      title={`Serial numbers — ${itemName}`}
      badge={
        <Badge tone={tone} size="xs">
          {draft.length}
          {requiredCount > 0 ? ` / ${requiredCount}` : ''} captured
        </Badge>
      }
      description="Pick registered serials awaiting receipt, or register the ones printed on the goods."
      footer={
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className={cx('text-xs', exact || requiredCount === 0 ? 'text-gray-500' : 'text-amber-700')}>
            {requiredCount === 0
              ? 'Enter a quantity on the line to see how many are needed.'
              : exact
                ? 'Every unit on this line has a serial number.'
                : `${Math.abs(requiredCount - draft.length)} ${draft.length < requiredCount ? 'still needed' : 'too many'}.`}
          </span>
          <div className="flex items-center gap-2">
            <Button variant="secondary" onClick={onClose}>
              Cancel
            </Button>
            <Button
              icon={Check}
              onClick={() => {
                onChange(draft)
                onClose()
              }}
            >
              Use {draft.length} serial{draft.length === 1 ? '' : 's'}
            </Button>
          </div>
        </div>
      }
    >
      <div className="space-y-3">
        {error ? (
          <p className="flex items-start gap-1.5 rounded-lg border border-red-200 bg-red-50 px-2.5 py-2 text-xs text-red-800" role="alert">
            <AlertTriangle className="mt-px h-3.5 w-3.5 shrink-0" aria-hidden />
            {error}
          </p>
        ) : null}
        {note ? (
          <p className="flex items-start gap-1.5 rounded-lg border border-amber-200 bg-amber-50 px-2.5 py-2 text-xs text-amber-800">
            <AlertTriangle className="mt-px h-3.5 w-3.5 shrink-0" aria-hidden />
            {note}
          </p>
        ) : null}
        {clashes.length > 0 ? (
          <p className="flex items-start gap-1.5 rounded-lg border border-red-200 bg-red-50 px-2.5 py-2 text-xs text-red-800" role="alert">
            <AlertTriangle className="mt-px h-3.5 w-3.5 shrink-0" aria-hidden />
            {clashes.map((s) => s.serial_no).join(', ')} {clashes.length === 1 ? 'is' : 'are'} already captured on another line of this
            document. A serial number can only be received once.
          </p>
        ) : null}

        {draft.length > 0 ? (
          <div className="flex flex-wrap gap-1.5">
            {draft.map((serial) => {
              const clash = usedElsewhere.has((serial.serial_no ?? `#${serial.serial_id}`).trim().toLowerCase())
              return (
                <span
                  key={serial.serial_id}
                  className={cx(
                    'inline-flex items-center gap-1 rounded-full border px-2 py-0.5 font-mono text-[11px]',
                    clash ? 'border-red-200 bg-red-50 text-red-700' : 'border-gray-200 bg-gray-50 text-gray-700',
                  )}
                >
                  {serial.serial_no ?? `#${serial.serial_id}`}
                  <button
                    type="button"
                    aria-label={`Remove ${serial.serial_no ?? serial.serial_id}`}
                    className="rounded-full p-0.5 hover:bg-white"
                    onClick={() => setDraft((current) => current.filter((s) => s.serial_id !== serial.serial_id))}
                  >
                    <X className="h-3 w-3" />
                  </button>
                </span>
              )
            })}
          </div>
        ) : null}

        <section>
          <h3 className="mb-1.5 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-gray-500">
            <ScanLine className="h-3.5 w-3.5" aria-hidden />
            Scan or paste serial numbers
          </h3>
          <Textarea
            ref={pasteRef}
            rows={3}
            monospace
            value={pasted}
            placeholder={'SN-0001\nSN-0002'}
            onChange={(e) => setPasted(e.target.value)}
            aria-label="Serial numbers to register"
          />
          <div className="mt-1.5 flex items-center gap-2">
            <Button size="sm" icon={Barcode} loading={registering} disabled={!pasted.trim()} onClick={() => void register()}>
              Register and select
            </Button>
            <span className="text-[11px] text-gray-500">One per line, or separated by commas.</span>
          </div>
        </section>

        <section>
          <div className="mb-1.5 flex items-center justify-between gap-2">
            <h3 className="text-[11px] font-semibold uppercase tracking-wide text-gray-500">Awaiting receipt</h3>
            <Input size="sm" className="w-44" placeholder="Filter…" value={filter} onChange={(e) => setFilter(e.target.value)} aria-label="Filter serial numbers" />
          </div>
          <div className="max-h-64 overflow-y-auto rounded-lg border border-gray-200">
            {loading ? (
              <p className="flex items-center justify-center gap-2 py-6 text-xs text-gray-500">
                <Spinner size="sm" /> Loading…
              </p>
            ) : visible.length === 0 ? (
              <p className="px-3 py-6 text-center text-xs text-gray-500">
                No serial numbers are registered as awaiting receipt for this item. Paste the ones printed on the goods above.
              </p>
            ) : (
              <ul className="divide-y divide-gray-100">
                {visible.map((row) => (
                  <li key={row.serial_id}>
                    <label className="flex cursor-pointer items-center gap-2.5 px-3 py-1.5 hover:bg-gray-50">
                      <input
                        type="checkbox"
                        className="h-3.5 w-3.5 shrink-0 rounded border-gray-300 text-primary focus:ring-primary/30"
                        checked={selectedIds.has(row.serial_id)}
                        onChange={() => toggle(row)}
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
          </div>
        </section>
      </div>
    </Drawer>
  )
}

export default GrnSerialDrawer
