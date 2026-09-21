import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import {
  Boxes,
  Eye,
  GitCompareArrows,
  History,
  Layers3,
  PackageMinus,
  ReceiptText,
  RefreshCw,
  Search,
  SquarePen,
  TriangleAlert,
  X,
} from 'lucide-react'
import { useAccess, useCan } from '../../access/AccessContext'
import { useCompany } from '../../company/CompanyContext'
import { useScopeLabel } from '../../company/useScopeLabel'
import { ListSheetActions } from '../../components/ListSheetActions'
import { RequirePermission } from '../../components/RequirePermission'
import { useReferenceData } from '../../documents/useReferenceData'
import { useListParams } from '../../hooks/useListParams'
import { useQuery } from '../../hooks/useQuery'
import { ConfigureColumns } from '../../registers/ConfigureColumns'
import { useColumnConfig } from '../../registers/useColumnConfig'
import { P } from '../../services/access'
import { itemsApi } from '../../services/items'
import { fetchRegistersSummary } from '../../services/registersApi'
import { fetchAllRows } from '../../services/listAll'
import { valuationApi } from '../../services/valuationApi'
import type { CostLayerRow, RecalcJob, ReportMethod } from '../../services/valuationApi'
import { Badge } from '../../ui/Badge'
import { Button } from '../../ui/Button'
import type { MenuAction } from '../../ui/MenuButton'
import { Card } from '../../ui/Card'
import { EmptyState } from '../../ui/EmptyState'
import { Skeleton } from '../../ui/Skeleton'
import { BreadcrumbHeader } from '../../ui/shell/BreadcrumbHeader'
import { LiveDataBadge } from '../../ui/shell/LiveDataBadge'
import { PageShell } from '../../ui/shell/PageShell'
import { cx } from '../../ui/cx'
import { formatDate, formatInt, formatMoney, formatQty, todayIso } from '../../utils/format'
import { ValuationTabs } from './ValuationTabs'
import { CostLayerDrawer } from './cost-layers/CostLayerDrawer'
import { CostLayerKpis } from './cost-layers/CostLayerKpis'
import { CostLayersFilterBar } from './cost-layers/CostLayersFilterBar'
import { CostLayersMoreFilters, MORE_FILTER_KEYS } from './cost-layers/CostLayersMoreFilters'
import type { MoreFilterKey } from './cost-layers/CostLayersMoreFilters'
import { CostLayersTable, buildCostLayerColumns } from './cost-layers/CostLayersTable'
import { ItemSnapshotPanel } from './cost-layers/ItemSnapshotPanel'
import { LayerDistribution } from './cost-layers/LayerDistribution'
import { RecalculateValuationModal } from './cost-layers/RecalculateValuationModal'
import { ValuationActivityTimeline } from './cost-layers/ValuationActivityTimeline'
import { ValuationAiInsight } from './cost-layers/ValuationAiInsight'
import { ValuationExceptionsDrawer } from './cost-layers/ValuationExceptionsDrawer'
import { ValuationRevisionDrawer } from './cost-layers/ValuationRevisionDrawer'
import {
  QUICK_VIEWS,
  QUICK_VIEW_KEYS,
  activeQuickView,
  activityEvents,
  deriveInsight,
  detectExceptions,
  periodFor,
  periodOptions,
} from './cost-layers/costLayersModel'
import type { DistributionMeasure } from './cost-layers/costLayersModel'
import '../views.css'

const FILTER_KEYS = [
  'item_id',
  'warehouse_id',
  'open_only',
  'layer_kind',
  'all_fy',
  'status',
  'batch_id',
  'period',
  'from',
  'to',
  'method',
] as const

/** Recent activity and the last-recalculation card read from the same window. */
const ACTIVITY_WINDOW = 5

const BREADCRUMBS = [
  { label: 'Inventory', to: '/dashboard' },
  { label: 'Valuation', to: '/valuation' },
  { label: 'Cost layers' },
] as const

