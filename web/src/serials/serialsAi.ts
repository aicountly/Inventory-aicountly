/**
 * The boundary an application-owned assistant would arrive behind.
 *
 * There is no Inventory AI endpoint today. This file exists so that when there
 * is one, exactly one thing changes — `serialAssistant()` starts returning an
 * available service — and no component has to be rewritten, no key ever lands
 * in the browser, and nothing calls a model directly from a page.
 *
 * Three rules are built into the shape of it, not left to the caller:
 *
 *  1. **It reads; it does not write.** There is no `apply`, no `update`, no
 *     mutation of any kind in this interface. A change to a serial number goes
 *     through the authorised workflow that validates and audits it. An
 *     assistant may explain a finding and suggest the filter that shows it —
 *     `SerialAiAnswer.filters` — and the operator presses the button.
 *  2. **It explains figures; it does not produce them.** Every number on the
 *     screen comes from `GET /v1/serials/summary`. An assistant that returned
 *     counts of its own would be a second, unauditable source for the same
 *     question.
 *  3. **Unavailable is a first-class state.** `available: false` carries the
 *     reason, and the card says it plainly and falls back to the rule-based
 *     findings rather than showing a button that does nothing.
 */

import type { SerialFinding } from './serialInsights'
import type { SerialSummary } from '../services/masters'

export interface SerialAiQuestion {
  question: string
  /** The figures on screen — what the answer must be consistent with. */
  summary: SerialSummary | null
  /** The deterministic findings, for the assistant to explain rather than redo. */
  findings: readonly SerialFinding[]
  /** Filters currently narrowing the list. */
  filters: Record<string, string>
}

export interface SerialAiAnswer {
  text: string
  /** A filter set the reader can apply — never applied on their behalf. */
  filters?: Record<string, string>
}

export interface SerialAiAvailable {
  available: true
  ask(question: SerialAiQuestion, signal?: AbortSignal): Promise<SerialAiAnswer>
}

export interface SerialAiUnavailable {
  available: false
  /** Said on the card, in words a user can act on. */
  reason: string
}

export type SerialAssistant = SerialAiAvailable | SerialAiUnavailable

/**
 * Whether this deployment has an assistant wired up.
 *
 * Returns unavailable, and will keep doing so until an Inventory-owned endpoint
 * exists behind the API. It is a function rather than a constant so that a
 * future implementation can consult configuration without every call site
 * changing shape.
 */
export function serialAssistant(): SerialAssistant {
  return {
    available: false,
    reason:
      'The Aicountly assistant is not connected to Inventory yet. The findings below are computed from this company’s own figures.',
  }
}
