import { NavLink } from 'react-router-dom'
import { useAccess } from '../access/AccessContext'
import { APP_ENV, APP_NAME } from '../config'
import { NAV_ITEMS } from './navigation'

interface SidebarProps {
  open: boolean
  onNavigate: () => void
}

export function Sidebar({ open, onNavigate }: SidebarProps) {
  const { can, loading } = useAccess()
  // While permissions load every entry shows; once known, entries the user
  // cannot open disappear rather than leading to a "forbidden" page.
  const items = loading ? NAV_ITEMS : NAV_ITEMS.filter((item) => can(item.permissions))

  return (
    <aside className={`app-sidebar${open ? ' open' : ''}`} aria-label="Primary">
      <NavLink to="/dashboard" className="app-brand" onClick={onNavigate}>
        <span className="app-brand-mark" aria-hidden>
          IN
        </span>
        <span>{APP_NAME}</span>
        {APP_ENV !== 'production' ? <span className="app-brand-env">{APP_ENV}</span> : null}
      </NavLink>
      <nav className="app-nav">
        {items.map((item) => (
          <NavLink key={item.to} to={item.to} className={({ isActive }) => `app-nav-link${isActive ? ' active' : ''}`} onClick={onNavigate}>
            <span className="app-nav-icon" aria-hidden>
              {item.icon}
            </span>
            {item.label}
          </NavLink>
        ))}
      </nav>
      <div className="app-nav-footer">AICOUNTLY {APP_NAME}</div>
    </aside>
  )
}
