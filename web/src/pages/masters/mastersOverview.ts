import type { LucideIcon } from 'lucide-react'
import type { AuditLogRow } from '../../services/auditApi'
import { MASTER_DEFINITIONS } from './masterDefinitions'
import type { MasterDefinition } from './masterDefinitions'

/**
 * Pure model behind the Masters landing page.
 *
 * Every figure this screen shows is derived here from what the live API
 * actually returned, and every one of them can come back unknown: a master the
 * profile cannot read is not counted, a request that failed is not counted, and
 * an audit trail the user cannot open produces no activity list. Nothing in
 * this file invents a number to fill a card — `null` travels all the way to the
 * UI, which renders an em dash for it.
 */

// ---------------------------------------------------------------------------
// Per-master statistics
// ---------------------------------------------------------------------------

export interface MasterStat {
  /** Total rows in the company, or null when unknown (no access, failed call). */
  count: number | null
  /** ISO timestamp of the most recently touched row, or null when unknown. */
  updatedAt: string | null
  /** The list call failed — distinct from "not allowed to look". */
  failed: boolean
}

export type MasterStats = Readonly<Record<string, MasterStat>>

export const UNKNOWN_STAT: MasterStat = { count: null, updatedAt: null, failed: false }

// ---------------------------------------------------------------------------
// Relative time
// ---------------------------------------------------------------------------

const MINUTE = 60_000
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR

function plural(n: number, unit: string): string {
  return `${n} ${unit}${n === 1 ? '' : 's'} ago`
}

/**
 * "just now" / "8 minutes ago" / "2 hours ago" / "3 days ago".
 *
 * Deliberately not `dashboard/formatters.relativeTimeFromNow`, which compresses
 * to "2h ago" because a KPI tile is 150px wide. These sit on a card footer and
 * in an activity feed with room to spell it out, and the two registers of
 * language should not be mixed inside one product.
 */
export function formatRelativeTime(
  value: string | number | Date | null | undefined,
  now: number = Date.now(),
): string | null {
  if (value === null || value === undefined || value === '') return null
  const t =
    typeof value === 'number' ? value : value instanceof Date ? value.getTime() : Date.parse(String(value))
  if (!Number.isFinite(t)) return null
  const delta = now - t
  // A stamp in the future is a clock skew, not a fact worth reporting.
  if (delta < MINUTE) return 'just now'
  if (delta < HOUR) return plural(Math.floor(delta / MINUTE), 'minute')
  if (delta < DAY) return plural(Math.floor(delta / HOUR), 'hour')
  const days = Math.floor(delta / DAY)
  if (days < 30) return plural(days, 'day')
  const months = Math.floor(days / 30)
  if (months < 12) return plural(months, 'month')
  return plural(Math.floor(days / 365), 'year')
}

/** True when `value` falls inside the last `days` days. */
export function isWithinDays(value: string | null | undefined, days: number, now: number = Date.now()): boolean {
  if (!value) return false
  const t = Date.parse(String(value))
  if (!Number.isFinite(t)) return false
  return t >= now - days * DAY && t <= now + MINUTE
}

/**
 * How many masters were touched in the last `days` days.
 *
 * Counts master *types*, matching the card's caption ("Recently Updated · in
 * the last 7 days"), and returns null when not one master's stamp could be
 * read — an em dash is honest there, a zero would claim nothing changed.
 */
export function recentlyUpdatedCount(
  stats: MasterStats,
  masters: readonly MasterDefinition[] = MASTER_DEFINITIONS,
  days = 7,
  now: number = Date.now(),
): number | null {
  let known = 0
  let recent = 0
  for (const master of masters) {
    const stat = stats[master.key]
    if (!stat || stat.count === null) continue
    known += 1
    if (isWithinDays(stat.updatedAt, days, now)) recent += 1
  }
  return known === 0 ? null : recent
}

// ---------------------------------------------------------------------------
// Master health
// ---------------------------------------------------------------------------

export type MasterHealthState = 'good' | 'review' | 'missing'

export interface MasterHealth {
  /** Masters holding at least one record. */
  good: number
  /** Optional masters with nothing in them yet — worth a look, not an error. */
  review: number
  /** Masters Inventory cannot post without, still empty. */
  missing: number
  /** Masters actually assessed: readable, and their count came back. */
  assessed: number
  /** good / assessed, rounded. Null when nothing could be assessed. */
  percent: number | null
  label: string
  /** Only ever positive when the underlying status really is clean. */
  message: string | null
  byMaster: Readonly<Record<string, MasterHealthState>>
}

