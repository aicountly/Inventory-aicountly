/**
 * The five dashboards, and how the URL names them.
 *
 * One definition drives the tab bar, the keyboard sequences, the command
 * palette, the permission gate, the PDF title and the remembered preference —
 * so a dashboard can never be reachable by one route and missing from another.
 *
 * ## The URL
 *
 * `/dashboard?view=<id>`. A query parameter rather than five paths because
 * `/dashboard` is already the app's front door: every existing deep link, the
 * sidebar's Dashboard item, the `alt+d` chord and the post-sign-in redirect all
 * point at it, and they all keep working — a bare `/dashboard` resolves to the
 * user's remembered dashboard, or Overview.
 *
 * Unknown, misspelt and forbidden values all fall back to an authorised
 * dashboard rather than erroring: a URL someone pasted from a colleague with
 * more permissions should land them somewhere useful, not on a dead end.
 */

import type { LucideIcon } from 'lucide-react'
import { Boxes, ClipboardCheck, Coins, LayoutDashboard, Repeat } from 'lucide-react'
import { P } from '../services/access'

export type DashboardViewId = 'overview' | 'operations' | 'replenishment' | 'valuation' | 'controls'

export interface DashboardView {
  id: DashboardViewId
  label: string
  /** The one-line subtitle under the page heading. */
  description: string
  icon: LucideIcon
  /** The sequence that opens it, for the tab badge. Must match sequences.ts. */
  sequence: readonly string[]
  /**
   * Any one of these permits the tab.
   *
   * Deliberately the permission that gates the dashboard's PRINCIPAL source,
   * not the union of everything on it: a tab that opens to six "you may not
   * read this" cards is worse than a tab that is not there. Individual panels
   * gate themselves on top of this.
   */
  permissions: readonly string[]
}

export const DASHBOARD_VIEWS: readonly DashboardView[] = [
  {
    id: 'overview',
    label: 'Overview',
    description: 'Your stock position and the things that need attention first.',
    icon: LayoutDashboard,
    sequence: ['g', '1'],
    permissions: [P.dashboard, P.report('stock_summary')],
  },
  {
    id: 'operations',
    label: 'Operations',
    description: 'Keep receipts, issues, transfers and counts moving.',
    icon: Boxes,
    sequence: ['g', '2'],
    permissions: [P.dashboard],
  },
  {
    id: 'replenishment',
    label: 'Replenishment',
    description: 'Anticipate shortages and review what to order.',
    icon: Repeat,
    sequence: ['g', '3'],
    permissions: [P.report('replenishment')],
  },
  {
    id: 'valuation',
    label: 'Valuation',
    description: 'Understand inventory cost, ageing and capital tied up in stock.',
    icon: Coins,
    sequence: ['g', '4'],
    permissions: [P.report('stock_summary'), P.report('stock_ageing')],
  },
  {
    id: 'controls',
    label: 'Controls',
    description: 'Resolve exceptions and keep Inventory aligned with Books.',
    icon: ClipboardCheck,
    sequence: ['g', '5'],
    permissions: [P.dashboard, P.reconciliationRead],
  },
]

export const DASHBOARD_VIEW_IDS: readonly DashboardViewId[] = DASHBOARD_VIEWS.map((v) => v.id)

/** The allowlist check. Anything not exactly one of the five is not a view. */
export function isDashboardViewId(value: string | null | undefined): value is DashboardViewId {
  return value !== null && value !== undefined && (DASHBOARD_VIEW_IDS as readonly string[]).includes(value)
}

export function viewById(id: DashboardViewId): DashboardView {
  return DASHBOARD_VIEWS.find((v) => v.id === id) ?? DASHBOARD_VIEWS[0]
}

/** `/dashboard?view=valuation`, preserving any extra filters the caller keeps. */
export function dashboardPath(id: DashboardViewId, extra?: Record<string, string | number | undefined>): string {
  const search = new URLSearchParams()
  search.set('view', id)
  for (const [k, v] of Object.entries(extra ?? {})) {
    if (v === undefined || v === '') continue
    search.set(k, String(v))
  }
  return `/dashboard?${search.toString()}`
}

// ---------------------------------------------------------------------------
// Permission gating and the remembered preference
// ---------------------------------------------------------------------------

export type CanFn = (permission: string | readonly string[]) => boolean

/** The dashboards this user may open, in tab order. */
export function permittedViews(can: CanFn, accessLoading: boolean): DashboardView[] {
  if (accessLoading) return [...DASHBOARD_VIEWS]
  return DASHBOARD_VIEWS.filter((v) => can(v.permissions))
}

const PREFERENCE_KEY = 'inventory.dashboard.view'

/**
 * The last dashboard this user opened.
 *
 * Remembered per browser, and — this is the part that matters — always run
 * back through the permission filter before it is used. A profile that loses a
 * permission must not keep landing on a dashboard it can no longer read just
 * because the browser remembers it did once.
 */
export function readPreferredView(): DashboardViewId | null {
  try {
    const raw = window.localStorage.getItem(PREFERENCE_KEY)
    return isDashboardViewId(raw) ? raw : null
  } catch {
    return null
  }
}

export function writePreferredView(id: DashboardViewId): void {
  try {
    window.localStorage.setItem(PREFERENCE_KEY, id)
  } catch {
    /* A browser that cannot remember it simply opens Overview next time. */
  }
}

/**
 * Which dashboard to show, given the URL, the remembered choice and the
 * permissions — in that order of authority.
 *
 * Returns `null` only when the user may open none of the five, which the page
 * turns into an explanation rather than a blank screen.
 */
export function resolveView(
  requested: string | null,
  can: CanFn,
  accessLoading: boolean,
  preferred: DashboardViewId | null = readPreferredView(),
): DashboardViewId | null {
  const allowed = permittedViews(can, accessLoading)
  if (allowed.length === 0) return null
  const allowedIds = new Set(allowed.map((v) => v.id))

  // 1. What the URL asked for, if it names a real dashboard this user may open.
  if (isDashboardViewId(requested) && allowedIds.has(requested)) return requested
  // 2. What they looked at last, same test.
  if (preferred && allowedIds.has(preferred)) return preferred
  // 3. The first they are allowed, which keeps tab order meaningful.
  return allowed[0].id
}
