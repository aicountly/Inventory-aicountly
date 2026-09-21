import { useEffect, useMemo, useState } from 'react'
import { Badge } from '../../ui/Badge'
import { Button } from '../../ui/Button'
import { Drawer } from '../../ui/Drawer'
import { Notice } from '../../components/Notice'
import { cx } from '../../ui/cx'
import { errorMessage, isAbortError } from '../../services/api'
import { lookupApi } from '../../services/lookupApi'
import type { BatchRow } from '../../services/lookupApi'
import { formatDate, formatQty, todayIso } from '../../utils/format'
import type { LineDraft } from '../formModel'
import { CountedQuantityInput } from './CountedQuantityInput'
import { differenceOf } from './countModel'
import type { CountRow } from './countModel'

/**
 * The batch breakdown behind one item in one warehouse.
 *
 * Two shapes, because the sheet has two:
 *
 *  - Loaded BATCH-WISE, every batch is already its own count line, so the
 *    drawer gathers the siblings and lets all of them be counted side by side,
 *    with the running total against the item's book figure. That total is the
 *    reconciliation the business rule asks for, and it is visible while typing
 *    rather than discovered on posting.
 *  - Loaded item-wise, there is one line and one count. The drawer then shows
 *    what the book figure is MADE OF — read from `GET /v1/batches` — so an
 *    operator standing in front of three pallets knows which batches they
 *    should be looking at. It does not invent per-batch counts the document
 *    would not carry.
 */

export interface BatchCountDrawerProps {
  row: CountRow | null
  /** Every loaded row for the same item and warehouse, batch-wise sheets included. */
  siblings: readonly CountRow[]
  onClose: () => void
  onPatchLine: (key: string, patch: Partial<LineDraft>) => void
  disabled?: boolean
}

function expiryTone(expiry: string | null, today: string): 'danger' | 'warning' | null {
  if (!expiry) return null
  if (expiry < today) return 'danger'
  // Within 30 days is "near expiry" — the window the batch registers use.
  const soon = new Date(`${today}T00:00:00Z`)
  soon.setUTCDate(soon.getUTCDate() + 30)
  return expiry <= soon.toISOString().slice(0, 10) ? 'warning' : null
}

