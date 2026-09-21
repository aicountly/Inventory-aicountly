import { useEffect, useMemo, useState } from 'react'
import { ArrowRight, ScanBarcode, X } from 'lucide-react'
import { Notice } from '../../components/Notice'
import { errorMessage, isAbortError } from '../../services/api'
import { lookupApi } from '../../services/lookupApi'
import type { SerialRow } from '../../services/lookupApi'
import { Badge } from '../../ui/Badge'
import { Button } from '../../ui/Button'
import { Drawer } from '../../ui/Drawer'
import { Input } from '../../ui/Input'
import { Skeleton } from '../../ui/Skeleton'
import { Textarea } from '../../ui/Textarea'
import { cx } from '../../ui/cx'
import { lineBaseQty } from '../formModel'
import type { LineDraft } from '../formModel'
import type { LineSerial } from '../types'
import { batchMapping } from './batchAdjustmentModel'

export interface SerialMappingDrawerProps {
  open: boolean
  line: LineDraft | null
  warehouseId: number | null
  warehouseName: string
  onClose: () => void
  onApply: (key: string, serials: LineSerial[]) => void
}

function Figure({ label, value, tone }: { label: string; value: string | number; tone?: 'warning' | 'success' }) {
  return (
    <div className="rounded-lg border border-gray-200 bg-gray-50 px-2.5 py-2">
      <div className="text-[10px] font-semibold uppercase tracking-wide text-gray-500">{label}</div>
      <div className={cx('mt-0.5 text-base font-semibold tabular-nums', tone === 'warning' ? 'text-amber-700' : tone === 'success' ? 'text-emerald-700' : 'text-gray-900')}>{value}</div>
    </div>
  )
}

/**
 * Serial mapping for one line.
 *
 * Out lines pick from the serials in stock at the line's warehouse; in lines pick from serials
 * registered as expected, or register new ones — exactly the rules `documents/SerialPicker` has
 * always applied, through the same two endpoints. What is new is the context around the list: the
 * batch movement the serials belong to, and how many of them the quantity still needs.
 */
