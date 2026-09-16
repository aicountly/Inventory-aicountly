/**
 * A register is a report that can be read like a book: it has a period, a fixed
 * set of columns, totals that belong to the whole filtered set rather than the
 * page on screen, and a way to get from a line back to the document that caused
 * it. Books has had that for years; this is the same contract in TypeScript.
 *
 * `RegisterConfig` *extends* `ReportConfig` and adds nothing required, so every
 * existing config in `src/reports/configs/` is already a valid register and the
 * single engine in `src/reports/ReportPage.tsx` renders both. That is
 * deliberate: the eight reports gain the register treatment without being
 * rewritten, and a new register is declared, not coded.
 */

import type { ReactNode } from 'react'
import type { LucideIcon } from 'lucide-react'
import type { PermissionKey } from '../access/AccessContext'
import type { ListQuery, ListResponse } from '../services/api'
import type { ReportResponse } from '../services/reportsApi'
import type { ReportConfig } from '../reports/types'
import type { IconTone } from '../ui/IconTile'
import type { BadgeTone } from '../ui/Badge'
import type { RegisterInsightSet } from './RegisterInsightStrip'

export type { ReportConfig, ReportColumn, ReportFilter, FilterContext, FilterKind } from '../reports/types'

/** A KPI card above the table. Mirrors StatCardProps, minus the layout props. */
export interface StatCardSpec {
  key: string
  label: string
  value: ReactNode
  hint?: ReactNode
  icon?: LucideIcon
  tone?: IconTone
  badge?: { label: string; tone?: BadgeTone }
  /** Drill-down target, with the filter pre-applied. */
  to?: string
  /** Only for the red-when-negative case; never a fabricated comparison. */
  current?: number | null
  emphasizeNegative?: boolean
}

/** Sections of the registers hub. */
export type RegisterGroup = 'stock' | 'movement' | 'valuation' | 'compliance' | 'analysis'

/**
 * An in-table grouping a register offers.
 *
 * Grouping is a view of the rows on screen, so the subtotal is of those rows —
 * the pinned footer stays the authority on the whole filtered set. Say so in
 * the subtotal's own label rather than leaving a reader to assume otherwise.
 */
export interface RegisterGrouping<T> {
  /** URL-free identifier, unique within the register. */
  key: string
  /** What the "Group by" control calls it. */
  label: string
  /** Which group a row belongs to, and the heading that group gets. */
  of: (row: T) => { key: string; label: string }
  /** Subtotal cells for one group, keyed by column key (see buildTotalsRow). */
  subtotal?: (rows: readonly T[], group: { key: string; label: string }) => Record<string, ReactNode>
}

/**
 * Row selection, for the registers where a reader acts on a handful of rows.
 *
 * Declared rather than coded: the engine owns the checkbox column, the
 * "N selected" bar and the clearing, and the register only says how to
 * identify a row and what to offer once some are picked. Kept out of
 * `columns` on purpose — the checkbox is a control, not data, and a register
 * whose CSV carried an empty first column would be exporting its own chrome.
 */
export interface RegisterSelection<T, S> {
  /** Stable identity for a row, unique across pages. */
  idOf: (row: T) => string | number
  /** Column header text for screen readers. Defaults to "Select". */
  label?: string
  /** Why this row cannot be picked, or null when it can. */
  disabledReason?: (row: T) => string | null
  /**
   * Rendered in the toolbar while at least one row is selected.
   *
   * `summary` is the server's aggregate over the whole filtered set, so a
   * selection can say what share of it has been ticked — "62% of stock value"
   * is the reason to tick rows on a valuation register at all, and it cannot
   * be worked out from the selected rows alone.
   */
  actions: (selected: readonly T[], clear: () => void, summary: S) => ReactNode
}

