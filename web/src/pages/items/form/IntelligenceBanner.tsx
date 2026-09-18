import { Sparkles } from 'lucide-react'
import { AIC, cx } from '../../../ui/cx'

export interface IntelligenceBannerProps {
  onAssist: () => void
  count: number
  disabled?: boolean
}

/**
 * The strip under the stepper.
 *
 * It says what the assistant does and stops there. No progress theatre, no
 * "analysing…", and the count is the number of suggestions that actually exist
 * for the draft on screen — a banner that promised help while offering none
 * would be the most expensive pixel on the page.
 */
export function IntelligenceBanner({ onAssist, count, disabled = false }: IntelligenceBannerProps) {
  return (
    <div
      className={cx(
        AIC,
        'flex items-center gap-3 rounded-xl border border-primary/20 bg-gradient-to-r from-primary-light/70 to-primary-light/20 px-3 py-2.5 md:px-4',
      )}
    >
      <span className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary" aria-hidden>
        <Sparkles className="h-4 w-4" />
      </span>
      <div className="flex min-w-0 flex-1 flex-col">
        <strong className="text-[0.8125rem] font-semibold text-gray-900">Inventory intelligence</strong>
        <span className="hidden text-[11px] leading-relaxed text-gray-600 sm:block">
          Assisted classification, duplicate detection and setup checks — from this draft and your own masters.
        </span>
      </div>
      <button
        type="button"
        onClick={onAssist}
        disabled={disabled}
        className={cx(
          AIC,
          'inline-flex h-8 shrink-0 items-center gap-1.5 rounded-lg border border-primary/25 bg-white px-3 text-xs font-bold text-primary transition-colors',
          'hover:bg-primary-light focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/30 disabled:cursor-not-allowed disabled:opacity-60',
        )}
      >
        <Sparkles className="h-3.5 w-3.5" aria-hidden />
        <span>Assist</span>
        {count > 0 ? (
          <span className="rounded-full bg-primary px-1.5 text-[10px] font-bold leading-4 text-white">{count}</span>
        ) : null}
      </button>
    </div>
  )
}

export default IntelligenceBanner
