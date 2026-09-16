import { useMemo } from 'react'
import { useAccess } from '../../access/AccessContext'
import { useCompany } from '../../company/CompanyContext'
import { Notice } from '../../components/Notice'
import { PageShell } from '../../ui/shell/PageShell'
import { MasterCard } from './MasterCard'
import { MasterInsightsSidebar } from './MasterInsightsSidebar'
import { MasterSummaryCards } from './MasterSummaryCards'
import { MastersHero } from './MastersHero'
import { MastersTabs } from './MastersTabs'
import { MASTER_DEFINITIONS, canReadMaster } from './masterDefinitions'
import { useMastersOverview } from './useMastersOverview'

/**
 * The Masters landing page.
 *
 * Hero, four figures, the category tabs, the grid of masters and a contextual
 * column. Every route it links to already existed — this screen adds no routes,
 * renames no master and changes no API contract; it reads the same list
 * endpoints the master screens themselves use, one page of one row at a time,
 * to put a real count and a real date on each card.
 *
 * The tab row is drawn here rather than by MastersLayout because the design
 * places it below the summary cards. MastersLayout draws it for every other
 * `/masters/*` screen, and skips it for this one, so it is never rendered
 * twice.
 */
export function MastersIndex() {
  const { companyName } = useCompany()
  const { can, loading: accessLoading } = useAccess()

  // While access is loading every master shows: a grid that appears and then
  // shrinks reads worse than one that arrives a beat later but complete.
  const visible = useMemo(
    () => MASTER_DEFINITIONS.filter((master) => accessLoading || can(canReadMaster(master))),
    [can, accessLoading],
  )

  const overview = useMastersOverview()

  return (
    <PageShell>
      <MastersHero companyName={companyName} />

      {!accessLoading && visible.length === 0 ? (
        <Notice kind="warning">
          You do not have permission to view any master in this company.
        </Notice>
      ) : null}

      <div className="grid items-start gap-3 wide:grid-cols-[minmax(0,1fr)_18rem]">
        <div className="min-w-0 space-y-3">
          <MasterSummaryCards
            masterTypes={MASTER_DEFINITIONS.length}
            pendingReviews={overview.pendingReviews}
            recentlyUpdated={overview.recentlyUpdated}
            loading={overview.loading}
          />

          <MastersTabs />

          <section
            className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 ultra:grid-cols-4"
            aria-label="Inventory master types"
          >
            {visible.map((master) => (
              <MasterCard key={master.key} master={master} stat={overview.stats[master.key]} />
            ))}
          </section>
        </div>

        <MasterInsightsSidebar
          health={overview.health}
          activity={overview.activity}
          activityReadable={overview.activityReadable}
          activityLoading={overview.activityLoading}
        />
      </div>
    </PageShell>
  )
}

export default MastersIndex
