/**
 * The seam an Inventory AI service would plug into for serial intake.
 *
 * ## Why this is an interface and not an implementation
 *
 * Inventory has no AI endpoint. There is no controller under `server-php/app/Controllers/Api`
 * that takes a block of scanned text and returns interpreted serials, and no service key for
 * an external one. Writing a client for a route that does not exist would produce a button
 * that fails in production, and inventing plausible answers on the client would be worse —
 * an adjustment posted against a serial an algorithm guessed at is a stock record nobody can
 * audit.
 *
 * So: the screen asks `aiAssist` whether it is configured. It is not, today, and the AI panel
 * says so in as many words while the intake it sits on top of — scan, paste, import — keeps
 * working, because that intake is not AI. It reads live serials through `GET /v1/serials` and
 * shows the operator exactly what the API returned.
 *
 * To turn it on, give `configureSerialAiAssist()` an adapter that calls the real service. The
 * screen then offers the AI pass as an extra step BEFORE the live lookup, never instead of it,
 * and never as a reason to post: whatever comes back is a suggestion the operator sees, edits
 * and confirms.
 */

export interface SerialAiSuggestion {
  /** The serial number the service read out of the input. */
  serial_no: string
  /** What it changed, for the operator to see before accepting — 'O → 0', 'stripped prefix'. */
  note?: string | null
  /** 0–1. The screen sorts low-confidence suggestions to the top for review. */
  confidence?: number | null
}

export interface SerialAiResult {
  suggestions: SerialAiSuggestion[]
  /** Free-text the service wants shown, e.g. "12 of 14 lines looked like serial numbers". */
  summary?: string | null
}

export interface SerialAiAdapter {
  /** Interpret a raw block of scanned / pasted / imported text as serial numbers. */
  interpret(input: { text: string; signal?: AbortSignal }): Promise<SerialAiResult>
}

let adapter: SerialAiAdapter | null = null

/** Register the real service. Called from app bootstrap once the endpoint exists. */
export function configureSerialAiAssist(next: SerialAiAdapter | null): void {
  adapter = next
}

export const aiAssist = {
  /** False in every environment today — see the note at the top of this file. */
  isConfigured(): boolean {
    return adapter !== null
  },

  /** The line the panel shows when nothing is wired up. */
  unavailableReason(): string {
    return 'AI assistance is not configured for this environment. Scanning, pasting and importing below read live serial data from the API and work exactly as they do with it switched on.'
  },

  async interpret(text: string, signal?: AbortSignal): Promise<SerialAiResult> {
    if (!adapter) throw new Error('AI assistance is not configured for this environment.')
    return adapter.interpret({ text, signal })
  },
}
