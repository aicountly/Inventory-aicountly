import { AIC, cx } from '../../ui/cx'

/**
 * The page's opening statement: where you are, what these are, and whose.
 *
 * The company name is read by the caller from CompanyContext, never from a
 * route param or a cached label — every master below is scoped to it, and the
 * sentence is the only thing on screen that says so.
 *
 * The decoration is a wash and two arcs drawn in the brand green at a few
 * percent alpha. It is `aria-hidden` and sits behind the text in the stacking
 * order, so it can never interrupt a screen reader or swallow a click.
 */
export function MastersHero({ companyName, className }: { companyName: string; className?: string }) {
  return (
    <section
      className={cx(
        AIC,
        'relative isolate overflow-hidden rounded-2xl bg-white px-4 py-5 sm:px-6 sm:py-7',
        className,
      )}
    >
      <div
        className="pointer-events-none absolute inset-0 -z-10 bg-gradient-to-r from-transparent via-transparent to-primary-light/70"
        aria-hidden
      />
      <svg
        className="pointer-events-none absolute -right-8 -top-16 -z-10 hidden h-[190%] w-[26rem] text-primary/20 sm:block"
        viewBox="0 0 400 400"
        fill="none"
        aria-hidden
      >
        <circle cx="300" cy="200" r="150" stroke="currentColor" strokeWidth="1.5" />
        <circle cx="300" cy="200" r="110" stroke="currentColor" strokeWidth="1.5" />
        <circle cx="300" cy="200" r="70" stroke="currentColor" strokeWidth="1.5" />
      </svg>

      <div className="flex flex-wrap items-end justify-between gap-x-8 gap-y-3">
        <div className="min-w-0">
          <span className="text-label-xs font-semibold uppercase tracking-[0.14em] text-primary">
            Inventory
          </span>
          <h1 className="mt-1 text-2xl font-bold tracking-tight text-gray-900 sm:text-3xl">Masters</h1>
          <p className="mt-1.5 max-w-2xl text-sm leading-relaxed text-gray-500">
            Reference data for{' '}
            <span className="font-semibold text-gray-700">{companyName || 'this company'}</span>. Every
            master is scoped to the selected company.
          </p>
        </div>

        {/* Decorative only, and the first thing to go when the row gets tight. */}
        <p
          className="hidden max-w-[15rem] shrink-0 text-right font-nunito text-sm italic leading-snug text-primary/70 xl:block"
          aria-hidden
        >
          Build the foundation for a smarter inventory tomorrow.
        </p>
      </div>
    </section>
  )
}

export default MastersHero
