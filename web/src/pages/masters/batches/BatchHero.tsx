import { Boxes, ShieldCheck, Sparkles, TrendingUp } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { AIC, cx } from '../../../ui/cx'

/**
 * The page's opening statement: what these are, and what they are for.
 *
 * Three bands on one card — identity, promise, capability — and each one drops
 * out in that order as the viewport narrows, so the row never squeezes the
 * heading into an ellipsis to keep a slogan on screen. The illustration is
 * decoration and is the first thing to go.
 *
 * It is a card, not a hero: the whole band is about 116px tall, because the
 * table underneath is what the reader came for.
 */

const CAPABILITIES: readonly { icon: LucideIcon; title: string; detail: string }[] = [
  { icon: Sparkles, title: 'Trace', detail: 'Know where it is' },
  { icon: ShieldCheck, title: 'Comply', detail: 'Track expiry & quality' },
  { icon: TrendingUp, title: 'Optimize', detail: 'Reduce waste' },
]

/**
 * Cartons on a shelf with a barcode band, drawn in the brand green at a few
 * percent alpha. `aria-hidden`, behind the text in the stacking order, and it
 * never intercepts a click.
 */
function BatchArtwork() {
  return (
    <svg
      viewBox="0 0 140 64"
      className="pointer-events-none h-16 w-[8.75rem] shrink-0 text-primary"
      fill="none"
      aria-hidden
    >
      <rect x="4" y="26" width="34" height="30" rx="3" stroke="currentColor" strokeWidth="1.5" opacity=".55" />
      <path d="M4 36h34" stroke="currentColor" strokeWidth="1.5" opacity=".35" />
      <rect x="42" y="14" width="34" height="42" rx="3" stroke="currentColor" strokeWidth="1.5" opacity=".75" />
      <path d="M42 26h34" stroke="currentColor" strokeWidth="1.5" opacity=".35" />
      <rect x="51" y="32" width="16" height="14" rx="2" fill="currentColor" opacity=".12" />
      {[54, 57, 60, 63].map((x, i) => (
        <path key={x} d={`M${x} 34v10`} stroke="currentColor" strokeWidth={i % 2 ? 1.5 : 1} opacity=".5" />
      ))}
      <rect x="80" y="30" width="30" height="26" rx="3" stroke="currentColor" strokeWidth="1.5" opacity=".45" />
      <path d="M80 39h30" stroke="currentColor" strokeWidth="1.5" opacity=".3" />
      <circle cx="124" cy="22" r="11" stroke="currentColor" strokeWidth="1.5" opacity=".3" />
      <circle cx="124" cy="22" r="5" stroke="currentColor" strokeWidth="1.5" opacity=".5" />
    </svg>
  )
}

export function BatchHero({ className }: { className?: string }) {
  return (
    <section
      className={cx(
        AIC,
        'relative isolate overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-card',
        'grid grid-cols-1 items-center gap-x-6 gap-y-4 px-4 py-4 sm:px-5',
        'lg:grid-cols-[minmax(18rem,1fr)_auto] wide:grid-cols-[minmax(18rem,1fr)_minmax(15rem,0.7fr)_auto]',
        className,
      )}
      aria-label="About batches"
    >
      <div
        className="pointer-events-none absolute inset-y-0 right-0 -z-10 w-1/2 bg-gradient-to-l from-primary-light/60 to-transparent"
        aria-hidden
      />

      <div className="flex min-w-0 items-center gap-3.5">
        <span className="grid h-14 w-14 shrink-0 place-items-center rounded-2xl bg-primary-light text-primary">
          <Boxes className="h-7 w-7" aria-hidden />
        </span>
        <div className="min-w-0">
          <h1 className="text-xl font-bold leading-tight tracking-tight text-gray-900 sm:text-2xl">
            Batches
          </h1>
          <p className="mt-1 max-w-xl text-[13px] leading-relaxed text-gray-500">
            Manage batch-wise tracking, expiry, stock and traceability for your items.
          </p>
        </div>
      </div>

      {/* The promise. Decoration, and the first band to go when the row tightens. */}
      <div className="hidden min-w-0 items-center gap-3 border-l border-gray-200 pl-5 wide:flex">
        <div className="min-w-0">
          <strong className="block text-[13px] font-bold text-gray-900">
            Track Better. Stay Compliant.
          </strong>
          <span className="mt-0.5 block max-w-[15rem] text-[11px] leading-snug text-gray-500">
            Complete visibility from manufacturing to consumption.
          </span>
        </div>
        <BatchArtwork />
      </div>

      <ul className="hidden w-fit overflow-hidden rounded-xl border border-gray-200 sm:flex" role="list">
        {CAPABILITIES.map(({ icon: Icon, title, detail }, i) => (
          <li
            key={title}
            className={cx(
              'flex min-w-[8rem] items-center gap-2.5 px-3 py-2.5',
              i > 0 && 'border-l border-gray-200',
            )}
          >
            <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-primary-light text-primary">
              <Icon className="h-4 w-4" aria-hidden />
            </span>
            <span className="min-w-0">
              <strong className="block text-xs font-semibold text-gray-900">{title}</strong>
              <span className="block whitespace-nowrap text-[10px] text-gray-500">{detail}</span>
            </span>
          </li>
        ))}
      </ul>
    </section>
  )
}

export default BatchHero
