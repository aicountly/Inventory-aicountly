/**
 * How an audit row reads on screen.
 *
 * Every mapping the table, the drawer and the row menu need lives here, as
 * plain functions over `AuditLogRow`. Deliberately not spread through JSX:
 * the colour of an event, the name of an actor and the link under an entity
 * are decisions an auditor will ask about, and they are answerable in one file
 * and testable without rendering anything.
 *
 * Nothing here invents a value. Where the row carries no answer the helper
 * returns null and the caller renders an em dash, because a screen that guesses
 * at who changed something is worse than one that admits it does not know.
 */

import type { BadgeTone } from '../../ui/Badge'
import type { IconTone } from '../../ui/IconTile'
import type { AuditLogRow } from '../../services/auditApi'
import { humanize } from '../../utils/format'

/* -------------------------------------------------------------------------- */
/* Action badges                                                              */
/* -------------------------------------------------------------------------- */

/**
 * Domains whose events mean the same thing whatever verb follows.
 *
 * Checked before the verb: `reconciliation.run` is a reconciliation first and a
 * run second, and coluring it by `run` would put it in the same bucket as a
 * valuation recalculation it has nothing to do with.
 */
const DOMAIN_TONE: Record<string, BadgeTone> = {
  reconciliation: 'violet',
  reconciliation_run: 'violet',
  valuation: 'teal',
  valuation_revision: 'teal',
  recalc: 'teal',
  recalc_job: 'teal',
  access: 'indigo',
  access_profile: 'indigo',
  member: 'indigo',
}

/** The verb, for every domain that has not claimed a colour of its own. */
const VERB_TONE: Record<string, BadgeTone> = {
  post: 'success',
  approve: 'success',
  restore: 'success',
  create: 'info',
  register: 'info',
  read: 'info',
  update: 'warning',
  upsert: 'warning',
  edit: 'warning',
  lock: 'warning',
  unlock: 'warning',
  delete: 'danger',
  remove: 'danger',
  reverse: 'danger',
  cancel: 'danger',
  run: 'violet',
  replay: 'violet',
  dispatch: 'violet',
}

/** `document.post` → `['document', 'post']`; a verbless action keeps one part. */
export function splitAction(action: string): { domain: string; verb: string } {
  const at = action.lastIndexOf('.')
  if (at <= 0) return { domain: action, verb: '' }
  return { domain: action.slice(0, at), verb: action.slice(at + 1) }
}

/**
 * The badge colour for an action.
 *
 * An unrecognised action is neutral rather than guessed at: a new event type
 * shipped by another product must not be shown in the green that this screen
 * uses to mean "posted".
 */
export function actionTone(action: string): BadgeTone {
  const { domain, verb } = splitAction(action)
  const root = domain.split('.')[0]
  return DOMAIN_TONE[root] ?? VERB_TONE[verb] ?? 'neutral'
}

/* -------------------------------------------------------------------------- */
/* Actors                                                                     */
/* -------------------------------------------------------------------------- */

export type ActorKind = 'user' | 'system' | 'automation'

export interface ActorIdentity {
  kind: ActorKind
  /** What the cell reads. */
  label: string
  /** Two characters at most, for the avatar. */
  initials: string
  tone: IconTone
  /** The exact value to filter by, or null when the row has no actor. */
  filterValue: string | null
  /** The full identifier, for the tooltip — never truncated. */
  title: string
}

/**
 * Who did it.
 *
 * Three kinds, because the audit trail records three: a signed-in person, a
 * scheduled command (`cli:inventory-reconcile`), and the server itself acting
 * with no actor at all. Telling them apart matters more on this screen than
 * anywhere else in the product — "nobody" and "a cron job" are different
 * answers to the question an auditor is asking.
 */
