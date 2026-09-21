import { CircleAlert, CircleCheck, CircleDashed, Factory, Info, Layers, Sparkles, TriangleAlert } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import type { ReactNode } from 'react'
import { Badge } from '../../../ui/Badge'
import { Button } from '../../../ui/Button'
import { Card } from '../../../ui/Card'
import { Skeleton } from '../../../ui/Skeleton'
import { cx } from '../../../ui/cx'
import { formatMoney, formatQty } from '../../../utils/format'
import type { BomHeader } from '../../bom'
import type { CostSummary, Insight, InsightTone } from '../productionModel'

const TONE_ICON: Record<InsightTone, LucideIcon> = {
  good: CircleCheck,
  warn: TriangleAlert,
  bad: CircleAlert,
  info: CircleDashed,
}

const TONE_CLASS: Record<InsightTone, string> = {
  good: 'text-emerald-600',
  warn: 'text-amber-600',
  bad: 'text-red-600',
  info: 'text-gray-400',
}

function Stat({ label, value }: { label: ReactNode; value: ReactNode }) {
  return (
    <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-4 text-xs">
      <span className="truncate text-gray-500">{label}</span>
      <span className="truncate text-right font-semibold tabular-nums text-gray-900">{value}</span>
    </div>
  )
}

export interface ProductionSidebarProps {
  bom: BomHeader | null
  bomLoading: boolean
  bomError: string | null
  onRetryBom: () => void
  onChangeBom: () => void
  onOpenBomDetails: () => void
  currency: string
  cost: CostSummary
  componentCount: number
  finishedUnitLabel: string
  insights: Insight[]
  suggestion: string
  intelLoading: boolean
  disabled: boolean
}

/**
 * The operational column: what is being made, and whether it can be.
 *
 * The preview restates the BOM as chosen — output, component count, cost — so the figures the
 * KPI strip totals can be traced to their source without leaving the screen. The insights below
 * are counted off the same rows the table shows; the suggestion is a rule over those counts, and
 * it is labelled a suggestion because that is what it is.
 */
