/**
 * Every request the cost-layer workspace makes, in one place.
 *
 * The screen asks four different questions of the valuation service and it
 * matters which endpoint answers which, so they are gathered here rather than
 * scattered through the panels:
 *
 *  - the TABLE is server-paginated on `GET /v1/valuation/cost-layers`, because
 *    that is the resource and its `meta.total` is the count the footer reports;
 *  - the RAIL (snapshot, distribution, insights, exceptions, activity) needs
 *    the item's layers as a SET, not a page, so it asks once for a bounded
 *    window of them and says so on screen when the window was not enough;
 *  - the KPI strip's inventory value is the valuation snapshot's own total, and
 *    the last recalculation is the recalculation queue's newest job. Neither is
 *    re-derived here;
 *  - batch numbers come from the item's batch list, because the cost-layer rows
 *    carry `batch_id` and no name.
 *
 * Each query fails on its own. A 403 on the recalculation queue must not blank
 * the table, and a slow snapshot must not hold up the layers.
 */

import { useMemo } from 'react'
import { useCompany } from '../../../company/CompanyContext'
import { useQuery } from '../../../hooks/useQuery'
import type { QueryState } from '../../../hooks/useQuery'
import { lookupApi } from '../../../services/lookupApi'
import type { BatchRow } from '../../../services/lookupApi'
import type { SortOrder } from '../../../services/api'
import { valuationApi } from '../../../services/valuationApi'
import type {
  CostLayerRow,
  CostLayersResponse,
  RecalcJob,
  ValuationRevision,
  ValuationSnapshotResponse,
} from '../../../services/valuationApi'
import { todayIso } from '../../../utils/format'
import {
  buildActivity,
  buildExceptions,
  buildInsights,
  costStats,
  highValueThreshold,
  isRefinementActive,
  refineLayers,
} from '../costLayerModel'
import type {
  ActivityEvent,
  CostStats,
  LayerRefinement,
  ValuationException,
  ValuationInsight,
} from '../costLayerModel'

/**
 * How many of an item's layers the rail reads.
 *
 * One item in one financial year opens one layer per receipt, so this covers
 * the overwhelming majority outright. It is a ceiling rather than a guess: when
 * the server says there are more, `layersCapped` is true and the rail tells the
 * reader its readings cover the most recent 500 rather than quietly describing
 * a subset as if it were the whole.
 */
export const ANALYSIS_LIMIT = 500

export interface CostLayerWorkspaceInput {
  itemId: string
  warehouseId: string
  layerKind: string
  /** Cost basis the SNAPSHOT figures are read at (`GET /v1/valuation?method=`). */
  method: string
  openOnly: boolean
  allFy: boolean
  /** Filters with no server parameter — see costLayerModel. */
  refinement: LayerRefinement
  /** The "high value" chip ranks against the item's own layers. */
  highValueChip: boolean
  page: number
  limit: number
  sort: string
  order: SortOrder
}

export interface CostLayerWorkspace {
  /** Rows for the table, already paginated however the mode demands. */
  rows: CostLayerRow[]
  total: number
  offset: number
  limit: number
  loading: boolean
  error: Error | null
  reload: () => void
  fetchedAt: number | null
  /** True while the table is showing refined rows rather than a served page. */
  refining: boolean
  /** The item's layers as a set, for the rail. */
  analysisRows: CostLayerRow[]
  analysisTotal: number
  /** The server had more layers than the rail read. */
  layersCapped: boolean
  analysisLoading: boolean

  item: CostLayersResponse['item'] | null
  summary: CostLayersResponse['summary'] | null
  stats: CostStats

  companyValue: QueryState<ValuationSnapshotResponse>
  itemSnapshot: QueryState<ValuationSnapshotResponse>
  jobs: RecalcJob[]
  jobsLoading: boolean
  revisions: ValuationRevision[]
  /** The item's batches, for the batch filter. Empty when it is not tracked. */
  batches: BatchRow[]
  batchName: (batchId: number | null) => string | null

  insights: ValuationInsight[]
  exceptions: ValuationException[]
  activity: ActivityEvent[]
  /** Everything a `fetchAll` export needs, honouring the active refinement. */
  exportRows: () => Promise<{ rows: CostLayerRow[]; total: number; truncated: boolean }>
}