/**
 * Item valuation — cost layers.
 *
 * The screen answers one question: what is this item's value built from, and
 * what has been taken out of it. Everything on it is the valuation API's own
 * figures under the filters in the URL — the aggregates come from the server so
 * they describe every matching layer rather than the page in memory, and the
 * two panels that read rather than report (the insight card, the exception
 * list) say out loud how many layers they were computed over.
 *
 * Nothing here changes a valuation. The three actions that can — recalculate,
 * revalue, revise — each open a workflow that records an actor, a scope and an
 * audit trail, and the two most destructive of them default to a preview.
 */
export function CostLayersPage() {
  const { scope, fyRange } = useCompany()
  const { loading: accessLoading } = useAccess()
  const { warehouses } = useReferenceData()
  const navigate = useNavigate()
  const canRecalculate = useCan(P.valuationRecalculate)
  const canRevalue = useCan(['documents.revaluation.create', 'documents.create'])
  const canReadItems = useCan(P.masters('items', 'read'))
  const canReadBatches = useCan(P.masters('batches', 'read'))
  const canReadAudit = useCan(P.auditRead)

  const params = useListParams({ sort: 'received_at', order: 'desc', limit: 25, filterKeys: FILTER_KEYS })
  const { state } = params
  const itemId = state.filters.item_id ?? ''
  const itemIdNum = itemId ? Number(itemId) : null
  const warehouseId = state.filters.warehouse_id ?? ''
  const openOnly = state.filters.open_only !== '0'
  const method = (state.filters.method as ReportMethod) || 'AS_PER_MASTER'

  const periods = useMemo(() => periodOptions(fyRange.from, fyRange.to), [fyRange.from, fyRange.to])
  const period = periods.some((p) => p.value === (state.filters.period ?? '')) ? (state.filters.period ?? '') : ''
  const selectedPeriod = periodFor(periods, period)

  /*
   * An explicit date in "more filters" beats the period picker, and the drawer
   * says so. Two controls writing the same two parameters silently would make
   * the narrower one look broken.
   */
  const range = useMemo(() => {
    const from = state.filters.from ?? ''
    const to = state.filters.to ?? ''
    if (from || to) return { from, to }
    return selectedPeriod ? { from: selectedPeriod.from, to: selectedPeriod.to } : { from: '', to: '' }
  }, [state.filters.from, state.filters.to, selectedPeriod])

  const scopeKey = scope ? `${scope.cmp_id}:${scope.fy_id}:${scope.bo_id}` : null

  const layerQuery = useMemo(
    () => ({
      page: state.page,
      limit: state.limit,
      sort: state.sort,
      order: state.order,
      item_id: itemId,
      warehouse_id: warehouseId || undefined,
      batch_id: state.filters.batch_id || undefined,
      open_only: openOnly ? 1 : 0,
      layer_kind: state.filters.layer_kind || undefined,
      status: state.filters.status || undefined,
      from: range.from || undefined,
      to: range.to || undefined,
      all_fy: state.filters.all_fy === '1' ? 1 : undefined,
    }),
    [
      state.page,
      state.limit,
      state.sort,
      state.order,
      state.filters.batch_id,
      state.filters.layer_kind,
      state.filters.status,
      state.filters.all_fy,
      itemId,
      warehouseId,
      openOnly,
      range.from,
      range.to,
    ],
  )

  const layers = useQuery(
    (signal) => valuationApi.costLayers(layerQuery, signal),
    [JSON.stringify(layerQuery), scopeKey],
    { enabled: scope !== null && itemId !== '', resetKey: scopeKey },
  )

  /* The only company-wide figure on the page, and the base currency with it. */
  const registers = useQuery((signal) => fetchRegistersSummary(signal), [scopeKey], {
    enabled: scope !== null,
    resetKey: scopeKey,
  })

  const snapshot = useQuery(
    (signal) =>
      valuationApi.snapshot(
        { item_id: itemId, warehouse_id: warehouseId || undefined, method, as_of: todayIso(), limit: 1 },
        signal,
      ),
    [itemId, warehouseId, method, scopeKey],
    { enabled: scope !== null && itemId !== '', resetKey: scopeKey },
  )

  const master = useQuery((signal) => itemsApi.get(Number(itemId), signal), [itemId, scopeKey], {
    enabled: scope !== null && itemId !== '' && canReadItems,
    resetKey: scopeKey,
  })

  const jobs = useQuery(
    (signal) =>
      valuationApi.recalcJobs(
        { item_id: itemId || undefined, limit: ACTIVITY_WINDOW, sort: 'created_at', order: 'desc' },
        signal,
      ),
    [itemId, scopeKey],
    { enabled: scope !== null, resetKey: scopeKey },
  )

  const revisions = useQuery(
    (signal) =>
      valuationApi.revisions({ item_id: itemId, limit: ACTIVITY_WINDOW, sort: 'created_at', order: 'desc' }, signal),
    [itemId, scopeKey],
    { enabled: scope !== null && itemId !== '', resetKey: scopeKey },
  )

  const rows = useMemo(() => layers.data?.data ?? [], [layers.data])
  const item = layers.data?.item ?? null
  const summary = layers.data?.summary ?? null
  const distribution = layers.data?.distribution ?? null
  const meta = layers.data?.meta ?? null
  const itemValuation = snapshot.data?.data?.[0] ?? null
  const lastJob: RecalcJob | null = jobs.data?.data?.[0] ?? null

  /* ---------------------------------------------------------------- derived */

  const exceptions = useMemo(
    () => detectExceptions(rows, { avgUnitCost: summary?.unit_cost_avg ?? null }),
    [rows, summary?.unit_cost_avg],
  )
  const insight = useMemo(() => deriveInsight(rows, summary, exceptions), [rows, summary, exceptions])
  const activity = useMemo(
    () =>
      activityEvents({
        layers: rows,
        jobs: jobs.data?.data ?? [],
        revisions: revisions.data?.data ?? [],
        limit: 6,
      }),
    [rows, jobs.data, revisions.data],
  )

  /* ------------------------------------------------------------------ state */

  const itemSearchRef = useRef<HTMLInputElement>(null)
  const [openLayer, setOpenLayer] = useState<CostLayerRow | null>(null)
  const [selected, setSelected] = useState<ReadonlySet<number>>(() => new Set())
  const [measure, setMeasure] = useState<DistributionMeasure>('value')
  const [showMoreFilters, setShowMoreFilters] = useState(false)
  const [showRecalc, setShowRecalc] = useState(false)
  const [recalcFrom, setRecalcFrom] = useState<string | null>(null)
  const [showRevision, setShowRevision] = useState(false)
  const [showExceptions, setShowExceptions] = useState(false)

  // A new result set invalidates a tick list keyed by layer id, and an open
  // drawer whose row is no longer on screen.
  const resultKey = `${JSON.stringify(layerQuery)}|${scopeKey}`
  useEffect(() => {
    setSelected(new Set())
    setOpenLayer(null)
  }, [resultKey])

  const toggleRow = useCallback((layerId: number) => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(layerId)) next.delete(layerId)
      else next.add(layerId)
      return next
    })
  }, [])

  const allSelected = rows.length > 0 && rows.every((r) => selected.has(r.layer_id))
  const someSelected = rows.some((r) => selected.has(r.layer_id))
  const toggleAll = useCallback(() => {
    setSelected((prev) => {
      const everyOne = rows.length > 0 && rows.every((r) => prev.has(r.layer_id))
      return everyOne ? new Set<number>() : new Set(rows.map((r) => r.layer_id))
    })
  }, [rows])

  /* ---------------------------------------------------------------- columns */

  const rowActions = useCallback(
    (row: CostLayerRow): MenuAction[] => {
      const actions: MenuAction[] = [
        { key: 'open', label: 'View layer', icon: Eye, onSelect: () => setOpenLayer(row) },
      ]
      if (row.source_document_id) {
        actions.push({
          key: 'receipt',
          label: 'View receipt',
          icon: ReceiptText,
          onSelect: () => navigate(`/documents/${row.source_document_id}`),
        })
      }
      if (row.consumptions?.length) {
        actions.push({
          key: 'consumption',
          label: `View consumption (${row.consumptions.length})`,
          icon: PackageMinus,
          onSelect: () => setOpenLayer(row),
        })
      }
      if (canReadItems) {
        actions.push({
          key: 'item',
          label: 'View item',
          icon: Boxes,
          separated: true,
          onSelect: () => navigate(`/items/${row.item_id}`),
        })
      }
      if (row.batch_id && canReadBatches) {
        actions.push({
          key: 'batch',
          label: 'View batch',
          icon: Layers3,
          onSelect: () => navigate(`/masters/batches?q=${encodeURIComponent(row.batch_no ?? String(row.batch_id))}`),
        })
      }
      if (canReadAudit) {
        // The audit log records documents and items, not layers: a layer is the
        // consequence of a posting, so its history is the history of whatever
        // posted it, and of the item when nothing did.
        const auditQuery = row.source_document_id
          ? `entity_type=document&entity_id=${row.source_document_id}`
          : `entity_type=item&entity_id=${row.item_id}`
        actions.push({
          key: 'audit',
          label: 'View audit trail',
          icon: History,
          onSelect: () => navigate(`/audit?${auditQuery}`),
        })
      }
      if (canRecalculate && row.received_at) {
        actions.push({
          key: 'recalc',
          label: 'Recalculate from this date',
          icon: RefreshCw,
          separated: true,
          onSelect: () => {
            setRecalcFrom(row.received_at?.slice(0, 10) ?? todayIso())
            setShowRecalc(true)
          },
        })
      }
      if (canRevalue) {
        actions.push({
          key: 'revise',
          label: 'Create revision',
          icon: SquarePen,
          onSelect: () => {
            setOpenLayer(row)
            setShowRevision(true)
          },
        })
      }
      return actions
    },
    [canRecalculate, canReadAudit, canReadBatches, canReadItems, canRevalue, navigate],
  )

  const allColumns = useMemo(
    () =>
      buildCostLayerColumns({
        itemName: item?.item_name ?? null,
        unitSymbol: master.data?.unit_symbol ?? itemValuation?.unit_symbol ?? null,
        actionsFor: rowActions,
        selected,
        onToggleRow: toggleRow,
        onToggleAll: toggleAll,
        allSelected,
        someSelected,
      }),
    [
      item?.item_name,
      master.data?.unit_symbol,
      itemValuation?.unit_symbol,
      rowActions,
      selected,
      toggleRow,
      toggleAll,
      allSelected,
      someSelected,
    ],
  )

  const columnConfig = useColumnConfig('valuation-cost-layers', allColumns)

  /* ---------------------------------------------------------------- filters */

  const setFilter = params.setFilter
  const setFilters = params.setFilters

  const onQuickView = useCallback(
    (key: string) => {
      const view = QUICK_VIEWS.find((v) => v.key === key)
      if (!view) return
      const patch: Record<string, string> = {}
      for (const param of QUICK_VIEW_KEYS) patch[param] = view.params[param] ?? ''
      setFilters(patch)
    },
    [setFilters],
  )

  const onMoreFilter = useCallback(
    (key: MoreFilterKey, value: string) => setFilter(key, value),
    [setFilter],
  )

  const clearMoreFilters = useCallback(() => {
    const patch: Record<string, string> = {}
    for (const key of MORE_FILTER_KEYS) patch[key] = ''
    setFilters(patch)
  }, [setFilters])

  const moreFilterCount = MORE_FILTER_KEYS.filter((k) => (state.filters[k] ?? '') !== '').length
  const canReset = Object.keys(state.filters).length > 0

  /* --------------------------------------------------------------- the view */

  const scopeLabel = useScopeLabel(selectedPeriod?.label)
  const firstLoad = layers.loading && !layers.data
  const hasItem = itemId !== ''
  const openQty = summary?.open_qty ?? 0
  const openValue = summary?.open_value ?? 0
  const partialScan = meta !== null && meta.total > rows.length

  const exportColumns = columnConfig.visibleColumns.filter((c) => c.key !== 'select' && c.key !== 'actions')

  const headerActions = (
    <>
      {hasItem ? (
        <ListSheetActions<CostLayerRow>
          columns={exportColumns}
          rows={rows}
          fetchAll={() =>
            fetchAllRows<CostLayerRow>((page, limit) => valuationApi.costLayers({ ...layerQuery, page, limit }))
          }
          filenameBase={`cost-layers-${item?.item_sku || item?.item_name || itemId}`}
          title={item ? `Cost layers — ${item.item_name}` : 'Cost layers'}
          description="Receipt layers the item's valuation is built from, and the issues that consumed them"
          scopePeriod={selectedPeriod?.label}
          metaLines={[
            item?.valuation_method ? `Valued: ${item.valuation_method}` : '',
            selectedPeriod ? `Period: ${selectedPeriod.label}` : '',
            range.from || range.to ? `Received between: ${range.from || '…'} and ${range.to || '…'}` : '',
            openOnly ? 'Layers: open only' : 'Layers: open and exhausted',
            state.filters.status ? `State: ${state.filters.status}` : '',
            state.filters.layer_kind ? `Kind: ${state.filters.layer_kind}` : '',
            warehouseId ? `Warehouse id: ${warehouseId}` : 'Warehouse: all',
            state.filters.all_fy === '1' ? 'Years: all financial years' : '',
          ].filter(Boolean)}
          summaryCards={
            summary
              ? [
                  { label: 'Open qty', value: formatQty(summary.open_qty) },
                  { label: 'Open value', value: formatMoney(summary.open_value) },
                  {
                    label: 'Backorder qty',
                    value: formatQty(summary.backorder_qty),
                    tone: summary.backorder_qty < 0 ? 'credit' : undefined,
                  },
                ]
              : undefined
          }
          footerNotes={['Which issues consumed each layer is on screen — open a layer to read its consumption trail.']}
          onRefresh={layers.reload}
          refreshing={layers.loading}
          disabled={!layers.data || layers.data.meta.total === 0}
        />
      ) : null}

      {canRecalculate ? (
        <Button
          variant="secondary"
          icon={RefreshCw}
          onClick={() => {
            setRecalcFrom(null)
            setShowRecalc(true)
          }}
        >
          Recalculate
        </Button>
      ) : null}

      <Link
        to={hasItem ? `/valuation/method-comparison?item_id=${itemId}` : '/valuation/method-comparison'}
        className="aic inline-flex h-8 items-center gap-1.5 rounded-lg border border-gray-200 bg-white px-3 text-sm font-medium text-gray-700 no-underline transition-colors hover:border-primary/40 hover:bg-primary-light hover:text-primary focus:outline-none focus:ring-2 focus:ring-primary/30"
      >
        <GitCompareArrows className="h-4 w-4" aria-hidden />
        Compare methods
      </Link>

      <Button
        variant="secondary"
        icon={TriangleAlert}
        onClick={() => setShowExceptions(true)}
        disabled={!hasItem}
        className={cx(
          exceptions.length > 0 && 'border-amber-300 bg-amber-50 text-amber-800',
        )}
      >
        Review exceptions
        {exceptions.length > 0 ? (
          <span className="ml-1 inline-flex h-4 min-w-[1rem] items-center justify-center rounded-full bg-amber-500 px-1 text-[10px] font-bold text-white">
            {exceptions.length}
          </span>
        ) : null}
      </Button>

      {canRevalue || canRecalculate ? (
        <Button icon={SquarePen} onClick={() => setShowRevision(true)} disabled={!hasItem}>
          Create revision
        </Button>
      ) : null}
    </>
  )

  return (
    <PageShell fullBleed>
      <BreadcrumbHeader
        breadcrumbs={BREADCRUMBS}
        title="Item valuation — cost layers"
        description="Pick an item to see the receipt layers its valuation is built from and which issues consumed them."
        icon={Layers3}
        meta={<span className="text-[11px] text-gray-500">{scopeLabel}</span>}
        /*
         * How old the figures are, from the last SUCCESSFUL fetch.
         *
         * This screen is read to decide whether to re-cost a period, and it
         * keeps the previous rows on screen while the next query runs and when
         * a reload fails — which is right, but it means a stale grid is
         * indistinguishable from a fresh one. The badge reads `fetchedAt`,
         * which useQuery deliberately does not move on a failure, so a page
         * whose last request died says "Showing last good data" instead of
         * looking current.
         *
         * `aside` only renders at 1536px and up, so it costs no room on the
         * laptop width the header is already tight at.
         */
        aside={
          hasItem ? (
            <LiveDataBadge
              fetchedAt={layers.fetchedAt}
              refreshing={layers.loading}
              stale={layers.error !== null}
            />
          ) : null
        }
        actions={headerActions}
      />

      <ValuationTabs />

      <RequirePermission permission={P.report('valuation')} what="cost layers">
        <section aria-label="Valuation summary" className="grid grid-cols-1 gap-2 sm:grid-cols-2 wide:grid-cols-4">
          <CostLayerKpis
            registers={registers.data}
            summary={summary}
            distribution={distribution}
            lastJob={lastJob}
            hasItem={hasItem}
            loading={(registers.loading && !registers.data) || (hasItem && firstLoad)}
          />
        </section>

        <CostLayersFilterBar
          itemId={itemId}
          itemSearchRef={itemSearchRef}
          onItem={(id) => setFilter('item_id', id)}
          warehouseId={warehouseId}
          onWarehouse={(id) => setFilter('warehouse_id', id)}
          warehouses={warehouses}
          method={method}
          onMethod={(m) => setFilter('method', m === 'AS_PER_MASTER' ? '' : m)}
          period={period}
          periods={periods}
          onPeriod={(p) => setFilter('period', p)}
          openOnly={openOnly}
          onOpenOnly={(next) => setFilter('open_only', next ? '' : '0')}
          onOpenMoreFilters={() => setShowMoreFilters(true)}
          moreFiltersOpen={showMoreFilters}
          moreFilterCount={moreFilterCount}
          activeQuickView={activeQuickView({
            status: state.filters.status ?? '',
            sort: state.sort,
            order: state.order,
          })}
          onQuickView={onQuickView}
          onReset={params.reset}
          canReset={canReset}
        />

        {/*
          The rail comes alongside only at `ultra` (1600px), and that number is
          arithmetic rather than taste: the app's nav takes 240px before this
          grid sees a pixel, so a 21rem rail at 1280 leaves a twelve-column
          financial table about 700px — the reader would scroll sideways to
          reach the value column, which is the figure they came for. Below
          1600 the table gets the full width and the rail sits under it, two
          panels abreast while there is room for two.
        */}
        <div className="grid grid-cols-1 items-start gap-2 ultra:grid-cols-[minmax(0,1fr)_19rem]">
          <main className="min-w-0">
            {!hasItem ? (
              <Card padding="none">
                <EmptyState
                  icon={Search}
                  title="Select an item to inspect its valuation layers"
                  description="Search by item name, SKU or code to see the receipt layers its value is built from, what each issue consumed, and what is still open."
                  action={
                    <div className="flex flex-wrap items-center justify-center gap-2">
                      <Button onClick={() => itemSearchRef.current?.focus()}>Select item</Button>
                      <Link
                        to="/valuation"
                        className="aic inline-flex h-8 items-center rounded-lg border border-gray-200 bg-white px-3 text-sm font-medium text-gray-700 no-underline transition-colors hover:border-primary/40 hover:text-primary"
                      >
                        View stock valuation
                      </Link>
                    </div>
                  }
                />
              </Card>
            ) : (
              <CostLayersTable
                rows={rows}
                meta={meta}
                limit={state.limit}
                loading={layers.loading}
                error={
                  layers.error
                    ? {
                        title: 'Unable to load valuation layers',
                        description:
                          import.meta.env.DEV
                            ? layers.error.message
                            : 'Something went wrong while retrieving the cost layers for this item.',
                        onRetry: layers.reload,
                      }
                    : null
                }
                sort={{ key: state.sort, order: state.order }}
                onSort={params.toggleSort}
                onPage={params.setPage}
                onLimit={params.setLimit}
                columns={columnConfig.visibleColumns}
                onRowOpen={setOpenLayer}
                openLayerId={openLayer?.layer_id ?? null}
                selected={selected}
                onToggleRow={toggleRow}
                onToggleAll={toggleAll}
                headerAction={
                  <ConfigureColumns
                    columns={allColumns}
                    visibility={columnConfig.visibility}
                    onChange={columnConfig.setVisibility}
                    disabled={!columnConfig.ready}
                    title="Columns"
                    description="Choose the columns to show. The choice is remembered for your own sign-in, and the export and print follow it."
                  />
                }
                empty={
                  <EmptyState
                    icon={Layers3}
                    title="No valuation layers found"
                    description="No cost layers match this item with the filters currently applied. Widen the period, clear the layer state, or switch off “open layers only”."
                    action={
                      <div className="flex flex-wrap items-center justify-center gap-2">
                        <Button variant="secondary" onClick={() => onQuickView('all')}>
                          Clear filters
                        </Button>
                        <Button variant="ghost" onClick={() => setFilter('period', '')}>
                          Use the whole year
                        </Button>
                      </div>
                    }
                  />
                }
                selectionBar={
                  selected.size > 0 ? (
                    <div className="mb-2 flex flex-wrap items-center gap-2 rounded-xl border border-primary/30 bg-primary-light px-3 py-2">
                      <span className="text-xs font-semibold text-primary">
                        {formatInt(selected.size)} layer{selected.size === 1 ? '' : 's'} selected ·{' '}
                        {formatMoney(
                          rows
                            .filter((r) => selected.has(r.layer_id))
                            .reduce((sum, r) => sum + r.remaining_value, 0),
                        )}{' '}
                        still held
                      </span>
                      <div className="ml-auto flex items-center gap-1.5">
                        {canRecalculate ? (
                          <Button
                            variant="secondary"
                            size="xs"
                            onClick={() => {
                              const dates = rows
                                .filter((r) => selected.has(r.layer_id))
                                .map((r) => r.received_at?.slice(0, 10))
                                .filter((d): d is string => Boolean(d))
                                .sort()
                              setRecalcFrom(dates[0] ?? null)
                              setShowRecalc(true)
                            }}
                          >
                            Recalculate from earliest
                          </Button>
                        ) : null}
                        <Button variant="ghost" size="xs" icon={X} onClick={() => setSelected(new Set())}>
                          Clear
                        </Button>
                      </div>
                    </div>
                  ) : null
                }
              />
            )}
          </main>

          <aside className="grid min-w-0 grid-cols-1 items-start gap-2 md:grid-cols-2 ultra:sticky ultra:top-2 ultra:grid-cols-1">
            <Card padding="none" className="overflow-hidden">
              <ItemSnapshotPanel
                item={item}
                master={master.data}
                valuation={itemValuation}
                loading={snapshot.loading && !snapshot.data}
                scopeLabel={warehouseId ? 'the selected warehouse' : 'every warehouse'}
              >
                {hasItem ? (
                  <LayerDistribution
                    distribution={distribution}
                    measure={measure}
                    onMeasure={setMeasure}
                    loading={firstLoad}
                    scopeNote="Every layer of this item in the selected warehouse and period — the open-layer toggle and the state filter do not narrow it."
                  />
                ) : null}
              </ItemSnapshotPanel>
            </Card>

            <ValuationAiInsight
              insight={insight}
              loading={hasItem && firstLoad}
              scannedCount={rows.length}
              hasItem={hasItem}
              onOpenDetail={hasItem ? () => setShowExceptions(true) : undefined}
            />

            <Card padding="none" className="overflow-hidden md:col-span-2 ultra:col-span-1">
              <ValuationActivityTimeline
                events={activity}
                loading={hasItem && (firstLoad || (jobs.loading && !jobs.data))}
                viewAllTo={hasItem ? `/valuation/recalculations?item_id=${itemId}` : '/valuation/recalculations'}
                emptyMessage={
                  hasItem
                    ? 'No receipts, issues, recalculations or revisions on record for this item in the selected period.'
                    : 'Pick an item to see the receipts, issues and recalculations behind its valuation.'
                }
              />
            </Card>

            {accessLoading ? <Skeleton className="h-12 w-full md:col-span-2 ultra:col-span-1" /> : null}
          </aside>
        </div>
      </RequirePermission>

      <CostLayerDrawer
        layer={openLayer}
        item={item}
        unitSymbol={master.data?.unit_symbol ?? itemValuation?.unit_symbol ?? null}
        onClose={() => setOpenLayer(null)}
        onRecalculateFrom={
          canRecalculate
            ? (fromDate) => {
                setRecalcFrom(fromDate)
                setOpenLayer(null)
                setShowRecalc(true)
              }
            : undefined
        }
        onRevalue={canRevalue ? () => setShowRevision(true) : undefined}
      />

      <CostLayersMoreFilters
        open={showMoreFilters}
        onClose={() => setShowMoreFilters(false)}
        values={state.filters}
        onChange={onMoreFilter}
        onClear={clearMoreFilters}
        itemId={itemIdNum}
        warehouseId={warehouseId ? Number(warehouseId) : null}
        periodLabel={selectedPeriod?.label ?? null}
      />

      <RecalculateValuationModal
        open={showRecalc}
        onClose={() => setShowRecalc(false)}
        itemId={itemIdNum}
        itemName={item?.item_name ?? null}
        initialFromDate={recalcFrom}
        onDone={() => {
          layers.reload()
          jobs.reload()
          revisions.reload()
        }}
      />

      <ValuationRevisionDrawer
        open={showRevision}
        onClose={() => setShowRevision(false)}
        item={item}
        layer={openLayer}
        openQty={openQty}
        openValue={openValue}
        canRevalue={canRevalue}
        canRecalculate={canRecalculate}
        onRecalculate={() => {
          setRecalcFrom(null)
          setShowRecalc(true)
        }}
      />

      <ValuationExceptionsDrawer
        open={showExceptions}
        onClose={() => setShowExceptions(false)}
        exceptions={exceptions}
        scannedCount={rows.length}
        partialScan={partialScan}
        itemName={item?.item_name ?? null}
        onOpenLayer={(layerId) => {
          const row = rows.find((r) => r.layer_id === layerId) ?? null
          setOpenLayer(row)
          setShowExceptions(false)
        }}
      />

      {layers.data && meta ? (
        <p className="px-1 pb-2 text-[11px] text-gray-400">
          {formatInt(meta.total)} layer{meta.total === 1 ? '' : 's'} match these filters
          {summary?.first_received_at
            ? `, opened between ${formatDate(summary.first_received_at)} and ${formatDate(summary.last_received_at)}`
            : ''}
          .{' '}
          {registers.data ? (
            <span>Figures in {registers.data.currency}.</span>
          ) : null}
          {distribution ? null : (
            <Badge tone="neutral" size="xs" className="ml-1">
              Layer states unavailable from this API
            </Badge>
          )}
        </p>
      ) : null}
    </PageShell>
  )
}
