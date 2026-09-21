import { useEffect, useMemo, useRef, useState } from 'react'
import { ScanBarcode } from 'lucide-react'
import { Badge } from '../../ui/Badge'
import { Button } from '../../ui/Button'
import { Drawer } from '../../ui/Drawer'
import { Input } from '../../ui/Input'
import { Textarea } from '../../ui/Textarea'
import { Notice } from '../../components/Notice'
import { cx } from '../../ui/cx'
import { errorMessage, isAbortError } from '../../services/api'
import { lookupApi } from '../../services/lookupApi'
import type { SerialRow } from '../../services/lookupApi'
import { formatQty } from '../../utils/format'
import type { LineSerial } from '../types'
import type { CountRow } from './countModel'

/**
 * Naming the individual units behind a serial-tracked difference.
 *
 * The framing matters and is different from the generic serial picker: on a
 * physical count a SHORTAGE means specific units are not on the shelf, so what
 * is being picked is the list of missing serials — and a serial already counted
 * on another line is refused outright, because one unit cannot be missing from
 * two places. An EXCESS is the opposite: units are present that the system does
 * not have, so they are chosen from the registered-but-not-received list or
 * registered on the spot.
 *
 * `POST /v1/serials/bulk` and `GET /v1/serials` are the endpoints the rest of
 * Inventory already uses; nothing was added for this drawer.
 */

export interface SerialCountDrawerProps {
  row: CountRow | null
  onClose: () => void
  onApply: (lineKey: string, serials: LineSerial[]) => void
  /** Serial ids already named on OTHER lines, so a unit cannot be counted twice. */
  usedElsewhere: ReadonlyMap<number, string>
  warehouseName: (id: number | null | undefined) => string
  disabled?: boolean
}

