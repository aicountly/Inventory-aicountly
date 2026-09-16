import { NavLink } from 'react-router-dom'
import { useAccess } from '../../access/AccessContext'
import { MASTER_NAV } from '../../config/navRegistry'
import { P } from '../../services/access'
import { AIC, cx } from '../../ui/cx'

/**
 * Category navigation across the masters.
 *
 * Real links to the existing `/masters/*` routes — not state — so the address
 * bar stays the source of truth and every tab is a middle-clickable,
 * bookmarkable target. Tabs the profile cannot read are dropped rather than
 * disabled; while access is still loading they all show, because a row that
 * appears and then shrinks is worse than one that arrives complete.
 *
 * Rendered by MastersLayout on the child screens and by MastersIndex itself on
 * the landing page, where the design puts it below the summary cards. Exactly
 * one of the two draws it for any given URL.
 */
export function MastersTabs({ className }: { className?: string }) {
  const { can, loading } = useAccess()
  const items = loading ? MASTER_NAV : MASTER_NAV.filter((m) => can(P.masters(m.permissionSlug, 'read')))

  const tab = ({ isActive }: { isActive: boolean }) =>
    cx(
      'relative -mb-px inline-flex shrink-0 items-center whitespace-nowrap rounded-t-lg border-b-2 px-2.5 py-2 text-[13px] font-medium no-underline transition-colors',
      'focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40',
      isActive
        ? 'border-primary bg-primary-light text-primary'
        : 'border-transparent text-gray-500 hover:bg-gray-50 hover:text-gray-900',
    )

  return (
    <nav
      className={cx(AIC, 'scrollbar-thin -mx-1 overflow-x-auto border-b border-gray-200 px-1 print:hidden', className)}
      aria-label="Inventory masters"
    >
      <div className="flex min-w-max items-end gap-0.5">
        <NavLink to="/masters" end className={tab}>
          Overview
        </NavLink>
        {items.map((m) => (
          <NavLink key={m.path} to={m.path} className={tab}>
            {m.label}
          </NavLink>
        ))}
      </div>
    </nav>
  )
}

export default MastersTabs