export function SerialMappingDrawer({ open, line, warehouseId, warehouseName, onClose, onApply }: SerialMappingDrawerProps) {
  const [rows, setRows] = useState<SerialRow[]>([])
  const [loading, setLoading] = useState(false)
  const [filter, setFilter] = useState('')
  const [draft, setDraft] = useState<LineSerial[]>([])
  const [newSerials, setNewSerials] = useState('')
  const [registering, setRegistering] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [tick, setTick] = useState(0)

  const itemId = line?.item_id ?? null
  const batchId = line?.batch_id ?? null
  const direction = line?.direction === 'in' ? 'in' : 'out'
  const required = line ? lineBaseQty(line) : 0
  const mapping = line ? batchMapping(line) : null

  useEffect(() => {
    if (!open || !line) return
    setDraft(line.serials)
    setFilter('')
    setNewSerials('')
    setError(null)
    // The drawer is keyed on the line, so seeding from it on open is the whole contract.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, line?.key])

  useEffect(() => {
    if (!open || itemId === null) return undefined
    const controller = new AbortController()
    setLoading(true)
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
  }, [open, itemId, warehouseId, batchId, direction, tick])

  const selectedIds = useMemo(() => new Set(draft.map((s) => s.serial_id)), [draft])
  const visible = useMemo(() => {
    const q = filter.trim().toLowerCase()
    return q ? rows.filter((r) => r.serial_no.toLowerCase().includes(q)) : rows
  }, [rows, filter])

  const toggle = (row: SerialRow) =>
    setDraft((d) => (selectedIds.has(row.serial_id) ? d.filter((s) => s.serial_id !== row.serial_id) : [...d, { serial_id: row.serial_id, serial_no: row.serial_no }]))

  const register = async () => {
    if (itemId === null) return
    const nos = newSerials
      .split(/[\n,;\s]+/)
      .map((s) => s.trim())
      .filter(Boolean)
    if (nos.length === 0) return
    setRegistering(true)
    setError(null)
    try {
      const res = await lookupApi.bulkCreateSerials({ item_id: itemId, serial_nos: nos, warehouse_id: warehouseId, batch_id: batchId })
      setDraft((d) => [...d, ...res.created.filter((c) => !d.some((s) => s.serial_id === c.serial_id))])
      setNewSerials('')
      setTick((t) => t + 1)
      if (res.skipped.length) setError(`${res.skipped.length} serial number(s) skipped: ${res.skipped.map((s) => `${s.serial_no} (${s.reason})`).join(', ')}`)
    } catch (err) {
      setError(errorMessage(err, 'Could not register serial numbers.'))
    } finally {
      setRegistering(false)
    }
  }

  /** A keyboard-wedge scanner types the code and presses Enter — select the exact match. */
  const acceptScan = () => {
    const code = filter.trim().toLowerCase()
    if (!code) return
    const match = rows.find((r) => r.serial_no.toLowerCase() === code) ?? (visible.length === 1 ? visible[0] : undefined)
    if (!match) return
    if (!selectedIds.has(match.serial_id)) toggle(match)
    setFilter('')
  }

  const remaining = Math.max(required - draft.length, 0)
  const over = required > 0 && draft.length > required

  return (
    <Drawer
      open={open && line !== null}
      onClose={onClose}
      width="md"
      title="Serial mapping"
      badge={<Badge tone={direction === 'in' ? 'success' : 'danger'} size="xs">{direction === 'in' ? 'In' : 'Out'}</Badge>}
      description={line ? `${line.item_sku ? `${line.item_sku} · ` : ''}${line.item_name}` : undefined}
      footer={
        <div className="flex items-center justify-between gap-2">
          <span className="text-[11px] text-gray-500">
            {required > 0 ? `${draft.length} of ${required} mapped` : `${draft.length} selected`}
          </span>
          <div className="flex items-center gap-2">
            <Button variant="secondary" onClick={onClose}>
              Cancel
            </Button>
            <Button
              onClick={() => line && onApply(line.key, draft)}
              disabled={over}
              title={over ? 'More serial numbers are selected than the quantity allows.' : undefined}
            >
              Apply serial mapping
            </Button>
          </div>
        </div>
      }
    >
      {line ? (
        <div className="space-y-3">
          <div className="rounded-lg border border-gray-200 px-3 py-2 text-xs text-gray-600">
            <div className="flex items-center justify-between gap-2">
              <span className="text-gray-500">Warehouse</span>
              <span className="font-semibold text-gray-900">{warehouseName || '—'}</span>
            </div>
            <div className="mt-1 flex items-center justify-between gap-2">
              <span className="text-gray-500">Batch movement</span>
              <span className="inline-flex items-center gap-1.5 font-semibold text-gray-900">
                {mapping?.from_batch_no ?? '—'}
                <ArrowRight className="h-3 w-3 text-gray-400" aria-hidden />
                {mapping?.to_batch_no ?? '—'}
              </span>
            </div>
          </div>

          <div className="grid grid-cols-3 gap-2">
            <Figure label="Required" value={required || '—'} />
            <Figure label="Mapped" value={draft.length} tone={required > 0 && draft.length === required ? 'success' : undefined} />
            <Figure label="Remaining" value={remaining} tone={remaining > 0 ? 'warning' : undefined} />
          </div>

          {over ? <Notice kind="error">More serial numbers are selected than the line&rsquo;s base quantity of {required}.</Notice> : null}
          {error ? <Notice kind="warning">{error}</Notice> : null}

          {draft.length > 0 ? (
            <div className="flex flex-wrap gap-1.5">
              {draft.map((s) => (
                <span key={s.serial_id} className="inline-flex items-center gap-1 rounded-full border border-gray-200 bg-gray-50 py-0.5 pl-2 pr-1 text-[11px] text-gray-700">
                  {s.serial_no ?? `#${s.serial_id}`}
                  <button
                    type="button"
                    className="rounded-full p-0.5 text-gray-400 transition-colors hover:bg-gray-200 hover:text-gray-700"
                    aria-label={`Remove ${s.serial_no ?? s.serial_id}`}
                    onClick={() => setDraft((d) => d.filter((x) => x.serial_id !== s.serial_id))}
                  >
                    <X className="h-3 w-3" aria-hidden />
                  </button>
                </span>
              ))}
            </div>
          ) : null}

          <Input
            size="md"
            leadingIcon={ScanBarcode}
            value={filter}
            placeholder="Search or scan a serial number…"
            aria-label="Search or scan a serial number"
            onChange={(e) => setFilter(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault()
                acceptScan()
              }
            }}
          />

          <div className="max-h-64 overflow-y-auto rounded-lg border border-gray-200">
            {loading ? (
              <div className="space-y-2 p-3">
                <Skeleton className="h-4 w-full" />
                <Skeleton className="h-4 w-4/5" />
                <Skeleton className="h-4 w-3/5" />
              </div>
            ) : visible.length === 0 ? (
              <p className="px-3 py-4 text-center text-xs text-gray-500">
                No serial numbers {direction === 'out' ? 'in stock here' : 'awaiting receipt'}
                {filter.trim() ? ' match that search' : ''}.
              </p>
            ) : (
              <ul className="divide-y divide-gray-100">
                {visible.map((r) => (
                  <li key={r.serial_id}>
                    <label className="flex cursor-pointer items-center gap-2 px-3 py-1.5 text-xs transition-colors hover:bg-gray-50">
                      <input type="checkbox" checked={selectedIds.has(r.serial_id)} onChange={() => toggle(r)} className="h-3.5 w-3.5" />
                      <span className="font-mono text-[11px] text-gray-900">{r.serial_no}</span>
                      <span className="ml-auto truncate text-[10px] text-gray-500">{[r.batch_no, r.warehouse_name].filter(Boolean).join(' · ')}</span>
                    </label>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {direction === 'in' ? (
            <div className="space-y-1.5">
              <label htmlFor="ba-new-serials" className="text-[11px] font-semibold uppercase tracking-wide text-gray-500">
                Register new serial numbers
              </label>
              <Textarea id="ba-new-serials" rows={2} value={newSerials} onChange={(e) => setNewSerials(e.target.value)} placeholder={'SN-0001\nSN-0002'} />
              <Button size="xs" variant="secondary" onClick={() => void register()} loading={registering} disabled={!newSerials.trim()}>
                Register and select
              </Button>
            </div>
          ) : null}
        </div>
      ) : null}
    </Drawer>
  )
}

export default SerialMappingDrawer
