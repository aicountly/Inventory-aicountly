import { useMemo } from 'react'
import { Library } from 'lucide-react'
import { useAccess } from '../access/AccessContext'
import { useScopeLabel } from '../company/useScopeLabel'
import { BreadcrumbHeader } from '../ui/shell/BreadcrumbHeader'
import { HubSections } from '../ui/shell/HubSections'
import type { HubSectionSpec } from '../ui/shell/HubSections'
import { PageShell } from '../ui/shell/PageShell'
import type { IconTone } from '../ui/IconTile'
import {
  REGISTER_GROUP_DESCRIPTIONS,
  REGISTER_GROUP_LABELS,
  REGISTER_GROUP_ORDER,
  registersInGroup,
} from './configs'
import { registerPermission, registerRoute } from './RegisterConfig'
import type { RegisterGroup } from './RegisterConfig'

const GROUP_TONE: Record<RegisterGroup, IconTone> = {
  movement: 'primary',
  stock: 'info',
  valuation: 'success',
  analysis: 'violet',
  compliance: 'warning',
}

/**
 * The registers hub.
 *
 * One door to every register, grouped the way a reader thinks about them
 * (what moved · what is here · what it is worth · what it tells me · what is
 * outstanding) rather than by which endpoint serves them. A section with no
 * registers the user may read simply disappears — permission filtering is a
 * `filter` at this level, never a disabled tile that teases.
 */
export function RegistersHubPage() {
  const { can } = useAccess()
  const scopeLabel = useScopeLabel()

  const sections = useMemo<HubSectionSpec[]>(
    () =>
      REGISTER_GROUP_ORDER.map((group) => ({
        label: REGISTER_GROUP_LABELS[group],
        description: REGISTER_GROUP_DESCRIPTIONS[group],
        items: registersInGroup(group)
          .filter((config) => can(registerPermission(config)))
          .map((config) => ({
            label: config.title,
            to: registerRoute(config),
            description: config.shortDescription ?? config.description,
            icon: config.icon,
            tone: config.tone ?? GROUP_TONE[group],
          })),
      })).filter((section) => section.items.length > 0),
    [can],
  )

  return (
    <PageShell>
      <BreadcrumbHeader
        breadcrumbs={[{ label: 'Registers' }]}
        title="Registers"
        icon={Library}
        description={`Dated, totalled and printable listings for ${scopeLabel}. Every register remembers its filters in the address bar, exports to CSV and drills through to the document behind the line.`}
      />
      <HubSections
        sections={sections}
        emptyMessage="No registers are available for your access level."
      />
    </PageShell>
  )
}

export default RegistersHubPage