export function useCostLayerWorkspace(input: CostLayerWorkspaceInput): CostLayerWorkspace {
  const { scope } = useCompany()
  const {
    itemId,
    warehouseId,
    layerKind,
    method,
    openOnly,
    allFy,
    refinement,
    highValueChip,
    page,
    limit,
    sort,
    order,
  } = input

  const scopeKey = scope ? `${scope.cmp_id}:${scope.fy_id}:${scope.bo_id}` : null
  const hasItem = itemId !== ''
  const enabled = scope !== null && hasItem

  /** The parameters the endpoint itself understands. Nothing else goes here. */
  const serverQuery = useMemo(
    () => ({
      item_id: itemId,
      warehouse_id: warehouseId || undefined,
      layer_kind: layerKind || undefined,
      open_only: openOnly ? 1 : 0,
      all_fy: allFy ? 1 : 0,
    }),
    [itemId, warehouseId, layerKind, openOnly, allFy],
  )

  const pageQuery = useMemo(
    () => ({ ...serverQuery, page, limit, sort, order }),
    [serverQuery, page, limit, sort, order],
  )

  // ---- the served page ----------------------------------------------------

  const layers = useQuery<CostLayersResponse>(
    async (signal) => valuationApi.costLayers(pageQuery, signal),
    [JSON.stringify(pageQuery), scopeKey],
    { enabled, resetKey: scopeKey },
  )

  // ---- the item's layers as a set, for the rail ---------------------------

  /*
   * Deliberately NOT the page query. The rail describes the item, so it must
   * see closed layers the open-only toggle hides and kinds the kind filter
   * excludes; a distribution drawn from a filtered page would report that 100%
   * of the item's value is open because the reader ticked a box.
   */
  const analysisQuery = useMemo(
    () => ({
      item_id: itemId,
      warehouse_id: warehouseId || undefined,
      all_fy: allFy ? 1 : 0,
      open_only: 0,
      page: 1,
      limit: ANALYSIS_LIMIT,
      sort: 'received_at',
      order: 'desc' as SortOrder,
    }),
    [itemId, warehouseId, allFy],
  )

  const analysis = useQuery<CostLayersResponse>(
    async (signal) => valuationApi.costLayers(analysisQuery, signal),
    [JSON.stringify(analysisQuery), scopeKey],
    { enabled, resetKey: scopeKey },
  )

  const analysisRows = useMemo(() => analysis.data?.data ?? [], [analysis.data])
  const analysisTotal = analysis.data?.meta.total ?? 0
  const layersCapped = analysisTotal > analysisRows.length

  // ---- the refinement the chips and the drawer ask for --------------------

  const effectiveRefinement = useMemo<LayerRefinement>(() => {
    if (!highValueChip) return refinement
    const threshold = highValueThreshold(analysisRows)
    return threshold === null ? refinement : { ...refinement, minRemainingValue: threshold }
  }, [refinement, highValueChip, analysisRows])

  const refining = isRefinementActive(effectiveRefinement)

  /*
   * In refine mode the served page is the wrong set — the server cannot express
   * "partially consumed" or "received in June", so paging it would page rows
   * that are then filtered away and leave a table of four under a footer that
   * says 60. The refined rows are sliced here instead, against the same page
   * and limit the URL already carries, so the pager behaves identically either
   * way and the link stays shareable.
   */
  const refined = useMemo(
    () => (refining ? refineLayers(analysisRows, effectiveRefinement) : []),
    [refining, analysisRows, effectiveRefinement],
  )

  const rows = useMemo(() => {
    if (!refining) return layers.data?.data ?? []
    const start = Math.max(0, (page - 1) * limit)
    return refined.slice(start, start + limit)
  }, [refining, layers.data, refined, page, limit])

  // ---- the figures the rail and the KPI strip report ----------------------

  const asOf = todayIso()

  const companyValue = useQuery<ValuationSnapshotResponse>(
    async (signal) =>
      valuationApi.snapshot(
        { as_of: asOf, method, warehouse_id: warehouseId || undefined, limit: 1, page: 1 },
        signal,
      ),
    [asOf, method, warehouseId, scopeKey],
    { enabled: scope !== null, resetKey: scopeKey },
  )

  const itemSnapshot = useQuery<ValuationSnapshotResponse>(
    async (signal) =>
      valuationApi.snapshot(
        { as_of: asOf, method, item_id: itemId, warehouse_id: warehouseId || undefined, limit: 1, page: 1 },
        signal,
      ),
    [asOf, method, itemId, warehouseId, scopeKey],
    { enabled, resetKey: scopeKey },
  )

  /*
   * Not filtered by item. `recalcJobs?item_id=` matches the job's own scope
   * column exactly, and a job that recalculated EVERY item carries a null there
   * — so asking for this item's jobs would hide the company-wide run that
   * actually re-costed it. The list is read whole and each entry says which
   * scope it ran at.
   */
  const jobs = useQuery(
    async (signal) =>
      valuationApi.recalcJobs({ limit: 5, page: 1, sort: 'created_at', order: 'desc', all_fy: 1 }, signal),
    [scopeKey],
    { enabled: scope !== null, resetKey: scopeKey },
  )

  const revisions = useQuery(
    async (signal) =>
      valuationApi.revisions(
        { item_id: itemId, acknowledged: '', limit: 10, page: 1, sort: 'created_at', order: 'desc' },
        signal,
      ),
    [itemId, scopeKey],
    { enabled, resetKey: scopeKey },
  )

  /*
   * Batch numbers. The cost-layer row carries `batch_id` and no name, and a
   * column reading "#412" is a column nobody can reconcile to a physical box.
   * Failure here is survivable by design — the cell falls back to the id.
   */
  const batches = useQuery(
    async (signal) => {
      if (!hasItem) return []
      const res = await lookupApi.batches(Number(itemId), { signal })
      return res.data
    },
    [itemId, scopeKey],
    { enabled, resetKey: scopeKey },
  )

  const batchName = useMemo(() => {
    const byId = new Map<number, string>()
    for (const b of batches.data ?? []) byId.set(b.batch_id, b.lot_no ? `${b.batch_no} / ${b.lot_no}` : b.batch_no)
    return (batchId: number | null) => (batchId === null ? null : (byId.get(batchId) ?? `#${batchId}`))
  }, [batches.data])

  // ---- readings -----------------------------------------------------------

  const item = analysis.data?.item ?? layers.data?.item ?? null
  const itemName = item?.item_name ?? 'this item'
  const unitSymbol = itemSnapshot.data?.data?.[0]?.unit_symbol ?? null
  const stats = useMemo(() => costStats(analysisRows), [analysisRows])

  const insights = useMemo(
    () => (analysisRows.length ? buildInsights(analysisRows, { itemName, unitSymbol }) : []),
    [analysisRows, itemName, unitSymbol],
  )

  const exceptions = useMemo(
    () =>
      analysisRows.length || (jobs.data?.data.length ?? 0) > 0
        ? buildExceptions(analysisRows, jobs.data?.data ?? [], revisions.data?.data ?? [], { itemName })
        : [],
    [analysisRows, jobs.data, revisions.data, itemName],
  )

  const activity = useMemo(
    () => buildActivity(analysisRows, jobs.data?.data ?? [], revisions.data?.data ?? []),
    [analysisRows, jobs.data, revisions.data],
  )

  /*
   * The export walks the same set the reader is looking at. In refine mode that
   * set is already in memory and re-walking the server would hand back rows the
   * chip excludes; in server mode it pages the endpoint, because the file must
   * hold every matching layer rather than the hundred on screen.
   */
  const exportRows = useMemo(
    () => async () => {
      if (refining) return { rows: refined, total: refined.length, truncated: layersCapped }
      const out: CostLayerRow[] = []
      let total = 0
      for (let p = 1; p <= 40; p += 1) {
        const res = await valuationApi.costLayers({ ...serverQuery, sort, order, page: p, limit: 500 })
        out.push(...res.data)
        total = res.meta.total
        if (res.data.length < 500 || out.length >= total) break
      }
      return { rows: out, total, truncated: out.length < total }
    },
    [refining, refined, layersCapped, serverQuery, sort, order],
  )

  return {
    rows,
    total: refining ? refined.length : (layers.data?.meta.total ?? 0),
    offset: refining ? Math.max(0, (page - 1) * limit) : (layers.data?.meta.offset ?? 0),
    limit,
    loading: refining ? analysis.loading : layers.loading,
    error: refining ? analysis.error : layers.error,
    reload: () => {
      layers.reload()
      analysis.reload()
    },
    fetchedAt: layers.fetchedAt ?? analysis.fetchedAt,
    refining,
    analysisRows,
    analysisTotal,
    layersCapped,
    analysisLoading: analysis.loading,
    item,
    summary: analysis.data?.summary ?? layers.data?.summary ?? null,
    stats,
    companyValue,
    itemSnapshot,
    jobs: jobs.data?.data ?? [],
    jobsLoading: jobs.loading,
    revisions: revisions.data?.data ?? [],
    batches: batches.data ?? [],
    batchName,
    insights,
    exceptions,
    activity,
    exportRows,
  }
}
