/**
 * What a failed card says to the person looking at it.
 *
 * The screen this replaces printed the API's own message straight onto the
 * card, which is how a user came to be reading
 *
 *     Could not load this card.
 *     Company context required (cmp_id, fy_id, bo_id)
 *
 * Three column names and a 400 are a note from the server to us. They tell the
 * reader nothing they can act on, they expose the shape of the request, and
 * they read as a crash. Every failure a card can hit is mapped here to a title
 * and a sentence in the user's own vocabulary; the original error keeps
 * travelling to the console for whoever is debugging it.
 *
 * Pure and exported so the mapping is unit-tested rather than asserted by
 * reading six components.
 */

import { ApiError, isApiError } from '../services/api'

export interface CardErrorCopy {
  title: string
  message: string
  /** False when retrying cannot possibly help — a permission, a locked scope. */
  retryable: boolean
  /** Rendered as a quieter, non-alarming panel: nothing is broken. */
  tone: 'error' | 'notice'
}

/** The generic fallback, named so callers can compare against it in tests. */
const GENERIC: CardErrorCopy = {
  title: 'We couldn’t load this',
  message: 'Some information is temporarily unavailable. Try again in a moment.',
  retryable: true,
  tone: 'error',
}

/**
 * `subject` names the thing that failed, in words a user would use —
 * "inventory value", "stock ageing". It is folded into the title so a page of
 * cards does not read as six copies of the same sentence.
 */
export function cardErrorCopy(error: unknown, subject = 'this'): CardErrorCopy {
  const titleFor = (verb: string) => `We couldn’t ${verb} ${subject}`

  if (!isApiError(error)) {
    // A timeout is not a failure of the data — it is a slow answer, and the
    // honest advice is different.
    const name = error instanceof Error ? error.name : ''
    if (name === 'TimeoutError' || name === 'AbortError') {
      return {
        title: titleFor('finish loading'),
        message: 'The request took longer than expected. Try again, or narrow the date or warehouse first.',
        retryable: true,
        tone: 'error',
      }
    }
    return { ...GENERIC, title: titleFor('load') }
  }

  const api = error as ApiError

  switch (api.code) {
    // The one this module was written for. The user has not done anything
    // wrong and there is nothing to retry until a company and year are chosen.
    case 'context_required':
      return {
        title: 'Select a company and financial year',
        message: 'Valuation insights are shown for one company, financial year and branch at a time. Pick them in the header above.',
        retryable: false,
        tone: 'notice',
      }
    case 'forbidden':
      return {
        title: 'You don’t have access to this',
        message: 'Your access profile does not include this information. An administrator can grant it in Settings → Access.',
        retryable: false,
        tone: 'notice',
      }
    case 'unauthorized':
      return {
        title: 'Your session has expired',
        message: 'Sign in again to continue — the figures on this page could not be refreshed.',
        retryable: true,
        tone: 'error',
      }
    case 'not_found':
      return {
        title: titleFor('load'),
        message: 'This information is not available for the selected company or financial year.',
        retryable: false,
        tone: 'notice',
      }
    case 'network_error':
      return {
        title: titleFor('reach'),
        message: 'We could not reach Inventory. Check your connection and try again.',
        retryable: true,
        tone: 'error',
      }
    case 'validation_failed':
    case 'bad_request':
      return {
        title: titleFor('load'),
        message: 'That combination of date and warehouse could not be read. Change a filter and try again.',
        retryable: true,
        tone: 'error',
      }
    default:
      break
  }

  if (api.status >= 500) {
    return {
      title: titleFor('load'),
      message: 'Inventory could not complete this calculation just now. Try again in a moment.',
      retryable: true,
      tone: 'error',
    }
  }

  return { ...GENERIC, title: titleFor('load') }
}

/**
 * True when the failure is the scope not being chosen yet.
 *
 * The page uses it to say so ONCE at the top rather than on each of six cards:
 * a company that has not been picked is one fact, not six failures.
 */
export function isContextError(error: unknown): boolean {
  return isApiError(error) && error.code === 'context_required'
}
