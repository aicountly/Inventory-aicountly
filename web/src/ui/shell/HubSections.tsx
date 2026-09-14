import { Link } from 'react-router-dom'
import { ExternalLink, FileText } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import type { ReactNode } from 'react'
import { Badge } from '../Badge'
import { Card } from '../Card'
import { IconTile } from '../IconTile'
import type { IconTone } from '../IconTile'
import { AIC, cx } from '../cx'

export interface HubTileItem {
  label: string
  /** Internal route. */
  to?: string
  /** External URL — opens in a new tab with an explicit affordance. */
  href?: string
  description?: ReactNode
  icon?: LucideIcon
  tone?: IconTone
  badge?: string
  disabled?: boolean
  disabledReason?: string
}

export interface HubSectionSpec {
  label: string
  description?: ReactNode
  items: readonly HubTileItem[]
}

function HubTile({ item }: { item: HubTileItem }) {
  const Icon = item.icon ?? FileText
  const inner = (
    <Card
      padding="md"
      className="h-full transition-all group-hover:border-primary/40 group-hover:shadow-overlay"
    >
      <div className="flex items-start gap-3">
        <IconTile icon={Icon} tone={item.tone ?? 'primary'} size="md" />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-semibold text-gray-900 group-hover:text-primary transition-colors">
              {item.label}
            </span>
            {item.badge ? (
              <Badge tone="info" size="xs" className="normal-case">
                {item.badge}
              </Badge>
            ) : null}
            {item.href ? (
              <ExternalLink className="w-3 h-3 text-gray-400 shrink-0" aria-hidden />
            ) : null}
          </div>
          {item.description ? (
            <div className="text-xs text-gray-500 mt-1 leading-relaxed">{item.description}</div>
          ) : null}
        </div>
      </div>
    </Card>
  )

  if (item.disabled || (!item.to && !item.href)) {
    return (
      <div
        className="rounded-xl opacity-60 cursor-not-allowed"
        title={item.disabledReason}
        aria-disabled
      >
        {inner}
      </div>
    )
  }

  if (item.href) {
    return (
      <a
        href={item.href}
        target="_blank"
        rel="noreferrer"
        className="group rounded-xl block no-underline focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/30"
      >
        {inner}
      </a>
    )
  }

  return (
    <Link
      to={item.to as string}
      className="group rounded-xl block no-underline focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/30"
    >
      {inner}
    </Link>
  )
}

export interface HubSectionsProps {
  sections: readonly HubSectionSpec[]
  emptyMessage?: ReactNode
  className?: string
}

/**
 * Grouped tile grid — the shape of every hub screen (Masters, Reports,
 * Registers). Sections with no items disappear, so permission filtering is
 * just `items.filter(can)` at the call site.
 */
export function HubSections({ sections, emptyMessage, className }: HubSectionsProps) {
  const visible = sections.filter((s) => s.items.length > 0)
  if (!visible.length) {
    return (
      <p className="text-sm text-gray-500">
        {emptyMessage ?? 'Nothing here is available for your access level.'}
      </p>
    )
  }
  return (
    <div className={cx(AIC, 'space-y-5', className)}>
      {visible.map((section) => (
        <section key={section.label} className="space-y-3">
          <div>
            <h2 className="text-sm font-semibold text-gray-900">{section.label}</h2>
            {section.description ? (
              <p className="text-xs text-gray-500 mt-0.5">{section.description}</p>
            ) : null}
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {section.items.map((item) => (
              <HubTile key={`${section.label}-${item.label}`} item={item} />
            ))}
          </div>
        </section>
      ))}
    </div>
  )
}

export default HubSections
