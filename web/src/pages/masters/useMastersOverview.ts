import { useMemo } from 'react'
import { useAccess } from '../../access/AccessContext'
import { useCompany } from '../../company/CompanyContext'
import { useQuery } from '../../hooks/useQuery'
import { P } from '../../services/access'
import { auditApi } from '../../services/auditApi'
import type { AuditLogRow } from '../../services/auditApi'
import { MASTER_AUDIT_ENTITIES, MASTER_DEFINITIONS, canReadMaster } from './masterDefinitions'
import type { MasterDefinition } from './masterDefinitions'
import { masterActivity, masterHealth, recentlyUpdatedCount } from './mastersOverview'
import type { MasterActivity, MasterHealth, MasterStat, MasterStats } from './mastersOverview'

/**
 * Everything the Masters landing page knows, read from the live API.
 *
 * One `limit=1` list call per master the profile may read answers both figures
 * a card shows: `meta.total` is the record count and, sorted by `updated_at`
 * descending, the single row returned carries the master's last-touched stamp.
 * That sort is whitelisted by every master controller and falls back to the
 * name column rather than erroring, so this cannot 400 on a master that has not
 * declared it.
 *
 * Nothing is cached across companies and nothing is persisted: the company /
 * FY / branch scope is in the dependency list and in `resetKey`, so switching
 * company drops the previous company's figures in the same render rather than
 * painting them under the new company's name.
 */

export interface MastersOverview {
  stats: MasterStats
  health: MasterHealth
  /** Master types touched in the last 7 days; null when no stamp was readable. */
  recentlyUpdated: number | null
  /**
   * Masters that want attention — essential ones with no records, plus optional
   * ones never set up. Derived from the same counts as the health ring so the
   * two can never disagree.
   *
   * There is no "pending review" concept in the API today. When one arrives,
   * replace this single line with the field; nothing else on the screen needs
   * to change.
   */
  pendingReviews: number | null
  activity: MasterActivity[]
  /** The audit trail is readable — distinguishes "nothing happened" from "cannot look". */
  activityReadable: boolean
  loading: boolean
  activityLoading: boolean
}

/** Counts and stamps for every master the profile may read. */
function useMasterStats(masters: readonly MasterDefinition[]) {
  const { scope } = useCompany()
  const { can, loading: accessLoading } = useAccess()

  const readable = useMemo(
    () => masters.filter((master) => can(canReadMaster(master))),
    [masters, can],
  )
  // The identity of the array changes on every access reload; its content is
  // what the request depends on.
  const readableKeys = readable.map((m) => m.key).join(',')

  const query = useQuery<MasterStats>(
    async (signal) => {
      const settled = await Promise.allSettled(
        readable.map((master) =>
          master.api.list({ limit: 1, sort: 'updated_at', order: 'desc' }, signal),
        ),
      )
      const stats: Record<string, MasterStat> = {}
      settled.forEach((result, index) => {
        const master = readable[index]
        if (result.status !== 'fulfilled') {
          // One master's endpoint being down must not blank the other ten.
          stats[master.key] = { count: null, updatedAt: null, failed: true }
          return
        }
        const { data, meta } = result.value
        const total = Number(meta?.total)
        stats[master.key] = {
          count: Number.isFinite(total) ? total : null,
          updatedAt: data[0]?.updated_at ?? data[0]?.created_at ?? null,
          failed: false,
        }
      })
      return stats
    },
    [scope?.cmp_id, scope?.fy_id, scope?.bo_id, readableKeys],
    {
      enabled: Boolean(scope) && !accessLoading && readable.length > 0,
      resetKey: scope ? `${scope.cmp_id}:${scope.fy_id}:${scope.bo_id}` : null,
    },
  )

  return {
    stats: query.data ?? {},
    loading: accessLoading || (query.loading && query.data === null),
  }
}

/** The newest master changes from the audit trail, when it may be read. */
function useMasterActivity(limit: number) {
  const { scope } = useCompany()
  const { can, loading: accessLoading } = useAccess()
  const readable = can(P.auditRead)

  const query = useQuery<AuditLogRow[]>(
    async (signal) => {
      // `entity_type` takes a comma-separated list server-side (whereIn), so
      // the whole feed is one request rather than one per master.
      const res = await auditApi.list(
        {
          entity_type: MASTER_AUDIT_ENTITIES.join(','),
          // Over-fetch a little: rows that describe an action the feed has no
          // wording for are dropped, and five must survive that filter.
          limit: Math.max(limit * 4, 20),
          sort: 'created_at',
          order: 'desc',
        },
        signal,
      )
      return res.data
    },
    [scope?.cmp_id, scope?.fy_id, scope?.bo_id, readable],
    {
      enabled: Boolean(scope) && !accessLoading && readable,
      resetKey: scope ? `${scope.cmp_id}:${scope.fy_id}:${scope.bo_id}` : null,
    },
  )

  return {
    rows: query.data ?? [],
    readable,
    // An audit trail the profile cannot open is not "still loading".
    loading: readable && (accessLoading || (query.loading && query.data === null)),
  }
}

export function useMastersOverview(
  masters: readonly MasterDefinition[] = MASTER_DEFINITIONS,
  activityLimit = 5,
): MastersOverview {
  const { stats, loading } = useMasterStats(masters)
  const { rows, readable, loading: activityLoading } = useMasterActivity(activityLimit)

  const health = useMemo(() => masterHealth(stats, masters), [stats, masters])
  const recentlyUpdated = useMemo(() => recentlyUpdatedCount(stats, masters), [stats, masters])
  const activity = useMemo(() => masterActivity(rows, activityLimit), [rows, activityLimit])

  return {
    stats,
    health,
    recentlyUpdated,
    pendingReviews: health.assessed === 0 ? null : health.missing + health.review,
    activity,
    activityReadable: readable,
    loading,
    activityLoading,
  }
}
