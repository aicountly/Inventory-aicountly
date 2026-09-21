import { useEffect, useMemo, useState } from 'react'
import { AlertTriangle, ArrowRight, CheckCircle2, Info, Layers, Sparkles, Warehouse } from 'lucide-react'
import { Badge } from '../../ui/Badge'
import { Button } from '../../ui/Button'
import { Drawer } from '../../ui/Drawer'
import { LoadingState } from '../../ui/LoadingState'
import { Notice } from '../../components/Notice'
import { cx } from '../../ui/cx'
import { errorMessage, isAbortError } from '../../services/api'
import { availabilityApi } from '../../services/stockApi'
import type { AvailabilityRow } from '../../services/stockApi'
import { formatQty } from '../../utils/format'
import { isBlankLine } from '../formModel'
import type { HeaderDraft, LineDraft } from '../formModel'
import { sourceWarehouseFor } from './transferModel'
import type { AvailabilityBuckets, LineStock, TransferTotals } from './transferModel'

export interface TransferAssistantDrawerProps {
  open: boolean
  onClose: () => void
  header: HeaderDraft
  lines: LineDraft[]
  stock: ReadonlyMap<string, LineStock>
  availability: ReadonlyMap<string, AvailabilityBuckets>
  totals: TransferTotals
  warehouseName: (id: number | null | undefined) => string
  /** Moves a line's source to a warehouse that can actually cover it. */
  onUseWarehouse: (lineKey: string, warehouseId: number) => void
}

interface Finding {
  id: string
  tone: 'danger' | 'warning' | 'info'
  title: string
  body: string
}

/** A line that cannot be covered where it is being drawn from. */
interface Shortage {
  line: LineDraft
  sourceWarehouseId: number
  shortBy: number
  required: number
}

/**
 * How large a share of the company's whole holding of an item one line may ask
 * for before it is worth a second look. Not a rule — a prompt.
 */
const LARGE_SHARE = 0.75

/**
 * The assistant's answers, computed here and now.
 *
 * Every figure in this drawer comes from the draft on screen and from
 * `GET /v1/availability` — the same endpoint the Available column reads. None of
 * it is generated text, and nothing is invented when an answer is not known: a
 * check with no data to run on says so.
 */
