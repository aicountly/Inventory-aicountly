import type { ReactNode } from 'react'
import type { Column } from '../components/DataTable'
import type { SummaryItem } from '../components/SummaryStrip'
import type { ListQuery, SortOrder } from '../services/api'
import type { ReportResponse } from '../services/reportsApi'
import type { CsvValue } from '../utils/csv'

export type FilterKind = 'item' | 'warehouse' | 'item_group' | 'stock_category' | 'date' | 'select' | 'number' | 'toggle' | 'text'

export interface FilterOption {
  value: string
  label: string
}

/** Values a default can be derived from (financial year range, today). */
export interface FilterContext {
  fyFrom: string
  fyTo: string
  today: string
}

export interface ReportFilter {
  /** Query-string key — the same name the API reads. */
  key: string
  kind: FilterKind
  label: string
  options?: FilterOption[]
  placeholder?: string
  /** Toggles: state when the URL has no value. */
  defaultOn?: boolean
  /** Dates / numbers / selects: value when the URL has none. */
  defaultValue?: (ctx: FilterContext) => string
}

export interface ReportColumn<T> extends Column<T> {
  /** CSV cell; defaults to the raw field named by `key`. */
  csv?: (row: T) => CsvValue
  csvHeader?: string
}

export interface ReportConfig<T, S> {
  /** Permission slug (`reports.<slug>.read`). */
  slug: string
  /** URL segment and API path (`/reports/<path>`). */
  path: string
  title: string
  description: string
  defaultSort: string
  defaultOrder?: SortOrder
  filters: ReportFilter[]
  columns: ReportColumn<T>[]
  rowKey: (row: T) => string | number
  summary: (summary: S, response: ReportResponse<T, S>) => SummaryItem[]
  /** Extra block under the summary (age buckets, class breakdown, per-warehouse totals). */
  extra?: (summary: S) => ReactNode
  rowClassName?: (row: T) => string | undefined
  /** Map the resolved filter values to the API query; identity by default. */
  toQuery?: (values: Record<string, string>) => ListQuery
  emptyMessage?: string
}
