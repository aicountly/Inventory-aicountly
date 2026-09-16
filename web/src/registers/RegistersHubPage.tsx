import { useMemo } from 'react'
import { useAccess } from '../access/AccessContext'
import { useScopeLabel } from '../company/useScopeLabel'
import { PageShell } from '../ui/shell/PageShell'
import { RegisterSection } from './hub/RegisterSection'
import { RegistersHero } from './hub/RegistersHero'
import { RegistersKpiStrip } from './hub/RegistersKpiStrip'
import { buildRegisterHubSections } from './hub/registersHubModel'
import { useRegistersSummary } from './hub/useRegistersSummary'

/**
 * The registers hub.
 *
 * One door to every register, grouped the way a reader thinks about them
 * (what moved · what is here · what it is worth · what it tells me · what is
 * outstanding) rather than by which endpoint serves them. A section with no
 * registers the user may read simply disappears — permission filtering is a
 * `filter` in the model, never a disabled tile that teases.
 *
 * The counters above them are an aside, and the order below says so: the
 * sections are built from the local catalogue and render on the first paint,
 * while the strip fills in from its one request and drops itself entirely if
 * that request fails. Nothing on this page waits on the network to be
 * clickable — this is a menu, and a menu that cannot be used until a figure
 * loads is worse than a menu with no figures.
 */
export function RegistersHubPage() {
  const { can } = useAccess()
  const scopeLabel = useScopeLabel()
  const summary = useRegistersSummary()

  const sections = useMemo(() => buildRegisterHubSections(can), [can])

  return (
    <PageShell>
      <RegistersHero scopeLabel={scopeLabel} />
      {summary.failed ? null : <RegistersKpiStrip cards={summary.cards} />}
      {sections.length ? (
        <div className="space-y-5">
          {sections.map((section) => (
            <RegisterSection key={section.key} section={section} />
          ))}
        </div>
      ) : (
        <p className="text-sm text-gray-500">
          No registers are available for your access level.
        </p>
      )}
    </PageShell>
  )
}

export default RegistersHubPage
