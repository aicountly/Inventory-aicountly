import { Library } from 'lucide-react'
import { BreadcrumbBar } from '../../ui/shell/BreadcrumbBar'
import { AIC, cx } from '../../ui/cx'

/**
 * The paper the hub is printed on.
 *
 * Every shape is a div or an inline SVG expressed in the accent token, so it
 * follows the palette picker and both themes, prints without a background, and
 * costs no image request — a raster or a remote asset for 90px of decoration is
 * a maintenance burden and a network round trip for something nobody looks at
 * twice. `aria-hidden`: there is nothing here to read.
 */
function HeroArt() {
  return (
    <div
      aria-hidden
      className="pointer-events-none relative hidden h-[6.5rem] w-[20rem] shrink-0 select-none lg:block"
    >
      <span className="absolute right-6 top-2 h-[6.4rem] w-[5.4rem] rotate-[7deg] rounded-xl border border-primary/15 bg-gray-50 shadow-card" />
      <span className="absolute right-[5.75rem] top-0 flex h-[6.4rem] w-[5.4rem] rotate-[5deg] flex-col justify-between rounded-xl border border-primary/15 bg-white p-3 shadow-card">
        <span className="block h-1.5 w-8 rounded-full bg-primary/25" />
        <span className="flex h-11 items-end gap-1">
          {[35, 62, 93, 72].map((h) => (
            <i
              key={h}
              className="block flex-1 rounded-sm rounded-b-[1px] bg-primary"
              style={{ height: `${h}%`, opacity: 0.35 + (h / 100) * 0.5 }}
            />
          ))}
        </span>
      </span>
      <span className="absolute left-0 top-4 w-[8.75rem] -rotate-[4deg] rounded-lg border border-primary/20 bg-white px-2.5 py-2 text-[11px] leading-tight text-gray-500 shadow-card">
        Complete registers
        <strong className="block font-semibold text-primary">for better control</strong>
      </span>
    </div>
  )
}

export interface RegistersHeroProps {
  /** `Acme Ltd · FY 2026-27 · All branches`, from the app's own scope. */
  scopeLabel: string
}

export function RegistersHero({ scopeLabel }: RegistersHeroProps) {
  return (
    <div className={cx(AIC, 'space-y-2')}>
      <BreadcrumbBar items={[{ label: 'Inventory', to: '/dashboard' }, { label: 'Registers' }]} />
      <section className="register-hero-wash flex items-center justify-between gap-6 overflow-hidden rounded-2xl border border-gray-200 px-5 py-4 md:px-6">
        <div className="flex min-w-0 items-start gap-4">
          <span className="mt-0.5 flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-primary-light text-primary sm:h-14 sm:w-14">
            <Library className="h-6 w-6 sm:h-7 sm:w-7" aria-hidden />
          </span>
          <div className="min-w-0">
            <h1 className="text-xl font-bold tracking-tight text-gray-900 md:text-2xl">Registers</h1>
            {/* One element, one sentence: the scope line is the page's claim
                about whose books these are, and splitting it across nodes makes
                it unreadable to anything that reads the page as text. */}
            <p className="mt-1 break-words text-sm leading-relaxed text-gray-600">
              Dated, detailed and printable listings for {scopeLabel}.
            </p>
            <p className="mt-1 hidden max-w-4xl text-xs leading-relaxed text-gray-500 sm:block">
              Every register remembers its filters in the address bar, exports the whole result to
              CSV, Excel or PDF, prints on the company letterhead, and drills through to the
              document behind the line.
            </p>
          </div>
        </div>
        <HeroArt />
      </section>
    </div>
  )
}

export default RegistersHero
