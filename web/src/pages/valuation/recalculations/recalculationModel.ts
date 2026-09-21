/**
 * What a recalculation job MEANS, separated from how it is drawn.
 *
 * Everything the register reads off a job row — its status vocabulary, the scope
 * it ran over, the mode it ran in, why it was triggered, what a failure was
 * actually about — resolves here, once, so the table cell, the detail drawer,
 * the export file and the print sheet cannot disagree about the same job. It is
 * plain data and pure functions on purpose: it is the part worth testing.
 */

import {
  CircleCheck,
  CircleSlash,
  CircleX,
  Clock3,
  LoaderCircle,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import type { BadgeTone } from '../../../ui/Badge'
import { currencySymbol, formatInt, formatMoney, humanize } from '../../../utils/format'
import type { RecalcJob, RecalcStatus, RecalcSummary } from '../../../services/valuationApi'

/* ------------------------------------------------------------------ status */

export interface RecalcStatusMeta {
  label: string
  tone: BadgeTone
  icon: LucideIcon
  /** The status is still moving: the chip animates and the row is polled. */
  live: boolean
  /** Sentence for the tooltip — what this status means for the valuation. */
  hint: string
}

/**
 * The five statuses of `inv_valuation_recalc_jobs.status`.
 *
 * Each carries a word AND a glyph, never a colour alone: a reader who cannot
 * separate the amber chip from the green one still reads "Running" and
 * "Completed", and the printed sheet has no colour at all.
 */
export const RECALC_STATUS_META: Record<RecalcStatus, RecalcStatusMeta> = {
  QUEUED: {
    label: 'Queued',
    tone: 'info',
    icon: Clock3,
    live: true,
    hint: 'Accepted and waiting for a worker. Nothing has been re-costed yet.',
  },
  RUNNING: {
    label: 'Running',
    tone: 'warning',
    icon: LoaderCircle,
    live: true,
    hint: 'Replaying costing forward from the effective date. Counts appear when it finishes.',
  },
  COMPLETED: {
    label: 'Completed',
    tone: 'success',
    icon: CircleCheck,
    live: false,
    hint: 'The replay finished. Any valuation that changed was revised and published to Books.',
  },
  FAILED: {
    label: 'Failed',
    tone: 'danger',
    icon: CircleX,
    live: false,
    hint: 'The replay stopped and wrote nothing. Stored valuation is unchanged.',
  },
  CANCELLED: {
    label: 'Cancelled',
    tone: 'neutral',
    icon: CircleSlash,
    live: false,
    hint: 'Dropped from the queue before it started. Nothing was re-costed.',
  },
}

const UNKNOWN_STATUS: RecalcStatusMeta = {
  label: 'Unknown',
  tone: 'neutral',
  icon: CircleSlash,
  live: false,
  hint: 'The server reported a status this screen does not recognise.',
}

export function statusMeta(status: string | null | undefined): RecalcStatusMeta {
  if (!status) return UNKNOWN_STATUS
  return RECALC_STATUS_META[String(status).toUpperCase() as RecalcStatus] ?? { ...UNKNOWN_STATUS, label: humanize(status) }
}

/** A job whose status can still change, and therefore worth polling for. */
export function isLive(job: Pick<RecalcJob, 'status'>): boolean {
  return statusMeta(job.status).live
}

/* ------------------------------------------------------------- reference */

/**
 * `RC-00012` — the job id, padded, with the prefix the screen and the export
 * both use. Padding is display only: the id is the number, and the search box
 * finds the job by either.
 */
export function recalcReference(jobId: number): string {
  return `RC-${String(jobId).padStart(5, '0')}`
}

/* ----------------------------------------------------------------- scope */

export type RecalcScopeType = 'all' | 'item' | 'warehouse'

export interface RecalcScope {
  type: RecalcScopeType
  label: string
  /** Where the scope can be inspected — the item's cost layers, say. */
  to: string | null
}

/**
 * What the job covered.
 *
 * The engine scopes a job by item (`item_id`) or runs the whole company; the
 * warehouse column exists on the row and is shown when a job carries one, but
 * this screen never OFFERS warehouse as a scope to start a job with, because
 * RecalculationService replays by item and would quietly ignore it.
 */
export function recalcScope(job: RecalcJob): RecalcScope {
  if (job.item_id) {
    const name = job.item_name ?? `Item #${job.item_id}`
    return {
      type: 'item',
      label: job.item_sku ? `${name} · ${job.item_sku}` : name,
      to: `/valuation/cost-layers?item_id=${job.item_id}`,
    }
  }
  if (job.warehouse_id) {
    return {
      type: 'warehouse',
      label: job.warehouse_name ?? `Warehouse #${job.warehouse_id}`,
      to: null,
    }
  }
  return { type: 'all', label: 'All items', to: null }
}

/* ------------------------------------------------------------------ mode */

export interface RecalcMode {
  label: string
  hint: string
  /** A dry run writes nothing, so it never publishes to Books. */
  dryRun: boolean
}

/**
 * The mode is what the engine DOES differently, which in this product is dry
 * run vs live — not the "back-date / re-run" wording of the visual concept.
 * Every job replays costing forward from its effective date; the difference
 * that matters to a reader is whether it wrote the result down.
 */
export function recalcMode(job: Pick<RecalcJob, 'dry_run'>): RecalcMode {
  return job.dry_run
    ? {
        label: 'Dry run',
        hint: 'Reports what would change. No revision is written and nothing is published to Books.',
        dryRun: true,
      }
    : {
        label: 'Live run',
        hint: 'Writes the revised valuation and publishes the applicable COGS revisions to Books.',
        dryRun: false,
      }
}

/* --------------------------------------------------------------- trigger */

/** What caused the job to exist, in the words a reader uses. */
const TRIGGER_LABELS: Record<string, string> = {
  manual: 'Manual request',
  backdated_document: 'Back-dated document',
  reversal: 'Document reversal',
  revaluation: 'Revaluation',
  method_change: 'Valuation method change',
  migration_rebuild: 'Migration rebuild',
}

export function triggerLabel(kind: string | null | undefined): string {
  if (!kind) return '—'
  return TRIGGER_LABELS[kind] ?? humanize(kind)
}

/* --------------------------------------------------------------- failure */

export interface RecalcFailure {
  /** Four or five words for the table cell. */
  short: string
  /** The server's own sentence, for the tooltip and the drawer. */
  full: string
}

/**
 * A failure reason a column can hold, without losing the one a person needs.
 *
 * RecalculationService writes paragraph-length refusals — they explain what a
 * replay would have done to the stored history, which is exactly right in a
 * drawer and unreadable in a 140px cell. The two refusals it raises by name get
 * a short label each; anything else is clipped at its first sentence, and the
 * full text always travels with it.
 */
export function recalcFailure(reason: string | null | undefined): RecalcFailure | null {
  const full = (reason ?? '').trim()
  if (full === '') return null
  if (/carry no cost to replay/i.test(full)) return { short: 'Unpriced inward lines', full }
  if (/receiving side of a transfer/i.test(full)) return { short: 'Unpaired transfer', full }
  const firstSentence = full.split(/(?<=[.!?])\s/)[0] ?? full
  const clipped = firstSentence.length > 64 ? `${firstSentence.slice(0, 63).trimEnd()}…` : firstSentence
  return { short: clipped, full }
}

/* ----------------------------------------------------------- COGS figure */

/**
 * A COGS delta, signed, in the company's base currency.
 *
 * NEVER coloured by sign anywhere it is used. A positive delta is not good news
 * and a negative one is not bad news — it is the movement in the cost of goods
 * sold that the restated valuation produced, and whether that helps or hurts is
 * a question for the P&L in Books, not a property of this number. Status colour
 * means status; this stays neutral.
 */
export function formatCogsDelta(
  value: number | null | undefined,
  currencyCode = 'INR',
  /**
   * Whole rupees, for a KPI caption. The paise are noise at that size and cost
   * the card the width it needs; anything a reader will reconcile or export
   * keeps them.
   */
  options: { decimals?: boolean } = {},
): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—'
  const symbol = currencySymbol(currencyCode)
  const sign = value < 0 ? '-' : ''
  const abs = Math.abs(value)
  const figure = options.decimals === false ? formatInt(Math.round(abs)) : formatMoney(abs)
  return `${sign}${symbol} ${figure}`
}

