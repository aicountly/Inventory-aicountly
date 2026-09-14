import type { ReactNode } from 'react'
import type { SummaryItem } from '../components/SummaryStrip'
import type { CellFormat } from '../registers/registerCells'
import type { ListQuery, SortOrder } from '../services/api'
import type { ReportResponse } from '../services/reportsApi'
import type { SmartColumn } from '../ui/shell/SmartTable'
import type { CsvValue } from '../utils/csv'

export type FilterKind =
  | 'item'
  | 'warehouse'
  | 'item_group'
  | 'stock_category'
  | 'date'
  /** Preset dropdown + From/To, backed by registers/dateRangePresets. */
  | 'date_range'
  /** Select of every document type the company has, loaded once and cached. */
  | 'document_type'
  | 'select'
  | 'number'
  | 'toggle'
  | 'text'

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
  /**
   * `date_range` only: the second query key. The filter writes `key` as the
   * period start and `toKey` as the end, so the URL keeps the two plain dates
   * the API already understands and an old bookmark still resolves.
   */
  toKey?: string
  /** `date_range` only: default for `toKey` when the URL has none. */
  defaultToValue?: (ctx: FilterContext) => string
  /** Hide the field but keep it in the URL (drill-through targets). */
  hidden?: boolean
  /** Width hint for the filter bar: text and item pickers want room. */
  grow?: boolean
}

/**
 * A register column.
 *
 * Extends the shared `SmartColumn` (sticky header, sortable header, alignment,
 * column-configurator metadata) and adds the export bits Inventory already had.
 * `csv` is re-declared because the app-wide `CsvValue` also allows `boolean`,
 * which several configs return.
 */
export interface ReportColumn<T> extends Omit<SmartColumn<T>, 'csv'> {
  /** CSV / print cell; defaults to the raw field named by `key`. */
  csv?: (row: T) => CsvValue
  csvHeader?: string
  /** How print formats the cell. Set for you by the shared column builders. */
  format?: CellFormat
}

export interface ReportConfig<T, S> {
  /** Permission slug (`reports.<slug>.read`) unless `permission` overrides it. */
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
