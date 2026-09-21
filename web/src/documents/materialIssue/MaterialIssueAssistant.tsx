import { AlertTriangle, Info, Lightbulb, OctagonAlert, Sparkles } from 'lucide-react'
import { Badge } from '../../ui'
import { AIC, cx } from '../../ui/cx'
import type { AssistantSuggestion, SuggestionTone } from './assistant'

const TONE_ICON = {
  info: Info,
  warning: AlertTriangle,
  danger: OctagonAlert,
} as const

const TONE_CLS: Record<SuggestionTone, string> = {
  info: 'text-sky-600',
  warning: 'text-amber-600',
  danger: 'text-red-600',
}

export interface MaterialIssueAssistantProps {
  suggestions: AssistantSuggestion[]
}

/**
 * The assistant panel.
 *
 * Its suggestions come from `assistant.ts` — deterministic rules over the draft
 * on screen. It is an aid, never a gate: the issue saves and posts with this
 * panel saying nothing at all, and nothing in it blocks a control.
 */
export function MaterialIssueAssistant({ suggestions }: MaterialIssueAssistantProps) {
  return (
    <section className={cx(AIC, 'overflow-hidden rounded-xl border border-indigo-100 bg-white shadow-card')}>
      {/* Flat wash rather than a gradient — see MaterialIssueInsights. */}
      <div className="flex items-center justify-between gap-2 bg-indigo-50 px-4 py-3">
        <div className="flex min-w-0 items-center gap-2">
          <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary">
            <Sparkles className="h-3.5 w-3.5 text-white" aria-hidden />
          </span>
          <strong className="truncate text-sm font-semibold text-gray-900">Aicountly AI assistant</strong>
        </div>
        <Badge tone="beta" size="xs">
          Beta
        </Badge>
      </div>

      <div className="p-4">
        <div className="flex items-center gap-1.5 text-xs font-semibold text-gray-900">
          <Lightbulb className="h-3.5 w-3.5 text-amber-500" aria-hidden />
          Smart suggestions for you
        </div>
        <ul className="mt-3 space-y-2.5">
          {suggestions.map((s) => {
            const Icon = TONE_ICON[s.tone]
            return (
              <li key={s.id} className="flex gap-2 text-xs leading-relaxed text-gray-700">
                <Icon className={cx('mt-0.5 h-3.5 w-3.5 shrink-0', TONE_CLS[s.tone])} aria-hidden />
                <span>{s.message}</span>
              </li>
            )
          })}
        </ul>
      </div>
    </section>
  )
}

export default MaterialIssueAssistant