/**
 * Health of the master data, computed from the live record counts.
 *
 * There is no health endpoint and this does not pretend there is one: it reads
 * the counts already on screen and says how many masters hold data, how many
 * essential ones are empty, and how many optional ones have never been used.
 * When no count could be read the percentage is null and the card falls back to
 * "Configuration overview" — never a made-up score.
 */
export function masterHealth(
  stats: MasterStats,
  masters: readonly MasterDefinition[] = MASTER_DEFINITIONS,
): MasterHealth {
  const byMaster: Record<string, MasterHealthState> = {}
  let good = 0
  let review = 0
  let missing = 0

  for (const master of masters) {
    const stat = stats[master.key]
    if (!stat || stat.count === null) continue
    let state: MasterHealthState
    if (stat.count > 0) state = 'good'
    else if (master.essential) state = 'missing'
    else state = 'review'
    byMaster[master.key] = state
    if (state === 'good') good += 1
    else if (state === 'review') review += 1
    else missing += 1
  }

  const assessed = good + review + missing
  const percent = assessed === 0 ? null : Math.round((good / assessed) * 100)

  let label = 'Configuration overview'
  let message: string | null = null
  if (assessed > 0) {
    if (missing > 0) {
      label = 'Missing setup'
      message = `${missing} essential ${missing === 1 ? 'master has' : 'masters have'} no records yet.`
    } else if (review > 0) {
      label = 'Need review'
      message = `${review} optional ${review === 1 ? 'master is' : 'masters are'} still empty.`
    } else {
      label = 'Healthy'
      message = 'Great! Your master data is in good shape.'
    }
  }

  return { good, review, missing, assessed, percent, label, message, byMaster }
}

// ---------------------------------------------------------------------------
// Recent activity
// ---------------------------------------------------------------------------

const ENTITY_LABELS: Record<string, string> = {
  item: 'Item',
  item_group: 'Item group',
  stock_category: 'Stock category',
  brand: 'Brand',
  uom: 'Unit of measure',
  warehouse: 'Warehouse',
  warehouse_group: 'Warehouse group',
  location: 'Location',
  bom: 'Bill of materials',
  batch: 'Batch',
  serial: 'Serial',
}

const ACTION_VERBS: Record<string, string> = {
  create: 'created',
  update: 'updated',
  delete: 'deleted',
  restore: 'restored',
}

/**
 * Columns that hold a record's human name, most specific first.
 *
 * The audit row carries the whole before/after snapshot, so the name is really
 * there; this only has to know what each master calls it.
 */
const NAME_COLUMNS = [
  'item_name',
  'grp_name',
  'cat_name',
  'brand_name',
  'unit_name',
  'unit_symbol',
  'warehouse_name',
  'location_name',
  'location_code',
  'bom_name',
  'batch_no',
  'serial_no',
]

function nameFromSnapshot(snapshot: Record<string, unknown> | null): string | null {
  if (!snapshot) return null
  for (const column of NAME_COLUMNS) {
    const value = snapshot[column]
    if (typeof value === 'string' && value.trim() !== '') return value.trim()
    if (typeof value === 'number' && Number.isFinite(value)) return String(value)
  }
  return null
}

export interface MasterActivity {
  id: number
  /** "Brand updated" — what happened. */
  title: string
  /** "Acme Electronics" — which record. */
  subject: string
  createdAt: string
  icon: LucideIcon | null
  /** The master's list route, when the entity maps to one. */
  to: string | null
}

const BY_AUDIT_ENTITY = new Map(MASTER_DEFINITIONS.map((m) => [m.auditEntity, m]))

/**
 * An audit row as the activity feed says it.
 *
 * Returns null for anything that is not a master change, so a feed fed the
 * whole audit log still only shows master data.
 */
export function describeActivity(row: AuditLogRow): MasterActivity | null {
  const entity = String(row.entity_type ?? '')
  const label = ENTITY_LABELS[entity]
  if (!label) return null

  // `brand.update` → `update`; anything else keeps the action as written.
  const verbKey = String(row.action ?? '').split('.').pop() ?? ''
  const verb = ACTION_VERBS[verbKey]
  if (!verb) return null

  const master = BY_AUDIT_ENTITY.get(entity) ?? null
  return {
    id: row.audit_id,
    title: `${label} ${verb}`,
    subject: nameFromSnapshot(row.after) ?? nameFromSnapshot(row.before) ?? `#${row.entity_id}`,
    createdAt: row.created_at,
    icon: master?.icon ?? null,
    to: master?.route ?? null,
  }
}

/** The newest master changes, ready for the sidebar. */
export function masterActivity(rows: readonly AuditLogRow[], limit = 5): MasterActivity[] {
  const out: MasterActivity[] = []
  for (const row of rows) {
    const activity = describeActivity(row)
    if (activity) out.push(activity)
    if (out.length >= limit) break
  }
  return out
}
