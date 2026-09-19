import { ArrowRight, Sparkles, X } from 'lucide-react'
import { cx } from '../../../ui/cx'

export interface InsightStripProps {
  /** The sentence, already built from the figures on screen. */
  text: string
  /** Opens the breakdown behind the method the sentence calls out. */
  onExplore?: () => void
  exploreLabel?: string
  onDismiss?: () => void
}

/**
 * The read on the comparison, in one line, above the table.
 *
 * The sentence is computed from the four figures the page already holds —
 * smallest absolute difference, largest, and their percentages (see
 * `model.ts`). No request is made for it and no service has to be reachable for
 * this strip to render, which is the whole point: an insight that disappears
 * when a model endpoint is down is an insight nobody can rely on.
 *
 * It is labelled "Smart insight" rather than "AI insight" because that is what
 * it is. When Aicountly AI is wired up behind it, the component takes a longer
 * sentence from the service and the label changes with it — until then, calling
 * arithmetic "AI" on a finance screen is a claim the screen cannot support.
 *
 * `print:hidden`: every figure in it is stated again, unabbreviated, in the
 * table below, and the sheet carries the table.
 */
export function InsightStrip({ text, onExplore, exploreLabel = 'Where it comes from', onDismiss }: InsightStripProps) {
  return (
    <section
      aria-label="Smart insight"
      className={cx(
        'aic flex shrink-0 flex-wrap items-center gap-x-4 gap-y-2 rounded-2xl border border-primary/15 px-4 py-2.5 print:hidden',
        'bg-gradient-to-r from-primary/[0.06] via-primary/[0.04] to-transparent',
      )}
    >
      <span className="inline-flex shrink-0 items-center gap-2 text-xs font-semibold text-primary">
        <span className="grid h-7 w-7 place-items-center rounded-lg bg-primary/10" aria-hidden>
          <Sparkles className="h-4 w-4" strokeWidth={1.75} />
        </span>
        Smart insight
      </span>

      {/* Mobile-first, and not `max-sm:`: this Tailwind config declares `raw`
          screens, which stops the `max-*` variants from being generated at all.
          A utility that silently compiles to nothing is worse than none. */}
      <p className="min-w-[14rem] flex-1 border-l-0 pl-0 text-[13px] leading-relaxed text-gray-700 sm:border-l sm:border-primary/15 sm:pl-4">
        {text}
      </p>

      {onExplore ? (
        <button
          type="button"
          onClick={onExplore}
          className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-lg border border-primary/20 bg-primary-light px-3 text-xs font-semibold text-primary transition-colors hover:bg-primary-light/70 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/30"
        >
          {exploreLabel}
          <ArrowRight className="h-3.5 w-3.5" aria-hidden />
        </button>
      ) : null}

      {onDismiss ? (
        <button
          type="button"
          onClick={onDismiss}
          aria-label="Dismiss insight"
          className="grid h-8 w-8 shrink-0 place-items-center rounded-lg text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-600 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/30"
        >
          <X className="h-4 w-4" aria-hidden />
        </button>
      ) : null}
    </section>
  )
}

export default InsightStrip