export function ProductionSidebar({
  bom,
  bomLoading,
  bomError,
  onRetryBom,
  onChangeBom,
  onOpenBomDetails,
  currency,
  cost,
  componentCount,
  finishedUnitLabel,
  insights,
  suggestion,
  intelLoading,
  disabled,
}: ProductionSidebarProps) {
  return (
    <>
      <Card padding="none" as="section" aria-label="Bill of materials preview">
        <div className="flex items-center justify-between gap-3 border-b border-gray-100 px-4 py-3">
          <h2 className="text-sm font-semibold text-gray-900">BOM preview</h2>
          {bom ? (
            <Button variant="secondary" size="xs" onClick={onChangeBom} disabled={disabled}>
              Change BOM
            </Button>
          ) : null}
        </div>
        <div className="px-4 py-4">
          {bomError ? (
            <div className="flex flex-col items-start gap-2">
              <p className="text-xs text-red-600">{bomError}</p>
              <Button variant="secondary" size="xs" onClick={onRetryBom}>
                Retry
              </Button>
            </div>
          ) : bomLoading && !bom ? (
            <div className="space-y-3">
              <div className="flex items-center gap-3">
                <Skeleton className="h-14 w-14" rounded="xl" />
                <div className="flex-1 space-y-2">
                  <Skeleton className="h-3 w-32" rounded="md" />
                  <Skeleton className="h-3 w-20" rounded="md" />
                </div>
              </div>
              <Skeleton className="h-3 w-full" rounded="md" />
              <Skeleton className="h-3 w-full" rounded="md" />
              <Skeleton className="h-3 w-2/3" rounded="md" />
            </div>
          ) : (
            <>
              <div className="flex items-center gap-3 pb-4">
                <span className={cx('grid h-14 w-14 shrink-0 place-items-center rounded-xl', bom ? 'bg-primary-light text-primary' : 'bg-gray-100 text-gray-400')}>
                  <Factory className="h-6 w-6" aria-hidden />
                </span>
                <div className="min-w-0">
                  <p className="truncate text-sm font-bold text-gray-900">
                    {bom ? (bom.finished_item_name ?? `Item #${bom.finished_item_id}`) : 'No BOM selected'}
                  </p>
                  <p className="mt-0.5 truncate text-[11px] text-gray-500">{bom ? bom.bom_name : '—'}</p>
                  {bom ? (
                    <span className="mt-1.5 inline-flex">
                      <Badge tone={Number(bom.is_active) === 1 ? 'success' : 'neutral'} size="xs" dot>
                        {Number(bom.is_active) === 1 ? 'Active' : 'Inactive'}
                      </Badge>
                    </span>
                  ) : null}
                </div>
              </div>

              <div className="grid gap-2.5">
                <Stat label="Finished item" value={bom ? (bom.finished_item_name ?? `#${bom.finished_item_id}`) : '—'} />
                <Stat
                  label="Expected output"
                  value={bom ? `${formatQty(bom.yield_qty)} ${bom.yield_unit_symbol ?? ''}`.trim() : '—'}
                />
                <Stat label="Total components" value={componentCount > 0 ? `${componentCount} items` : bom ? `${bom.lines.length} items` : '—'} />
                <Stat
                  label="Estimated cost"
                  value={cost.componentCost === null ? '—' : `${currency} ${formatMoney(cost.componentCost)}`}
                />
                <Stat label="Finished rate" value={cost.finishedRate > 0 ? `${currency} ${formatMoney(cost.finishedRate)}` : '—'} />
                <Stat label="Estimated value" value={cost.finishedValue === null ? '—' : `${currency} ${formatMoney(cost.finishedValue)}`} />
                <Stat label="Run quantity" value={cost.finishedQty > 0 ? `${formatQty(cost.finishedQty)} ${finishedUnitLabel}`.trim() : '—'} />
              </div>

              {bom ? (
                <Button variant="outline" size="sm" block className="mt-4" icon={Layers} onClick={onOpenBomDetails}>
                  View BOM details
                </Button>
              ) : null}
            </>
          )}
        </div>
      </Card>

      <Card padding="none" as="section" aria-label="Production insights">
        <div className="flex items-center justify-between gap-3 border-b border-gray-100 px-4 py-3">
          <h2 className="flex items-center gap-2 text-sm font-semibold text-gray-900">
            <Sparkles className="h-4 w-4 text-violet-500" aria-hidden />
            Production insights
          </h2>
          {intelLoading ? <span className="text-[11px] text-gray-400">Refreshing…</span> : null}
        </div>
        <div className="px-4 py-4">
          <ul className="flex flex-col gap-3">
            {insights.map((insight) => {
              const Icon = TONE_ICON[insight.tone]
              return (
                <li key={insight.id} className="grid grid-cols-[16px_1fr] items-start gap-2 text-xs leading-relaxed text-gray-700">
                  <Icon className={cx('mt-0.5 h-4 w-4 shrink-0', TONE_CLASS[insight.tone])} aria-hidden />
                  <span>{insight.text}</span>
                </li>
              )
            })}
          </ul>

          <div className="mt-4 rounded-xl border border-violet-200 bg-gradient-to-br from-violet-500/[0.08] to-primary/[0.05] p-3">
            <p className="mb-1.5 flex items-center gap-1.5 text-[11px] font-bold text-violet-700">
              <Sparkles className="h-3.5 w-3.5" aria-hidden />
              Smart suggestion
            </p>
            <p className="text-[11px] leading-relaxed text-gray-600">{suggestion}</p>
            <p className="mt-2 flex items-start gap-1.5 text-[10px] leading-relaxed text-gray-500">
              <Info className="mt-px h-3 w-3 shrink-0" aria-hidden />
              Worked out from live stock balances on this screen. Nothing is transferred, allocated or posted without you.
            </p>
          </div>
        </div>
      </Card>
    </>
  )
}

export default ProductionSidebar
