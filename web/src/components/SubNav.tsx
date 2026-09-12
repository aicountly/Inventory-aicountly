import { NavLink } from 'react-router-dom'
import { useAccess } from '../access/AccessContext'
import type { PermissionKey } from '../access/AccessContext'

export interface SubNavItem {
  to: string
  label: string
  /** Match only the exact path (index entries). */
  end?: boolean
  /** Hidden once permissions are known and the user lacks the key(s). */
  permission?: PermissionKey
}

/** Horizontal sub-navigation inside a module, filtered by permission. */
export function SubNav({ items, label }: { items: readonly SubNavItem[]; label: string }) {
  const { can, loading } = useAccess()
  const visible = loading ? items : items.filter((i) => !i.permission || can(i.permission))
  return (
    <nav className="sub-nav" aria-label={label}>
      {visible.map((i) => (
        <NavLink key={i.to} to={i.to} end={i.end} className={({ isActive }) => `sub-nav-link${isActive ? ' active' : ''}`}>
          {i.label}
        </NavLink>
      ))}
    </nav>
  )
}
