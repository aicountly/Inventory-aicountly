import { useMemo } from 'react'
import { AlertTriangle, CheckCircle2, Info, Sparkles, XCircle } from 'lucide-react'
import type { AvailabilityCheckResult } from '../../services/stockApi'
import { Badge } from '../../ui/Badge'
import type { BadgeTone } from '../../ui/Badge'
import { Card } from '../../ui/Card'
import { cx } from '../../ui/cx'
import type { HeaderDraft, LineDraft } from '../formModel'
import type { DocumentTypeSpec } from '../registry'
import { computePackingInsights } from './packingInsights'
import type { InsightTone, ReadinessState } from './packingInsights'

export interface PackingAIInsightsPanelProps {
  header: HeaderDraft
  lines: LineDraft[]
  spec: DocumentTypeSpec
  availability: Record<string, AvailabilityCheckResult>
  checking: boolean
}

const TONE_ICON: Record<InsightTone, typeof CheckCircle2> = {
  success: CheckCircle2,
  warning: AlertTriangle,
  danger: XCircle,
  info: Info,
}

const TONE_ICON_CLASS: Record<InsightTone, string> = {
  success: 'text-emerald-600',
  warning: 'text-amber-600',
  danger: 'text-red-600',
  info: 'text-gray-400',
}

const READINESS_BADGE: Record<ReadinessState, BadgeTone> = {
  ready_to_dispatch: 'success',
  ready_to_pack: 'info',
  needs_attention: 'warning',
  not_ready: 'danger',
}

/** Renders `computePackingInsights` — a deterministic read of the draft, badged as BETA rather than claimed as a model. */
export function PackingAIInsightsPanel({ header, lines, spec, availability, checking }: PackingAIInsightsPanelProps) {
  const result = useMemo(() => computePackingInsights({ header, lines, spec, availability, checking }), [header, lines, spec, availability, checking])

  return (
    <Card padding="none" className="overflow-hidden">
      <div className="flex items-center gap-2 rounded-t-xl border-b border-gray-100 bg-violet-50 px-4 py-3">
        <span className="flex h-7 w-7 items-center justify-center rounded-full bg-white text-violet-600">
          <Sparkles className="h-3.5 w-3.5" aria-hidden />
        </span>
        <h3 className="text-sm font-semibold text-gray-900">Inventory AI</h3>
        <Badge tone="beta" size="xs">
          BETA
        </Badge>
        <Badge tone={READINESS_BADGE[result.readiness.state]} size="xs" className="ml-auto">
          {result.readiness.label}
        </Badge>
      </div>
      <div className="flex flex-col gap-2.5 px-4 py-3">
        {result.insights.map((insight) => {
          const Icon = TONE_ICON[insight.tone]
          return (
            <div key={insight.key} className="flex items-start gap-2 text-xs leading-relaxed text-gray-700">
              <Icon className={cx('mt-0.5 h-3.5 w-3.5 shrink-0', TONE_ICON_CLASS[insight.tone])} aria-hidden />
              <span>{insight.message}</span>
            </div>
          )
        })}
      </div>
      {result.tip ? (
        <div className="mx-4 mb-4 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] leading-relaxed text-amber-900">
          <strong className="font-semibold">Tip: </strong>
          {result.tip}
        </div>
      ) : null}
    </Card>
  )
}

export default PackingAIInsightsPanel
