import { useCallback, useMemo } from 'react'
import { useCompany } from '../company/CompanyContext'
import { useScopeLabel } from '../company/useScopeLabel'
import { useCan } from '../access/AccessContext'
import { DataTable } from '../components/DataTable'
import { ExportCsvButton } from '../components/ExportCsvButton'
import { PageHeader } from '../components/PageHeader'
import { Pagination } from '../components/Pagination'
import { RequirePermission } from '../components/RequirePermission'
import { SummaryStrip } from '../components/SummaryStrip'
import { useListParams } from '../hooks/useListParams'
import { useQuery } from '../hooks/useQuery'
import { P } from '../services/access'
import type { ListQuery } from '../services/api'
import { fetchAllRows } from '../services/listAll'
import { fetchReport } from '../services/reportsApi'
import { csvFilename } from '../utils/csv'
import { todayIso } from '../utils/format'
import { ReportFilters } from './ReportFilters'
import { csvColumnsFromTable, resolveFilterValues } from './helpers'
import type { FilterContext, ReportConfig } from './types'

/** One screen for every `/reports/*` endpoint, driven by a ReportConfig. */
export function ReportPage<T, S>({ config }: { config: ReportConfig<T, S> }) {
  const { scope, fyRange, companyName } = useCompany()
  const scopeLabel = useScopeLabel()
  const allowed = useCan(P.report(config.slug))
  const filterKeys = useMemo(() => config.filters.map((f) => f.key), [config.filters])
  const params = useListParams({ sort: config.defaultSort, order: config.defaultOrder, limit: 100, filterKeys })
  const { state } = params

  const ctx = useMemo<FilterContext>(() => ({ fyFrom: fyRange.from, fyTo: fyRange.to, today: todayIso() }), [fyRange.from, fyRange.to])
  const values = useMemo(() => resolveFilterValues(config.filters, state.filters, ctx), [config.filters, state.filters, ctx])
  const apiFilters = useMemo<ListQuery>(() => (config.toQuery ? config.toQuery(values) : { ...values }), [config, values])
  const apiQuery = useMemo<ListQuery>(() => ({ ...apiFilters, page: state.page, limit: state.limit, sort: state.sort, order: state.order }), [apiFilters, state.page, state.limit, state.sort, state.order])

  const result = useQuery((signal) => fetchReport<T, S>(config.path, apiQuery, signal), [config.path, JSON.stringify(apiQuery), scope?.cmp_id, scope?.fy_id, scope?.bo_id], { enabled: scope !== null && allowed })
  const rows = result.data?.data ?? []
  const csvColumns = useMemo(() => csvColumnsFromTable(config.columns), [config.columns])
  const fetchAll = useCallback(() => fetchAllRows<T>((page, limit) => fetchReport<T, S>(config.path, { ...apiFilters, sort: state.sort, order: state.order, page, limit })), [config.path, apiFilters, state.sort, state.order])
  const summaryItems = result.data ? config.summary(result.data.summary, result.data) : []

  return (
    <div className="page">
      <PageHeader
        title={config.title}
        subtitle={`${config.description} ${scopeLabel}.`}
        actions={
          <>
            <ExportCsvButton filename={csvFilename(config.title, companyName)} columns={csvColumns} rows={rows} fetchAll={fetchAll} disabled={!result.data || result.data.meta.total === 0} />
            <button type="button" className="btn btn-sm" onClick={result.reload} disabled={result.loading}>
              {result.loading ? 'Loading…' : 'Refresh'}
            </button>
          </>
        }
      />
      <RequirePermission permission={P.report(config.slug)} what={config.title}>
        <ReportFilters filters={config.filters} values={values} onChange={params.setFilter} onReset={params.reset} showReset={Object.keys(state.filters).length > 0} />
        <SummaryStrip items={summaryItems} />
        {result.data && config.extra ? config.extra(result.data.summary) : null}
        <DataTable columns={config.columns} rows={rows} rowKey={config.rowKey} loading={result.loading} error={result.error} emptyMessage={config.emptyMessage ?? 'No rows match these filters.'} sort={{ key: state.sort, order: state.order }} onSort={params.toggleSort} rowClassName={config.rowClassName} />
        <Pagination meta={result.data?.meta ?? null} onPage={params.setPage} onLimit={params.setLimit} limit={state.limit} />
      </RequirePermission>
    </div>
  )
}
