import { CircleAlert, CircleCheck, CircleDashed, Loader2, PackageMinus, PackagePlus, TrendingUp } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import type { ReactNode } from 'react'
import { Card } from '../../../ui/Card'
import { IconTile } from '../../../ui/IconTile'
import type { IconTone } from '../../../ui/IconTile'
import { Skeleton } from '../../../ui/Skeleton'
import { Tooltip } from '../../../ui/Tooltip'
import { cx } from '../../../ui/cx'
import { formatMoney, formatQty } from '../../../utils/format'
import { READINESS_LABEL } from '../productionModel'
import type { CostSummary, Readiness } from '../productionModel'

interface KpiProps {
  icon: LucideIcon
  tone: IconTone
  label: string
  value: ReactNode
  meta: ReactNode
  /** Explains how the figure was arrived at — never a claim the data cannot support. */
  title?: string
  loading?: boolean
  emphasis?: 'default' | 'good' | 'warn' | 'bad'
  onClick?: () => void
}

const EMPHASIS: Record<NonNullable<KpiProps['emphasis']>, string> = {
  default: 'text-gray-900',
  good: 'text-emerald-600',
  warn: 'text-amber-600',
  bad: 'text-red-600',
}

function Kpi({ icon, tone, label, value, meta, title, loading, emphasis = 'default', onClick }: KpiProps) {
  const body = (
    <>
      <IconTile icon={icon} tone={tone} size="lg" />
      <div className="min-w-0 flex-1">
        <p className="truncate text-[11px] font-medium uppercase tracking-wide text-gray-500">{label}</p>
        {loading ? (
          <Skeleton className="mt-1.5 h-6 w-24" rounded="md" />
        ) : (
          <p className={cx('mt-0.5 truncate text-lg font-bold leading-tight tabular-nums tracking-tight', EMPHASIS[emphasis])}>{value}</p>
        )}
        <p className="mt-1 line-clamp-2 text-[11px] leading-snug text-gray-500">{meta}</p>
      </div>
    </>
  )
  const shell = 'flex min-h-[94px] w-full items-center gap-3 p-3'
  return (
    <Card padding="none" as="article" className="min-w-0 overflow-hidden">
      {onClick ? (
        <button
          type="button"
          onClick={onClick}
          title={title}
          className={cx(shell, 'text-left transition-colors hover:bg-gray-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary/30')}
        >
          {body}
        </button>
      ) : (
        <div title={title} className={shell}>
          {body}
        </div>
      )}
    </Card>
  )
}

export interface ProductionKpiBarProps {
  currency: string
  cost: CostSummary
  componentCount: number
  finishedUnitLabel: string
  readiness: Readiness
  blocking: number
  attention: number
  costForbidden: boolean
  loading: boolean
  onReadinessClick?: () => void
}

const READINESS_ICON: Record<Readiness, LucideIcon> = {
  idle: CircleDashed,
  awaiting_qty: CircleDashed,
  awaiting_explosion: CircleDashed,
  checking: Loader2,
  blocked: CircleAlert,
  attention: CircleAlert,
  ready: CircleCheck,
}

const READINESS_TONE: Record<Readiness, IconTone> = {
  idle: 'slate',
  awaiting_qty: 'slate',
  awaiting_explosion: 'slate',
  checking: 'info',
  blocked: 'danger',
  attention: 'warning',
  ready: 'success',
}

const READINESS_EMPHASIS: Record<Readiness, 'default' | 'good' | 'warn' | 'bad'> = {
  idle: 'default',
  awaiting_qty: 'default',
  awaiting_explosion: 'default',
  checking: 'default',
  blocked: 'bad',
  attention: 'warn',
  ready: 'good',
}

/**
 * The four figures that decide whether this run can go ahead.
 *
 * Every one of them is inventory's own: what the components cost to hold, what the finished goods
 * will be brought in at, the difference between the two, and whether the stock is there. None of
 * them is a selling price or a margin — Inventory has no commercial data and the labels say so.
 * "Expected value add" is deliberately not called profit, and it stays blank until the finished
 * rate is entered AND every component has a readable cost, because a partial sum presented as a
 * difference is a wrong number rather than an incomplete one.
 */