export function BatchCountDrawer({ row, siblings, onClose, onPatchLine, disabled = false }: BatchCountDrawerProps) {
  const [batches, setBatches] = useState<BatchRow[] | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const today = todayIso()

  const itemId = row?.line.item_id ?? null
  const warehouseId = row?.line.warehouse_id ?? null
  const batchWise = siblings.length > 1 || (row?.line.batch_id ?? null) !== null

  useEffect(() => {
    if (itemId === null) return undefined
    const controller = new AbortController()
    setLoading(true)
    setError(null)
    lookupApi
      .batches(itemId, { warehouseId, status: 'active', signal: controller.signal })
      .then((res) => {
        if (controller.signal.aborted) return
        setBatches(res.data)
        setLoading(false)
      })
      .catch((err: unknown) => {
        if (controller.signal.aborted || isAbortError(err)) return
        setError(errorMessage(err, 'Batch information could not be loaded.'))
        setLoading(false)
      })
    return () => controller.abort()
  }, [itemId, warehouseId])

  const expiryById = useMemo(() => {
    const map = new Map<number, string | null>()
    for (const b of batches ?? []) map.set(b.batch_id, b.expiry_date ?? null)
    return map
  }, [batches])

  const totals = useMemo(() => {
    let book = 0
    let counted = 0
    let anyCounted = false
    for (const s of siblings) {
      book += Number(s.line.book_qty) || 0
      if (s.counted) {
        counted += Number(s.line.physical_qty) || 0
        anyCounted = true
      }
    }
    return { book, counted, anyCounted }
  }, [siblings])

  if (!row) return null

  return (
    <Drawer
      open
      onClose={onClose}
      title={`Batches · ${row.line.item_name}`}
      badge={
        <Badge tone="neutral" size="xs">
          {row.snapshot.warehouseName ?? 'Warehouse'}
        </Badge>
      }
      description={
        batchWise
          ? 'Count each batch; the total is checked against the book quantity for this item and warehouse.'
          : 'This sheet was loaded item-wise, so the count is one figure. These are the batches behind it.'
      }
      width="lg"
      footer={
        <div className="flex items-center justify-between gap-2">
          <span className="text-xs text-gray-500">
            Book <strong className="tabular-nums text-gray-800">{formatQty(totals.book)}</strong>
            {totals.anyCounted ? (
              <>
                {' · counted '}
                <strong className="tabular-nums text-gray-800">{formatQty(totals.counted)}</strong>
                {' · difference '}
                <strong
                  className={cx(
                    'tabular-nums',
                    totals.counted - totals.book < 0
                      ? 'text-red-600'
                      : totals.counted - totals.book > 0
                        ? 'text-emerald-600'
                        : 'text-gray-800',
                  )}
                >
                  {totals.counted - totals.book > 0 ? '+' : ''}
                  {formatQty(totals.counted - totals.book)}
                </strong>
              </>
            ) : null}
          </span>
          <Button size="sm" onClick={onClose}>
            Done
          </Button>
        </div>
      }
    >
      {error ? <Notice kind="warning">{error}</Notice> : null}

      {batchWise ? (
        <div className="overflow-x-auto rounded-lg border border-gray-200">
          <table className="w-full text-xs">
            <thead className="bg-gray-50 text-[10px] uppercase tracking-wide text-gray-500">
              <tr>
                <th scope="col" className="px-2.5 py-1.5 text-left font-semibold">
                  Batch
                </th>
                <th scope="col" className="px-2.5 py-1.5 text-left font-semibold">
                  Expiry
                </th>
                <th scope="col" className="px-2.5 py-1.5 text-right font-semibold">
                  Book qty
                </th>
                <th scope="col" className="px-2.5 py-1.5 text-right font-semibold">
                  Counted
                </th>
                <th scope="col" className="px-2.5 py-1.5 text-right font-semibold">
                  Difference
                </th>
              </tr>
            </thead>
            <tbody>
              {siblings.map((s) => {
                const expiry = s.snapshot.batchExpiry ?? (s.line.batch_id !== null ? (expiryById.get(s.line.batch_id) ?? null) : null)
                const tone = expiryTone(expiry, today)
                const diff = differenceOf(s.line)
                return (
                  <tr key={s.line.key} className="border-t border-gray-100">
                    <td className="px-2.5 py-1.5 font-medium text-gray-900">{s.line.batch_no ?? '—'}</td>
                    <td className="px-2.5 py-1.5">
                      {expiry ? (
                        <span className="flex items-center gap-1.5">
                          <span className={cx(tone === 'danger' ? 'text-red-600' : tone === 'warning' ? 'text-amber-700' : 'text-gray-600')}>
                            {formatDate(expiry)}
                          </span>
                          {tone ? (
                            <Badge tone={tone === 'danger' ? 'danger' : 'warning'} size="xs">
                              {tone === 'danger' ? 'Expired' : 'Near expiry'}
                            </Badge>
                          ) : null}
                        </span>
                      ) : (
                        <span className="text-gray-400">—</span>
                      )}
                    </td>
                    <td className="px-2.5 py-1.5 text-right tabular-nums">{formatQty(s.line.book_qty)}</td>
                    <td className="px-2.5 py-1.5 text-right">
                      <CountedQuantityInput
                        value={s.line.physical_qty}
                        onChange={(next) => onPatchLine(s.line.key, { physical_qty: next })}
                        disabled={disabled}
                        ariaLabel={`Counted quantity for batch ${s.line.batch_no ?? ''}`}
                      />
                    </td>
                    <td
                      className={cx(
                        'px-2.5 py-1.5 text-right font-semibold tabular-nums',
                        diff === null ? 'text-gray-400' : diff < 0 ? 'text-red-600' : diff > 0 ? 'text-emerald-600' : 'text-gray-500',
                      )}
                    >
                      {diff === null ? '—' : `${diff > 0 ? '+' : ''}${formatQty(diff)}`}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      ) : loading ? (
        <p className="py-6 text-center text-xs text-gray-500">Loading batches…</p>
      ) : (batches ?? []).length === 0 ? (
        <p className="py-6 text-center text-xs text-gray-500">This item has no active batches in this warehouse.</p>
      ) : (
        <ul className="divide-y divide-gray-100 rounded-lg border border-gray-200">
          {(batches ?? []).map((b) => {
            const tone = expiryTone(b.expiry_date ?? null, today)
            return (
              <li key={b.batch_id} className="flex items-center gap-2 px-3 py-2 text-xs">
                <span className="font-medium text-gray-900">{b.batch_no}</span>
                {b.expiry_date ? (
                  <span className={cx('text-[11px]', tone === 'danger' ? 'text-red-600' : tone === 'warning' ? 'text-amber-700' : 'text-gray-500')}>
                    expires {formatDate(b.expiry_date)}
                  </span>
                ) : null}
                {tone ? (
                  <Badge tone={tone === 'danger' ? 'danger' : 'warning'} size="xs">
                    {tone === 'danger' ? 'Expired' : 'Near expiry'}
                  </Badge>
                ) : null}
                <span className="ml-auto tabular-nums text-gray-600">
                  on hand {formatQty(b.stock?.on_hand ?? 0)}
                </span>
              </li>
            )
          })}
        </ul>
      )}

      {batchWise ? (
        <p className="mt-3 text-[11px] text-gray-500">
          Each batch posts as its own adjustment line. Batches left uncounted are not adjusted.
        </p>
      ) : (
        <p className="mt-3 text-[11px] text-gray-500">
          To count each batch separately, switch on “Load batch-wise” in Count setup and load again.
        </p>
      )}
    </Drawer>
  )
}

export default BatchCountDrawer
