import { BarChart3, Boxes, Info, Loader2, Package, RefreshCw, Sigma, TrendingDown, TrendingUp } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { Badge, Button, Tooltip } from '../../ui'
import { formatQty } from '../../utils/format'
import type { MoneyFormat } from './revaluationFormat'
import type { RevaluationTotals, ValuationScope } from './revaluationModel'

export interface RevaluationImpactSummaryProps {
  totals: RevaluationTotals
  money: MoneyFormat
  scope: ValuationScope
  loading: boolean
  fetchedAt: number | null
  onRefresh: () => void
  disabled?: boolean
}

/**
 * What the document would do to stock value, recalculated as the user types.
 *
 * It is a preview and it says so: the quantities behind it are a snapshot, and the posting engine
 * re-reads the live cost layers when the document posts. Nothing here is the posted figure.
 */
export function RevaluationImpactSummary({ totals, money, scope, loading, fetchedAt, onRefresh, disabled }: RevaluationImpactSummaryProps) {
  const netTone = totals.net > 0 ? 'increase' : totals.net < 0 ? 'decrease' : 'none'

  return (
    <section className="rounded-xl border border-gray-200 bg-white p-4 shadow-card" aria-labelledby="revaluation-impact-heading">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-sky-50">
            <BarChart3 className="h-4 w-4 text-sky-600" aria-hidden />
          </span>
          <div className="min-w-0">
            <h2 id="revaluation-impact-heading" className="flex items-center gap-1.5 text-sm font-semibold text-gray-900">
              Revaluation impact
              <span className="font-normal text-gray-500">(preview)</span>
              <Tooltip label="Preview amounts are indicative. The posting engine re-reads the live cost layers and recalculates the authoritative value when the document is posted.">
                <Info className="h-3.5 w-3.5 cursor-help text-gray-400" aria-hidden />
              </Tooltip>
            </h2>
            <p className="mt-0.5 text-xs text-gray-500">
              Estimated impact on stock valuation at the new rates, {scope === 'warehouse' ? 'per warehouse' : 'across every warehouse'}.
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {loading ? (
            <span className="inline-flex items-center gap-1.5 text-[11px] text-gray-500">
              <Loader2 className="h-3 w-3 animate-spin" aria-hidden /> Reading stock…
            </span>
          ) : fetchedAt ? (
            <span className="text-[11px] text-gray-400">
              As at {new Date(fetchedAt).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}
            </span>
          ) : null}
          <Button size="xs" variant="secondary" icon={RefreshCw} onClick={onRefresh} disabled={disabled || loading}>
            Refresh
          </Button>
        </div>
      </div>

      <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-5" aria-live="polite">
        <Tile icon={Package} tone="sky" label="Total items" value={String(totals.lines)} caption={totals.unchanged > 0 ? `${totals.unchanged} with no change` : undefined} />
        <Tile icon={Boxes} tone="amber" label="Total on-hand qty" value={formatQty(totals.onHandQty, '0')} caption="Informational — none of it moves" />
        <Tile icon={TrendingUp} tone="emerald" label="Increase in value" value={money.amount(totals.increase)} />
        <Tile icon={TrendingDown} tone="red" label="Decrease in value" value={money.amount(totals.decrease)} />
        <div className="rounded-xl border border-violet-200 bg-violet-50 p-3">
          <div className="flex items-center gap-2.5">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-violet-50 text-violet-600">
              <Sigma className="h-4 w-4" aria-hidden />
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-[10px] font-semibold uppercase tracking-wide text-gray-500">Net impact</p>
              <p className={`mt-0.5 truncate text-base font-bold tabular-nums ${netTone === 'increase' ? 'text-emerald-600' : netTone === 'decrease' ? 'text-red-600' : 'text-gray-900'}`}>
                {money.signed(totals.net)}
              </p>
            </div>
            <Badge tone={netTone === 'increase' ? 'success' : netTone === 'decrease' ? 'danger' : 'neutral'} size="xs">
              {netTone === 'increase' ? 'Increase' : netTone === 'decrease' ? 'Decrease' : 'No change'}
            </Badge>
          </div>
        </div>
      </div>

      {totals.pending > 0 ? (
        <p className="mt-2.5 text-[11px] text-gray-500">
          {totals.pending} line{totals.pending === 1 ? '' : 's'} not counted yet — {totals.pending === 1 ? 'it is' : 'they are'} still waiting on a new cost, or on a current cost that could not be read.
        </p>
      ) : null}
    </section>
  )
}

const TONES = {
  sky: 'bg-sky-50 text-sky-600',
  amber: 'bg-amber-50 text-amber-600',
  emerald: 'bg-emerald-50 text-emerald-600',
  red: 'bg-red-50 text-red-600',
} as const

function Tile({ icon: Icon, tone, label, value, caption }: { icon: LucideIcon; tone: keyof typeof TONES; label: string; value: string; caption?: string }) {
  return (
    <div className="flex items-center gap-2.5 rounded-xl border border-gray-200 bg-white p-3">
      <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${TONES[tone]}`}>
        <Icon className="h-4 w-4" aria-hidden />
      </span>
      <div className="min-w-0">
        <p className="text-[10px] font-semibold uppercase tracking-wide text-gray-500">{label}</p>
        <p className="mt-0.5 truncate text-base font-bold tabular-nums text-gray-900">{value}</p>
        {caption ? <p className="truncate text-[10px] text-gray-400">{caption}</p> : null}
      </div>
    </div>
  )
}

export default RevaluationImpactSummary
