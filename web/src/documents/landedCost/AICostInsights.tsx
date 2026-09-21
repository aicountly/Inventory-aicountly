import { AlertTriangle, CheckCircle2, Info, OctagonAlert, Sparkles } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { Badge } from '../../ui/Badge'
import { Card } from '../../ui/Card'
import { AIC, cx } from '../../ui/cx'
import type { Insight, InsightSeverity } from './insights'
import { allClear, rankInsights } from './insights'

interface AICostInsightsProps {
  insights: Insight[]
  /** Nothing selected and nothing entered — there is nothing to say yet. */
  idle: boolean
  onFocus: (section: 'details' | 'receipts' | 'charges' | 'review') => void
}

const SEVERITY: Record<InsightSeverity, { icon: LucideIcon; tone: 'neutral' | 'success' | 'warning' | 'danger' | 'info'; cls: string }> = {
  note: { icon: Info, tone: 'success', cls: 'text-gray-400' },
  review: { icon: Info, tone: 'warning', cls: 'text-amber-500' },
  warning: { icon: AlertTriangle, tone: 'warning', cls: 'text-amber-500' },
  blocker: { icon: OctagonAlert, tone: 'danger', cls: 'text-red-500' },
}

/**
 * The observations card.
 *
 * It is labelled "checked on this device" because that is exactly what it is: every line is
 * computed here from the charges and the receipts on screen. Inventory has no landed-cost analysis
 * service, and a card that implied one — "AI reviewed this allocation" over arithmetic — would be
 * telling the operator that something checked their work when nothing did.
 *
 * The severities are kept visually apart for the same reason. A screening threshold is not an
 * accounting error: freight at 18% of invoice value on an air consignment is ordinary, so it gets
 * "Review" in amber and the footnote says the bands are a prompt to look. Only a `blocker` — the
 * things the server will actually refuse — is rendered as something that must be fixed.
 */
export function AICostInsights({ insights, idle, onFocus }: AICostInsightsProps) {
  const ranked = rankInsights(insights)
  const clear = allClear(ranked)

  return (
    <Card padding="sm" className={cx(AIC, 'border-violet-200')}>
      <div className="mb-2.5 flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-1.5">
          <Sparkles className="h-4 w-4 shrink-0 text-violet-500" aria-hidden />
          <h3 className="truncate text-sm font-semibold text-gray-900">Cost insights</h3>
          <Badge tone="beta" size="xs">
            Checked here
          </Badge>
        </div>
      </div>

      {idle ? (
        <p className="text-[11px] leading-relaxed text-gray-500">
          Pick a receipt and enter the charges. Each one is checked against the value of the goods as you type.
        </p>
      ) : (
        <>
          {clear ? (
            <div className="mb-2.5 flex items-start gap-2 rounded-lg bg-emerald-50 px-2.5 py-2 text-emerald-800">
              <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
              <div className="min-w-0">
                <p className="text-xs font-semibold">Nothing stands out</p>
                <p className="text-[10px] leading-snug">The charges and the bases they spread on look ordinary for this consignment.</p>
              </div>
            </div>
          ) : null}

          <ul className="divide-y divide-gray-100">
            {ranked.map((insight) => {
              const style = SEVERITY[insight.severity]
              const Icon = style.icon
              const clickable = Boolean(insight.focus)
              const body = (
                <>
                  <Icon className={cx('mt-0.5 h-3.5 w-3.5 shrink-0', style.cls)} aria-hidden />
                  <span className="min-w-0 flex-1 text-[11px] leading-snug text-gray-600">{insight.message}</span>
                  <Badge tone={style.tone} size="xs">
                    {insight.status}
                  </Badge>
                </>
              )
              return (
                <li key={insight.id}>
                  {clickable ? (
                    <button
                      type="button"
                      onClick={() => insight.focus && onFocus(insight.focus)}
                      className="flex w-full items-start gap-2 rounded-md py-2 text-left transition-colors hover:bg-gray-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
                    >
                      {body}
                    </button>
                  ) : (
                    <div className="flex items-start gap-2 py-2">{body}</div>
                  )}
                </li>
              )
            })}
          </ul>
        </>
      )}

      <p className="mt-2.5 rounded-lg bg-sky-50 px-2.5 py-2 text-[10px] leading-relaxed text-sky-900">
        These are checks run on this device over the figures on screen — not a review by a service. The percentage bands are a prompt to
        look, not a rule of accounting. The final allocation follows this company&rsquo;s configured inventory rules and the server&rsquo;s own validation.
      </p>
    </Card>
  )
}
