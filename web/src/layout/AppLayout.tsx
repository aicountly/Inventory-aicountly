import { useEffect, useState } from 'react'
import { Outlet, useLocation } from 'react-router-dom'
import { useAccess } from '../access/AccessContext'
import { useAuth } from '../auth/AuthProvider'
import { useCompany } from '../company/CompanyContext'
import { Notice } from '../components/Notice'
import { Header } from './Header'
import { Sidebar } from './Sidebar'
import { getManageApiOrigin } from '../services/appLauncher'
import './layout.css'
import '../components/ui.css'

/** Sidebar + header + routed content, with the company/access states handled once. */
export function AppLayout() {
  const company = useCompany()
  const access = useAccess()
  const { signOut } = useAuth()
  const location = useLocation()
  const [menuOpen, setMenuOpen] = useState(false)

  useEffect(() => {
    setMenuOpen(false)
  }, [location.pathname])

  // Nothing to scope by yet: first load, no companies, or Manage unreachable.
  if (company.companies.length === 0) {
    return (
      <main className="app-fullscreen">
        <div className="panel">
          {company.status === 'loading' ? (
            <p className="message">Loading your companies…</p>
          ) : company.status === 'empty' ? (
            <>
              <h1 className="welcome">No company to open</h1>
              <p className="message">Create a company in Manage, or ask its owner to share one with you, then reload.</p>
              <div className="page-actions">
                <a className="btn btn-primary" href={getManageApiOrigin()} target="_blank" rel="noreferrer">
                  Open Manage
                </a>
                <button type="button" className="btn" onClick={company.reload}>
                  Reload
                </button>
                <button type="button" className="btn btn-ghost" onClick={signOut}>
                  Log out
                </button>
              </div>
            </>
          ) : (
            <>
              <h1 className="welcome">Could not load your companies</h1>
              <p className="message">{company.error ?? 'Manage did not answer.'}</p>
              <div className="page-actions">
                <button type="button" className="btn btn-primary" onClick={company.reload}>
                  Try again
                </button>
                <button type="button" className="btn btn-ghost" onClick={signOut}>
                  Log out
                </button>
              </div>
            </>
          )}
        </div>
      </main>
    )
  }

  const noProfile = !access.loading && !access.error && access.member === null && !access.isOwner && company.status === 'ready'

  return (
    <div className="app-shell">
      <Sidebar open={menuOpen} onNavigate={() => setMenuOpen(false)} />
      {menuOpen ? <div className="app-sidebar-scrim" onClick={() => setMenuOpen(false)} aria-hidden /> : null}
      <Header onToggleMenu={() => setMenuOpen((v) => !v)} />
      <main className="app-main">
        {company.warning || company.error || access.error || noProfile ? (
          <div className="app-banners">
            {company.error ? (
              <Notice
                kind="error"
                title="Company"
                actions={
                  <button type="button" className="btn btn-sm" onClick={company.reload}>
                    Retry
                  </button>
                }
              >
                {company.error}
              </Notice>
            ) : null}
            {company.warning ? <Notice kind="warning">{company.warning}</Notice> : null}
            {access.error ? (
              <Notice
                kind="error"
                title="Access"
                actions={
                  <button type="button" className="btn btn-sm" onClick={access.reload}>
                    Retry
                  </button>
                }
              >
                {access.error}
              </Notice>
            ) : null}
            {noProfile ? (
              <Notice kind="warning" title="No access profile">
                You have no Inventory access profile in {company.companyName || 'this company'}. Ask an administrator to add you as a team member.
              </Notice>
            ) : null}
          </div>
        ) : null}
        {company.status === 'ready' ? <Outlet /> : company.status === 'loading' ? <p className="muted">Loading {company.companyName || 'company'}…</p> : null}
      </main>
    </div>
  )
}
