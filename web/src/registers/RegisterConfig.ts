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
export interface RegisterSelection<T> {
  /** Stable identity for a row, unique across pages. */
  idOf: (row: T) => string | number
  /** Column header text for screen readers. Defaults to "Select". */
  label?: string
  /** Why this row cannot be picked, or null when it can. */
  disabledReason?: (row: T) => string | null
  /** Rendered in the toolbar while at least one row is selected. */
  actions: (selected: readonly T[], clear: () => void) => ReactNode
}

export interface RegisterFetchArgs {
  query: ListQuery
  signal?: AbortSignal
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

  /** Row selection and the bulk actions it enables. */
  selectable?: RegisterSelection<T>

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
  /** Shown on the hub tile instead of `description` when the full text is long. */
  shortDescription?: string
  /** Register is reachable at `/registers/<path>` unless this overrides it. */
  routePath?: string
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