export interface RegisterFetchArgs {
  query: ListQuery
  signal?: AbortSignal
  /**
   * Why the rows are being fetched.
   *
   * `page` is the screen; `export` is the pager walking every page for a CSV,
   * a sheet or a print. A register that asks its endpoint for an aggregate over
   * the whole filtered set wants it once, with the page — asking again on each
   * of seventeen export pages re-runs the same aggregate for figures the
   * caller already holds.
   */
  purpose?: 'page' | 'export'
}

/**
 * The filter *panel* arrangement: heading, quick period chips, a labelled grid
 * and an overflow popover.
 *
 * Declaring this is what opts a register out of the one-row toolbar. It changes
 * the arrangement only — the filters, their keys, their values and the moment
 * they apply are the `filters` array's business either way.
 */
export interface RegisterFilterPanelSpec {
  /** Card heading. Defaults to "Filters". */
  title?: string
  /** One line under the heading, naming what the filters are for. */
  description?: string
  /**
   * Period presets offered as chips, by id (see registers/dateRangePresets).
   * Only meaningful on a register that declares a `date_range` filter.
   */
  quickRanges?: readonly string[]
  /** What the "no period at all" chip is called here — "All documents". */
  allRangeLabel?: string
  /**
   * Filter keys that get a cell in the grid. Everything else declared moves
   * behind "More filters", which carries the count of those that are set.
   * Omit and every filter is in the grid.
   */
  primaryKeys?: readonly string[]
}

/** What an analytics band is handed. See `RegisterConfig.analytics`. */
export interface AnalyticsArgs<T, S> {
  /** The server's aggregate over the whole filtered set. */
  summary: S
  /** The rows on this page — never the basis of a figure about the whole set. */
  rows: readonly T[]
  /** Effective filter values, defaults resolved: what the register was asked. */
  values: Record<string, string>
  /** The filters as the API received them. */
  query: ListQuery
  /** True while the register itself is refetching. */
  loading: boolean
}

export interface RegisterConfig<T, S> extends ReportConfig<T, S> {
  /**
   * How the rows are fetched.
   *
   * Omit it and the engine calls `GET /v1/reports/<path>`, which is what the
   * eight existing reports want. Supply it and a register can sit on any list
   * endpoint — `/v1/stock-movements`, `/v1/valuation`, `/v1/reservations` —
   * without a bespoke page. This is the hinge that lets registers arriving from
   * Books land as configuration rather than as screens.
   */
  fetch?: (args: RegisterFetchArgs) => Promise<ReportResponse<T, S>>

  /** Permission to read this register. Defaults to `reports.<slug>.read`. */
  permission?: PermissionKey

  /**
   * Breadcrumb trail and the back target.
   *
   * A register mounted outside `/registers` — the documents register lives at
   * `/documents`, which is where Books hands off to — must not claim a trail
   * it did not come down. Defaults to Registers > title.
   */
  breadcrumbs?: readonly { label: string; to?: string }[]
  /** `null` = no back arrow at all (a top-level destination). */
  backTo?: string | null

  /**
   * Register-specific header controls, rendered before Configure columns and
   * the export menu — "New document" on the documents register, for instance.
   */
  headerActions?: ReactNode

  /**
   * How the screen is arranged.
   *
   * `toolbar` (the default) is the one-row filter bar and the compact
   * breadcrumb header every register has always had. `panel` is the wider
   * treatment: a page header with the title and its description, the filter
   * panel below it, and KPI cards laid out four to a row. It suits a register
   * with many filters that people work in all day rather than glance at.
   */
  layout?: 'toolbar' | 'panel'

  /** Panel arrangement for the filters. Implies `layout: 'panel'` is wanted. */
  filterPanel?: RegisterFilterPanelSpec

  /**
   * Decoration beside the title in `page` layout, rendered only at ≥1536px and
   * hidden from assistive technology. Nothing a reader needs belongs here.
   */
  headerAside?: ReactNode

