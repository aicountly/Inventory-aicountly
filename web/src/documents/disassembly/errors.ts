/**
 * Turning an API failure into a sentence a stores clerk can act on.
 *
 * Raw exception text never reaches the screen: the technical detail goes to the console for a
 * developer, and the user gets what happened plus what to do about it. The status codes below
 * are the ones this screen can actually provoke.
 */

import { ApiError, errorMessage, isApiError } from '../../services/api'

export interface FriendlyError {
  message: string
  /** Offer a "refresh availability and costs" action beside the message. */
  refreshable?: boolean
  /** The server named a field; the form highlights it. */
  field?: string | null
}

export function describeError(err: unknown, action: 'save' | 'post'): FriendlyError {
  if (isApiError(err)) return fromApi(err, action)
  // A fetch that never reached the server throws a TypeError, not an ApiError.
  if (err instanceof Error && /network|fetch|timeout|abort/i.test(err.message)) {
    return { message: 'Could not reach the server. Check your connection and try again — nothing was changed.' }
  }
  return { message: errorMessage(err, action === 'post' ? 'The disassembly could not be posted.' : 'The draft could not be saved.') }
}

function fromApi(err: ApiError, action: 'save' | 'post'): FriendlyError {
  switch (err.status) {
    case 401:
      return { message: 'Your session has expired. Sign in again — this document has not been saved.' }
    case 403:
      return {
        message:
          action === 'post'
            ? 'You do not have permission to post a disassembly. Save it as a draft and ask someone who can post it.'
            : 'You do not have permission to save this document.',
      }
    case 404:
      return { message: 'This draft no longer exists — it may have been deleted or posted elsewhere. Reload the screen before trying again.', refreshable: true }
    case 409:
      return {
        message: 'Stock has changed since this document was loaded. Refresh availability before posting.',
        refreshable: true,
      }
    case 422:
      // The server's own validation message is written for the user and names the field.
      return { message: err.message, field: err.field }
    case 429:
      return { message: 'Too many requests. Wait a moment and try again.' }
    default:
      if (err.status >= 500) {
        return {
          message:
            action === 'post'
              ? 'Unable to post the disassembly. No stock changes were committed — try again in a moment.'
              : 'Unable to save the draft right now. Try again in a moment.',
          refreshable: true,
        }
      }
      return { message: err.message, field: err.field }
  }
}