export function SerialCountDrawer({ row, onClose, onApply, usedElsewhere, warehouseName, disabled = false }: SerialCountDrawerProps) {
  const [rows, setRows] = useState<SerialRow[]>([])
  const [draft, setDraft] = useState<LineSerial[]>([])
  const [filter, setFilter] = useState('')
  const [newSerials, setNewSerials] = useState('')
  const [loading, setLoading] = useState(false)
  const [registering, setRegistering] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [tick, setTick] = useState(0)
  const scanRef = useRef<HTMLInputElement>(null)

  const open = row !== null
  const difference = row?.difference ?? null
  const direction: 'in' | 'out' = difference !== null && difference > 0 ? 'in' : 'out'
  const required = difference === null ? 0 : Math.abs(difference)
  const lineKey = row?.line.key ?? ''

  useEffect(() => {
    if (!row) return undefined
    setDraft(row.line.serials)
    setFilter('')
    setNewSerials('')
    setError(null)
    setNotice(null)
    const controller = new AbortController()
    setLoading(true)
    lookupApi
      .serials(row.line.item_id as number, {
        status: direction === 'out' ? 'in_stock' : 'expected',
        warehouseId: direction === 'out' ? row.line.warehouse_id : null,
        batchId: row.line.batch_id,
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
        setError(errorMessage(err, 'Some serial numbers could not be validated.'))
        setLoading(false)
      })
    return () => controller.abort()
    // `row.line.serials` seeds the draft on open only; re-seeding on every
    // keystroke would undo the reader's ticks.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lineKey, direction, tick])

  const selected = useMemo(() => new Set(draft.map((s) => s.serial_id)), [draft])
  const visible = useMemo(() => {
    const q = filter.trim().toLowerCase()
    return q ? rows.filter((r) => r.serial_no.toLowerCase().includes(q)) : rows
  }, [rows, filter])

  if (!row) return null

  const toggle = (serial: SerialRow) => {
    setNotice(null)
    if (selected.has(serial.serial_id)) {
      setDraft((d) => d.filter((s) => s.serial_id !== serial.serial_id))
      return
    }
    const clash = usedElsewhere.get(serial.serial_id)
    if (clash && clash !== lineKey) {
      setNotice(`${serial.serial_no} is already counted on another line. A unit cannot be missing from two places.`)
      return
    }
    setDraft((d) => [...d, { serial_id: serial.serial_id, serial_no: serial.serial_no }])
  }

  const scan = (value: string) => {
    const term = value.trim()
    if (!term) return
    const match = rows.find((r) => r.serial_no.toLowerCase() === term.toLowerCase())
    if (!match) {
      setNotice(`No serial ${term} ${direction === 'out' ? `in stock at ${warehouseName(row.line.warehouse_id) || 'this warehouse'}` : 'awaiting receipt'}.`)
      return
    }
    toggle(match)
    setFilter('')
  }

  const register = async () => {
    const nos = newSerials
      .split(/[\n,;]+/)
      .map((s) => s.trim())
      .filter(Boolean)
    if (nos.length === 0) return
    setRegistering(true)
    setError(null)
    try {
      const res = await lookupApi.bulkCreateSerials({
        item_id: row.line.item_id as number,
        serial_nos: nos,
        warehouse_id: row.line.warehouse_id,
        batch_id: row.line.batch_id,
      })
      setDraft((d) => [...d, ...res.created.filter((c) => !d.some((s) => s.serial_id === c.serial_id))])
      setNewSerials('')
      setTick((t) => t + 1)
      if (res.skipped.length) {
        setNotice(`${res.skipped.length} skipped: ${res.skipped.map((s) => `${s.serial_no} (${s.reason})`).join(', ')}`)
      }
    } catch (err) {
      setError(errorMessage(err, 'Could not register serial numbers.'))
    } finally {
      setRegistering(false)
    }
  }

  const matches = required === 0 || draft.length === required

  return (
    <Drawer
      open={open}
      onClose={onClose}
      title={`Serial numbers · ${row.line.item_name}`}
      badge={
        <Badge tone={matches ? 'success' : 'danger'} size="xs">
          {draft.length} of {formatQty(required)}
        </Badge>
      }
      description={
        direction === 'out'
          ? `Tick the units that were NOT found at ${warehouseName(row.line.warehouse_id) || 'this warehouse'}.`
          : 'Tick the units found that the system does not have, or register them.'
      }
      width="lg"
      footer={
        <div className="flex items-center justify-between gap-2">
          <span className={cx('text-xs', matches ? 'text-gray-500' : 'text-red-600')}>
            {required === 0
              ? 'Enter a counted quantity first to know how many serials are needed.'
              : matches
                ? 'Matches the counted difference.'
                : `The difference is ${formatQty(required)} unit${required === 1 ? '' : 's'}.`}
          </span>
          <div className="flex items-center gap-2">
            <Button variant="secondary" size="sm" onClick={onClose}>
              Cancel
            </Button>
            <Button size="sm" disabled={disabled} onClick={() => onApply(lineKey, draft)}>
              Use {draft.length} serial{draft.length === 1 ? '' : 's'}
            </Button>
          </div>
        </div>
      }
    >
      <div className="space-y-3">
        <div className="grid grid-cols-3 gap-2 rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-center">
          <div>
            <div className="text-[10px] uppercase tracking-wide text-gray-500">Book serials</div>
            <div className="text-sm font-semibold tabular-nums text-gray-900">
              {row.snapshot.bookSerialCount ?? rows.length}
            </div>
          </div>
          <div>
            <div className="text-[10px] uppercase tracking-wide text-gray-500">Named here</div>
            <div className="text-sm font-semibold tabular-nums text-gray-900">{draft.length}</div>
          </div>
          <div>
            <div className="text-[10px] uppercase tracking-wide text-gray-500">Difference</div>
            <div className="text-sm font-semibold tabular-nums text-gray-900">
              {difference === null ? '—' : `${difference > 0 ? '+' : ''}${formatQty(difference)}`}
            </div>
          </div>
        </div>

        {error ? <Notice kind="error">{error}</Notice> : null}
        {notice ? <Notice kind="warning">{notice}</Notice> : null}

        <Input
          ref={scanRef}
          leadingIcon={ScanBarcode}
          value={filter}
          placeholder="Scan or search a serial number…"
          aria-label="Scan or search a serial number"
          onChange={(e) => setFilter(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              scan(filter)
            }
          }}
        />

        {draft.length > 0 ? (
          <div className="flex flex-wrap gap-1">
            {draft.map((s) => (
              <span
                key={s.serial_id}
                className="inline-flex items-center gap-1 rounded-full border border-gray-200 bg-white px-2 py-0.5 text-[11px] text-gray-700"
              >
                <span className="font-mono">{s.serial_no ?? `#${s.serial_id}`}</span>
                <button
                  type="button"
                  className="rounded-full px-1 text-gray-400 hover:bg-gray-100 hover:text-gray-700"
                  aria-label={`Remove ${s.serial_no ?? s.serial_id}`}
                  onClick={() => setDraft((d) => d.filter((x) => x.serial_id !== s.serial_id))}
                >
                  ×
                </button>
              </span>
            ))}
          </div>
        ) : null}

        <div className="max-h-72 overflow-y-auto rounded-lg border border-gray-200">
          {loading ? (
            <p className="px-3 py-6 text-center text-xs text-gray-500">Loading serial numbers…</p>
          ) : visible.length === 0 ? (
            <p className="px-3 py-6 text-center text-xs text-gray-500">
              No serial numbers {direction === 'out' ? 'in stock here' : 'awaiting receipt'}.
            </p>
          ) : (
            <ul>
              {visible.map((r) => {
                const clash = usedElsewhere.get(r.serial_id)
                // Only blocks ADDING it. A serial already ticked here stays
                // untickable-from — otherwise the one screen that can clear a
                // duplicate is the one screen that refuses to.
                const takenElsewhere = Boolean(clash) && clash !== lineKey && !selected.has(r.serial_id)
                return (
                  <li key={r.serial_id} className="border-b border-gray-100 last:border-b-0">
                    <label
                      className={cx(
                        'flex items-center gap-2 px-3 py-1.5 text-xs',
                        takenElsewhere ? 'cursor-not-allowed opacity-60' : 'cursor-pointer hover:bg-gray-50',
                      )}
                    >
                      <input
                        type="checkbox"
                        className="rounded border-gray-300 text-primary focus:ring-primary/30"
                        checked={selected.has(r.serial_id)}
                        disabled={takenElsewhere}
                        onChange={() => toggle(r)}
                      />
                      <span className="font-mono text-gray-900">{r.serial_no}</span>
                      <span className="ml-auto truncate text-[11px] text-gray-500">
                        {[r.batch_no, r.warehouse_name].filter(Boolean).join(' · ')}
                      </span>
                      {takenElsewhere ? (
                        <Badge tone="danger" size="xs">
                          On another line
                        </Badge>
                      ) : null}
                    </label>
                  </li>
                )
              })}
            </ul>
          )}
        </div>

        {direction === 'in' ? (
          <div className="space-y-1.5">
            <label htmlFor="new-count-serials" className="text-[11px] font-semibold uppercase tracking-wide text-gray-500">
              Register found units (one per line)
            </label>
            <Textarea
              id="new-count-serials"
              rows={3}
              monospace
              value={newSerials}
              placeholder={'SN-0001\nSN-0002'}
              onChange={(e) => setNewSerials(e.target.value)}
            />
            <Button
              variant="secondary"
              size="sm"
              loading={registering}
              disabled={!newSerials.trim()}
              onClick={() => void register()}
            >
              Register and select
            </Button>
          </div>
        ) : null}
      </div>
    </Drawer>
  )
}

export default SerialCountDrawer
