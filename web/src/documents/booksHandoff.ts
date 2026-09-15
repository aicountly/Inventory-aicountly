/**
 * Posting a stock document now waits for the books to accept its accounting entry before the
 * post is reported as done (server: DocumentPostingService::post ->
 * BooksJournalHandoff::deliver). Stock and the ledger therefore move together, and the price of
 * that is availability: while the books are unreachable, a stock document cannot be posted at
 * all.
 *
 * That trade is deliberate, but a user who is refused without being told why will retry, then
 * re-enter the document, then telephone somebody. These are the three answers the server can
 * give, turned into something a storekeeper can act on:
 *
 *   books_unavailable         (503) the books did not answer; the document was reversed, no
 *                                   stock moved. Wait and post again.
 *   books_refused             (409) the books answered and would not take the entry; the
 *                                   document was reversed, no stock moved. The reason is theirs.
 *   books_handoff_unresolved  (500) the entry was not accepted AND the stock movement could not
 *                                   be undone. The only case where something is left to repair,
 *                                   and the only one where re-entering the document would
 *                                   double the stock.
 */

import { isApiError } from '../services/api'

export const BOOKS_UNAVAILABLE = 'books_unavailable'
export const BOOKS_REFUSED = 'books_refused'
export const BOOKS_UNRESOLVED = 'books_handoff_unresolved'

export const BOOKS_HANDOFF_CODES = [BOOKS_UNAVAILABLE, BOOKS_REFUSED, BOOKS_UNRESOLVED] as const

export type BooksHandoffKind = (typeof BOOKS_HANDOFF_CODES)[number]

export interface BooksHandoffBlock {
  kind: BooksHandoffKind
  /** Title for the notice. */
  title: string
  /** What happened, in the user's terms. */
  message: string
  /** What to do next. */
  advice: string
  /** True when the stock movement was taken back off the books — nothing changed. */
  reversed: boolean
  /** Verbatim reason from the books, when they gave one. */
  booksError: string | null
  /** The durable repair record, for support to quote. */
  handoffId: number | null
}

function str(v: unknown): string | null {
  return typeof v === 'string' && v.trim() !== '' ? v.trim() : null
}

/**
 * The block this error describes, or null when it is not a books-handoff failure.
 *
 * `reversed` is read from the server's details and defaults to FALSE when the field is missing:
 * claiming "nothing changed" when we were not told so would send somebody off to re-enter a
 * document whose stock did move.
 */
export function parseBooksHandoff(err: unknown): BooksHandoffBlock | null {
  if (!isApiError(err)) return null
  const kind = BOOKS_HANDOFF_CODES.find((c) => c === err.code)
  if (!kind) return null
  const details = (err.details ?? {}) as Record<string, unknown>
  const reversed = details.reversed === true
  const booksError = str(details.books_error)
  const handoffId = typeof details.handoff_id === 'number' && details.handoff_id > 0 ? details.handoff_id : null

  if (kind === BOOKS_UNRESOLVED) {
    return {
      kind,
      title: 'Posted in stock, but not in the books — being repaired',
      message:
        'The books did not accept the accounting entry for this document, and the stock movement could not be undone automatically. Stock has moved here and there is no entry in the books for it.',
      advice:
        'Do NOT re-enter this document — that would move the stock a second time. It is recorded for repair and is retried automatically; quote the repair reference to support if it does not clear.',
      reversed,
      booksError,
      handoffId,
    }
  }

  if (kind === BOOKS_REFUSED) {
    return {
      kind,
      title: 'The books would not accept this entry — nothing was posted',
      message: `The books refused the accounting entry for this document, so the stock movement was ${reversed ? 'reversed' : 'not completed'} and no stock has changed.`,
      advice:
        'This is usually a setup problem in the books (a missing ledger or a closed period) rather than anything wrong with the document. Fix the reason below in the books, then post again.',
      reversed,
      booksError,
      handoffId,
    }
  }

  return {
    kind,
    title: 'The books are not answering — nothing was posted',
    message: `The accounting service could not be reached, so the stock movement was ${reversed ? 'reversed' : 'not completed'} and no stock has changed.`,
    advice:
      'Stock and the books have to record the same movement in the same moment, so Inventory does not post stock while the books are unavailable. Nothing is lost — the document is still here. Try posting again in a few minutes.',
    reversed,
    booksError,
    handoffId,
  }
}
