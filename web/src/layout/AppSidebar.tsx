import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, NavLink, useLocation } from 'react-router-dom'
import { ChevronRight, PanelLeftClose, PanelLeftOpen } from 'lucide-react'
import { useAccess } from '../access/AccessContext'
import { APP_ENV, APP_NAME } from '../config'
import { SIDEBAR_NAV, filterNav } from '../config/navRegistry'
import type { MegaMenuColumn, NavLeaf, SidebarNavItem } from '../config/navRegistry'
import { Badge } from '../ui/Badge'
import { Tooltip } from '../ui/Tooltip'
import { AIC, cx } from '../ui/cx'

interface AppSidebarProps {
  collapsed: boolean
  onToggleCollapsed: () => void
  /** Mobile drawer state — ignored from `md` up. */
  mobileOpen: boolean
  onNavigate: () => void
}

interface FlyoutState {
  key: string
  top: number
}

const CLOSE_DELAY_MS = 120

function isLeafActive(pathname: string, leaf: NavLeaf): boolean {
  if (!leaf.path) return false
  const [path] = leaf.path.split('?')
  return leaf.end ? pathname === path : pathname === path || pathname.startsWith(`${path}/`)
}

function MegaMenu({
  item,
  top,
  onNavigate,
  onMouseEnter,
  onMouseLeave,
}: {
  item: SidebarNavItem
  top: number
  onNavigate: () => void
  onMouseEnter: () => void
  onMouseLeave: () => void
}) {
  const location = useLocation()
  const columns: readonly MegaMenuColumn[] = item.megaMenu ?? []
  return (
    <div
      // Fixed, not absolute: the rail scrolls and would clip an absolute panel.
      style={{ top: Math.min(top, Math.max(64, window.innerHeight - 140)) }}
      className="aic fixed left-[var(--sidebar-flyout-left)] z-40 hidden md:block print:hidden"
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
    >
      <div className="ml-1 rounded-xl border border-gray-200 bg-white shadow-overlay p-3 max-h-[70vh] overflow-auto scrollbar-thin animate-rise-in">
        <div
          className={cx(
            'grid gap-x-5 gap-y-1',
            columns.length > 2 ? 'grid-cols-3' : columns.length === 2 ? 'grid-cols-2' : 'grid-cols-1',
          )}
        >
          {columns.map((column) => (
            <div key={column.label} className="min-w-[13rem]">
              <p className="px-2 pb-1 text-label-xs font-semibold uppercase tracking-wide text-gray-400">
                {column.label}
              </p>
              <ul className="space-y-0.5">
                {column.items.map((leaf) => {
                  const LeafIcon = leaf.icon
                  const active = isLeafActive(location.pathname, leaf)
                  return (
                    <li key={leaf.label}>
                      <Link
                        to={leaf.path ?? '#'}
                        onClick={onNavigate}
                        className={cx(
                          'group/leaf flex items-start gap-2 rounded-lg px-2 py-1.5 no-underline transition-colors',
                          active
                            ? 'bg-primary-light text-primary'
                            : 'text-gray-700 hover:bg-primary-light/50 hover:text-primary',
                        )}
                      >
                        {LeafIcon ? (
                          <LeafIcon className="mt-0.5 h-3.5 w-3.5 shrink-0 opacity-70" aria-hidden />
                        ) : null}
                        <span className="min-w-0">
                          <span className="block text-sm font-medium leading-tight">
                            {leaf.label}
                          </span>
                          {leaf.description ? (
                            <span className="mt-0.5 block text-[11px] leading-snug text-gray-500">
                              {leaf.description}
                            </span>
                          ) : null}
                        </span>
                      </Link>
                    </li>
                  )
                })}
              </ul>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

/**
 * The primary navigation rail.
 *
 * Collapsed it is an icon rail with tooltips; expanded it shows labels. Either
 * way, a section with a mega menu opens a flyout on hover or keyboard focus,
 * which is how a user reaches a sub-screen without landing on the section
 * index first.
 */
export function AppSidebar({
  collapsed,
  onToggleCollapsed,
  mobileOpen,
  onNavigate,
}: AppSidebarProps) {
  const { can, loading } = useAccess()
  const location = useLocation()
  const [flyout, setFlyout] = useState<FlyoutState | null>(null)
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  // While permissions load every entry shows; once known, entries the user
  // cannot open disappear rather than leading to a "forbidden" page.
  const items = useMemo(
    () => (loading ? [...SIDEBAR_NAV] : filterNav(SIDEBAR_NAV, can)),
    [loading, can],
  )

  const cancelClose = useCallback(() => {
    if (closeTimer.current) {
      clearTimeout(closeTimer.current)
      closeTimer.current = null
    }
  }, [])

  const scheduleClose = useCallback(() => {
    cancelClose()
    closeTimer.current = setTimeout(() => setFlyout(null), CLOSE_DELAY_MS)
  }, [cancelClose])

  const openFlyout = useCallback(
    (item: SidebarNavItem, el: HTMLElement | null) => {
      cancelClose()
      if (!item.megaMenu?.length || !el) {
        setFlyout(null)
        return
      }
      setFlyout({ key: item.key, top: el.getBoundingClientRect().top })
    },
    [cancelClose],
  )

  useEffect(() => {
    setFlyout(null)
  }, [location.pathname])

  useEffect(() => () => cancelClose(), [cancelClose])

  const activeFlyoutItem = flyout ? items.find((i) => i.key === flyout.key) : undefined

  return (
    <>
      <aside
        style={
          {
            '--sidebar-flyout-left': collapsed ? '3.5rem' : '14rem',
          } as React.CSSProperties
        }
        className={cx(
          AIC,
          'app-sidebar print:hidden fixed inset-y-0 left-0 z-40 flex flex-col border-r border-gray-200 bg-white transition-[width,transform] duration-200 md:static md:translate-x-0',
          collapsed ? 'w-14' : 'w-56',
          mobileOpen ? 'translate-x-0 shadow-overlay' : '-translate-x-full',
        )}
        aria-label="Primary"
      >
        <Link
          to="/dashboard"
          onClick={onNavigate}
          className="flex h-12 shrink-0 items-center gap-2 border-b border-gray-200 px-3 no-underline"
        >
          <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-primary text-[11px] font-bold text-white">
            IN
          </span>
          {!collapsed ? (
            <span className="flex min-w-0 items-center gap-1.5">
              <span className="truncate text-sm font-semibold text-gray-900">{APP_NAME}</span>
              {APP_ENV !== 'production' ? (
                <Badge tone="warning" size="xs">
                  {APP_ENV}
                </Badge>
              ) : null}
            </span>
          ) : null}
        </Link>

        <nav className="flex-1 overflow-y-auto overflow-x-hidden scrollbar-thin px-2 py-2">
          <ul className="space-y-0.5">
            {items.map((item) => {
              const Icon = item.icon
              const hasMenu = Boolean(item.megaMenu?.length)
              const link = (
                <NavLink
                  to={item.path}
                  end={item.end}
                  onClick={onNavigate}
                  onFocus={(e) => openFlyout(item, e.currentTarget)}
                  className={({ isActive }) =>
                    cx(
                      'group relative flex items-center gap-2.5 rounded-lg px-2 py-1.5 text-sm font-medium no-underline transition-colors',
                      collapsed && 'justify-center px-0',
                      isActive
                        ? 'bg-primary-light text-primary'
                        : 'text-gray-600 hover:bg-gray-50 hover:text-gray-900',
                    )
                  }
                >
                  {({ isActive }) => (
                    <>
                      {isActive ? (
                        <span
                          className="absolute left-0 top-1/2 h-5 w-0.5 -translate-y-1/2 rounded-r bg-primary"
                          aria-hidden
                        />
                      ) : null}
                      <Icon className="h-4 w-4 shrink-0" aria-hidden />
                      {!collapsed ? <span className="truncate">{item.label}</span> : null}
                      {!collapsed && hasMenu ? (
                        <ChevronRight
                          className="ml-auto h-3.5 w-3.5 shrink-0 text-gray-300 group-hover:text-gray-400"
                          aria-hidden
                        />
                      ) : null}
                    </>
                  )}
                </NavLink>
              )
              return (
                <li
                  key={item.key}
                  onMouseEnter={(e) => openFlyout(item, e.currentTarget)}
                  onMouseLeave={scheduleClose}
                >
                  {collapsed ? (
                    <Tooltip label={item.label} placement="bottom">
                      <span className="block w-full">{link}</span>
                    </Tooltip>
                  ) : (
                    link
                  )}
                </li>
              )
            })}
          </ul>
        </nav>

        <div className="shrink-0 border-t border-gray-200 p-2">
          <button
            type="button"
            onClick={onToggleCollapsed}
            className={cx(
              'hidden w-full items-center gap-2 rounded-lg px-2 py-1.5 text-xs font-medium text-gray-500 transition-colors hover:bg-gray-50 hover:text-gray-800 md:flex',
              collapsed && 'justify-center px-0',
            )}
            aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          >
            {collapsed ? (
              <PanelLeftOpen className="h-4 w-4" aria-hidden />
            ) : (
              <>
                <PanelLeftClose className="h-4 w-4" aria-hidden />
                <span>Collapse</span>
              </>
            )}
          </button>
          {!collapsed ? (
            <p className="px-2 pt-1 text-[10px] uppercase tracking-wide text-gray-400">
              AICOUNTLY {APP_NAME}
            </p>
          ) : null}
        </div>
      </aside>

      {activeFlyoutItem && flyout ? (
        <MegaMenu
          item={activeFlyoutItem}
          top={flyout.top}
          onNavigate={onNavigate}
          onMouseEnter={cancelClose}
          onMouseLeave={scheduleClose}
        />
      ) : null}
    </>
  )
}

export default AppSidebar
