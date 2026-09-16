import { useCallback, useMemo, useState } from 'react'
import { NavLink, Outlet } from 'react-router-dom'
import { Building2, CalendarClock, ChevronRight, FileText, ShieldCheck } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { useAccess } from '../../access/AccessContext'
import type { PermissionKey } from '../../access/AccessContext'
import { ConfirmDialog } from '../../components/ConfirmDialog'
import { useUnsavedChanges } from '../../hooks/useUnsavedChanges'
import { P } from '../../services/access'
import { PageShell } from '../../ui/shell/PageShell'
import { AIC, cx } from '../../ui/cx'
import { SettingsChromeContext } from './SettingsChrome'

interface SettingsTab {
  to: string
  label: string
  icon: LucideIcon
  end?: boolean
  permission: PermissionKey
}

/**
 * Only tabs that lead somewhere.
 *
 * The design this screen was rebuilt to also showed Integrations and Advanced. Neither exists:
 * there is no integration setting and no advanced setting in `GET /v1/settings`, and a tab that
 * opens an empty page is worse than no tab — it reads as a feature that is broken rather than one
 * that has not been built. They go in here, with a route and a permission, on the day there is
 * something behind them.
 */
const TABS: readonly SettingsTab[] = [
  { to: '/settings', label: 'Company', icon: Building2, end: true, permission: P.settingsRead },
  { to: '/settings/period-locks', label: 'Period locks', icon: CalendarClock, permission: P.settingsRead },
  {
    to: '/settings/access',
    label: 'Access & permissions',
    icon: ShieldCheck,
    permission: [P.accessManage, P.accessMembersManage, P.settingsRead] as const,
  },
  { to: '/settings/document-types', label: 'Document types', icon: FileText, permission: P.settingsRead },
]

export function SettingsLayout() {
  const { can, loading } = useAccess()
  const [headerSlot, setHeaderSlot] = useState<HTMLElement | null>(null)
  const [dirty, setDirtyState] = useState(false)
  const [pending, setPending] = useState<(() => void) | null>(null)

  // Stable, so a tab can call it straight from an effect without re-running it every render.
  const setDirty = useCallback((next: boolean) => setDirtyState(next), [])

  useUnsavedChanges({
    when: dirty,
    // The callback is stored, not called: setState with a function argument would run it.
    onBlocked: useCallback((_to: string, proceed: () => void) => setPending(() => proceed), []),
  })

  const chrome = useMemo(() => ({ headerSlot, setDirty }), [headerSlot, setDirty])
  const visible = loading ? TABS : TABS.filter((t) => can(t.permission))

  return (
    <SettingsChromeContext.Provider value={chrome}>
      <PageShell className="pb-6">
        <nav aria-label="Breadcrumb" className={cx(AIC, 'flex items-center gap-1.5 text-xs text-gray-500')}>
          <span>Inventory</span>
          <ChevronRight className="h-3 w-3 text-gray-300" aria-hidden />
          <span className="font-semibold text-gray-900" aria-current="page">
            Settings
          </span>
        </nav>

        <header className={cx(AIC, 'flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between')}>
          <div className="min-w-0">
            <h1 className="text-2xl font-bold leading-tight tracking-tight text-gray-900">
              Inventory settings
            </h1>
            <p className="mt-1 max-w-2xl text-sm leading-relaxed text-gray-500">
              Configure how inventory works for this company. These settings control costing, stock
              behaviour and more.
            </p>
          </div>
          {/* Filled by the open tab through SettingsChrome — see SettingsChrome.tsx. */}
          <div
            ref={setHeaderSlot}
            className="flex flex-col items-stretch gap-3 sm:flex-row sm:flex-wrap sm:items-start lg:justify-end"
          />
        </header>

        <nav
          aria-label="Inventory settings sections"
          className={cx(
            AIC,
            'scrollbar-thin flex w-full overflow-x-auto rounded-xl border border-gray-200 bg-white shadow-card print:hidden',
          )}
        >
          {visible.map((tab, i) => (
            <NavLink
              key={tab.to}
              to={tab.to}
              end={tab.end}
              className={({ isActive }) =>
                cx(
                  'inline-flex min-h-[2.75rem] min-w-[9.5rem] flex-1 items-center justify-center gap-2 whitespace-nowrap px-4 text-[0.8125rem] no-underline transition-colors',
                  i > 0 && 'border-l border-gray-200',
                  i === 0 && 'rounded-l-xl',
                  i === visible.length - 1 && 'rounded-r-xl',
                  'focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary/40',
                  isActive
                    ? 'bg-primary font-semibold text-white'
                    : 'font-medium text-gray-600 hover:bg-primary-light/40 hover:text-primary',
                )
              }
            >
              {({ isActive }) => (
                <>
                  <tab.icon
                    className={cx('h-4 w-4 shrink-0', isActive ? 'text-white' : 'text-gray-400')}
                    aria-hidden
                  />
                  <span>{tab.label}</span>
                </>
              )}
            </NavLink>
          ))}
        </nav>

        <Outlet />
      </PageShell>

      <ConfirmDialog
        open={pending !== null}
        title="Unsaved changes"
        message="You have changes to these settings that have not been saved. Leaving now discards them."
        confirmLabel="Discard changes"
        danger
        onConfirm={() => {
          const proceed = pending
          setPending(null)
          setDirtyState(false)
          proceed?.()
        }}
        onCancel={() => setPending(null)}
      />
    </SettingsChromeContext.Provider>
  )
}
