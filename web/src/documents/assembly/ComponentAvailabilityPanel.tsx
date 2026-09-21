import { useCallback, useState } from 'react'
import { AlertTriangle, CheckCircle2, Database, Loader2, TriangleAlert } from 'lucide-react'
import { Link } from 'react-router-dom'
import { Button } from '../../ui/Button'
import { AIC, cx } from '../../ui/cx'
import { errorMessage, isAbortError } from '../../services/api'
import { availabilityApi } from '../../services/stockApi'
import type { AvailabilityCheckResult, StockBalanceRow } from '../../services/stockApi'
import { shortBy } from '../../services/stockApi'
import { formatQty, toNumber } from '../../utils/format'
import type { LineDraft } from '../formModel'
import { filledComponents } from './assemblyModel'

export type AvailabilityStatus = 'unchecked' | 'checking' | 'available' | 'partial' | 'insufficient' | 'failed'

export interface ComponentAvailabilityPanelProps {
  components: readonly LineDraft[]
  results: Record<string, AvailabilityCheckResult>
  checking: boolean
  error: string | null
  checkedAt: number | null
  onRefresh: () => void
  disabled?: boolean
}

interface Shortage {
  key: string
  itemId: number
  itemName: string
  warehouseId: number | null
  required: number
  available: number
  gap: number
}

const STATUS_STYLE: Record<Exclude<AvailabilityStatus, 'checking'>, { box: string; badge: string; icon: typeof CheckCircle2; text: string }> = {
  unchecked: { box: 'border-gray-200 bg-gray-50/70', badge: 'bg-gray-200 text-gray-600', icon: Database, text: 'text-gray-700' },
  available: { box: 'border-emerald-200 bg-emerald-50/50', badge: 'bg-emerald-500 text-white', icon: CheckCircle2, text: 'text-emerald-800' },
  partial: { box: 'border-amber-200 bg-amber-50/60', badge: 'bg-amber-500 text-white', icon: TriangleAlert, text: 'text-amber-800' },
  insufficient: { box: 'border-red-200 bg-red-50/60', badge: 'bg-red-500 text-white', icon: AlertTriangle, text: 'text-red-700' },
  failed: { box: 'border-red-200 bg-red-50/60', badge: 'bg-red-500 text-white', icon: AlertTriangle, text: 'text-red-700' },
}

/** The panel's one-word verdict over the whole component list. */
export function availabilityStatus(
  components: readonly LineDraft[],
  results: Record<string, AvailabilityCheckResult>,
  checking: boolean,
  error: string | null,
): AvailabilityStatus {
  if (error) return 'failed'
  if (checking) return 'checking'
  const lines = filledComponents(components).filter((l) => l.item_id !== null)
  if (lines.length === 0) return 'unchecked'
  const checked = lines.filter((l) => results[l.key] !== undefined)
  if (checked.length === 0) return 'unchecked'
  const short = checked.filter((l) => !results[l.key].ok)
  if (short.length === 0) return 'available'
  return short.length === checked.length ? 'insufficient' : 'partial'
}

/**
 * Whether this assembly can be picked off the shelf today, and where the missing stock is.
 *
 * The figures come from the same batched `POST /v1/availability/check` the rows use — one request
 * for the whole document, never one per line. The verdict NEVER changes a warehouse by itself:
 * the alternate locations are offered as a sentence with the quantity in it, and moving the line
 * there is a click the user makes.
 */
