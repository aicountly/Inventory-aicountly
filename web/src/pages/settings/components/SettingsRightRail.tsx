import { Link } from 'react-router-dom'
import { ChevronRight, FileText, History, Package, Sparkles, Users } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { useAccess } from '../../../access/AccessContext'
import type { PermissionKey } from '../../../access/AccessContext'
import { P } from '../../../services/access'
import { getAppById, launchApp } from '../../../services/appLauncher'
import { Button } from '../../../ui/Button'
import { Card } from '../../../ui/Card'
import { AIC, cx } from '../../../ui/cx'
import { formatDateTime } from '../../../utils/format'

/** Where the audit trail is already filtered to this company's settings changes. */
export function settingsAuditPath(cmpId: number | null): string {
  return cmpId ? `/audit?entity_type=settings&entity_id=${cmpId}` : '/audit?entity_type=settings'
}

interface QuickLink {
  label: string
  to: string
  icon: LucideIcon
  permission: PermissionKey
}

export interface SettingsRightRailProps {
  cmpId: number | null
  updatedAt?: string | null
  updatedBy?: string | null
  className?: string
}

/**
 * The supporting column: ask Pulse, jump somewhere related, see who changed this last.
 *
 * Every link is a route this app actually serves and every one is permission-filtered, so the rail
 * never offers a door that opens onto a "you do not have permission" banner. There is no Help
 * Centre card because this product has no help route to send anyone to; the third card does the job
 * the settings screen actually owes its reader — these values decide stock valuation, so who last
 * changed them is the useful thing to have at hand.
 */
export function SettingsRightRail({ cmpId, updatedAt, updatedBy, className }: SettingsRightRailProps) {
  const { can } = useAccess()
  const pulse = getAppById('buddy')

  const links: QuickLink[] = [
    { label: 'Item masters', to: '/items', icon: Package, permission: P.masters('items', 'read') },
    { label: 'Document types', to: '/settings/document-types', icon: FileText, permission: P.settingsRead },
    { label: 'User permissions', to: '/settings/access', icon: Users, permission: [P.accessManage, P.accessMembersManage] },
    { label: 'Audit trail', to: settingsAuditPath(cmpId), icon: History, permission: P.auditRead },
  ]
  const visible = links.filter((l) => can(l.permission))

  return (
    <aside
      className={cx(AIC, 'grid grid-cols-1 items-start gap-3 md:grid-cols-3 xl:grid-cols-1', className)}
      aria-label="Settings help and shortcuts"
    >
      {pulse ? (
        <Card padding="md" className="bg-gradient-to-b from-primary-light/50 to-transparent">
          <span
            aria-hidden
            className="mb-3 flex h-16 items-center justify-center rounded-xl bg-primary-light/60"
          >
            <Sparkles className="h-6 w-6 text-primary" />
          </span>
          <h3 className="text-sm font-semibold text-gray-900">Optimise your inventory settings</h3>
          <p className="mt-1.5 text-[0.6875rem] leading-relaxed text-gray-500">
            Get the right configuration for your business with AI guidance from Aicountly Pulse.
          </p>
          <Button
            variant="outline"
            size="md"
            block
            className="mt-3"
            icon={Sparkles}
            onClick={() => launchApp(pulse, { newTab: true })}
          >
            Ask Aicountly Pulse
          </Button>
        </Card>
      ) : null}

      {visible.length > 0 ? (
        <Card padding="md">
          <h3 className="text-sm font-semibold text-gray-900">Quick links</h3>
          <ul className="mt-1.5 list-none space-y-0 p-0">
            {visible.map((link) => (
              <li key={link.to} className="border-b border-gray-100 last:border-b-0">
                <Link
                  to={link.to}
                  className="flex items-center gap-2 py-2.5 text-xs text-gray-600 no-underline transition-colors hover:text-primary"
                >
                  <link.icon className="h-3.5 w-3.5 shrink-0 text-gray-400" aria-hidden />
                  <span className="flex-1 truncate">{link.label}</span>
                  <ChevronRight className="h-3.5 w-3.5 shrink-0 text-gray-300" aria-hidden />
                </Link>
              </li>
            ))}
          </ul>
        </Card>
      ) : null}

      <Card padding="md">
        <h3 className="text-sm font-semibold text-gray-900">Change history</h3>
        <p className="mt-1.5 text-[0.6875rem] leading-relaxed text-gray-500">
          These settings decide how stock is valued, so every change is recorded with the user, the
          time and the values before and after.
        </p>
        <dl className="mt-3 space-y-1.5 text-[0.6875rem]">
          <div className="flex items-baseline justify-between gap-2">
            <dt className="text-gray-500">Last changed</dt>
            <dd className="truncate font-medium text-gray-900">{formatDateTime(updatedAt)}</dd>
          </div>
          <div className="flex items-baseline justify-between gap-2">
            <dt className="text-gray-500">By</dt>
            <dd className="truncate font-medium text-gray-900">{updatedBy || '—'}</dd>
          </div>
        </dl>
        {can(P.auditRead) ? (
          <Link
            to={settingsAuditPath(cmpId)}
            className="mt-3 inline-flex h-9 w-full items-center justify-center gap-1.5 rounded-lg border border-primary/40 bg-white text-xs font-semibold text-primary no-underline transition-colors hover:bg-primary-light"
          >
            <History className="h-3.5 w-3.5" aria-hidden />
            Open audit trail
          </Link>
        ) : null}
      </Card>
    </aside>
  )
}

export default SettingsRightRail