export function actorIdentity(row: Pick<AuditLogRow, 'actor_uuid'>): ActorIdentity {
  const raw = row.actor_uuid?.trim() ?? ''
  if (raw === '') {
    return {
      kind: 'system',
      label: 'System',
      initials: 'SY',
      tone: 'teal',
      filterValue: null,
      title: 'System — recorded with no signed-in actor',
    }
  }
  if (raw.toLowerCase().startsWith('cli:')) {
    const name = raw.slice(4)
    const parts = name.split(/[-_.:\s]+/).filter(Boolean)
    const initials = (parts.length > 1 ? parts[0][0] + parts[1][0] : name.slice(0, 2)).toUpperCase()
    return { kind: 'automation', label: raw, initials, tone: 'violet', filterValue: raw, title: raw }
  }
  // A bare integer is the portal user id the rest of Inventory shows as `#7`.
  if (/^\d+$/.test(raw)) {
    return {
      kind: 'user',
      label: `User #${raw}`,
      initials: raw.slice(-2),
      tone: 'info',
      filterValue: raw,
      title: `User #${raw}`,
    }
  }
  const head = raw.replace(/[^a-zA-Z0-9]/g, '').slice(0, 2).toUpperCase()
  return {
    kind: 'user',
    label: raw.length > 14 ? `${raw.slice(0, 8)}…` : raw,
    initials: head || 'U',
    tone: 'info',
    filterValue: raw,
    title: raw,
  }
}

/* -------------------------------------------------------------------------- */
/* Entities                                                                   */
/* -------------------------------------------------------------------------- */

export interface EntityIdentity {
  label: string
  /** The record's own type, when the snapshot names it. Never inferred. */
  subtitle: string | null
  /** An in-app route, or null when this entity type has no screen. */
  to: string | null
}

const ENTITY_ROUTES: Record<string, (id: number) => string> = {
  document: (id) => `/documents/${id}`,
  item: (id) => `/items/${id}`,
  reconciliation_run: (id) => `/reconciliation/${id}`,
}

/**
 * The entity cell: what the row is about, and where to go and look at it.
 *
 * The subtitle is read out of the snapshot the row already carries
 * (`after.document_type`, else `before.document_type`) — the document's own
 * type as it stood at the moment of the write. It is not derived from
 * `source_document_type`, which names the voucher in *Books* that caused the
 * change, not the Inventory record that was changed.
 *
 * `to` is null for every entity type with no screen behind it. A link that
 * lands on "not found" is worse than plain text: the reader concludes the
 * record was deleted, which on an audit screen is a false statement.
 */
export function entityIdentity(row: AuditLogRow): EntityIdentity {
  const label = `${humanize(row.entity_type)} #${row.entity_id}`
  const snapshot = (row.after ?? row.before ?? null) as Record<string, unknown> | null
  const rawType = snapshot?.document_type
  const subtitle = typeof rawType === 'string' && rawType.trim() !== '' ? humanize(rawType) : null
  const route = ENTITY_ROUTES[row.entity_type]
  return { label, subtitle, to: route ? route(row.entity_id) : null }
}

/* -------------------------------------------------------------------------- */
/* Source app                                                                 */
/* -------------------------------------------------------------------------- */

export interface SourceIdentity {
  /** `books · books.sales`, or null when the write named no source. */
  label: string | null
  /** `#71958` — the voucher in the originating product. */
  reference: string | null
}

export function sourceIdentity(row: AuditLogRow): SourceIdentity {
  const app = row.source_app?.trim() ?? ''
  if (app === '') return { label: null, reference: null }
  const type = row.source_document_type?.trim() ?? ''
  return {
    label: type === '' ? app : `${app} · ${type}`,
    reference: row.source_document_id ? `#${row.source_document_id}` : null,
  }
}

/* -------------------------------------------------------------------------- */
/* Changed fields                                                             */
/* -------------------------------------------------------------------------- */

/**
 * The field names the write touched.
 *
 * The keys of the `after` snapshot, which is what the CSV export has always
 * written. Kept identical on purpose: a chip row and an export column headed
 * "Changed fields" that disagreed about the same event would make both
 * untrustworthy.
 */
export function changedFields(row: Pick<AuditLogRow, 'after'>): string[] {
  return Object.keys(row.after ?? {})
}

/* -------------------------------------------------------------------------- */
/* Before / after                                                             */
/* -------------------------------------------------------------------------- */

export type ChangeKind = 'added' | 'removed' | 'changed' | 'unchanged'

export interface AuditChange {
  /** Dotted path, `lines[0].quantity` for nested values. */
  path: string
  before: unknown
  after: unknown
  kind: ChangeKind
}

const MAX_DEPTH = 4

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

