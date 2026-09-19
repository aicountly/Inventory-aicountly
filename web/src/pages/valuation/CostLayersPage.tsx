import { useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  GitCompareArrows,
  Layers3,
  PackageSearch,
  RefreshCw,
  ScrollText,
  TriangleAlert,
} from 'lucide-react'
import { useCan } from '../../access/AccessContext'
import { ListSheetActions } from '../../components/ListSheetActions'
import { Notice } from '../../components/Notice'
import { RequirePermission } from '../../components/RequirePermission'
import { useReferenceData } from '../../documents/useReferenceData'
import { useListParams } from '../../hooks/useListParams'
import { ConfigureColumns } from '../../registers/ConfigureColumns'
import { useColumnConfig } from '../../registers/useColumnConfig'
import type { ExportableColumn } from '../../registers/registerCells'
import { P } from '../../services/access'
import { METHOD_LABELS } from '../../services/valuationApi'
import type { CostLayerRow } from '../../services/valuationApi'
import { Badge } from '../../ui/Badge'
import { Button } from '../../ui/Button'
import { Card } from '../../ui/Card'
import { EmptyState } from '../../ui/EmptyState'
import { BreadcrumbHeader } from '../../ui/shell/BreadcrumbHeader'
import { LiveDataBadge } from '../../ui/shell/LiveDataBadge'
import { PageShell } from '../../ui/shell/PageShell'
import { ServerTablePagination } from '../../ui/shell/TablePagination'
import { cx } from '../../ui/cx'
import { formatInt, humanize } from '../../utils/format'
import { ValuationTabs } from './ValuationLayout'
import { AGING_DAYS, isRefinementActive, quickFilter } from './costLayerModel'
import type { LayerRefinement } from './costLayerModel'
import { CostLayerDrawer } from './cost-layers/CostLayerDrawer'
import { CostLayersTable, useCostLayerColumns } from './cost-layers/CostLayersTable'
import { ItemSnapshotPanel } from './cost-layers/ItemSnapshotPanel'
import { RecalculateValuationModal } from './cost-layers/RecalculateValuationModal'
import { ValuationActivityTimeline } from './cost-layers/ValuationActivityTimeline'
import { ValuationAiInsight } from './cost-layers/ValuationAiInsight'
import { ValuationExceptionDrawer } from './cost-layers/ValuationExceptionDrawer'
import { ValuationFilterBar } from './cost-layers/ValuationFilterBar'
import type { CostLayerFilterValues } from './cost-layers/ValuationFilterBar'
import { ValuationKpiGrid } from './cost-layers/ValuationKpiGrid'
import { ValuationRevisionDrawer } from './cost-layers/ValuationRevisionDrawer'
import { ANALYSIS_LIMIT, useCostLayerWorkspace } from './cost-layers/useCostLayerWorkspace'

const FILTER_KEYS = [
  'item_id',
  'warehouse_id',
  'layer_kind',
  'method',
  'open_only',
  'all_fy',
  'quick',
  'batch_id',
  'from',
  'to',
  'cost_min',
  'cost_max',
  'unlinked',
] as const

/** URL parameter behind each control in the filter bar. */
const URL_KEY: Record<keyof CostLayerFilterValues, string> = {
  itemId: 'item_id',
  warehouseId: 'warehouse_id',
  layerKind: 'layer_kind',
  method: 'method',
  openOnly: 'open_only',
  allFy: 'all_fy',
  quick: 'quick',
  batchId: 'batch_id',
  receivedFrom: 'from',
  receivedTo: 'to',
  costMin: 'cost_min',
  costMax: 'cost_max',
  unlinked: 'unlinked',
}

/**
 * The sheet's columns.
 *
 * Unchanged from the register this screen replaced, deliberately: an export is
 * a document somebody has already filed, mailed to an auditor and built a
 * spreadsheet on top of, and a redesign of the screen is not a reason for last
 * month's file and this month's to have different headings.
 *
 * The per-issue consumption list stays a count — a table inside a cell has
 * nowhere to go on paper — and the footer says where the detail lives.
 */
