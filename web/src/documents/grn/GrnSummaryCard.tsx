import { AlertTriangle, ArrowRight, CheckCircle2, ClipboardCheck, Info, XCircle } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import type { ReactNode } from 'react'
import { Card } from '../../ui/Card'
import { IconTile } from '../../ui/IconTile'
import { cx } from '../../ui/cx'
import { formatMoney, formatQty } from '../../utils/format'
import type { GrnAlert, GrnAlertTone, GrnTotals, StockImpact } from './grnModel'

export interface GrnSummaryCardProps {
  totals: GrnTotals
  impact: StockImpact
  alerts: GrnAlert[]
  currencySymbol: string
  /** Opens the purchase-order drawer from the "View matching POs" link. */
  onViewMatches?: () => void
  matchedCount: number
}

const ALERT_STYLE: Record<GrnAlertTone, { icon: LucideIcon; cls: string }> = {
  success: { icon: CheckCircle2, cls: 'text-emerald-700' },
  info: { icon: Info, cls: 'text-sky-700' },
  warning: { icon: AlertTriangle, cls: 'text-amber-700' },
  danger: { icon: XCircle, cls: 'text-red-700' },
}

const IMPACT_CLASS: Record<StockImpact['tone'], string> = {
  pending: 'text-amber-600',
  receives: 'text-emerald-600',
  settles: 'text-sky-600',
}

/**
 * What this document adds up to, and what is still wrong with it.
 *
 * Both halves are derived from the draft on every keystroke (`grnModel`), never accumulated: a
 * total that is maintained by hand is a total that is eventually wrong, and on a receiving screen
 * "eventually wrong" means stock that does not match the shelf.
 *
 * The alerts are the same list the posting dialog reads, so nothing can be reported here and
 * quietly ignored there.
 */
export function GrnSummaryCard({ totals, impact, alerts, currencySymbol, onViewMatches, matchedCount }: GrnSummaryCardProps) {
  return (
    <Card padding="none" className="overflow-hidden">
      <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1.5fr)_minmax(18rem,1fr)]">
        <div className="p-3.5">
          <div className="mb-3 flex items-center gap-2.5">
            <IconTile icon={ClipboardCheck} tone="success" size="md" />
            <div className="min-w-0">
              <h2 className="text-sm font-semibold text-gray-900">Document summary</h2>
              <p className="mt-0.5 text-xs text-gray-500">Quick overview of this inward challan</p>
            </div>
          </div>

          <dl className="grid grid-cols-2 gap-2 xl:grid-cols-4">
            <Metric label="Total items" value={formatQty(totals.items, '0')} tone="text-sky-600" />
            <Metric label="Total quantity" value={formatQty(totals.quantity, '0')} tone="text-emerald-600" />
            <Metric label="Total amount" value={`${currencySymbol} ${formatMoney(totals.amount, '0.00')}`} tone="text-violet-600" />
            <Metric label="Stock impact" value={impact.label} tone={IMPACT_CLASS[impact.tone]} />
          </dl>

          {totals.incomplete > 0 ? (
            <p className="mt-2 text-[11px] text-amber-700">
              {totals.incomplete} line{totals.incomplete === 1 ? ' has' : 's have'} no item picked yet.
            </p>
          ) : null}
        </div>

        <div className="border-t border-dashed border-gray-200 p-3.5 lg:border-l lg:border-t-0">
          <h3 className="mb-2 flex items-center gap-1.5 text-[13px] font-semibold text-gray-900">
            <AlertTriangle className="h-4 w-4 text-amber-500" aria-hidden />
            Notes &amp; alerts
          </h3>
          {alerts.length === 0 ? (
            <p className="text-[11px] text-gray-500">Nothing to flag. Add the items received to see how this document will post.</p>
          ) : (
            <ul className="space-y-1.5" aria-live="polite">
              {alerts.map((alert) => {
                const { icon: Icon, cls } = ALERT_STYLE[alert.tone]
                return (
                  <li key={alert.id} className={cx('flex items-start gap-1.5 text-[11px] leading-snug', cls)}>
                    <Icon className="mt-px h-3.5 w-3.5 shrink-0" aria-hidden />
                    <span className="min-w-0">{alert.message}</span>
                  </li>
                )
              })}
            </ul>
          )}

          {onViewMatches ? (
            <button
              type="button"
              onClick={onViewMatches}
              className="mt-2.5 inline-flex items-center gap-1 text-[11px] font-semibold text-primary hover:underline"
            >
              {matchedCount > 0 ? 'View matching POs' : 'Find a purchase order'}
              <ArrowRight className="h-3 w-3" aria-hidden />
            </button>
          ) : null}
        </div>
      </div>
    </Card>
  )
}

function Metric({ label, value, tone }: { label: string; value: ReactNode; tone: string }) {
  return (
    <div className="rounded-lg border border-gray-100 bg-gray-50/60 px-2.5 py-2">
      <dt className="text-[10px] uppercase tracking-wide text-gray-500">{label}</dt>
      <dd className={cx('mt-0.5 truncate text-base font-semibold tabular-nums', tone)}>{value}</dd>
    </div>
  )
}

export default GrnSummaryCard
