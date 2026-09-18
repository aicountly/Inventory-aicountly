import { useMemo } from 'react'
import { Link } from 'react-router-dom'
import { FilePlus2 } from 'lucide-react'
import { useAccess } from '../access/AccessContext'
import { useScopeLabel } from '../company/useScopeLabel'
import { BreadcrumbHeader } from '../ui/shell/BreadcrumbHeader'
import { HubSections } from '../ui/shell/HubSections'
import type { HubSectionSpec, HubTileItem } from '../ui/shell/HubSections'
import { PageShell } from '../ui/shell/PageShell'
import { GROUP_ICON, GROUP_TONE, allowedTypeCount, buildEntryHub } from './entryHub'

/**
 * `/documents/new` — the document entry hub.
 *
 * Books listed every voucher type in an always-visible Transactions mega-menu.
 * Inventory's equivalent was one dropdown on one screen, so a user who never
 * opened it concluded the vouchers had not been built. This is the screen that
 * answers that: every native type, grouped, described, one click from its form.
 *
 * A type the profile cannot raise is shown DISABLED with the reason printed on
 * the tile, never hidden. A Store Keeper holds `create` on ten operational
 * types only; hiding the other eleven is what made a missing permission look
 * like a missing feature.
 */
export function DocumentEntryHubPage() {
  const { can, profile, loading } = useAccess()
  const scopeLabel = useScopeLabel()

  const groups = useMemo(() => buildEntryHub(can), [can])
  const allowed = allowedTypeCount(groups)
  const totalTypes = groups.reduce((n, g) => n + g.entries.length, 0)

  const sections = useMemo<HubSectionSpec[]>(
    () =>
      groups
        .filter((group) => group.entries.length > 0)
        .map((group) => ({
          label: group.label,
          description: group.description,
          items: group.entries.map<HubTileItem>((entry) => ({
            label: entry.spec.label,
            to: entry.allowed ? entry.to : undefined,
            icon: GROUP_ICON[group.key],
            tone: GROUP_TONE[group.key],
            disabled: !entry.allowed,
            disabledReason: entry.unavailableReason ?? undefined,
            description: (
              <>
                <span>{entry.spec.description}</span>
                {entry.unavailableReason ? (
                  <span className="mt-1 block font-medium text-amber-700">
                    {entry.unavailableReason}
                  </span>
                ) : null}
              </>
            ),
          })),
        })),
    [groups],
  )

  // Never a blank page and never an unexplained one: if the profile can raise
  // nothing at all, the screen still lists every type and says who to ask.
  const profileLine = profile?.profile_name ? ` You are on the ${profile.profile_name} profile.` : ''
  const description = loading
    ? 'Checking what your profile may raise…'
    : allowed === 0
      ? `None of these ${totalTypes} document types can be raised with your access.${profileLine} Each tile below says why; ask whoever manages access in ${scopeLabel.split(' · ')[0]} to grant the create permission you need.`
      : `Every inventory document you can raise in ${scopeLabel}. ${allowed} of ${totalTypes} types are available to you${profileLine ? `.${profileLine}` : '; the rest say why they are not.'}`

  return (
    <PageShell>
      <BreadcrumbHeader
        breadcrumbs={[{ label: 'Documents', to: '/documents' }, { label: 'New document' }]}
        title="New document"
        icon={FilePlus2}
        description={description}
        backTo="/documents"
        backLabel="Back to documents"
        actions={
          <Link
            to="/documents"
            className="text-xs font-medium text-primary hover:underline whitespace-nowrap"
          >
            View the documents register
          </Link>
        }
      />
      <HubSections sections={sections} />
    </PageShell>
  )
}

export default DocumentEntryHubPage
