import { ArrowRight, Check, Lightbulb, Target } from 'lucide-react'
import { cx } from '../../../ui/cx'
import type { Takeaway } from './model'

export interface TakeawaysProps {
  items: readonly Takeaway[]
  /** Opens the explainer — what the four methods are, and what this screen is not. */
  onLearnMore: () => void
}

/**
 * The closing panel: what the table just said, and what it means.
 *
 * The left column is generated from the figures (`model.takeaways`) and so
 * changes with the data. The right column is fixed prose, and deliberately
 * stops short of a recommendation — which method a company values its stock on
 * is a tax and audit decision, and a screen that has read one date's numbers
 * has no business making it. It explains the effect and points at the reading.
 */
export function Takeaways({ items, onLearnMore }: TakeawaysProps) {
  return (
    <section
      className={cx(
        'aic grid shrink-0 gap-x-8 gap-y-6 rounded-2xl border border-primary/15 px-5 py-4 print:hidden',
        'bg-gradient-to-r from-primary/[0.05] via-primary/[0.02] to-amber-500/[0.04]',
        'lg:grid-cols-[1fr_1px_1.05fr]',
      )}
      aria-label="What this comparison shows"
    >
      <div className="min-w-0">
        <h3 className="mb-2.5 flex items-center gap-2 text-sm font-semibold text-gray-900">
          <span className="grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-primary/10 text-primary" aria-hidden>
            <Target className="h-4 w-4" strokeWidth={1.75} />
          </span>
          Key takeaways
        </h3>
        <ul className="flex flex-col gap-2">
          {items.map((t) => (
            <li key={t.key} className="flex items-start gap-2 text-xs leading-relaxed text-gray-600">
              <span
                className="mt-0.5 grid h-4 w-4 shrink-0 place-items-center rounded-full bg-emerald-500/15 text-emerald-600"
                aria-hidden
              >
                <Check className="h-2.5 w-2.5" strokeWidth={3} />
              </span>
              {t.text}
            </li>
          ))}
        </ul>
      </div>

      <div className="hidden bg-primary/10 lg:block" aria-hidden />

      <div className="min-w-0 border-t border-primary/10 pt-5 lg:border-t-0 lg:pt-0">
        <h3 className="mb-2.5 flex items-center gap-2 text-sm font-semibold text-gray-900">
          <span className="grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-amber-500/15 text-amber-600" aria-hidden>
            <Lightbulb className="h-4 w-4" strokeWidth={1.75} />
          </span>
          Business insight
        </h3>
        <p className="max-w-prose text-xs leading-relaxed text-gray-600">
          The valuation method changes what your closing stock is worth on the books, and with it
          your cost of goods sold and your reported margin. Differences between the methods are
          normal — they follow from the order your stock moved in and how purchase costs shifted
          over the period. Use this comparison to understand that effect for your reporting and
          compliance, not as a reason to switch.
        </p>
        <button
          type="button"
          onClick={onLearnMore}
          className="mt-3 inline-flex h-8 items-center gap-1.5 rounded-lg border border-primary/20 bg-primary-light px-3 text-xs font-semibold text-primary transition-colors hover:bg-primary-light/70 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/30"
        >
          Learn about valuation methods
          <ArrowRight className="h-3.5 w-3.5" aria-hidden />
        </button>
      </div>
    </section>
  )
}

export default Takeaways
