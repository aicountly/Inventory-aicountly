/**
 * Seam for the Aicountly AI service (auto-fill from CSV, rate suggestions,
 * duplicate detection, stock validation) — a separate Aicountly product, not
 * a database Inventory shares.
 *
 * Nothing in this build calls that service yet, so this never fabricates a
 * suggestion: `status()` reports what is actually available today, and the UI
 * that renders its `message` is the whole feature until an endpoint exists.
 * Wiring the real integration later means giving `status()` a signal and an
 * `AbortSignal` and making it async; callers only read `.available`/`.message`,
 * so that change stays local to this file.
 */

export interface AiAssistantStatus {
  available: boolean
  message: string
}

const UNAVAILABLE: AiAssistantStatus = {
  available: false,
  message: 'AI-assisted opening stock tools will be connected through the Aicountly AI service.',
}

export const aiAssistantApi = {
  status(): AiAssistantStatus {
    return UNAVAILABLE
  },
}
