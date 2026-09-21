/**
 * Talking to the OTHER Aicountly products.
 *
 * Every product owns its own database and Inventory never copies a row out of one:
 * Manage owns company / branch / financial year, Purchases owns purchase orders and their
 * balances, Books owns supplier ledgers and the accounting side. Inventory reads them over a
 * live API each time it needs them (`docs/DOMAIN_OWNERSHIP.md`), exactly as the Manage relay
 * already does through `ManageProxyController`.
 *
 * Some of those relays are not built yet. That is not a reason to mirror a table here — it is a
 * reason for the call to say "not wired up" instead of throwing, so the screen can fall back to
 * what Inventory itself knows and keep working. `relayCall` is that contract: a resolved
 * `RelayResult`, never an exception, for the statuses that mean "this endpoint does not exist
 * for this company yet".
 */

import { ApiError, errorMessage, isAbortError, isApiError } from './api'

/** Why a relay could not answer. `unavailable` = the endpoint is not deployed yet. */
export type RelayUnavailableReason = 'unavailable' | 'forbidden' | 'error'

export type RelayResult<T> =
  | { available: true; data: T }
  | { available: false; reason: RelayUnavailableReason; message: string }

/**
 * Statuses that mean "there is no such relay here", as opposed to "the relay failed".
 *
 * 404 — the route is not mounted. 501 — mounted but not implemented. 502/503/504 — the upstream
 * product is not reachable from this deployment. All four leave Inventory's own data intact, so
 * the caller degrades instead of showing an error the user can do nothing about.
 */
const NOT_WIRED = new Set([404, 501, 502, 503, 504])

export async function relayCall<T>(run: () => Promise<T>, what: string): Promise<RelayResult<T>> {
  try {
    return { available: true, data: await run() }
  } catch (err) {
    if (isAbortError(err)) throw err
    if (isApiError(err)) {
      if (NOT_WIRED.has(err.status)) {
        return { available: false, reason: 'unavailable', message: `${what} is not connected to this company yet.` }
      }
      if (err.status === 403 || err.status === 401) {
        return { available: false, reason: 'forbidden', message: `You do not have access to ${what}.` }
      }
      // A network error never reached a relay at all; report it as a failure, not as "not built".
      if (err instanceof ApiError && err.status === 0) {
        return { available: false, reason: 'error', message: err.message }
      }
      return { available: false, reason: 'error', message: err.message }
    }
    return { available: false, reason: 'error', message: errorMessage(err, `Could not reach ${what}.`) }
  }
}