export function ComponentAvailabilityPanel({
  components,
  results,
  checking,
  error,
  checkedAt,
  onRefresh,
  disabled = false,
}: ComponentAvailabilityPanelProps) {
  const [expanded, setExpanded] = useState<string | null>(null)
  const [elsewhere, setElsewhere] = useState<Record<string, StockBalanceRow[]>>({})
  const [lookupError, setLookupError] = useState<string | null>(null)
  const [lookingUp, setLookingUp] = useState(false)

  const status = availabilityStatus(components, results, checking, error)

  const shortages: Shortage[] = filledComponents(components)
    .filter((line) => line.item_id !== null && results[line.key] && !results[line.key].ok)
    .map((line) => {
      const result = results[line.key]
      return {
        key: line.key,
        itemId: line.item_id as number,
        itemName: line.item_name || `Item #${line.item_id}`,
        warehouseId: line.warehouse_id,
        required: Number(result.requested) || 0,
        available: Number(result.available) || 0,
        gap: shortBy(result),
      }
    })

  const loadElsewhere = useCallback(
    async (shortage: Shortage) => {
      if (expanded === shortage.key) {
        setExpanded(null)
        return
      }
      setExpanded(shortage.key)
      setLookupError(null)
      if (elsewhere[shortage.key]) return
      setLookingUp(true)
      try {
        const res = await availabilityApi.balances({ item_id: shortage.itemId, nonzero: true, limit: 50 })
        setElsewhere((prev) => ({ ...prev, [shortage.key]: res.data }))
      } catch (err) {
        if (isAbortError(err)) return
        setLookupError(errorMessage(err, 'Stock in other warehouses could not be loaded.'))
      } finally {
        setLookingUp(false)
      }
    },
    [elsewhere, expanded],
  )

  const style = STATUS_STYLE[status === 'checking' ? 'unchecked' : status]
  const Icon = style.icon

  const headline =
    status === 'checking'
      ? 'Checking availability…'
      : status === 'failed'
        ? 'Stock availability could not be checked'
        : status === 'available'
          ? 'Every component is available'
          : status === 'partial'
            ? `${shortages.length} of ${filledComponents(components).filter((l) => l.item_id).length} components are short`
            : status === 'insufficient'
              ? 'No component has enough stock'
              : 'Components availability'

  return (
    <div className={cx(AIC, 'rounded-xl border px-3 py-2.5', style.box)}>
      <div className="flex flex-wrap items-center gap-3">
        <span
          className={cx('flex h-8 w-8 shrink-0 items-center justify-center rounded-full', style.badge)}
          aria-hidden
        >
          {status === 'checking' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Icon className="h-4 w-4" />}
        </span>
        <div className="min-w-0 flex-1">
          {/* Status is text first and colour second: a reader who cannot tell the amber ring from
              the green one still reads the sentence. */}
          <p className={cx('text-xs font-semibold', style.text)} role="status">
            {headline}
          </p>
          <p className="mt-0.5 text-[11px] leading-snug text-gray-600">
            {error
              ? error
              : checkedAt
                ? `Real-time check across the selected warehouses · last checked ${new Date(checkedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`
                : 'Real-time stock check across the selected warehouses.'}
          </p>
        </div>
        <Button variant="outline" size="xs" onClick={onRefresh} disabled={disabled || checking} loading={checking}>
          {checkedAt ? 'Re-check' : 'Check availability'}
        </Button>
      </div>

      {shortages.length > 0 ? (
        <ul className="mt-2.5 space-y-1.5 border-t border-black/5 pt-2.5">
          {shortages.map((shortage) => {
            const rows = (elsewhere[shortage.key] ?? []).filter(
              (r) => r.warehouse_id !== shortage.warehouseId && (toNumber(r.available_qty) ?? 0) > 0,
            )
            const open = expanded === shortage.key
            return (
              <li key={shortage.key} className="text-[11px]">
                <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                  <strong className="font-semibold text-gray-900">{shortage.itemName}</strong>
                  <span className="text-gray-600">
                    required {formatQty(shortage.required)} · available {formatQty(shortage.available)} ·{' '}
                    <span className="font-semibold text-red-700">short by {formatQty(shortage.gap)}</span>
                  </span>
                  <button
                    type="button"
                    className="font-semibold text-primary hover:underline"
                    aria-expanded={open}
                    onClick={() => void loadElsewhere(shortage)}
                  >
                    {open ? 'Hide other warehouses' : 'Find it elsewhere'}
                  </button>
                  <Link
                    to={`/registers/stock-balances?item_id=${shortage.itemId}`}
                    className="text-gray-500 underline-offset-2 hover:text-primary hover:underline"
                  >
                    View warehouse stock
                  </Link>
                </div>
                {open ? (
                  <div className="mt-1 rounded-lg bg-white/70 px-2 py-1.5 text-gray-700">
                    {lookingUp && !elsewhere[shortage.key] ? (
                      <span className="text-gray-500">Looking…</span>
                    ) : lookupError ? (
                      <span className="text-red-700">{lookupError}</span>
                    ) : rows.length === 0 ? (
                      <span className="text-gray-500">No other warehouse is holding this item.</span>
                    ) : (
                      <ul className="space-y-0.5">
                        {rows.slice(0, 5).map((row) => (
                          <li key={`${row.warehouse_id}-${row.batch_id ?? 0}`}>
                            {formatQty(row.available_qty)} available in{' '}
                            <strong className="font-semibold">{row.warehouse_name ?? `warehouse #${row.warehouse_id}`}</strong>
                            {row.batch_no ? ` · batch ${row.batch_no}` : ''}
                          </li>
                        ))}
                      </ul>
                    )}
                    <p className="mt-1 text-[10px] text-gray-500">
                      Change the component&rsquo;s warehouse yourself if you want to take it from there — nothing is moved for you.
                    </p>
                  </div>
                ) : null}
              </li>
            )
          })}
        </ul>
      ) : null}
    </div>
  )
}

export default ComponentAvailabilityPanel