const EXPORT_COLUMNS: ExportableColumn<CostLayerRow>[] = [
  { key: 'received_at', csvHeader: 'Received', format: 'date' },
  { key: 'layer_kind', csvHeader: 'Kind', csv: (r) => humanize(r.layer_kind) },
  { key: 'source_document_no', csvHeader: 'Source document', csv: (r) => r.source_document_no ?? (r.source_document_id ? `#${r.source_document_id}` : '') },
  { key: 'warehouse_name', csvHeader: 'Warehouse', csv: (r) => r.warehouse_name ?? '' },
  { key: 'qty_received', csvHeader: 'Received qty', align: 'right', format: 'qty' },
  { key: 'qty_consumed', csvHeader: 'Consumed qty', align: 'right', format: 'qty' },
  { key: 'qty_remaining', csvHeader: 'Remaining qty', align: 'right', format: 'qty' },
  { key: 'unit_cost', csvHeader: 'Unit cost (valuation)', align: 'right', format: 'amount' },
  { key: 'remaining_value', csvHeader: 'Remaining value (valuation)', align: 'right', format: 'amount' },
  { key: 'consumption_count', csvHeader: 'Issues', align: 'right', format: 'int', csv: (r) => r.consumptions?.length ?? 0 },
]

/**
 * Item valuation — cost layers.
 *
 * Each receipt opens a layer at the cost it came in at; issues consume layers
 * in the order the item's method prescribes. This screen is where a controller
 * answers "why is this item worth what it says" — which receipts the value is
 * built from, which issues took it away, and what is left.
 *
 * The page composes rather than computes: every figure on it comes from the
 * valuation service (see `useCostLayerWorkspace` for which endpoint answers
 * what), and every reading of those figures is a pure function in
 * `costLayerModel`. Nothing here writes except the two workflows that ask
 * first — recalculation and revision — and neither of them can change a cost
 * without publishing an auditable record of it.
 */