  /**
   * The scope line's period, decided from the live filter values.
   *
   * `scopePeriod` is a constant, which is right for a register that is never
   * read inside the selected year. A register carrying a filter that WIDENS the
   * scope — "every financial year" — has to be able to say so, because the
   * scope line is stamped on the printed sheet and is the only record there of
   * what was asked for. Takes precedence over `scopePeriod` when it returns a
   * string; return undefined to fall back to it.
   */
  scopePeriodFor?: (values: Record<string, string>) => string | undefined

  /** Row selection and the bulk actions it enables. */
  selectable?: RegisterSelection<T, S>

  /**
   * A per-row control pinned to the right of the table — the "⋮" menu.
   *
   * Declared here rather than as a column for the same reason the checkbox is:
   * it is chrome, not data. A CSV whose last column was an empty string under
   * the header "" would be exporting the screen's furniture, and the column
   * configurator would offer to hide a menu.
   */
  rowActions?: (row: T) => ReactNode

  /**
   * What the scope line says about the period, when the selected financial
   * year is not it.
   *
   * The scope line is stamped on the printed sheet, where it is the only
   * record of what was asked for. Most registers are read inside the selected
   * FY and say so. A few are not: the pending-quantity register is deliberately
   * unscoped by year (goods sent to a job worker in February are still out in
   * April, and ITC-04 counts them), and `inv_stock_balances` has no fy_id at
   * all. "FY 2026-27" over those rows asserts a filter the query never applied.
   */
  scopePeriod?: string

  /** Row → destination URL. Enables click / Enter drill-through. */
  drillTo?: (row: T) => string | null


  /**
   * The pinned `<tfoot>`, keyed by column key.
   *
   * Build it from the server summary, not from `rows` — the whole point is that
   * the figure under a 25-row page is the total of all 4,000 matching rows.
   * `rows` is passed for the endpoints that genuinely send no summary, and
   * anything derived from it must say "(page)" in its label.
   */
  totals?: (summary: S, rows: readonly T[]) => Record<string, ReactNode>

  /**
   * Re-derive the summary over a different set of rows.
   *
   * Only for the endpoints that send no aggregate, whose `summary` is the
   * served page (`configs/pageSummary.ts`). An export walks every page, so its
   * footer and its KPI cards have to be totalled over what it actually wrote —
   * a printed register carrying 10,000 rows under "Total (100 movements) —
   * this page only" is worse than one with no footer at all.
   *
   * Registers backed by a real server aggregate leave this undefined: their
   * summary already speaks for the whole filtered set.
   */
  summaryForRows?: (summary: S, rows: readonly T[]) => S

  /** Clickable KPI cards above the table. Falls back to `summary` when absent. */
  kpis?: (summary: S, response: ReportResponse<T, S>) => StatCardSpec[]

  /**
   * An analytics band under the KPI cards.
   *
   * Distinct from `insights`, which states facts about the rows in words. This
   * is for a register whose question is about the SHAPE of the set — "where is
   * my stock value, and how has it moved" is not answerable by any one row, nor
   * by a sentence about them.
   *
   * Opt-in, because most registers are read as a list and a chart strip over
   * one is noise. It is handed the server's own summary and the page's rows so
   * it charts what the register reports rather than a second, differently
   * filtered answer; anything more it must fetch itself, from the same
   * endpoints under the same filters. Screen only — the printed sheet carries
   * the figures, not the pictures.
   */
  analytics?: (args: AnalyticsArgs<T, S>) => ReactNode

  /**
   * The operational strip under the KPI cards — what the rows on screen say
   * about the state of things, rather than what they sum to.
   *
   * Derive it from the summary and the rows the register already has; never
   * fetch for it, and never state a count more widely than the data supports.
   * On an endpoint whose summary is the served page, say "on this page" in the
   * hint the same way the cards and the footer do. A register that declares
   * none simply shows no strip.
   */
  insights?: (summary: S, response: ReportResponse<T, S>) => RegisterInsightSet


