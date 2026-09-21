/**
 * Local recovery for a stock journal that was being typed when the tab died.
 *
 * This is a UI convenience and nothing more. A recovered draft is **not** a
 * document: it has no id, it was never sent, it holds no stock and it carries no
 * audit trail. The screen says so when it offers one, and the entry is dropped
 * the moment the real draft is saved through the API.
 *
 * Scoped per company / branch / financial year, because a draft typed against
 * one company's warehouses is meaningless under another.
 */

import type { HeaderDraft, LineDraft } from '../formModel'

const VERSION = 1
const PREFIX = 'aic.inv.sj.draft'
/** Older than this and the draft is more confusing than useful. */
const MAX_AGE_MS = 24 * 60 * 60 * 1000

export interface StoredDraft {
  version: number
  savedAt: number
  header: HeaderDraft
  lines: LineDraft[]
}

export interface DraftScope {
  cmpId: number | null
  boId: number
  fyId: number | null
  /** Set when editing a saved draft, so a new document and an edit never collide. */
  documentId?: number | null
}

export function draftKey(scope: DraftScope): string {
  const doc = scope.documentId ? `d${scope.documentId}` : 'new'
  return `${PREFIX}.${scope.cmpId ?? 0}.${scope.boId}.${scope.fyId ?? 0}.${doc}`
}

/** Storage can be absent (private mode, blocked cookies); never let that break entry. */
function storage(): Storage | null {
  try {
    return window.localStorage
  } catch {
    return null
  }
}

export function saveDraft(scope: DraftScope, header: HeaderDraft, lines: LineDraft[]): void {
  const store = storage()
  if (!store) return
  try {
    const payload: StoredDraft = { version: VERSION, savedAt: Date.now(), header, lines }
    store.setItem(draftKey(scope), JSON.stringify(payload))
  } catch {
    /* quota or a serialisation failure — recovery is best effort by definition */
  }
}

export function readDraft(scope: DraftScope): StoredDraft | null {
  const store = storage()
  if (!store) return null
  try {
    const raw = store.getItem(draftKey(scope))
    if (!raw) return null
    const parsed = JSON.parse(raw) as StoredDraft
    if (parsed?.version !== VERSION || !parsed.header || !Array.isArray(parsed.lines)) return null
    if (Date.now() - parsed.savedAt > MAX_AGE_MS) {
      store.removeItem(draftKey(scope))
      return null
    }
    return parsed
  } catch {
    return null
  }
}

export function clearDraft(scope: DraftScope): void {
  const store = storage()
  if (!store) return
  try {
    store.removeItem(draftKey(scope))
  } catch {
    /* nothing to do */
  }
}

/**
 * Whether the draft holds anything worth offering back. A date on its own is
 * every new document, so it does not count.
 */
export function isWorthKeeping(header: HeaderDraft, lines: readonly LineDraft[]): boolean {
  if (header.reason_code.trim() || header.movement_reason.trim() || header.narration.trim() || header.document_no.trim()) return true
  return lines.some((l) => l.item_id !== null || l.qty.trim() !== '' || l.description.trim() !== '')
}