/**
 * Counts are only meaningful once the replay has finished successfully.
 *
 * COMPLETED only, and FAILED is deliberately excluded. RecalculationService's
 * failure path writes the status, the reason and the finish time and NOTHING
 * else, so a failed job's counts are whatever the row was created with — zeros.
 * Printing "0 lines, ₹ 0.00" beside a failure reads as "it examined the period
 * and found nothing to change", which is the opposite of what happened: it
 * refused to look. The cells read "—" and the failure column carries the story.
 *
 * A queued job has examined nothing and a running one has not reported yet, for
 * the same reason. `0` on a COMPLETED job IS a finding: nothing changed.
 */
export function hasSettledCounts(job: Pick<RecalcJob, 'status'>): boolean {
  return String(job.status).toUpperCase() === 'COMPLETED'
}

/* ----------------------------------------------------------------- KPIs */

export interface RecalcKpiFigures {
  total: number
  completed: number
  inProgress: number
  failed: number
  cancelled: number
  cogsDelta: number
  /** Completed as a share of jobs that reached a terminal state, or null. */
  successRate: number | null
  queuedThisMonth: number
  queuedPrevMonth: number
  cogsDeltaThisMonth: number
  cogsDeltaPrevMonth: number
}

/**
 * The cards, read off the server's summary.
 *
 * Nothing here is counted from the page on screen: a register showing 50 of 812
 * jobs cannot say how many failed, and a success rate derived from one page is a
 * figure nobody can reconcile. When the summary endpoint has not answered, the
 * caller renders placeholders rather than page-scoped arithmetic.
 *
 * The success rate divides by jobs that actually REACHED an outcome. Counting
 * queued and running jobs as failures-in-waiting would make the rate fall every
 * time someone starts a job and rise again when it lands, which is noise.
 */