  /** Heading over the table card. Defaults to the register's own title. */
  tableTitle?: string
  /** One line under that heading, saying what the rows on screen are. */
  tableHint?: string
  /**
   * A register's own control in the table card's header, beside Customize
   * columns — "Add item" on the valuation register.
   *
   * Here rather than in `extra` because `extra` renders ABOVE the card: a
   * register that put its heading and button there would draw a second heading
   * over the one the card already has.
   */
  tableActions?: ReactNode

  /**
   * Groupings the reader can switch between, with per-group subtotals. The
   * engine offers "No grouping" plus one entry per item; a register with none
   * shows no control at all.
   */
  groupBy?: readonly RegisterGrouping<T>[]

  /** Column-preference key. Defaults to `slug`. */
  columnPrefsKey?: string

  /** Minimum table width before the body scrolls sideways. */
  minWidth?: number

  printOrientation?: 'portrait' | 'landscape'

  /** Rows per page on first load. */
  defaultLimit?: number

  /**
   * Filters that must have a value before anything is fetched — the stock
   * ledger is one item's ledger and there is no sensible "all items" answer.
   */
  requireFilters?: readonly string[]
  requireFiltersMessage?: string

  /** Hub placement and chrome. */
  group?: RegisterGroup
  icon?: LucideIcon
  tone?: IconTone
  /**
   * The lead line, where the full `description` is too long to be one.
   *
   * Used by the hub tile and by the `page` header. `description` stays the
   * register's full self-description and is what the export and the printed
   * sheet carry — a caveat that belongs on paper ("this type carries no
   * valuation…") should not also be the screen's subtitle when the screen
   * already states it in its own callout.
   */
  shortDescription?: string
  /** Register is reachable at `/registers/<path>` unless this overrides it. */
  routePath?: string
  /**
   * What to show when the register is empty and NO filter is set.
   *
   * "No rows match these filters. Widen the period or clear a filter" is the
   * wrong sentence for a company that has simply never entered one of these —
   * it sends the reader hunting for a filter that is not there. Registers that
   * can be legitimately empty supply the other screen; the rest fall back to
   * the filtered message, which is right often enough.
   */
  emptyUnfiltered?: ReactNode

  /** Noun used in the totals label: "Total (412 movements)". */
  rowNoun?: string
  rowNounPlural?: string
  /** Base for the CSV / print filename. Defaults to the slug. */
  filenameBase?: string
}

/** Loosely-typed register, for lists that hold registers of every row shape. */
/* eslint-disable-next-line @typescript-eslint/no-explicit-any */
export type AnyRegisterConfig = RegisterConfig<any, any>

/** The permission a register is gated on. */
export function registerPermission(config: {
  slug: string
  permission?: PermissionKey
}): PermissionKey {
  return config.permission ?? `reports.${config.slug}.read`
}

export function registerRoute(config: { path: string; routePath?: string }): string {
  return `/registers/${config.routePath ?? config.path}`
}

export function registerColumnPrefsKey(config: { slug: string; columnPrefsKey?: string }): string {
  return config.columnPrefsKey ?? config.slug
}

/**
 * Adapt a plain list endpoint to the report envelope.
 *
 * Most Inventory list endpoints answer `{data, meta}` and some add `summary`.
 * The engine wants `{data, meta, summary, report}`, so this fills the gaps
 * rather than making every caller repeat the same three lines.
 */
export function asReportResponse<T, S>(
  response: ListResponse<T> & { summary?: unknown },
  report: string,
  fallbackSummary: S,
): ReportResponse<T, S> {
  const summary = (response as { summary?: S }).summary
  return {
    ...response,
    summary: summary === undefined || summary === null ? fallbackSummary : summary,
    report,
  }
}

/** Identity helper that keeps a config's `T`/`S` inferred at the declaration. */
export function defineRegister<T, S>(config: RegisterConfig<T, S>): RegisterConfig<T, S> {
  return config
}
