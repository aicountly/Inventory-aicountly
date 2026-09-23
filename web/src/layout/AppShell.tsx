import { useCallback, useEffect, useState } from 'react'
import { Outlet, useLocation } from 'react-router-dom'
import { Building2, RefreshCw } from 'lucide-react'
import { useAccess } from '../access/AccessContext'
import { useAuth } from '../auth/AuthProvider'
import { useCompany } from '../company/CompanyContext'
import { ReconciliationAlert } from '../reconciliation/ReconciliationAlert'
import { Notice } from '../components/Notice'
import { getManageApiOrigin } from '../services/appLauncher'
import { Button } from '../ui/Button'
import { IconTile } from '../ui/IconTile'
import { LoadingState } from '../ui/LoadingState'
import { SettingsPanel } from '../ui/SettingsPanel'
import { cx } from '../ui/cx'
import { AppSidebar } from './AppSidebar'
import { AppTopbar } from './AppTopbar'
import { CommandPalette } from './CommandPalette'
import { readSidebarCollapsed, writeSidebarCollapsed } from './sidebarStorage'

/**
 * Sidebar + topbar + routed content.
 *
 * Replaces layout/AppLayout.tsx. The company / access state machine below is
 * carried over unchanged — same four banner branches, same "no company"
 * fullscreen panel, same gate on `company.status === 'ready'` before the
 * outlet mounts. Only the clothes are new.
 */
export function AppShell() {
  const company = useCompany()
  const access = useAccess()
  const { signOut } = useAuth()
  const location = useLocation()
  const [mobileOpen, setMobileOpen] = useState(false)
  const [collapsed, setCollapsed] = useState(readSidebarCollapsed)

  useEffect(() => {
    setMobileOpen(false)
  }, [location.pathname])

  // The drawer covers the page behind a scrim, and a scrim is a pointer
  // affordance only — Escape is the keyboard's way back out.
  useEffect(() => {
    if (!mobileOpen) return undefined
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setMobileOpen(false)
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [mobileOpen])

  const toggleCollapsed = useCallback(() => {
    setCollapsed((v) => {
      writeSidebarCollapsed(!v)
      return !v
    })
  }, [])

  // Nothing to scope by yet: first load, no companies, or Manage unreachable.
  if (company.companies.length === 0) {
    return (
      <main className="aic flex min-h-screen items-center justify-center bg-workspace px-4">
        <div className="w-full max-w-md rounded-2xl border border-gray-200 bg-white p-6 shadow-card">
          {company.status === 'loading' ? (
            <LoadingState label="Loading your companies…" />
          ) : company.status === 'empty' ? (
            <>
              <IconTile icon={Building2} tone="primary" size="lg" className="mb-3" />
              <h1 className="text-lg font-semibold text-gray-900">No company to open</h1>
              <p className="mt-1 text-sm leading-relaxed text-gray-500">
                Create a company in Manage, or ask its owner to share one with you, then reload.
              </p>
              <div className="mt-4 flex flex-wrap gap-2">
                <a
                  className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-primary px-3 text-sm font-medium text-white no-underline transition-colors hover:bg-primary-hover"
                  href={getManageApiOrigin()}
                  target="_blank"
                  rel="noreferrer"
                >
                  Open Manage
                </a>
                <Button variant="secondary" icon={RefreshCw} onClick={company.reload}>
                  Reload
                </Button>
                <Button variant="ghost" onClick={signOut}>
                  Log out
                </Button>
              </div>
            </>
          ) : (
            <>
              <IconTile icon={Building2} tone="danger" size="lg" className="mb-3" />
              <h1 className="text-lg font-semibold text-gray-900">Could not load your companies</h1>
              <p className="mt-1 text-sm leading-relaxed text-gray-500">
                {company.error ?? 'Manage did not answer.'}
              </p>
              <div className="mt-4 flex flex-wrap gap-2">
                <Button icon={RefreshCw} onClick={company.reload}>
                  Try again
                </Button>
                <Button variant="ghost" onClick={signOut}>
                  Log out
                </Button>
              </div>
            </>
          )}
        </div>
      </main>
    )
  }

  const noProfile =
    !access.loading &&
    !access.error &&
    access.member === null &&
    !access.isOwner &&
    company.status === 'ready'
  const hasBanner = Boolean(company.warning || company.error || access.error || noProfile)

  return (
    <div className="app-shell aic flex min-h-screen bg-workspace text-gray-900">
      <AppSidebar
        collapsed={collapsed}
        onToggleCollapsed={toggleCollapsed}
        mobileOpen={mobileOpen}
        onNavigate={() => setMobileOpen(false)}
      />
      {mobileOpen ? (
        <div
          className="app-sidebar-scrim fixed inset-0 z-30 bg-gray-900/40 backdrop-blur-sm md:hidden print:hidden"
          onClick={() => setMobileOpen(false)}
          aria-hidden
        />
      ) : null}

      <div className="flex min-h-screen min-w-0 flex-1 flex-col">
        <AppTopbar onToggleMobileNav={() => setMobileOpen((v) => !v)} />
        {/* The scroll container is `main`, not the window: that is what lets a
            register pin its header and totals to a viewport-bound height. */}
        <main className={cx('app-main scrollbar-thin flex-1 overflow-auto px-3 py-3 md:px-5')}>
          {hasBanner ? (
            <div className="mb-3 space-y-2 print:hidden">
              {company.error ? (
                <Notice
                  kind="error"
                  title="Company"
                  actions={
                    <Button variant="secondary" size="xs" onClick={company.reload}>
                      Retry
                    </Button>
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
                    <Button variant="secondary" size="xs" onClick={access.reload}>
                      Retry
                    </Button>
                  }
                >
                  {access.error}
                </Notice>
              ) : null}
              {noProfile ? (
                <Notice kind="warning" title="No access profile">
                  You have no Inventory access profile in{' '}
                  {company.companyName || 'this company'}. Ask an administrator to add you as a
                  team member.
                </Notice>
              ) : null}
            </div>
          ) : null}

          {/* Outside `hasBanner`: that block is for what is wrong with loading the company, and
              this is about what the company's figures say once it HAS loaded. It draws nothing
              at all when the two systems agree. */}
          {company.status === 'ready' ? (
            <div className="mb-3 print:hidden empty:mb-0">
              <ReconciliationAlert />
            </div>
          ) : null}

          {company.status === 'ready' ? (
            <Outlet />
          ) : company.status === 'loading' ? (
            <LoadingState label={`Loading ${company.companyName || 'company'}…`} />
          ) : null}
        </main>
      </div>

      <CommandPalette />
      <SettingsPanel />
    </div>
  )
}

export default AppShell