export function recalcKpis(summary: RecalcSummary): RecalcKpiFigures {
  const by = summary.by_status ?? {}
  const completed = by.COMPLETED ?? 0
  const failed = by.FAILED ?? 0
  const cancelled = by.CANCELLED ?? 0
  const settled = completed + failed + cancelled
  return {
    total: summary.total ?? 0,
    completed,
    inProgress: summary.in_progress ?? (by.QUEUED ?? 0) + (by.RUNNING ?? 0),
    failed,
    cancelled,
    cogsDelta: summary.cogs_delta ?? 0,
    successRate: settled > 0 ? (completed / settled) * 100 : null,
    queuedThisMonth: summary.queued_this_month ?? 0,
    queuedPrevMonth: summary.queued_prev_month ?? 0,
    cogsDeltaThisMonth: summary.cogs_delta_this_month ?? 0,
    cogsDeltaPrevMonth: summary.cogs_delta_prev_month ?? 0,
  }
}

/** `8% of total` — the share a count is of the register, or null when empty. */
export function shareOfTotal(count: number, total: number): string | null {
  if (total <= 0) return null
  return `${Math.round((count / total) * 100)}% of total`
}

/* -------------------------------------------------------- row permissions */

export interface RecalcRowAbilities {
  /** Run it now — a queued job the worker has not taken yet. */
  canRun: boolean
  /** The same endpoint, named for what it does to a job that already failed. */
  canRetry: boolean
  canCancel: boolean
  canOpenRevisions: boolean
}

