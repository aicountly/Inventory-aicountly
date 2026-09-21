import { Boxes, ScanLine, ShieldCheck, TrendingUp } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import type { ReactNode } from 'react'
import { BreadcrumbBar } from '../../../ui/shell/BreadcrumbBar'
import { AIC, cx } from '../../../ui/cx'

/**
 * The page's introduction: what this screen is for, and the three things batch
 * tracking buys you.
 *
 * Kept to one band about 110px tall. It is the first thing on the screen and
 * the least useful thing on it — every pixel it takes is a row of stock the
 * controller cannot see — so the middle message and the capability strip drop
 * out as the viewport narrows rather than wrapping into a second and third
 * line. Below `lg` only the title, the subtitle and the breadcrumb survive,
 * which is the whole of what a reader needs.
 */

interface Capability {
  icon: LucideIcon
  title: string
  detail: string
}

const CAPABILITIES: Capability[] = [
  { icon: ScanLine, title: 'Trace', detail: 'Know where it is' },
  { icon: ShieldCheck, title: 'Comply', detail: 'Track expiry & quality' },
  { icon: TrendingUp, title: 'Optimize', detail: 'Reduce waste' },
]

export interface BatchHeroProps {
  /** Import / Export / New batch — the page's own actions, beside the trail. */
  actions?: ReactNode
}

export function BatchHero({ actions }: BatchHeroProps) {
  return (
    <div className="space-y-2">
      {/*
        * The trail and the page's actions share a row ABOVE the card, not a
        * column inside it. They were in the band at first, and five buttons
        * beside three capability tiles and a message left the heading about
        * 100px: "Batches" over a subtitle broken across nine lines. A row of
        * buttons is not part of the introduction, so it does not live in it.
        */}
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 print:hidden">
        <BreadcrumbBar items={[{ label: 'Masters', to: '/masters' }, { label: 'Batches' }]} />
        {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
      </div>

      <header
        className={cx(
          AIC,
          'rounded-xl border border-gray-200 bg-white px-4 py-3.5 shadow-card print:hidden',
          'flex flex-col gap-3 lg:flex-row lg:items-center lg:gap-6',
        )}
      >
        <div className="flex min-w-0 flex-1 items-center gap-3.5">
          <span
            className="hidden h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-primary-light text-primary sm:inline-flex"
            aria-hidden
          >
            <Boxes className="h-7 w-7" />
          </span>
          <div className="min-w-0">
            <h1 className="text-xl font-semibold tracking-tight text-gray-900 md:text-2xl">Batches</h1>
            <p className="mt-1 text-[13px] leading-relaxed text-gray-500">
              Manage batch-wise tracking, expiry, stock and traceability for your items.
            </p>
          </div>
        </div>

        <div className="hidden min-w-0 shrink border-l border-gray-200 pl-5 xl:block">
          <p className="text-sm font-bold text-gray-900">Track Better. Stay Compliant.</p>
          <p className="mt-0.5 max-w-[15rem] text-xs leading-relaxed text-gray-500">
            Complete visibility from manufacturing to consumption.
          </p>
        </div>

        <ul className="hidden shrink-0 overflow-hidden rounded-xl border border-gray-200 lg:flex">
          {CAPABILITIES.map(({ icon: Icon, title, detail }) => (
            <li key={title} className="flex min-w-[8.25rem] items-center gap-2.5 p-3 [&+&]:border-l [&+&]:border-gray-200">
              <span className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary-light text-primary" aria-hidden>
                <Icon className="h-4 w-4" />
              </span>
              <span className="min-w-0">
                <span className="block text-xs font-semibold text-gray-900">{title}</span>
                <span className="block whitespace-nowrap text-[10px] text-gray-500">{detail}</span>
              </span>
            </li>
          ))}
        </ul>
      </header>
    </div>
  )
}

export default BatchHero
