/**
 * Links out of the job-work screens.
 *
 * A job worker is a Books ledger and the ledger is read in Books, live. This
 * builds the link; it does not fetch anything, and Inventory holds no copy of
 * what is on the other side of it.
 */

import { getAppById, resolveAppOrigin } from '../../services/appLauncher'

/**
 * The job worker's ledger in Smart Books, on the environment this app is
 * running in (sandbox or production). Null when the catalog has no Books entry
 * — the field then simply shows no link rather than one that cannot resolve.
 */
export function booksLedgerHref(partyRef: number | string | null | undefined): string | null {
  const ref = typeof partyRef === 'number' ? partyRef : Number(String(partyRef ?? '').trim())
  if (!Number.isFinite(ref) || ref <= 0) return null
  const books = getAppById('books')
  if (!books) return null
  return `${resolveAppOrigin(books)}/ledgers/${Math.floor(ref)}`
}
