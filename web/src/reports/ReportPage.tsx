import { useCallback, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { FileSearch, ListFilter } from 'lucide-react'
import { useAccess } from '../access/AccessContext'
import { useCompany } from '../company/CompanyContext'
import { useScopeLabel } from '../company/useScopeLabel'
import { RequirePermission } from '../components/RequirePermission'
import { ConfigureColumns } from '../registers/ConfigureColumns'
import { RegisterFilterBar } from '../registers/RegisterFilterBar'
import { RegisterKpis, summaryItemsToCards } from '../registers/RegisterKpis'
import { describeDateRange } from '../registers/dateRangePresets'
import { totalsLabel as registerTotalsLabel, totalsRowToText } from '../registers/registerTotals'
import { useColumnConfig } from '../registers/useColumnConfig'
import {
  registerColumnPrefsKey,
  registerPermission,
} from '../registers/RegisterConfig'
import type { RegisterConfig, StatCardSpec } from '../registers/RegisterConfig'
import { useListParams } from '../hooks/useListParams'
import { useQuery } from '../hooks/useQuery'
import type { ListQuery } from '../services/api'
import { fetchAllRows } from '../services/listAll'
import { fetchReport } from '../services/reportsApi'
import type { ReportResponse } from '../services/reportsApi'
import { EmptyState } from '../ui/EmptyState'
import { FilterField } from '../ui/shell/FilterBar'
import { Select } from '../ui/Select'
import { ExportActions } from '../export/ExportActions'
import type { SheetSummaryCard } from '../export/sheetHtml'
import { slugifyExportFilename } from '../export/exportActions'
import { useExportIdentity } from '../export/useExportIdentity'
import { ReportListShell } from '../ui/shell/ReportListShell'
import { ServerTablePagination } from '../ui/shell/TablePagination'
import { SmartTable } from '../ui/shell/SmartTable'
import { REPORT_TABLE_PROPS } from '../styles/designTokens'
import type { IconTone } from '../ui/IconTile'
import { todayIso } from '../utils/format'
import { filterUrlKeys, resolveFilterValues } from './helpers'
import type { FilterContext } from './types'

/**
 * The emphasis a KPI carries, in the vocabulary the sheet understands.
 *
 * A Negative stock or Expiry register puts its one alarming figure in red, and
 * that is the figure the reader is meant to find. Dropping the tone on the way
 * to paper prints it in the same black as everything else.
 */
const SHEET_TONE: Partial<Record<IconTone, SheetSummaryCard['tone']>> = {
  danger: 'credit',
  rose: 'credit',
  warning: 'warn',
}

function toSheetCards(cards: readonly StatCardSpec[]): SheetSummaryCard[] {
  return cards
    .filter((card) => typeof card.value === 'string' || typeof card.value === 'number')
    .map((card) => ({
      label: card.label,
      value: String(card.value),
      hint: typeof card.hint === 'string' ? card.hint : undefined,
      tone: (card.tone && SHEET_TONE[card.tone]) || undefined,
    }))
}

/**
 * The register engine.
 *
 * One screen for every declarative `RegisterConfig`, whether it sits on a
 * `/v1/reports/*` endpoint or on any other list endpoint through the config's
 * own `fetch`. It gives every register the same things a Books register has:
 *
 *  - a pinned header, a pinned filter row and a table that fills the viewport;
 *  - date-range presets instead of two bare date boxes;
 *  - clickable KPI cards over the table;
 *  - a sticky header and a pinned totals row taken from the *server's* summary,
 *    so the figure under a 25-row page is the total of every matching row;
 *  - per-user column configuration that the CSV and the print sheet follow;
 *  - drill-through on click and Enter, with `/`, Ctrl+R, Ctrl+P and Esc;
 *  - server pagination that holds up on real volumes.
 *
 * Because `RegisterConfig` only adds optional members to `ReportConfig`, the
 * eight reports that already exist are valid registers and all of them upgrade
 * through this one file.
 */
export function ReportPage<T, S>({ config }: { config: RegisterConfig<T, S> }) {
  const { scope, fyRange, companyName } = useCompany()
  const { can } = useAccess()
  const navigate = useNavigate()
  const searchInputRef = useRef<HTMLInputElement | null>(null)

  const scopeLabel = useScopeLabel()
  // Filled by ExportActions so Ctrl+P prints the letterheaded sheet rather than
  // whatever slice of the app DOM happens to be on screen.
  const printRef = useRef<(() => void) | null>(null)
  const runPrint = useCallback(() => printRef.current?.(), [])

  const permission = useMemo(() => registerPermission(config), [config])
  const allowed = can(permission)

  const filterKeys = useMemo(() => filterUrlKeys(config.filters), [config.filters])
  const params = useListParams({
    sort: config.defaultSort,
    order: config.defaultOrder,
    limit: config.defaultLimit ?? 100,
    filterKeys,
  })
  const { state } = params

  const ctx = useMemo<FilterContext>(
    () => ({ fyFrom: fyRange.from, fyTo: fyRange.to, today: todayIso() }),
    [fyRange.from, fyRange.to],
  )
  const values = useMemo(
    () => resolveFilterValues(config.filters, state.filters, ctx),
    [config.filters, state.filters, ctx],
  )

  // Some registers are meaningless without a filter — a stock ledger is one
  // item's ledger, and "every item ever" is not a smaller version of it.
  const missingRequired = useMemo(
    () => (config.requireFilters ?? []).filter((key) => !values[key]),
    [config.requireFilters, values],
  )

  const apiFilters = useMemo<ListQuery>(
    () => (config.toQuery ? config.toQuery(values) : { ...values }),
    [config, values],
  )

  const fetchPage = useCallback(
    (query: ListQuery, signal?: AbortSignal): Promise<ReportResponse<T, S>> =>
      config.fetch
        ? config.fetch({ query, signal })
        : fetchReport<T, S>(config.path, query, signal),
    [config],
  )

  const apiQuery = useMemo<ListQuery>(
    () => ({
      ...apiFilters,
      page: state.page,
      limit: state.limit,
      sort: state.sort,
      order: state.order,
    }),
    [apiFilters, state.page, state.limit, state.sort, state.order],
  )

  const result = useQuery(
    (signal) => fetchPage(apiQuery, signal),
    [config.path, JSON.stringify(apiQuery), scope?.cmp_id, scope?.fy_id, scope?.bo_id],
    { enabled: scope !== null && allowed && missingRequired.length === 0 },
  )

  const rows = useMemo(() => result.data?.data ?? [], [result.data])

  // ---- grouping ------------------------------------------------------------
  // A view of the rows on screen, not a second query: the reader picks it, the
  // page keeps it, and nothing about the request changes. Kept out of the URL
  // for that reason — it is not part of the question the server was asked.
  const [groupKey, setGroupKey] = useState('')
  const grouping = useMemo(
    () => config.groupBy?.find((g) => g.key === groupKey) ?? null,
    [config.groupBy, groupKey],
  )

  // Group rows have to be adjacent to be a group. Sorting here, rather than in
  // the table, keeps the reader's sort column intact inside each group.
  const tableRows = useMemo(() => {
    if (!grouping) return rows
    const order = new Map<string, number>()
    for (const row of rows) {
      const g = grouping.of(row)
      if (!order.has(g.key)) order.set(g.key, order.size)
    }
    return [...rows].sort(
      (a, b) => (order.get(grouping.of(a).key) ?? 0) - (order.get(grouping.of(b).key) ?? 0),
    )
  }, [rows, grouping])
  const summary = result.data?.summary

  // ---- columns -------------------------------------------------------------
  const prefsKey = registerColumnPrefsKey(config)
  const {
    visibility,
    setVisibility,
    visibleColumns,
    columnsKey,
    ready: columnsReady,
  } = useColumnConfig(prefsKey, config.columns)

  // ---- KPI cards -----------------------------------------------------------
  const kpiCards = useMemo(() => {
    if (!result.data || summary === undefined) return []
    if (config.kpis) return config.kpis(summary, result.data)
    return summaryItemsToCards(config.summary(summary, result.data))
  }, [config, result.data, summary])

  // ---- totals --------------------------------------------------------------
  const totals = useMemo(() => {
    if (!config.totals || summary === undefined) return undefined
    return config.totals(summary, rows)
  }, [config, summary, rows])

  // ---- drill-through -------------------------------------------------------
  const drillTo = config.drillTo
  const onRowActivate = useMemo(
    () =>
      drillTo
        ? (row: T) => {
            const target = drillTo(row)
            if (target) navigate(target)
          }
        : undefined,
    [drillTo, navigate],
  )
  const isRowActivatable = useMemo(
    () => (drillTo ? (row: T) => drillTo(row) !== null : undefined),
    [drillTo],
  )

  // ---- export / print ------------------------------------------------------
  const fetchAll = useCallback(
    () =>
      fetchAllRows<T>((page, limit) =>
        fetchPage({ ...apiFilters, sort: state.sort, order: state.order, page, limit }),
      ),
    [fetchPage, apiFilters, state.sort, state.order],
  )

  const periodLine = useMemo(() => {
    const range = config.filters.find((f) => f.kind === 'date_range')
    if (range) return `Period: ${describeDateRange(values[range.key] ?? '', values[range.toKey ?? 'to'] ?? '')}`
    if (values.from || values.to) return `Period: ${describeDateRange(values.from ?? '', values.to ?? '')}`
    if (values.as_of) return `As at: ${values.as_of}`
    if (values.to) return `As at: ${values.to}`
    return ''
  }, [config.filters, values])

  const filterLine = useMemo(() => {
    const parts = config.filters
      .filter((f) => f.kind !== 'date_range' && f.kind !== 'date')
      .map((f) => {
        const v = values[f.key]
        if (!v || (f.kind === 'toggle' && v === '0')) return ''
        return `${f.label}: ${f.kind === 'toggle' ? 'yes' : v}`
      })
      .filter(Boolean)
    return parts.length ? `Filters — ${parts.join(' · ')}` : ''
  }, [config.filters, values])

  const printTotals = useMemo(
    () => totalsRowToText(visibleColumns, totals),
    [visibleColumns, totals],
  )

  // Registers whose figures are the served page have to re-total whatever the
  // export walked, or the sheet carries every row under a footer that speaks
  // for one page — and still labels it "this page only".
  const summaryForRows = config.summaryForRows
  const forExportedRows = useCallback(
    (all: readonly T[]) => {
      if (!summaryForRows || summary === undefined || !result.data) return {}
      const rescoped = summaryForRows(summary, all)
      const response: ReportResponse<T, S> = { ...result.data, data: [...all], summary: rescoped }
      const cards = config.kpis
        ? config.kpis(rescoped, response)
        : summaryItemsToCards(config.summary(rescoped, response))
      return {
        summaryCards: toSheetCards(cards),
        totalsText: config.totals ? totalsRowToText(visibleColumns, config.totals(rescoped, all)) : null,
      }
    },
    [summaryForRows, summary, config, result.data, visibleColumns],
  )

  const printSummaryCards = useMemo(() => toSheetCards(kpiCards), [kpiCards])

  const filenameBase = config.filenameBase ?? config.slug

  // Company, scope, registered office, GSTIN and logo — the letterhead every
  // export and every printed sheet carries.
  const identity = useExportIdentity()

  // Label for the printed totals row when the register's own totals map leaves
  // the label cell blank.
  const totalsLabel = useMemo(
    () => registerTotalsLabel(result.data?.meta.total, config.rowNoun ?? 'row', config.rowNounPlural),
    [result.data?.meta.total, config.rowNoun, config.rowNounPlural],
  )

  // ---- render --------------------------------------------------------------
  const breadcrumbs = useMemo(
    () => [{ label: 'Registers', to: '/registers' }, { label: config.title }],
    [config.title],
  )

  const headerActions = (
    <>
      <ConfigureColumns
        columns={config.columns}
        visibility={visibility}
        onChange={setVisibility}
        // The choice is stored against the member uuid, so one taken before
        // /v1/access/me answers has nowhere to be written and would be dropped
        // the moment the uuid arrives and the per-user key changes under it.
        disabled={!columnsReady}
      />
      <ExportActions
        columns={visibleColumns}
        rows={rows}
        fetchAll={fetchAll}
        filename={slugifyExportFilename([filenameBase, companyName, todayIso()])}
        identity={identity}
        title={config.title}
        description={config.description}
        metaLines={[periodLine, filterLine].filter(Boolean)}
        summaryCards={printSummaryCards}
        totalsText={printTotals}
        totalsLabel={totalsLabel}
        forExportedRows={summaryForRows ? forExportedRows : undefined}
        orientation={config.printOrientation ?? 'landscape'}
        printRef={printRef}
        onRefresh={result.reload}
        refreshing={result.loading}
        disabled={!result.data || result.data.meta.total === 0}
      />
    </>
  )

  return (
    <ReportListShell
      breadcrumbs={breadcrumbs}
      title={config.title}
      description={`${config.description}.`}
      icon={config.icon ?? FileSearch}
      headerActions={headerActions}
      searchInputRef={searchInputRef}
      onRefresh={result.reload}
      onPrint={runPrint}
      backTo="/registers"
      scope={scopeLabel}
      filters={
        <RegisterFilterBar
          filters={config.filters}
          values={values}
          onChange={params.setFilter}
          // Both ends of a period in one navigation — see useListParams.setFilters.
          onChangeMany={params.setFilters}
          onReset={params.reset}
          showReset={Object.keys(state.filters).length > 0}
          ctx={ctx}
          searchInputRef={searchInputRef}
          trailing={
            config.groupBy?.length ? (
              <FilterField label="Group by">
                <Select
                  value={groupKey}
                  onChange={(e) => setGroupKey(e.target.value)}
                  aria-label="Group by"
                  className="w-auto min-w-[9rem]"
                >
                  <option value="">No grouping</option>
                  {config.groupBy.map((g) => (
                    <option key={g.key} value={g.key}>
                      {g.label}
                    </option>
                  ))}
                </Select>
              </FilterField>
            ) : undefined
          }
        />
      }
      summary={kpiCards.length ? <RegisterKpis cards={kpiCards} /> : undefined}
    >
      <RequirePermission permission={permission} what={config.title}>
        {config.extra && summary !== undefined ? (
          <div className="shrink-0">{config.extra(summary)}</div>
        ) : null}

        {missingRequired.length ? (
          <EmptyState
            icon={ListFilter}
            title={config.requireFiltersMessage ?? 'Choose a filter to run this register'}
            description={`Waiting for: ${missingRequired.join(', ')}.`}
          />
        ) : (
          <SmartTable
            {...REPORT_TABLE_PROPS}
            columns={visibleColumns}
            rows={tableRows}
            rowKey={config.rowKey}
            rowGroup={grouping ? (row) => grouping.of(row) : undefined}
            groupSubtotal={grouping?.subtotal}
            loading={result.loading}
            error={result.error}
            sort={{ key: state.sort, order: state.order }}
            onSort={params.toggleSort}
            onRowActivate={onRowActivate}
            isRowActivatable={isRowActivatable}
            keyboardResetKey={[state.page, state.sort, state.order, columnsKey, groupKey]}
            searchInputRef={searchInputRef}
            rowClassName={config.rowClassName ? (row) => config.rowClassName?.(row) : undefined}
            totals={totals}
            minWidth={config.minWidth ?? 1100}
            empty={
              <EmptyState
                title="No rows match these filters"
                description={config.emptyMessage ?? 'Widen the period or clear a filter and try again.'}
              />
            }
            footer={
              <ServerTablePagination
                meta={result.data?.meta ?? null}
                limit={state.limit}
                onPage={params.setPage}
                onLimit={params.setLimit}
              />
            }
          />
        )}
      </RequirePermission>
    </ReportListShell>
  )
}

export default ReportPage