function sameValue(a: unknown, b: unknown): boolean {
  if (a === b) return true
  if (a === null || b === null || a === undefined || b === undefined) return false
  if (typeof a !== 'object' || typeof b !== 'object') return false
  try {
    return JSON.stringify(a) === JSON.stringify(b)
  } catch {
    return false
  }
}

function walk(
  before: unknown,
  after: unknown,
  path: string,
  depth: number,
  out: AuditChange[],
): void {
  if (sameValue(before, after)) {
    if (path !== '') out.push({ path, before, after, kind: 'unchanged' })
    return
  }

  /**
   * A creation has no `before` and a deletion has no `after`, and they are the
   * two commonest entries in the log. Standing the missing side up as an empty
   * container of the same shape is what turns them into "these fields were
   * added" instead of one opaque row holding the whole record as JSON.
   */
  if (isPlainObject(after) && (before === undefined || before === null)) before = {}
  else if (isPlainObject(before) && (after === undefined || after === null)) after = {}
  else if (Array.isArray(after) && (before === undefined || before === null)) before = []
  else if (Array.isArray(before) && (after === undefined || after === null)) after = []

  if (depth < MAX_DEPTH) {
    if (Array.isArray(before) && Array.isArray(after)) {
      const length = Math.max(before.length, after.length)
      for (let i = 0; i < length; i += 1) {
        walk(before[i], after[i], `${path}[${i}]`, depth + 1, out)
      }
      return
    }
    if (isPlainObject(before) && isPlainObject(after)) {
      const keys = [...new Set([...Object.keys(before), ...Object.keys(after)])].sort()
      for (const key of keys) {
        const next = path === '' ? key : `${path}.${key}`
        walk(before[key], after[key], next, depth + 1, out)
      }
      return
    }
  }

  const had = before !== undefined
  const has = after !== undefined
  out.push({
    path: path === '' ? '(record)' : path,
    before,
    after,
    kind: !had && has ? 'added' : had && !has ? 'removed' : 'changed',
  })
}

/**
 * The before and after snapshots, flattened into one list of paths.
 *
 * Recursion stops at four levels and reports the whole subtree as one change
 * beyond that. A document's `lines` array is the reason: fully expanded, a
 * fifty-line invoice produces several hundred rows of diff, and the two fields
 * the reader actually came for are lost in it. The raw JSON tab is always
 * there for the rest, and it is the snapshot verbatim.
 *
 * Unchanged paths are included and flagged, so the caller can offer "show
 * unchanged" without a second pass over the data.
 */
export function buildChanges(
  before: Record<string, unknown> | null,
  after: Record<string, unknown> | null,
): AuditChange[] {
  if (before === null && after === null) return []
  const out: AuditChange[] = []
  walk(before ?? undefined, after ?? undefined, '', 0, out)
  return out
}

/** A snapshot value as one line of text. Objects fall back to compact JSON. */
export function formatChangeValue(value: unknown): string | null {
  if (value === undefined) return null
  if (value === null) return 'null'
  if (typeof value === 'string') return value === '' ? '""' : value
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  try {
    return JSON.stringify(value)
  } catch {
    return String(value)
  }
}

/* -------------------------------------------------------------------------- */
/* Identifiers                                                                */
/* -------------------------------------------------------------------------- */

/** The head of a long identifier; short ones are returned whole. */
export function shortId(value: string, keep = 12): string {
  return value.length > keep ? value.slice(0, keep) : value
}

/**
 * The timestamp split for the two-line `When` cell.
 *
 * The server sends company-local time as a plain string and this reads it as
 * one — no Date parsing, no zone conversion. Reinterpreting `10:15` in the
 * reader's own zone would move every entry on the screen by hours and silently
 * contradict the record.
 */
export function splitTimestamp(value: string): { date: string; time: string | null } {
  const m = String(value).match(/^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2}))?/)
  if (!m) return { date: String(value), time: null }
  const date = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])))
  const day = Number.isNaN(date.getTime())
    ? `${m[3]}/${m[2]}/${m[1]}`
    : date.toLocaleDateString('en-GB', {
        day: '2-digit',
        month: 'short',
        year: 'numeric',
        timeZone: 'UTC',
      })
  return { date: day, time: m[4] ? `${m[4]}:${m[5]}` : null }
}
