import { NavLink, Outlet } from 'react-router-dom'
import { useAccess } from '../../access/AccessContext'
import { MASTER_NAV } from '../../layout/navigation'
import { P } from '../../services/access'

/** Sub-navigation across the master screens plus the routed screen. */
export function MastersLayout() {
  const { can, loading } = useAccess()
  const items = loading ? MASTER_NAV : MASTER_NAV.filter((m) => can(P.masters(m.permissionSlug, 'read')))

  return (
    <div className="page">
      <nav className="sub-nav" aria-label="Masters">
        <NavLink to="/masters" end className={({ isActive }) => `sub-nav-link${isActive ? ' active' : ''}`}>
          Overview
        </NavLink>
        {items.map((m) => (
          <NavLink key={m.slug} to={`/masters/${m.slug}`} className={({ isActive }) => `sub-nav-link${isActive ? ' active' : ''}`}>
            {m.label}
          </NavLink>
        ))}
      </nav>
      <Outlet />
    </div>
  )
}
