import { Link } from 'react-router-dom'
import type { LinkProps } from 'react-router-dom'
import type { HTMLAttributes, ReactNode } from 'react'
import { AIC, cx } from './cx'

export type CardPadding = 'none' | 'sm' | 'md' | 'lg'

const PADDING: Record<CardPadding, string> = {
  none: '',
  sm: 'p-3',
  md: 'p-4',
  lg: 'p-5',
}

export interface CardProps extends Omit<HTMLAttributes<HTMLDivElement>, 'children' | 'title'> {
  /** `Link` turns the whole card into a navigation target (see StatCard). */
  as?: 'div' | 'section' | 'article' | 'li' | 'aside' | typeof Link
  /** Required when `as={Link}`. */
  to?: string
  padding?: CardPadding
  /** Adds the shared hover affordance used by clickable tiles. */
  interactive?: boolean
  children?: ReactNode
}

const BASE =
  'bg-white rounded-xl border border-gray-200 shadow-card'

const INTERACTIVE =
  'cursor-pointer transition-colors hover:border-primary/40 hover:bg-primary-light/40 no-underline text-inherit block'

/**
 * The surface every other component sits on. One border radius, one border
 * colour, one shadow — ported from books-react-app/web/src/components/ui/Card.jsx.
 */
export function Card({
  as: Tag = 'div',
  to,
  padding = 'md',
  interactive = false,
  className,
  children,
  ...rest
}: CardProps) {
  const cls = cx(AIC, BASE, PADDING[padding], interactive && INTERACTIVE, className)
  if (Tag === Link) {
    // The prop bag is typed for a div; a Link renders an anchor. The DOM
    // attributes overlap almost completely and the only difference that
    // matters (the handler's element type) is not observable here.
    const linkProps = rest as unknown as Omit<LinkProps, 'to' | 'className' | 'children'>
    return (
      <Link to={to ?? '#'} className={cls} {...linkProps}>
        {children}
      </Link>
    )
  }
  const El = Tag as 'div'
  return (
    <El className={cls} {...rest}>
      {children}
    </El>
  )
}

export interface CardHeaderProps {
  title: ReactNode
  description?: ReactNode
  action?: ReactNode
  className?: string
}

export function CardHeader({ title, description, action, className }: CardHeaderProps) {
  return (
    <div className={cx('flex items-start justify-between gap-3 mb-3', className)}>
      <div className="min-w-0">
        <h3 className="text-sm font-semibold text-gray-900 truncate">{title}</h3>
        {description ? (
          <p className="text-xs text-gray-500 mt-0.5 truncate">{description}</p>
        ) : null}
      </div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </div>
  )
}


export default Card
