import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { ChevronRight, PanelLeftClose, PanelLeftOpen } from 'lucide-react'
import { useAccess } from '../access/AccessContext'
import { APP_ENV, APP_NAME } from '../config'
import { SIDEBAR_NAV, filterNav } from '../config/navRegistry'
import type { MegaMenuColumn, NavLeaf, SidebarNavItem } from '../config/navRegistry'
import { Badge } from '../ui/Badge'
import { Tooltip } from '../ui/Tooltip'
import { AIC, cx } from '../ui/cx'
import { activeNavKey } from './activeNavItem'

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

/* Books' rail, to the pixel: web/src/components/AppSidebar.jsx:552-553. The
   flyout opens flush against the rail's outer edge, so its offset is the rail
   width itself — declared here with it so the two cannot drift apart. */
const RAIL_WIDTH_EXPANDED = '15rem'
const RAIL_WIDTH_COLLAPSED = '4.25rem'

/* Matches the `md:` breakpoint the rail switches on. Below it the rail is an
   overlay drawer, and a drawer has obligations a static rail does not. */
const DESKTOP_QUERY = '(min-width: 768px)'

const DRAWER_FOCUSABLE = 'a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])'

/* The collapse control is `hidden md:flex`, so at drawer widths it is
   display:none. A trap that counted it would hand Tab to something that cannot
   take focus, and focus would land on the page behind the scrim instead. */
function drawerFocusables(aside: HTMLElement): HTMLElement[] {
  return [...aside.querySelectorAll<HTMLElement>(DRAWER_FOCUSABLE)].filter(
    (el) => window.getComputedStyle(el).display !== 'none',
  )
}

function matchesDesktop(): boolean {
  // No matchMedia: assume the static rail, which is the state that needs no
  // special handling — never lock a usable rail away behind `inert`.
  if (typeof window === 'undefined' || !window.matchMedia) return true
  return window.matchMedia(DESKTOP_QUERY).matches
}

function isLeafActive(pathname: string, leaf: NavLeaf): boolean {
  if (!leaf.path) return false
  const [path] = leaf.path.split('?')
  return leaf.end ? pathname === path : pathname === path || pathname.startsWith(`${path}/`)
}

function MegaMenu({
  item,
  top,
  left,
  onNavigate,
  onMouseEnter,
  onMouseLeave,
}: {
  item: SidebarNavItem
  top: number
  left: string
  onNavigate: () => void
  onMouseEnter: () => void
  onMouseLeave: () => void
}) {
  const location = useLocation()
  const columns: readonly MegaMenuColumn[] = item.megaMenu ?? []
  return (
    <div
      // Fixed, not absolute: the rail scrolls and would clip an absolute panel.
      // `left` is inline rather than a custom property because this panel is
      // the rail's sibling, and a custom property only reaches descendants.
      style={{ top: Math.min(top, Math.max(64, window.innerHeight - 140)), left }}
      className="aic fixed z-40 hidden md:block print:hidden"
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
    >
      <div className="ml-1 w-max max-w-[calc(100vw-2rem)] rounded-xl border border-gray-200 bg-white shadow-overlay p-3 max-h-[70vh] overflow-auto scrollbar-thin animate-rise-in">
        {/* One column per section, each as wide as it needs and no wider — a
            fixed three-column grid squeezed a four-section menu and left a
            two-section one with a column of air. Books does the same. */}
        <div
          className="grid gap-x-5 gap-y-1"
          style={{ gridTemplateColumns: `repeat(${columns.length}, minmax(200px, max-content))` }}
        >
          {columns.map((column) => (
            <div key={column.label} className="min-w-[200px]">
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
  const asideRef = useRef<HTMLElement>(null)
  const [isDesktop, setIsDesktop] = useState(matchesDesktop)

  // While permissions load every entry shows; once known, entries the user
  // cannot open disappear rather than leading to a "forbidden" page.
  const items = useMemo(
    () => (loading ? [...SIDEBAR_NAV] : filterNav(SIDEBAR_NAV, can)),
    [loading, can],
  )

  // Resolved once for the whole rail, so exactly one section can be active.
  const activeKey = useMemo(
    () => activeNavKey(location.pathname, items),
    [location.pathname, items],
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

  useEffect(() => {
    if (!window.matchMedia) return undefined
    const mql = window.matchMedia(DESKTOP_QUERY)
    const onChange = (e: MediaQueryListEvent) => setIsDesktop(e.matches)
    mql.addEventListener('change', onChange)
    return () => mql.removeEventListener('change', onChange)
  }, [])

  // Closed, the drawer is only translated off-screen: without `inert` every
  // link in it stays tabbable and announced, so a keyboard user walks an
  // invisible menu on the way from the topbar to the page.
  const drawerOpen = !isDesktop && mobileOpen
  const drawerHidden = !isDesktop && !mobileOpen

  // Open, the page behind the scrim is still tabbable, so focus has to be put
  // in the drawer and held there until it closes.
  useEffect(() => {
    const aside = asideRef.current
    if (!drawerOpen || !aside) return undefined
    const restoreTo = document.activeElement as HTMLElement | null
    drawerFocusables(aside)[0]?.focus()
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Tab') return
      const items = drawerFocusables(aside)
      if (items.length === 0) return
      const edge = e.shiftKey ? items[0] : items[items.length - 1]
      if (document.activeElement !== edge) return
      e.preventDefault()
      ;(e.shiftKey ? items[items.length - 1] : items[0]).focus()
    }
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('keydown', onKeyDown)
      if (restoreTo?.isConnected) restoreTo.focus()
    }
  }, [drawerOpen])

  const activeFlyoutItem = flyout ? items.find((i) => i.key === flyout.key) : undefined

  return (
    <>
      <aside
        ref={asideRef}
        inert={drawerHidden}
        className={cx(
          AIC,
          'app-sidebar print:hidden fixed inset-y-0 left-0 z-40 flex flex-col border-r border-gray-200 bg-white transition-[width,transform] duration-200 md:static md:translate-x-0',
          collapsed ? 'w-[4.25rem]' : 'w-60',
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
              // Not NavLink's own isActive: it answers per link, and on a
              // nested route several links answer yes. See activeNavItem.ts.
              const isActive = item.key === activeKey
              const link = (
                <Link
                  to={item.path}
                  onClick={onNavigate}
                  onFocus={(e) => openFlyout(item, e.currentTarget)}
                  aria-current={isActive ? 'page' : undefined}
                  className={cx(
                    'group relative flex items-center gap-2.5 rounded-lg px-2 py-1.5 text-sm font-medium no-underline transition-colors',
                    collapsed && 'justify-center px-0',
                    isActive
                      ? 'bg-gradient-to-r from-primary-light to-primary-light/40 text-primary'
                      : 'text-gray-600 hover:bg-gray-50 hover:text-gray-900',
                  )}
                >
                  {isActive ? (
                    <span
                      className="absolute left-0 top-1/2 h-5 w-[3px] -translate-y-1/2 rounded-r bg-primary"
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
                </Link>
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
          left={collapsed ? RAIL_WIDTH_COLLAPSED : RAIL_WIDTH_EXPANDED}
          onNavigate={onNavigate}
          onMouseEnter={cancelClose}
          onMouseLeave={scheduleClose}
        />
      ) : null}
    </>
  )
}

export default AppSidebar
