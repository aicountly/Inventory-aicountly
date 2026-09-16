import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { FileSearch, ListFilter } from 'lucide-react'
import { useAccess } from '../access/AccessContext'
import { useCompany } from '../company/CompanyContext'
import { useScopeLabel } from '../company/useScopeLabel'
import { RequirePermission } from '../components/RequirePermission'
import { Columns3 } from 'lucide-react'
import { ConfigureColumns } from '../registers/ConfigureColumns'
import {
  RegisterInsightStrip,
  RegisterInsightStripSkeleton,
} from '../registers/RegisterInsightStrip'
import { RegisterFilterBar } from '../registers/RegisterFilterBar'
import { RegisterFilterPanel } from '../registers/RegisterFilterPanel'
import { RegisterKpis, RegisterKpisSkeleton, summaryItemsToCards } from '../registers/RegisterKpis'
import { describeDateRange } from '../registers/dateRangePresets'
import { totalsLabel as registerTotalsLabel, totalsRowToText } from '../registers/registerTotals'
import { useColumnConfig } from '../registers/useColumnConfig'
import {
  registerColumnPrefsKey,
  registerPermission,
} from '../registers/RegisterConfig'
import type { RegisterConfig, StatCardSpec } from '../registers/RegisterConfig'
import type { ReportColumn } from './types'
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
import type { SmartTableError } from '../ui/shell/SmartTable'
import {
  METRIC_CARD_GRID,
  REGISTER_KPI_GRID,
  REPORT_TABLE_PROPS,
  TABLE_ROW_SELECTED,
} from '../styles/designTokens'
import { Button } from '../ui/Button'
import { LiveDataBadge } from '../ui/shell/LiveDataBadge'
import { isApiError } from '../services/api'
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

  const scopePeriodFor = config.scopePeriodFor
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

  // A filter that widens the scope has to be able to say so: the scope line is
  // stamped on every export and printed sheet, and is the only record there of
  // what was actually asked for.
  const scopeLabel = useScopeLabel(scopePeriodFor?.(values) ?? config.scopePeriod)

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
    (
      query: ListQuery,
      signal?: AbortSignal,
      purpose: 'page' | 'export' = 'page',
    ): Promise<ReportResponse<T, S>> =>
      config.fetch
        ? config.fetch({ query, signal, purpose })
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

  // ---- the at-a-glance strip ----------------------------------------------
  // Derived from the response already in hand — never a second request, and
  // never a figure stated more widely than the register's own summary supports.
  const insights = useMemo(() => {
    if (!config.insights || !result.data || summary === undefined) return null
    return config.insights(summary, result.data)
  }, [config, result.data, summary])

  // ---- the analytics band --------------------------------------------------
  // Handed the server's summary and this page's rows under the same filters the
  // table was fetched with, so a chart can never answer a different question
  // from the register it sits on. Anything more it fetches itself.
  const analytics = config.analytics
  const analyticsBand = useMemo(() => {
    if (!analytics || summary === undefined) return null
    return analytics({ summary, rows, values, query: apiFilters, loading: result.loading })
  }, [analytics, summary, rows, values, apiFilters, result.loading])

  // The same Configure Columns dialog is offered from the toolbar and from over
  // the table, so the open flag lives here rather than inside either trigger.
  const [columnsOpen, setColumnsOpen] = useState(false)

  // ---- selection -----------------------------------------------------------
  // Held as id -> row so a reader can tick rows on page 1, page over to page 3
  // and still act on all of them: a bulk print that silently dropped whatever
  // scrolled off screen would print fewer documents than were asked for.
  const selectable = config.selectable
  const [selected, setSelected] = useState<Map<string | number, T>>(() => new Map())
  const selectedRows = useMemo(() => [...selected.values()], [selected])
  const clearSelection = useCallback(() => setSelected(new Map()), [])

  // A new question was asked, so the previous answer's rows are no longer what
  // the reader is looking at. Paging and sorting keep the ticks.
  const filterFingerprint = JSON.stringify(apiFilters)
  useEffect(() => {
    setSelected(new Map())
  }, [filterFingerprint])

  const selectableRows = useMemo(
    () => (selectable ? rows.filter((row) => !selectable.disabledReason?.(row)) : []),
    [selectable, rows],
  )
  const allOnPageSelected =
    selectableRows.length > 0 && selectableRows.every((row) => selected.has(selectable!.idOf(row)))
  const someOnPageSelected =
    !allOnPageSelected && selectableRows.some((row) => selected.has(selectable!.idOf(row)))

  const toggleRow = useCallback(
    (row: T) => {
      if (!selectable) return
      const id = selectable.idOf(row)
      setSelected((prev) => {
        const next = new Map(prev)
        if (next.has(id)) next.delete(id)
        else next.set(id, row)
        return next
      })
    },
    [selectable],
  )

  const togglePage = useCallback(() => {
    if (!selectable) return
    setSelected((prev) => {
      const next = new Map(prev)
      const everyone = selectableRows.every((row) => next.has(selectable.idOf(row)))
      for (const row of selectableRows) {
        if (everyone) next.delete(selectable.idOf(row))
        else next.set(selectable.idOf(row), row)
      }
      return next
    })
  }, [selectable, selectableRows])

  const selectColumn = useMemo<ReportColumn<T> | null>(() => {
    if (!selectable) return null
    const label = selectable.label ?? 'Select'
    return {
      key: '__select',
      align: 'center',
      width: '2.75rem',
      alwaysVisible: true,
      header: (
        <input
          type="checkbox"
          className="rounded border-gray-300 text-primary focus:ring-primary/30"
          aria-label={`${label} every row on this page`}
          checked={allOnPageSelected}
          ref={(el) => {
            if (el) el.indeterminate = someOnPageSelected
          }}
          disabled={selectableRows.length === 0}
          onChange={togglePage}
        />
      ),
      render: (row: T) => {
        const reason = selectable.disabledReason?.(row) ?? null
        return (
          <input
            type="checkbox"
            className="rounded border-gray-300 text-primary focus:ring-primary/30"
            aria-label={`${label} ${String(selectable.idOf(row))}`}
            checked={selected.has(selectable.idOf(row))}
            disabled={reason !== null}
            title={reason ?? undefined}
            onClick={(e) => e.stopPropagation()}
            onChange={() => toggleRow(row)}
          />
        )
      },
      // Chrome, not data: never in a CSV, a PDF or a printed sheet.
      csv: () => '',
    }
  }, [selectable, selected, selectableRows, allOnPageSelected, someOnPageSelected, togglePage, toggleRow])

  const actionsColumn = useMemo<ReportColumn<T> | null>(() => {
    const rowActions = config.rowActions
    if (!rowActions) return null
    return {
      key: '__actions',
      header: <span className="sr-only">Actions</span>,
      align: 'right',
      width: '3rem',
      alwaysVisible: true,
      render: (row: T) => rowActions(row),
      // Chrome, not data: never in a CSV, a PDF or a printed sheet.
      csv: () => '',
    }
  }, [config.rowActions])

  // The exports keep `visibleColumns`; only the table gains the checkbox and
  // the row menu.
  const tableColumns = useMemo(
    () =>
      [
        ...(selectColumn ? [selectColumn] : []),
        ...visibleColumns,
        ...(actionsColumn ? [actionsColumn] : []),
      ],
    [selectColumn, visibleColumns, actionsColumn],
  )

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
        // `export`: the pager is walking every page, so a register that asks
        // its endpoint for an aggregate over the whole filtered set skips it
        // here rather than re-running it once per page.
        fetchPage(
          { ...apiFilters, sort: state.sort, order: state.order, page, limit },
          undefined,
          'export',
        ),
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
  const identity = useExportIdentity(scopePeriodFor?.(values) ?? config.scopePeriod)

  // Label for the printed totals row when the register's own totals map leaves
  // the label cell blank.
  const totalsLabel = useMemo(
    () => registerTotalsLabel(result.data?.meta.total, config.rowNoun ?? 'row', config.rowNounPlural),
    [result.data?.meta.total, config.rowNoun, config.rowNounPlural],
  )

  // ---- render --------------------------------------------------------------
  /**
   * A ticked row looks ticked.
   *
   * The checkbox is 14 pixels at the far left of a table a thousand pixels
   * wide; on a register where the reader ticks four rows out of fifty and then
   * presses "Print 4 documents", the only way to check the batch before it goes
   * to paper is to run an eye down that column. The row carries the state too.
   */
  const rowClassName = useMemo(() => {
    const declared = config.rowClassName
    if (!selectable) return declared ? (row: T) => declared(row) : undefined
    return (row: T) => {
      const parts = [declared?.(row)]
      if (selected.has(selectable.idOf(row))) parts.push(TABLE_ROW_SELECTED)
      const cls = parts.filter(Boolean).join(' ')
      return cls || undefined
    }
  }, [config.rowClassName, selectable, selected])

  /**
   * How many filters the reader has actually set.
   *
   * Counted over the URL rather than the resolved values, because a declared
   * default is the register's own choice and not something the reader can be
   * asked to clear. A period counts once, not once per end.
   */
  const activeFilterCount = useMemo(() => {
    const set = new Set(
      Object.keys(state.filters).filter((k) => state.filters[k] && state.filters[k] !== '0'),
    )
    let n = 0
    for (const f of config.filters) {
      if (f.hidden) continue
      if (f.kind === 'date_range') {
        if (set.has(f.key) || set.has(f.toKey ?? 'to')) n += 1
        continue
      }
      if (set.has(f.key)) n += 1
    }
    return n
  }, [config.filters, state.filters])

  /**
   * What the reader is told when the fetch fails.
   *
   * An ApiError carries a message the server wrote for a person, so it is shown.
   * Anything else is a TypeError from the network stack or a bug in our own
   * code, and its text is an implementation detail — the reader gets the
   * guidance and the Retry, not the internals. The filters are still in the URL
   * either way, which is worth saying: the common fear on a failed register is
   * having to set six controls again.
   */
  const tableError = useMemo<SmartTableError>(() => {
    if (!result.error) return null
    const noun = (config.rowNounPlural ?? `${config.rowNoun ?? 'row'}s`).toLowerCase()
    return {
      title: `Unable to load ${noun}`,
      description: isApiError(result.error)
        ? `${result.error.message} Your filters have been preserved.`
        : 'Please try again. Your filters have been preserved.',
      onRetry: result.reload,
    }
  }, [result.error, result.reload, config.rowNoun, config.rowNounPlural])

  const panel = config.layout === 'panel' || config.filterPanel !== undefined

  const breadcrumbs = useMemo(() => {
    const trail =
      config.breadcrumbs ?? [{ label: 'Registers', to: '/registers' }, { label: config.title }]
    // The page header prints the title as an <h1>. A trail of one unlinked crumb
    // is that same title again, in smaller type, directly above it.
    if (panel && trail.length === 1 && !trail[0].to) return undefined
    return trail
  }, [config.breadcrumbs, config.title, panel])

  const headerActions = (
    <>
      {config.headerActions}
      <ConfigureColumns
        columns={config.columns}
        visibility={visibility}
        onChange={setVisibility}
        // The choice is stored against the member uuid, so one taken before
        // /v1/access/me answers has nowhere to be written and would be dropped
        // the moment the uuid arrives and the per-user key changes under it.
        disabled={!columnsReady}
        open={columnsOpen}
        onOpenChange={setColumnsOpen}
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

  const groupByControl = config.groupBy?.length ? (
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

  // The header takes the lead line; `description` in full is what the export and
  // the printed sheet carry. Sentence-ended text is left as it is rather than
  // gaining a second full stop.
  const headerText = config.shortDescription ?? config.description
  const headerDescription = /[.!?]$/.test(headerText.trim()) ? headerText : `${headerText}.`

  return (
    <ReportListShell
      breadcrumbs={breadcrumbs}
      title={config.title}
      description={headerDescription}
      icon={config.icon ?? FileSearch}
      headerVariant={panel ? 'page' : 'compact'}
      // A chart band and a viewport-locked table cannot share one flex column:
      // the band takes its height and the table's `flex-1` resolves to nothing.
      fill={!analyticsBand}
      headerAside={
        config.headerAside ?? (
          <LiveDataBadge
            fetchedAt={result.fetchedAt}
            refreshing={result.loading}
            // A failed reload leaves the previous answer on screen. Saying so is
            // the difference between old figures and wrong ones.
            stale={Boolean(result.error) && result.data !== null}
          />
        )
      }
      headerActions={headerActions}
      searchInputRef={searchInputRef}
      onRefresh={result.reload}
      onPrint={runPrint}
      backTo={config.backTo === undefined ? '/registers' : (config.backTo ?? undefined)}
      scope={panel ? undefined : scopeLabel}
      bareFilters={panel}
      // Four wide cards is main's metric strip; a register that declares five
      // takes the auto-fit grid instead, which sizes the track to the count
      // rather than wrapping the fifth onto a row of its own.
      summaryClassName={panel ? (kpiCards.length === 4 ? METRIC_CARD_GRID : REGISTER_KPI_GRID) : undefined}
      filters={
        panel ? (
          <RegisterFilterPanel
            spec={config.filterPanel ?? {}}
            filters={config.filters}
            values={values}
            onChange={params.setFilter}
            // Both ends of a period in one navigation — see useListParams.setFilters.
            onChangeMany={params.setFilters}
            onReset={params.reset}
            activeCount={activeFilterCount}
            onApply={result.reload}
            applying={result.loading}
            ctx={ctx}
            searchInputRef={searchInputRef}
            scope={scopeLabel}
          />
        ) : (
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
            trailing={groupByControl}
          />
        )
      }
      toolbar={
        selectable && selectedRows.length ? (
          <div className="flex flex-wrap items-center gap-2 rounded-lg border border-primary/30 bg-primary-light/40 px-3 py-2 text-xs">
            <span className="font-semibold text-gray-800">
              {selectedRows.length} selected
            </span>
            {summary !== undefined ? selectable.actions(selectedRows, clearSelection, summary) : null}
            <button
              type="button"
              className="ml-auto rounded-full bg-white px-2 py-1 text-gray-600 hover:text-red-600"
              onClick={clearSelection}
            >
              Clear selection
            </button>
          </div>
        ) : panel && groupByControl ? (
          // The panel has no trailing slot, so the grouping control — a view of
          // the rows rather than a filter — sits on its own row above the table.
          <div className="flex flex-wrap items-center justify-end gap-2">{groupByControl}</div>
        ) : undefined
      }
      summary={
        // First load only. A refresh keeps the figures and dims them instead of
        // replacing a number the reader is looking at with a grey bar.
        result.loading && !result.data ? (
          <RegisterKpisSkeleton count={config.kpis ? 5 : 4} layout={panel ? 'metric' : 'stacked'} />
        ) : kpiCards.length ? (
          <RegisterKpis cards={kpiCards} layout={panel ? 'metric' : 'stacked'} />
        ) : undefined
      }
      insights={
        config.insights || analyticsBand ? (
          <>
            {config.insights ? (
              result.loading && !result.data ? (
                <RegisterInsightStripSkeleton />
              ) : insights && insights.items.length ? (
                <RegisterInsightStrip items={insights.items} note={insights.note} />
              ) : null
            ) : null}
            {/* Under the strip: the strip says what the rows are, the band shows
                the shape of the set they came from. */}
            {analyticsBand}
          </>
        ) : undefined
      }
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
            fillAvailable={!analyticsBand}
            className={analyticsBand ? 'max-h-[min(34rem,58vh)]' : undefined}
            columns={tableColumns}
            rows={tableRows}
            rowKey={config.rowKey}
            rowGroup={grouping ? (row) => grouping.of(row) : undefined}
            groupSubtotal={grouping?.subtotal}
            loading={result.loading}
            error={tableError}
            title={config.tableTitle ?? config.title}
            description={config.tableHint}
            headerAction={
              <div className="flex flex-wrap items-center gap-2">
                {config.tableActions}
                {/* The same dialog the toolbar's Columns button opens — one
                    flag, two doors, so the choice cannot be made twice over
                    itself. */}
                <Button
                  variant="secondary"
                  size="xs"
                  icon={Columns3}
                  onClick={() => setColumnsOpen(true)}
                  disabled={!columnsReady}
                >
                  Customize columns
                </Button>
              </div>
            }
            // The shell locks the page to the viewport at `taller:` in the panel
            // layout and at `tall:` otherwise; the table has to fill against the
            // same breakpoint or it fills a parent that never got a height.
            fillAt={panel ? 'taller' : 'tall'}
            sort={{ key: state.sort, order: state.order }}
            onSort={params.toggleSort}
            onRowActivate={onRowActivate}
            isRowActivatable={isRowActivatable}
            keyboardResetKey={[state.page, state.sort, state.order, columnsKey, groupKey]}
            searchInputRef={searchInputRef}
            rowClassName={rowClassName}
            totals={totals}
            minWidth={config.minWidth ?? 1100}
            empty={
              activeFilterCount === 0 && config.emptyUnfiltered ? (
                config.emptyUnfiltered
              ) : (
                <EmptyState
                  title="No rows match these filters"
                  description={
                    config.emptyMessage ?? 'Widen the period or clear a filter and try again.'
                  }
                  // The way out of an over-filtered register, where the reader
                  // is already looking. Offered only when there is something to
                  // clear — a button that does nothing is worse than no button.
                  action={activeFilterCount > 0 ? 'Clear filters' : undefined}
                  onAction={params.reset}
                />
              )
            }
            footer={
              <ServerTablePagination
                meta={result.data?.meta ?? null}
                limit={state.limit}
                onPage={params.setPage}
                onLimit={params.setLimit}
                // A register is read by jumping — "the negative rows are near
                // the end" — so it takes the numbered pager rather than a
                // counter and four arrows.
                numbered
              />
            }
          />
        )}
      </RequirePermission>
    </ReportListShell>
  )
}

export default ReportPage
