import type { LucideIcon } from 'lucide-react'
import type { ReactNode } from 'react'
import { Card } from '../../ui/Card'
import { IconTile } from '../../ui/IconTile'
import type { IconTone } from '../../ui/IconTile'
import { cx } from '../../ui/cx'

/**
 * A panel whose body reaches the card's own edges.
 *
 * `FormSectionCard` pads its body, which is right for a grid of fields and wrong for a table:
 * a line grid that stops 16px short of the card border wastes the only horizontal room a
 * receiving screen has, and its horizontal scrollbar ends up floating in the middle of nothing.
 * Same header, same border, same shadow — the padding is simply the section's to decide.
 */
export function GrnCard({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <Card padding="none" className={cx('overflow-hidden', className)}>
      {children}
    </Card>
  )
}

export interface GrnCardHeaderProps {
  icon: LucideIcon
  tone?: IconTone
  title: ReactNode
  description?: ReactNode
  action?: ReactNode
}

export function GrnCardHeader({ icon, tone = 'primary', title, description, action }: GrnCardHeaderProps) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 border-b border-gray-100 px-4 py-2.5">
      <div className="flex min-w-0 items-center gap-2.5">
        <IconTile icon={icon} tone={tone} size="md" />
        <div className="min-w-0">
          <h2 className="truncate text-sm font-semibold text-gray-900">{title}</h2>
          {description ? <p className="mt-0.5 truncate text-xs text-gray-500">{description}</p> : null}
        </div>
      </div>
      {action ? <div className="flex shrink-0 flex-wrap items-center gap-2">{action}</div> : null}
    </div>
  )
}

export default GrnCard