/**
 * Which actions a row may offer, given the job and what the user may do.
 *
 * Mirrors the server exactly rather than guessing: RecalculationService::run
 * accepts QUEUED and FAILED (so "Retry" is real, and is the same call as "Run
 * now"), and cancelRecalc accepts QUEUED alone — a running replay has no
 * checkpoint to stop at, and a completed one is undone by recalculating again,
 * not by cancelling. A menu that offered either would be a button that returns
 * a 409.
 */
export function rowAbilities(job: RecalcJob, canRecalculate: boolean): RecalcRowAbilities {
  const status = String(job.status).toUpperCase()
  return {
    canRun: canRecalculate && status === 'QUEUED',
    canRetry: canRecalculate && status === 'FAILED',
    canCancel: canRecalculate && status === 'QUEUED',
    // A dry run writes no revisions, so there is nothing for the link to open.
    canOpenRevisions: status === 'COMPLETED' && !job.dry_run && (job.revised_line_count ?? 0) > 0,
  }
}

/* ------------------------------------------------------- Books publication */

export type BooksPublicationState = 'not_applicable' | 'nothing_to_publish' | 'published' | 'partly_acknowledged' | 'pending'

export interface BooksPublication {
  state: BooksPublicationState
  label: string
  detail: string
  tone: BadgeTone
}

/**
 * What happened to this job's revisions on the Books side.
 *
 * Read from the revision counts the detail endpoint already aggregates — this
 * screen does not hold a second copy of the Books ledger and does not ask Books
 * anything. Inventory publishes a revision and records that it did; Books
 * acknowledges it. Both facts live on the revision rows, so both are reported
 * from there and nowhere else.
 */
export function booksPublication(job: RecalcJob): BooksPublication {
  const status = String(job.status).toUpperCase()
  if (job.dry_run) {
    return {
      state: 'not_applicable',
      label: 'Not applicable',
      detail: 'A dry run writes no revisions, so nothing is published to Books.',
      tone: 'neutral',
    }
  }
  if (status !== 'COMPLETED') {
    return {
      state: 'not_applicable',
      label: 'Not applicable',
      detail: 'Revisions are published only when a live run completes.',
      tone: 'neutral',
    }
  }
  const summary = job.revision_summary
  if (!summary || summary.revisions === 0) {
    return {
      state: 'nothing_to_publish',
      label: 'Nothing to publish',
      detail: 'The replay changed no valuation, so no COGS revision was raised.',
      tone: 'neutral',
    }
  }
  if (summary.unacknowledged === 0) {
    return {
      state: 'published',
      label: 'Acknowledged by Books',
      detail: `All ${summary.revisions} revisions were published and acknowledged.`,
      tone: 'success',
    }
  }
  if (summary.published > 0) {
    return {
      state: 'partly_acknowledged',
      label: 'Awaiting Books',
      detail: `${summary.published} of ${summary.revisions} revisions published; ${summary.unacknowledged} not yet acknowledged by Books.`,
      tone: 'warning',
    }
  }
  return {
    state: 'pending',
    label: 'Pending publication',
    detail: `${summary.revisions} revisions recorded and not yet published to Books.`,
    tone: 'warning',
  }
}

/* -------------------------------------------------------------- durations */

/**
 * How long a job has been going, or took. Minutes and seconds, because a replay
 * is measured in either and an hour-long one is already a problem worth naming.
 */
export function formatElapsed(fromIso: string | null | undefined, toIso?: string | null, now: number = Date.now()): string | null {
  if (!fromIso) return null
  const start = Date.parse(fromIso.replace(' ', 'T'))
  if (!Number.isFinite(start)) return null
  const end = toIso ? Date.parse(toIso.replace(' ', 'T')) : now
  if (!Number.isFinite(end) || end < start) return null
  const seconds = Math.floor((end - start) / 1000)
  if (seconds < 60) return `${seconds}s`
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m ${seconds % 60}s`
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`
}