export function ProductionKpiBar({
  currency,
  cost,
  componentCount,
  finishedUnitLabel,
  readiness,
  blocking,
  attention,
  costForbidden,
  loading,
  onReadinessClick,
}: ProductionKpiBarProps) {
  const money = (n: number | null) => (n === null ? '—' : `${currency} ${formatMoney(n)}`)

  const componentMeta = costForbidden
    ? 'Cost hidden — needs valuation access'
    : componentCount === 0
      ? 'No components yet'
      : cost.costComplete || cost.componentCost === null
        ? `${componentCount} component${componentCount === 1 ? '' : 's'}`
        : `${componentCount} components · ${cost.costedComponents} of ${cost.totalComponents} costed`

  const finishedMeta =
    cost.finishedQty > 0
      ? cost.finishedValue === null
        ? `${formatQty(cost.finishedQty)} ${finishedUnitLabel} · costed on posting`
        : `${formatQty(cost.finishedQty)} ${finishedUnitLabel} at ${currency} ${formatMoney(cost.finishedRate)}`
      : 'Enter a run quantity'

  const valueAddMeta =
    cost.valueAdd === null
      ? cost.finishedValue === null
        ? 'Enter a finished rate to compare'
        : costForbidden
          ? 'Component cost is not visible to you'
          : 'Every component needs a cost first'
      : `${cost.valueAddPct === null ? '—' : `${cost.valueAddPct > 0 ? '+' : ''}${formatQty(cost.valueAddPct)}%`} over component cost`

  const readinessMeta =
    readiness === 'ready'
      ? 'All checks passed — the server revalidates on post'
      : readiness === 'blocked'
        ? `${blocking} issue${blocking === 1 ? '' : 's'} to resolve${attention > 0 ? `, ${attention} to review` : ''}`
        : readiness === 'attention'
          ? `${attention} item${attention === 1 ? '' : 's'} to review`
          : readiness === 'idle'
            ? 'Select a bill of materials'
            : readiness === 'awaiting_qty'
              ? 'Enter the run quantity'
              : readiness === 'awaiting_explosion'
                ? 'Explode the BOM into lines'
                : 'Reading live stock…'

  return (
    <section className="aic grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4" aria-label="Production summary">
      <Kpi
        icon={PackageMinus}
        tone="violet"
        label="Components to consume"
        value={money(cost.componentCost)}
        meta={componentMeta}
        title="Inventory cost of the components this run consumes, at the unit cost the valuation engine reports for the document date."
        loading={loading}
      />
      <Kpi
        icon={PackagePlus}
        tone="success"
        label="Finished goods value"
        value={money(cost.finishedValue)}
        meta={finishedMeta}
        title="Run quantity times the finished rate you entered. Left blank, the posting engine brings the goods in at the item's own cost."
        loading={loading}
      />
      <Kpi
        icon={TrendingUp}
        tone="warning"
        label="Expected value add"
        value={money(cost.valueAdd)}
        meta={valueAddMeta}
        title="Finished goods value less component cost. An inventory figure, not a margin: Inventory holds no selling price."
        loading={loading}
        emphasis={cost.valueAdd !== null && cost.valueAdd < 0 ? 'bad' : 'default'}
      />
      <Kpi
        icon={READINESS_ICON[readiness]}
        tone={READINESS_TONE[readiness]}
        label="Production readiness"
        value={
          readiness === 'blocked' ? (
            `${blocking} issue${blocking === 1 ? '' : 's'}`
          ) : (
            <Tooltip label="Derived from live stock balances, batch and serial allocation, and this company's negative-stock policy.">
              <span>{READINESS_LABEL[readiness]}</span>
            </Tooltip>
          )
        }
        meta={readinessMeta}
        emphasis={READINESS_EMPHASIS[readiness]}
        onClick={onReadinessClick}
      />
    </section>
  )
}

export default ProductionKpiBar
