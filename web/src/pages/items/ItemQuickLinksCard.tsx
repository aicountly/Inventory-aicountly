import { Link } from 'react-router-dom'
import type { LucideIcon } from 'lucide-react'
import { AIC, cx } from '../../ui/cx'
import { AsideCard } from './ItemWorkspaceKit'

/**
 * Where else this item appears.
 *
 * Every tile leads to a route that exists in `router.tsx` and that this profile is allowed to
 * open — a tile the user would be 403'd on is not rendered at all, rather than rendered and then
 * failing. The item id rides in the query string the registers already read, and the company /
 * financial year / branch scope travels with the API client, so a link lands on the same scope the
 * reader is in without any of it being in the URL.
 *
 * `Attached files` is the exception and says so: it scrolls to the Media section, which explains
 * that Inventory has no attachment endpoint yet. A tile that led nowhere would be worse.
 */
export interface QuickLink {
  key: string
  label: string
  icon: LucideIcon
  to?: string
  onClick?: () => void
  tone: 'sky' | 'primary' | 'amber' | 'violet'
  hint?: string
}

const TONES = {
  sky: 'bg-sky-50 text-sky-700 hover:bg-sky-100',
  primary: 'bg-primary-light text-primary hover:bg-primary-light/70',
  amber: 'bg-amber-50 text-amber-700 hover:bg-amber-100',
  violet: 'bg-violet-50 text-violet-700 hover:bg-violet-100',
} as const

export function ItemQuickLinksCard({ links }: { links: readonly QuickLink[] }) {
  if (links.length === 0) return null
  return (
    <AsideCard title="Quick Links">
      <div className={cx(AIC, 'grid grid-cols-2 gap-2')}>
        {links.map((link) => {
          const body = (
            <>
              <link.icon className="h-4 w-4" aria-hidden />
              <span className="mt-1 text-[11px] font-semibold leading-tight">{link.label}</span>
            </>
          )
          const className = cx(
            'flex min-h-[3.25rem] flex-col items-start rounded-xl p-2.5 no-underline transition-colors',
            'focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40',
            TONES[link.tone],
          )
          return link.to ? (
            <Link key={link.key} to={link.to} title={link.hint} className={className}>
              {body}
            </Link>
          ) : (
            <button key={link.key} type="button" onClick={link.onClick} title={link.hint} className={className}>
              {body}
            </button>
          )
        })}
      </div>
    </AsideCard>
  )
}

export default ItemQuickLinksCard
