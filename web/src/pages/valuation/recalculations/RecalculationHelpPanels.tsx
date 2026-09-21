import { Link } from 'react-router-dom'
import { ArrowRight, BookOpen, Check, Lightbulb, Sparkles } from 'lucide-react'
import { Button } from '../../../ui/Button'
import { cx } from '../../../ui/cx'

/**
 * The three guidance panels under the register.
 *
 * They answer the questions a reader who has never queued a recalculation
 * actually asks — when do I need one, what will it do to my books, how do I try
 * it safely — and each one ends somewhere REAL. None of them links to a
 * documentation site: this product has no in-app docs route, and a "Learn more
 * →" that goes nowhere is worse than no link at all. They point at the screens
 * that hold the answer instead.
 */

const CARD = 'rounded-xl border p-4 flex items-start gap-3'
const HEADING = 'text-[13px] font-semibold text-gray-900'
const BODY = 'text-[11.5px] leading-relaxed text-gray-600'
const GLYPH = 'grid h-9 w-9 shrink-0 place-items-center rounded-full bg-white/80'

export function RecalculationHelpPanels({
  onNewRecalculation,
  canRecalculate,
}: {
  onNewRecalculation: () => void
  canRecalculate: boolean
}) {
  return (
    <section
      aria-label="About valuation recalculations"
      className="grid shrink-0 grid-cols-1 gap-2.5 lg:grid-cols-3 print:hidden"
    >
      <article className={cx(CARD, 'border-sky-100 bg-sky-50/40')}>
        <span className={cx(GLYPH, 'text-sky-600')} aria-hidden>
          <Lightbulb className="h-4 w-4" />
        </span>
        <div className="min-w-0">
          <h3 className={HEADING}>When to run a recalculation?</h3>
          <ul className={cx(BODY, 'mt-1.5 list-disc space-y-0.5 pl-4')}>
            <li>A receipt or purchase rate was entered or corrected after later issues had already been costed</li>
            <li>Opening stock or its value was corrected</li>
            <li>An item&rsquo;s valuation method changed in the master</li>
            <li>A document was reversed or re-posted in a closed-off period</li>
          </ul>
          <Link
            to="/settings"
            className="mt-2 inline-flex items-center gap-1 text-[11.5px] font-semibold text-primary hover:underline"
          >
            Company valuation settings
            <ArrowRight className="h-3 w-3" aria-hidden />
          </Link>
        </div>
      </article>

      <article className={cx(CARD, 'border-emerald-100 bg-emerald-50/40')}>
        <span className={cx(GLYPH, 'text-emerald-600')} aria-hidden>
          <BookOpen className="h-4 w-4" />
        </span>
        <div className="min-w-0">
          <h3 className={HEADING}>What happens?</h3>
          <ul className={cx(BODY, 'mt-1.5 space-y-1')}>
            {[
              'Every movement from the effective date is re-costed in order',
              'Cost layers and on-hand valuation are rebuilt',
              'Lines whose valuation changed become revisions, published to Books',
              'The job, its inputs and its result stay on the audit trail',
            ].map((line) => (
              <li key={line} className="flex items-start gap-1.5">
                <Check className="mt-0.5 h-3 w-3 shrink-0 text-emerald-600" aria-hidden />
                <span>{line}</span>
              </li>
            ))}
          </ul>
          <Link
            to="/valuation/revisions"
            className="mt-2 inline-flex items-center gap-1 text-[11.5px] font-semibold text-emerald-700 hover:underline"
          >
            See the revisions published
            <ArrowRight className="h-3 w-3" aria-hidden />
          </Link>
        </div>
      </article>

      <article className={cx(CARD, 'border-violet-100 bg-violet-50/40')}>
        <span className={cx(GLYPH, 'text-violet-600')} aria-hidden>
          <Sparkles className="h-4 w-4" />
        </span>
        <div className="min-w-0">
          <h3 className={HEADING}>Pro tip</h3>
          <p className={cx(BODY, 'mt-1.5')}>
            {/*
              A dry run is this product's real rehearsal — RecalculationService
              replays exactly the same way and writes nothing — so the tip points
              at a mode that exists rather than inventing a "test" one.
            */}
            Start with a dry run on one item. It replays the costing exactly as a live run would,
            reports what it would change, and writes no revision and nothing to Books.
          </p>
          {/* Not a second button called "New recalculation": the header already
              has one, and two controls with the same accessible name on one page
              are one name to a screen reader. This one says what it starts. */}
          {canRecalculate ? (
            <Button
              variant="secondary"
              size="xs"
              iconRight={ArrowRight}
              className="mt-2.5"
              onClick={onNewRecalculation}
            >
              Start a dry run
            </Button>
          ) : null}
        </div>
      </article>
    </section>
  )
}
