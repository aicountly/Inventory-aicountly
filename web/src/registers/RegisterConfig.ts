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

  /** Clickable KPI cards above the table. Falls back to `summary` when absent. */
  kpis?: (summary: S, response: ReportResponse<T, S>) => StatCardSpec[]

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