export function TransferAssistantDrawer({
  open,
  onClose,
  header,
  lines,
  stock,
  availability,
  totals,
  warehouseName,
  onUseWarehouse,
}: TransferAssistantDrawerProps) {
  const shortages = useMemo<Shortage[]>(() => {
    const out: Shortage[] = []
    for (const line of lines) {
      if (isBlankLine(line) || !line.item_id) continue
      const s = stock.get(line.key)
      const wh = sourceWarehouseFor(line, header)
      if (!s || !wh || s.state !== 'ready' || !s.short) continue
      out.push({ line, sourceWarehouseId: wh, shortBy: s.shortBy, required: s.required })
    }
    return out
  }, [lines, stock, header])

  const [elsewhere, setElsewhere] = useState<AvailabilityRow[] | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const itemIds = useMemo(() => [...new Set(shortages.map((s) => s.line.item_id as number))].sort((a, b) => a - b), [shortages])
  const itemSignature = useMemo(() => itemIds.join(','), [itemIds])

  // Where else this stock sits. Asked only when the drawer is open and only for
  // the items that are actually short — the cheapest question that answers it.
  useEffect(() => {
    if (!open || itemSignature === '') {
      setElsewhere(null)
      setError(null)
      return undefined
    }
    const controller = new AbortController()
    setLoading(true)
    setError(null)
    availabilityApi
      .forItems(itemSignature.split(',').map(Number), null, false, controller.signal)
      .then((rows) => {
        if (controller.signal.aborted) return
        setElsewhere(rows)
        setLoading(false)
      })
      .catch((err: unknown) => {
        if (controller.signal.aborted || isAbortError(err)) return
        setElsewhere(null)
        setError(errorMessage(err, 'Stock in other warehouses could not be read.'))
        setLoading(false)
      })
    return () => controller.abort()
  }, [open, itemSignature])

  const findings = useMemo<Finding[]>(() => {
    const out: Finding[] = []
    for (const s of shortages) {
      out.push({
        id: `short-${s.line.key}`,
        tone: 'danger',
        title: `${s.line.item_name || 'This item'} is short by ${formatQty(s.shortBy)}`,
        body: `${warehouseName(s.sourceWarehouseId)} cannot cover the ${formatQty(s.required)} this transfer asks for.`,
      })
    }
    // Unusually large: one line taking most of everything the company holds.
    if (elsewhere) {
      const byItem = new Map<number, number>()
      for (const row of elsewhere) byItem.set(row.item_id, (byItem.get(row.item_id) ?? 0) + (Number(row.on_hand) || 0))
      for (const line of lines) {
        if (isBlankLine(line) || !line.item_id) continue
        const total = byItem.get(line.item_id)
        const s = stock.get(line.key)
        if (!total || total <= 0 || !s || s.required <= 0) continue
        const share = s.required / total
        if (share >= LARGE_SHARE) {
          out.push({
            id: `large-${line.key}`,
            tone: 'warning',
            title: `${line.item_name || 'This item'}: ${Math.round(share * 100)}% of everything on hand`,
            body: `This line moves ${formatQty(s.required)} of the ${formatQty(total)} held across every warehouse. Worth confirming before posting.`,
          })
        }
      }
    }
    return out
  }, [shortages, elsewhere, lines, stock, warehouseName])

  const alternatives = useMemo(() => {
    if (!elsewhere) return new Map<string, AvailabilityRow[]>()
    const out = new Map<string, AvailabilityRow[]>()
    for (const s of shortages) {
      const rows = elsewhere
        .filter((r) => r.item_id === s.line.item_id && r.warehouse_id && r.warehouse_id !== s.sourceWarehouseId && Number(r.available) >= s.required)
        .sort((a, b) => Number(b.available) - Number(a.available))
        .slice(0, 4)
      if (rows.length) out.set(s.line.key, rows)
    }
    return out
  }, [elsewhere, shortages])

  const batchAlternatives = useMemo(() => {
    const out = new Map<string, { batchId: number; available: number }[]>()
    for (const s of shortages) {
      if (!s.line.batch_id) continue
      const rows: { batchId: number; available: number }[] = []
      for (const [key, buckets] of availability) {
        const [itemId, wh, batchId] = key.split(':').map(Number)
        if (itemId !== s.line.item_id || wh !== s.sourceWarehouseId || !batchId || batchId === s.line.batch_id) continue
        if (buckets.available >= s.required) rows.push({ batchId, available: buckets.available })
      }
      if (rows.length) out.set(s.line.key, rows.sort((a, b) => b.available - a.available).slice(0, 4))
    }
    return out
  }, [availability, shortages])

  return (
    <Drawer
      open={open}
      onClose={onClose}
      title="Assistant"
      badge={<Badge tone="beta" size="sm">Beta</Badge>}
      description="Checks run over this draft and live stock. No figure here is generated."
      width="lg"
      footer={
        <div className="flex justify-end">
          <Button variant="secondary" onClick={onClose}>
            Close
          </Button>
        </div>
      }
    >
      <section className="rounded-xl border border-gray-200 bg-gray-50 p-3">
        <h3 className="flex items-center gap-1.5 text-xs font-semibold text-gray-700">
          <Sparkles className="h-3.5 w-3.5 text-violet-500" aria-hidden />
          This transfer
        </h3>
        <p className="mt-1.5 text-xs leading-relaxed text-gray-600">
          {totals.items === 0
            ? 'No items on the transfer yet.'
            : `${totals.items} line${totals.items === 1 ? '' : 's'}, ${formatQty(totals.quantity)} in total, moving from ${
                warehouseName(header.from_warehouse_id) || 'an unchosen warehouse'
              } to ${warehouseName(header.to_warehouse_id) || 'an unchosen warehouse'}.`}
        </p>
      </section>

      {error ? (
        <Notice kind="warning" className="mt-3">
          {error}
        </Notice>
      ) : null}

      <h3 className="mt-4 text-xs font-semibold uppercase tracking-wide text-gray-500">Findings</h3>
      {loading ? (
        <LoadingState label="Reading stock in every warehouse…" />
      ) : findings.length === 0 ? (
        <div className="mt-2 flex items-start gap-2 rounded-xl border border-emerald-100 bg-emerald-50 p-3">
          <CheckCircle2 className="mt-px h-4 w-4 shrink-0 text-emerald-600" aria-hidden />
          <p className="text-xs leading-relaxed text-emerald-800">
            Nothing to raise. Every line is covered by the stock its source warehouse holds right now.
          </p>
        </div>
      ) : (
        <ul className="mt-2 space-y-2">
          {findings.map((f) => (
            <li
              key={f.id}
              className={cx(
                'flex items-start gap-2 rounded-xl border p-3',
                f.tone === 'danger' ? 'border-red-100 bg-red-50' : f.tone === 'warning' ? 'border-amber-100 bg-amber-50' : 'border-sky-100 bg-sky-50',
              )}
            >
              <AlertTriangle
                className={cx('mt-px h-4 w-4 shrink-0', f.tone === 'danger' ? 'text-red-600' : f.tone === 'warning' ? 'text-amber-600' : 'text-sky-600')}
                aria-hidden
              />
              <div className="min-w-0">
                <strong className="block text-xs font-semibold text-gray-900">{f.title}</strong>
                <p className="mt-0.5 text-[11px] leading-relaxed text-gray-600">{f.body}</p>
              </div>
            </li>
          ))}
        </ul>
      )}

      {shortages.length > 0 && !loading ? (
        <>
          <h3 className="mt-5 text-xs font-semibold uppercase tracking-wide text-gray-500">Where this stock is</h3>
          <div className="mt-2 space-y-3">
            {shortages.map((s) => {
              const warehouses = alternatives.get(s.line.key) ?? []
              const batches = batchAlternatives.get(s.line.key) ?? []
              return (
                <div key={s.line.key} className="rounded-xl border border-gray-200 p-3">
                  <p className="text-xs font-semibold text-gray-900">{s.line.item_name || `Item #${s.line.item_id}`}</p>
                  {warehouses.length === 0 && batches.length === 0 ? (
                    <p className="mt-1 flex items-start gap-1.5 text-[11px] leading-relaxed text-gray-500">
                      <Info className="mt-px h-3 w-3 shrink-0" aria-hidden />
                      No other warehouse holds {formatQty(s.required)} of this item either. Receive stock first, or reduce the
                      quantity.
                    </p>
                  ) : null}
                  {warehouses.length > 0 ? (
                    <ul className="mt-2 space-y-1">
                      {warehouses.map((row) => (
                        <li key={row.warehouse_id} className="flex items-center justify-between gap-2">
                          <span className="flex min-w-0 items-center gap-1.5 text-[11px] text-gray-700">
                            <Warehouse className="h-3 w-3 shrink-0 text-gray-400" aria-hidden />
                            <span className="truncate">{warehouseName(row.warehouse_id)}</span>
                            <span className="shrink-0 font-semibold text-emerald-600">{formatQty(row.available)} free</span>
                          </span>
                          <Button
                            variant="ghost"
                            size="xs"
                            iconRight={ArrowRight}
                            onClick={() => onUseWarehouse(s.line.key, row.warehouse_id as number)}
                          >
                            Draw from here
                          </Button>
                        </li>
                      ))}
                    </ul>
                  ) : null}
                  {batches.length > 0 ? (
                    <p className="mt-2 flex items-start gap-1.5 text-[11px] leading-relaxed text-gray-600">
                      <Layers className="mt-px h-3 w-3 shrink-0 text-gray-400" aria-hidden />
                      <span>
                        {batches.length === 1 ? 'Another batch' : `${batches.length} other batches`} in this warehouse can cover
                        it — change the batch on the line.
                      </span>
                    </p>
                  ) : null}
                </div>
              )
            })}
          </div>
        </>
      ) : null}

      <p className="mt-5 border-t border-gray-100 pt-3 text-[11px] leading-relaxed text-gray-400">
        These are deterministic checks over live stock, not a language model. A conversational Aicountly assistant is not
        connected to Inventory yet; when it is, it answers here beside them.
      </p>
    </Drawer>
  )
}
