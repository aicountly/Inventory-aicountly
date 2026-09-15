/**
 * The posting-status figures, as cards a reader can click.
 *
 * Two rules shape this file.
 *
 * The first is the drill-down rule (`dashboard/kpiNavigation.ts`): a card may
 * only navigate somewhere that reproduces the number it shows. The server
 * computes `summary` over EVERY Books-sourced voucher in the company, year and
 * branch — `ReconciliationController::postingStatus()` applies `sync_status`,
 * `source_document_type` and `source_document_id` to the rows it returns and
 * not to the summary. So a card links to its own status and to nothing else:
 * carrying the screen's other filters into the link would land the reader on a
 * table whose total is smaller than the card they just clicked.
 *
 * The second is that a status name is not an explanation. `MISSING_IN_BOOKS`
 * is a sentence about two systems disagreeing, and the person clearing it needs
 * that sentence, not the token. Each meaning below is the one
 * `ReconciliationService::compositeStatus()` actually implements.
 */

import type { SummaryItem } from '../../components/SummaryStrip'
import { SYNC_STATUSES } from '../../services/reconciliationApi'
import { formatInt, humanize } from '../../utils/format'

/** What each composite status means, in the words a user would use. */
export const SYNC_MEANING: Record<string, string> = {
  IN_SYNC: 'Inventory has posted it and Books reports the same. Nothing to do.',
  PENDING_INVENTORY: 'The Inventory document is still a draft or mid-posting, so no stock has moved yet.',
  FAILED_INVENTORY: 'Inventory refused the stock effect. The reason is on the row — fix it and post again.',
  REVERSED_INVENTORY: 'Inventory reversed or cancelled the document while the Books voucher still stands.',
  CANCELLED_IN_BOOKS: 'Books cancelled the voucher; the Inventory document is still posted.',
  CANCELLED_BOTH: 'Cancelled on both sides. Nothing to clear.',
  MISSING_IN_BOOKS: 'Inventory posted it and Books reported nothing at all for it.',
  MISSING_IN_INVENTORY: 'Books has a stock voucher with no Inventory document behind it.',
  PENDING_IN_BOOKS: 'Inventory posted; the Books side is still pending.',
  FAILED_IN_BOOKS: 'Inventory posted; the Books side failed.',
  BOOKS_UNAVAILABLE: 'Books could not be reached, so only the Inventory side is known.',
  BOOKS_STATUS_UNKNOWN: 'Books answered with a status this app does not recognise. That is not agreement.',
}

const TONE: Record<string, SummaryItem['tone']> = {
  IN_SYNC: 'good',
  PENDING_INVENTORY: 'neutral',
  PENDING_IN_BOOKS: 'neutral',
  CANCELLED_BOTH: 'neutral',
  REVERSED_INVENTORY: 'warning',
  CANCELLED_IN_BOOKS: 'warning',
  BOOKS_UNAVAILABLE: 'warning',
  BOOKS_STATUS_UNKNOWN: 'warning',
  FAILED_INVENTORY: 'critical',
  FAILED_IN_BOOKS: 'critical',
  MISSING_IN_BOOKS: 'critical',
  MISSING_IN_INVENTORY: 'critical',
}

export const POSTING_STATUS_PATH = '/reconciliation/posting-status'

/** `IN_SYNC` → the screen filtered to exactly the rows the card counted. */
export function postingStatusLink(status: string): string {
  return `${POSTING_STATUS_PATH}?sync_status=${encodeURIComponent(status)}`
}

/**
 * The summary as KPI cards, in the vocabulary's own order so the strip does not
 * reshuffle itself between refreshes. A status the server did not report is not
 * shown: an invented zero reads as "checked, none found" when nothing was
 * checked at all.
 */
export function postingStatusCards(summary: Record<string, number> | null | undefined): SummaryItem[] {
  if (!summary) return []
  const known = SYNC_STATUSES.filter((s) => s in summary)
  const extra = Object.keys(summary).filter((k) => !(SYNC_STATUSES as readonly string[]).includes(k))
  return [...known, ...extra].map((status) => ({
    label: humanize(status),
    value: formatInt(summary[status]),
    hint: SYNC_MEANING[status] ?? 'Status reported by the posting comparison.',
    tone: TONE[status] ?? 'neutral',
    to: postingStatusLink(status),
  }))
}