export function CostLayersPage() {
  const navigate = useNavigate()
  const { warehouses } = useReferenceData()
  const canRecalculate = useCan(P.valuationRecalculate)

  const params = useListParams({
    sort: 'received_at',
    order: 'desc',
    limit: 50,
    filterKeys: FILTER_KEYS,
  })
  const { state } = params
  const f = state.filters

  const itemId = f.item_id ?? ''
  const chip = quickFilter(f.quick)

  /*
   * The toggle and the chips both speak to `open_only`, and the chip wins —
   * "Closed" with the open-only toggle left on would ask the server for layers
   * it has just been told to exclude. The toggle is then DISPLAYED at whatever
   * the chip forced, so the control on screen never contradicts the query
   * behind it.
   */
  const openOnly = chip.server?.open_only ? chip.server.open_only === '1' : f.open_only !== '0'
  const layerKind = f.layer_kind || chip.server?.layer_kind || ''
  const allFy = f.all_fy === '1'
  const method = f.method || 'AS_PER_MASTER'

  const refinement = useMemo<LayerRefinement>(
    () => ({
      ...chip.refinement,
      batchId: f.batch_id ? Number(f.batch_id) : null,
      receivedFrom: f.from || null,
      receivedTo: f.to || null,
      costMin: f.cost_min === undefined || f.cost_min === '' ? null : Number(f.cost_min),
      costMax: f.cost_max === undefined || f.cost_max === '' ? null : Number(f.cost_max),
      unlinkedOnly: f.unlinked === '1',
    }),
    [chip, f.batch_id, f.from, f.to, f.cost_min, f.cost_max, f.unlinked],
  )

  const refinementCount = [f.batch_id, f.from, f.to, f.cost_min, f.cost_max, f.unlinked].filter(
    (v) => v !== undefined && v !== '',
  ).length

  const workspace = useCostLayerWorkspace({
    itemId,
    warehouseId: f.warehouse_id ?? '',
    layerKind,
    method,
    openOnly,
    allFy,
    refinement,
    highValueChip: f.quick === 'high_value',
    page: state.page,
    limit: state.limit,
    sort: state.sort,
    order: state.order,
  })

  const [layerOpen, setLayerOpen] = useState<CostLayerRow | null>(null)
  const [revisionFor, setRevisionFor] = useState<CostLayerRow | null>(null)
  const [revisionOpen, setRevisionOpen] = useState(false)
  const [recalcOpen, setRecalcOpen] = useState(false)
  const [recalcFrom, setRecalcFrom] = useState<string | null>(null)
  const [reviewOpen, setReviewOpen] = useState(false)
  const [moreOpen, setMoreOpen] = useState(false)
  const [columnsOpen, setColumnsOpen] = useState(false)
  const [selected, setSelected] = useState<Set<number>>(new Set())
  const itemInputRef = useRef<HTMLInputElement | null>(null)

  const setFilter = (key: keyof CostLayerFilterValues, value: string) => {
    setSelected(new Set())
    /*
     * Flipping the toggle by hand clears a chip that was forcing it, in the
     * same navigation. Two `setFilter` calls would both start from the
     * pre-update URL and the second would drop the first.
     */
    if (key === 'openOnly' && chip.server?.open_only) {
      params.setFilters({ open_only: value, quick: '' })
      return
    }
    params.setFilter(URL_KEY[key], value)
  }

  const values: CostLayerFilterValues = {
    itemId,
    warehouseId: f.warehouse_id ?? '',
    layerKind: f.layer_kind ?? '',
    method,
    openOnly,
    allFy,
    quick: f.quick ?? '',
    batchId: f.batch_id ?? '',
    receivedFrom: f.from ?? '',
    receivedTo: f.to ?? '',
    costMin: f.cost_min ?? '',
    costMax: f.cost_max ?? '',
    unlinked: f.unlinked === '1',
  }

  const openLayer = (row: CostLayerRow) => setLayerOpen(row)
  const openRevision = (row: CostLayerRow | null) => {
    setRevisionFor(row)
    setRevisionOpen(true)
  }
  const openRecalc = (from: string | null) => {
    setRecalcFrom(from)
    setRecalcOpen(true)
  }

  const pageRows = workspace.rows
  const allColumns = useCostLayerColumns({
    itemLabel: workspace.item?.item_name ?? 'Item',
    itemSku: workspace.item?.item_sku ?? null,
    batchName: workspace.batchName,
    selected,
    onToggle: (id) =>
      setSelected((prev) => {
        const next = new Set(prev)
        if (next.has(id)) next.delete(id)
        else next.add(id)
        return next
      }),
    onToggleAll: () =>
      setSelected((prev) =>
        prev.size === pageRows.length ? new Set() : new Set(pageRows.map((r) => r.layer_id)),
      ),
    allSelected: pageRows.length > 0 && selected.size === pageRows.length,
    someSelected: selected.size > 0,
    pageRowCount: pageRows.length,
    onOpenLayer: openLayer,
    onCompareCost: () => navigate(`/valuation/method-comparison?item_id=${itemId}`),
    onCreateRevision: (row) => openRevision(row),
    onRecalculate: canRecalculate ? (row) => openRecalc(row.received_at?.slice(0, 10) ?? null) : null,
    onNavigate: (to) => navigate(to),
  })

  const columnConfig = useColumnConfig('valuation-cost-layers', allColumns)
  const criticalExceptions = workspace.exceptions.filter((e) => e.severity === 'critical').length
  const hasItem = itemId !== ''
  const refining = isRefinementActive(refinement) || f.quick === 'high_value'

  const meta = {
    total: workspace.total,
    limit: workspace.limit,
    offset: workspace.offset,
  }

  return (
    <PageShell compact>
      <BreadcrumbHeader
        breadcrumbs={[
          { label: 'Inventory', to: '/' },
          { label: 'Valuation', to: '/registers/valuation' },
          { label: 'Cost layers' },
        ]}
        title="Item valuation — cost layers"
        description="Pick an item to see the receipt layers its valuation is built from and which issues consumed them."
        icon={Layers3}
        escBack={false}
        aside={
          <LiveDataBadge
            fetchedAt={workspace.fetchedAt}
            refreshing={workspace.loading}
            stale={workspace.error !== null}
          />
        }
        actions={
          <>
            <Button
              variant="secondary"
              icon={GitCompareArrows}
              onClick={() =>
                navigate(itemId ? `/valuation/method-comparison?item_id=${itemId}` : '/valuation/method-comparison')
              }
            >
              Compare methods
            </Button>
            {canRecalculate ? (
              <Button variant="secondary" icon={RefreshCw} onClick={() => openRecalc(null)}>
                Recalculate
              </Button>
            ) : null}
            <Button
              variant="secondary"
              icon={TriangleAlert}
              onClick={() => setReviewOpen(true)}
              disabled={!hasItem}
              className={cx(
                workspace.exceptions.length > 0 &&
                  'border-amber-300 bg-amber-50 text-amber-800 hover:border-amber-400 hover:bg-amber-100 hover:text-amber-900',
              )}
            >
              Review exceptions
              {workspace.exceptions.length > 0 ? (
                <Badge
                  tone={criticalExceptions > 0 ? 'danger' : 'warning'}
                  size="xs"
                  className="ml-1.5 normal-case"
                >
                  {workspace.exceptions.length}
                </Badge>
              ) : null}
            </Button>
            {canRecalculate ? (
              <Button icon={ScrollText} onClick={() => openRevision(null)} disabled={!hasItem}>
                Create revision
              </Button>
            ) : null}
          </>
        }
      />

      <ValuationTabs />

      <RequirePermission permission={P.report('valuation')} what="cost layers">
        <ValuationKpiGrid
          companySummary={workspace.companyValue.data?.summary ?? null}
          companyLoading={workspace.companyValue.loading}
          stats={hasItem ? workspace.stats : null}
          layerTotal={workspace.analysisTotal}
          layersLoading={workspace.analysisLoading}
          lastJob={workspace.jobs[0] ?? null}
          jobsLoading={workspace.jobsLoading}
          itemSelected={hasItem}
        />

        <ValuationFilterBar
          values={values}
          onChange={setFilter}
          onReset={() => {
            setSelected(new Set())
            params.reset()
          }}
          warehouses={warehouses}
          batches={workspace.batches}
          moreOpen={moreOpen}
          onMoreOpen={setMoreOpen}
          refinementCount={refinementCount}
        />

        {!hasItem ? (
          <Card padding="none">
            <EmptyState
              icon={PackageSearch}
              title="Select an item to inspect its valuation layers"
              description="Search by item name, SKU or code to see the receipt layers its value is built from, which issues consumed them, and what is left."
              action={
                <div className="flex flex-wrap items-center justify-center gap-2">
                  <Button
                    icon={PackageSearch}
                    onClick={() => itemInputRef.current?.focus()}
                  >
                    Search for an item
                  </Button>
                  <Button variant="secondary" onClick={() => navigate('/registers/valuation')}>
                    Open stock valuation
                  </Button>
                </div>
              }
            />
          </Card>
        ) : (
          /*
           * The rail is measured against the grid rather than chosen for looks:
           * at 1600px the twelve columns want 988px, so anything wider than
           * 19.5rem here makes the table scroll sideways on the screen this
           * page is optimised for. Below 1280 the rail drops under the grid.
           */
          <div className="grid grid-cols-1 items-start gap-3 xl:grid-cols-[minmax(0,1fr)_18.5rem] wide:grid-cols-[minmax(0,1fr)_19.5rem]">
            <main className="min-w-0 space-y-2">
              {workspace.layersCapped && refining ? (
                <Notice kind="warning" title="Refined on a window of layers.">
                  This item has {formatInt(workspace.analysisTotal)} layers and the screen read the
                  most recent {ANALYSIS_LIMIT}. Narrow by warehouse or financial year to refine the
                  rest.
                </Notice>
              ) : null}

              <Card padding="none" className="overflow-hidden">
                <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-b border-gray-200 px-3 py-2.5">
                  <div className="min-w-0">
                    <h2 className="text-[15px] font-semibold tracking-tight text-gray-900">
                      Valuation layers{' '}
                      <span className="font-medium text-gray-500">
                        ({formatInt(workspace.total)})
                      </span>
                    </h2>
                    <p className="mt-0.5 text-[11px] text-gray-500">
                      {refining
                        ? 'Refined from the layers loaded for this item'
                        : 'Cost layers for item receipts and their consumption'}
                      {selected.size > 0 ? ` · ${selected.size} selected` : ''}
                    </p>
                  </div>
                  {/*
                    * Export lives on the panel it exports, not in the page
                    * header. Four verbs and a three-button export group beside
                    * a heading is 760px of controls, which overflowed the
                    * header outright between 768px and 1280px — and the file
                    * is of these rows, under these columns, so this is where a
                    * reader looks for it anyway.
                    */}
                  <div className="flex shrink-0 flex-wrap items-center gap-1.5">
                    {selected.size > 0 ? (
                      <Button variant="ghost" size="xs" onClick={() => setSelected(new Set())}>
                        Clear selection
                      </Button>
                    ) : null}
                    <ListSheetActions<CostLayerRow>
                      columns={EXPORT_COLUMNS}
                      rows={pageRows}
                      fetchAll={workspace.exportRows}
                      filenameBase={`cost-layers-${workspace.item?.item_sku || workspace.item?.item_name || itemId}`}
                      title={workspace.item ? `Cost layers — ${workspace.item.item_name}` : 'Cost layers'}
                      description="Receipt layers the item's valuation is built from"
                      metaLines={[
                        workspace.item?.valuation_method ? `Valued: ${workspace.item.valuation_method}` : '',
                        `Snapshot basis: ${METHOD_LABELS[method as keyof typeof METHOD_LABELS] ?? method}`,
                        openOnly ? 'Layers: open only' : 'Layers: open and exhausted',
                        f.warehouse_id ? `Warehouse id: ${f.warehouse_id}` : '',
                        layerKind ? `Kind: ${humanize(layerKind)}` : '',
                        f.quick ? `Quick filter: ${chip.label}` : '',
                        refinementCount > 0 ? `Refinements applied: ${refinementCount}` : '',
                        allFy ? 'Years: all financial years' : '',
                      ].filter(Boolean)}
                      summaryCards={
                        workspace.summary
                          ? [
                              { label: 'Open qty', value: formatQtyText(workspace.summary.open_qty) },
                              { label: 'Open value', value: formatMoneyText(workspace.summary.open_value) },
                              { label: 'Backorder qty', value: formatQtyText(workspace.summary.backorder_qty) },
                            ]
                          : undefined
                      }
                      footerNotes={[
                        'Which issues consumed each layer is on the screen, under "Consumed by" in the layer detail panel.',
                      ]}
                      onRefresh={workspace.reload}
                      refreshing={workspace.loading}
                      disabled={workspace.total === 0}
                      searchInputRef={itemInputRef}
                    />
                    <ConfigureColumns
                      columns={allColumns}
                      visibility={columnConfig.visibility}
                      onChange={columnConfig.setVisibility}
                      open={columnsOpen}
                      onOpenChange={setColumnsOpen}
                      disabled={!columnConfig.ready}
                    />
                  </div>
                </div>

                <CostLayersTable
                  columns={columnConfig.visibleColumns}
                  rows={pageRows}
                  loading={workspace.loading}
                  error={workspace.error}
                  onRetry={workspace.reload}
                  sort={{ key: state.sort, order: state.order }}
                  onSort={params.toggleSort}
                  onRowClick={openLayer}
                  activeLayerId={layerOpen?.layer_id ?? null}
                  resetKey={`${state.page}:${state.sort}:${state.order}:${columnConfig.columnsKey}`}
                  empty={
                    <EmptyState
                      size="sm"
                      icon={Layers3}
                      title="No valuation layers found"
                      description={
                        refining || openOnly || layerKind
                          ? 'No cost layers match the current filters for this item.'
                          : 'This item has no cost layers in the selected financial year — nothing has been received into stock yet.'
                      }
                      action={
                        <div className="flex flex-wrap items-center justify-center gap-2">
                          <Button
                            variant="secondary"
                            onClick={() => {
                              setSelected(new Set())
                              params.setFilters({
                                quick: '',
                                open_only: '0',
                                layer_kind: '',
                                batch_id: '',
                                from: '',
                                to: '',
                                cost_min: '',
                                cost_max: '',
                                unlinked: '',
                              })
                            }}
                          >
                            Clear filters
                          </Button>
                          {!allFy ? (
                            <Button variant="ghost" onClick={() => setFilter('allFy', '1')}>
                              Look in every financial year
                            </Button>
                          ) : null}
                        </div>
                      }
                    />
                  }
                />

                <div className="border-t border-gray-200 px-3 py-2">
                  {/* Numbered: an item with 40 receipts a year runs to pages,
                      and a reader who knows a cost changed "around August"
                      navigates by jumping rather than by pressing Next. */}
                  <ServerTablePagination
                    meta={meta}
                    onPage={params.setPage}
                    onLimit={params.setLimit}
                    limit={state.limit}
                    numbered
                  />
                </div>
              </Card>

              {/* The whole point of the grid, said once, where it is read
                  rather than in a tooltip nobody opens. */}
              <p className="px-1 text-[10.5px] leading-relaxed text-gray-400">
                Every receipt opens a layer at the cost it came in at; issues consume layers in the
                order the item&rsquo;s method prescribes. Open layers older than {AGING_DAYS} days
                are flagged as ageing. Costs here are valuation figures — what the stock cost this
                company — not a price anything was sold at.
              </p>
            </main>

            <aside className="grid min-w-0 grid-cols-1 items-start gap-2.5 md:grid-cols-2 xl:grid-cols-1">
              <ItemSnapshotPanel
                item={workspace.item}
                summary={workspace.summary}
                snapshot={workspace.itemSnapshot.data}
                stats={workspace.stats}
                layers={workspace.analysisRows}
                loading={workspace.analysisLoading || workspace.itemSnapshot.loading}
                capped={workspace.layersCapped}
                analysisTotal={workspace.analysisTotal}
                methodLabel={METHOD_LABELS[method as keyof typeof METHOD_LABELS] ?? method}
              />

              {/* Two up on a tablet: the insight beside the snapshot rather
                  than under it, or the second column of that row is empty. */}
              <ValuationAiInsight
                insights={workspace.insights}
                loading={workspace.analysisLoading}
                onOpenAnalysis={() => setReviewOpen(true)}
                itemSelected={hasItem}
              />
              <ValuationActivityTimeline
                events={workspace.activity}
                loading={workspace.analysisLoading}
                itemSelected={hasItem}
                viewAllTo={`/valuation/revisions?item_id=${itemId}`}
                className="md:col-span-2 xl:col-span-1"
              />
            </aside>
          </div>
        )}
      </RequirePermission>

      <CostLayerDrawer
        layer={layerOpen}
        item={workspace.item}
        batchName={workspace.batchName}
        revisions={workspace.revisions}
        unitSymbol={workspace.itemSnapshot.data?.data?.[0]?.unit_symbol ?? null}
        onClose={() => setLayerOpen(null)}
        onCreateRevision={(row) => {
          setLayerOpen(null)
          openRevision(row)
        }}
        onRecalculate={
          canRecalculate
            ? (row) => {
                setLayerOpen(null)
                openRecalc(row.received_at?.slice(0, 10) ?? null)
              }
            : null
        }
      />

      <RecalculateValuationModal
        open={recalcOpen}
        onClose={() => setRecalcOpen(false)}
        itemId={itemId}
        itemName={workspace.item?.item_name ?? null}
        defaultFromDate={recalcFrom}
        onDone={workspace.reload}
      />

      <ValuationRevisionDrawer
        open={revisionOpen}
        onClose={() => setRevisionOpen(false)}
        layer={revisionFor}
        item={workspace.item}
        itemId={itemId}
        onDone={workspace.reload}
      />

      <ValuationExceptionDrawer
        open={reviewOpen}
        onClose={() => setReviewOpen(false)}
        exceptions={workspace.exceptions}
        insights={workspace.insights}
        loading={workspace.analysisLoading}
        itemName={workspace.item?.item_name ?? null}
        capped={workspace.layersCapped}
        analysisCount={workspace.analysisRows.length}
        analysisTotal={workspace.analysisTotal}
      />
    </PageShell>
  )
}

/*
 * The sheet's summary carries TEXT, and it has to read exactly as the screen
 * does — a printed card saying 1200 where the panel says 1,200 is the same
 * figure written two ways on one desk.
 */
function formatQtyText(value: number): string {
  return new Intl.NumberFormat('en-IN', { maximumFractionDigits: 4 }).format(value)
}

function formatMoneyText(value: number): string {
  return new Intl.NumberFormat('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(
    value,
  )
}

export default CostLayersPage
