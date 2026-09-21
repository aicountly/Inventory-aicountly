import { Lightbulb, Sparkles } from 'lucide-react'
import { Badge } from '../../ui/Badge'
import { Card } from '../../ui/Card'
import { AIC, cx } from '../../ui/cx'
import { formatQty } from '../../utils/format'
import type { StockEffectRow } from './jobWorkModel'
import type { AssistantActionKey, JobWorkModeSpec } from './jobWorkMode'

export interface JobWorkAssistantProps {
  modeSpec: JobWorkModeSpec
  /** Every action here runs an ordinary API call on this screen. */
  onAction: (action: AssistantActionKey) => void
  onPrimary: () => void
  /** What this draft will do to stock, from the lines as they stand. */
  effect: readonly StockEffectRow[]
  disabled?: boolean
  /** Extra line of context — what this job worker is already holding. */
  context?: string | null
}

/**
 * The right-hand rail.
 *
 * Every control on it triggers a deterministic API call this screen already
 * makes — pulling the pending list, checking availability, opening the paste
 * drawer. None of it is a model, none of it is called one, and nothing here
 * writes to the document without the user seeing what changed: the pending
 * drawer proposes lines, the operator applies them.
 *
 * The panel is gated on `features.jobWorkAssistant`; with the flag off the page
 * renders without it and every one of these actions is still reachable from the
 * toolbar above the grid.
 */
export function JobWorkAssistant({ modeSpec, onAction, onPrimary, effect, disabled, context }: JobWorkAssistantProps) {
  return (
    <Card padding="md" className={cx(AIC, 'flex flex-col gap-4')} as="aside" aria-label="Job work assistant">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Sparkles className="h-4 w-4 text-violet-600" aria-hidden />
          <h2 className="text-sm font-semibold text-gray-900">Assistant</h2>
          <Badge tone="beta" size="xs">
            Beta
          </Badge>
        </div>
      </div>

      <div className="rounded-xl bg-violet-50 p-3.5">
        <p className="text-sm font-semibold text-violet-700">{modeSpec.assistant.question}</p>
        <p className="mt-1.5 text-xs leading-relaxed text-violet-600">{modeSpec.assistant.answer}</p>
        <button
          type="button"
          onClick={onPrimary}
          disabled={disabled}
          className="aic mt-3 inline-flex h-8 items-center gap-1.5 rounded-lg bg-violet-600 px-3 text-sm font-medium text-white hover:bg-violet-700 disabled:opacity-60"
        >
          {modeSpec.assistant.cta}
          <span aria-hidden>→</span>
        </button>
      </div>

      <div>
        <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-gray-500">Quick actions</h3>
        <div className="grid grid-cols-2 gap-2">
          {modeSpec.assistant.actions.map((action) => (
            <button
              key={action.key}
              type="button"
              onClick={() => onAction(action.key)}
              disabled={disabled}
              className="aic flex min-h-[2.25rem] items-center gap-2 rounded-lg border border-gray-200 bg-white px-2.5 py-2 text-left text-xs font-medium text-gray-700 hover:border-primary/40 hover:bg-primary-light disabled:opacity-60"
            >
              <action.icon className="h-3.5 w-3.5 shrink-0 text-gray-400" aria-hidden />
              <span className="truncate">{action.label}</span>
            </button>
          ))}
        </div>
      </div>

      {effect.length > 0 ? (
        <div id="jw-stock-effect">
          <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-gray-500">Stock effect on posting</h3>
          <ul className="space-y-1.5">
            {effect.map((row) => (
              <li key={row.key} className="flex items-center justify-between gap-2 text-xs">
                <span className="min-w-0 truncate text-gray-600">{row.label}</span>
                <span className={cx('shrink-0 font-semibold tabular-nums', row.direction === 'in' ? 'text-emerald-600' : 'text-amber-600')}>
                  {row.direction === 'in' ? '+' : '−'}
                  {formatQty(row.qty)}
                </span>
              </li>
            ))}
          </ul>
          <p className="mt-2 text-[10px] leading-relaxed text-gray-400">
            Quantities in base units, from the lines as they stand. The server values and posts them.
          </p>
        </div>
      ) : null}

      {context ? (
        <div className="rounded-xl bg-sky-50 p-3">
          <p className="text-[11px] leading-relaxed text-sky-700">{context}</p>
        </div>
      ) : null}

      <div className="rounded-xl bg-emerald-50 p-3">
        <p className="flex items-center gap-1.5 text-[11px] font-semibold text-emerald-800">
          <Lightbulb className="h-3.5 w-3.5" aria-hidden />
          Tip
        </p>
        <p className="mt-1 text-[11px] leading-relaxed text-emerald-800">{modeSpec.assistant.tip}</p>
      </div>
    </Card>
  )
}
