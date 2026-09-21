/**
 * Saved views — a named set of filters a reader comes back to.
 *
 * Stored in `localStorage`, scoped by register and by the signed-in member's uuid, which
 * is exactly how this app already stores column preferences (`registers/columnPrefs.ts`):
 * on a shared machine one person's views must not greet the next person who signs in.
 *
 * It is deliberately NOT presented as a team feature. Inventory's API has no saved-view
 * resource, so nothing here can be shared with a colleague, survive a cleared browser or
 * reach a second device — and a control that implied otherwise would be the worst kind of
 * wrong, because the reader only finds out when the view they relied on is gone. The menu
 * says where the views live, in as many words, and the store is written against this small
 * interface so a future `/v1/saved-views` can replace the storage without touching the UI.
 *
 * What a view holds is the register's own URL query: its filters, its sort and its page
 * size, which is the whole of the question the server was asked. Column choices are
 * already remembered per register by columnPrefs, so a view does not restate them —
 * applying one changes what you are looking AT, never how the grid is laid out.
 */

export interface SavedView {
  id: string
  name: string
  /** The register's URL query string, without the leading `?`. */
  query: string
  /** Epoch millis, for ordering and for "saved on" in the menu. */
  savedAt: number
}

const KEY_PREFIX = 'inventory.registers.views'
/** Enough for a working set; a hundred named views is a filing system, not a shortcut. */
export const MAX_SAVED_VIEWS = 20

function storageKey(registerKey: string, userUuid: string | null | undefined): string | null {
  const id = String(userUuid ?? '').trim()
  const register = String(registerKey ?? '').trim()
  if (!id || !register) return null
  return `${KEY_PREFIX}.${register}.${id}`
}

function safeStorage(): Storage | null {
  try {
    return window.localStorage
  } catch {
    return null
  }
}

function isView(value: unknown): value is SavedView {
  if (!value || typeof value !== 'object') return false
  const v = value as Record<string, unknown>
  return (
    typeof v.id === 'string' &&
    typeof v.name === 'string' &&
    typeof v.query === 'string' &&
    typeof v.savedAt === 'number'
  )
}

/** Every view for this register and member, newest first. Never throws. */
export function loadSavedViews(registerKey: string, userUuid?: string | null): SavedView[] {
  const key = storageKey(registerKey, userUuid)
  const store = key ? safeStorage() : null
  if (!key || !store) return []
  try {
    const parsed: unknown = JSON.parse(store.getItem(key) ?? '[]')
    if (!Array.isArray(parsed)) return []
    return parsed.filter(isView).sort((a, b) => b.savedAt - a.savedAt)
  } catch {
    return []
  }
}

/**
 * Write the list, then hand back what can actually be read again.
 *
 * Reading back rather than returning the optimistic list is the point: with no member
 * uuid yet, or in a browser that refuses `localStorage`, the write is a no-op and a
 * caller handed its own list would show the reader a view that will not be there when
 * the panel is next opened. A shortcut that silently forgets is worse than one that
 * plainly did not save, so the caller is told the truth and the register renders either
 * way — nothing here throws.
 */
function persist(registerKey: string, userUuid: string | null | undefined, views: SavedView[]): SavedView[] {
  const key = storageKey(registerKey, userUuid)
  const store = key ? safeStorage() : null
  if (!key || !store) return loadSavedViews(registerKey, userUuid)
  try {
    store.setItem(key, JSON.stringify(views))
  } catch {
    // Quota, or a private window that allows reads and refuses writes.
  }
  return loadSavedViews(registerKey, userUuid)
}

/**
 * Save `query` under `name`, replacing a view of the same name.
 *
 * Replacing rather than duplicating is the behaviour a reader expects from "save": two
 * entries called "Chennai receipts" differing by a filter nobody can see is a list you
 * cannot use. The name is trimmed and compared case-insensitively for the same reason.
 */
export function saveView(
  registerKey: string,
  userUuid: string | null | undefined,
  name: string,
  query: string,
): SavedView[] {
  const trimmed = name.trim()
  if (!trimmed) return loadSavedViews(registerKey, userUuid)
  const existing = loadSavedViews(registerKey, userUuid).filter(
    (v) => v.name.toLowerCase() !== trimmed.toLowerCase(),
  )
  const view: SavedView = {
    id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
    name: trimmed,
    query: query.replace(/^\?/, ''),
    savedAt: Date.now(),
  }
  return persist(registerKey, userUuid, [view, ...existing].slice(0, MAX_SAVED_VIEWS))
}

export function deleteView(
  registerKey: string,
  userUuid: string | null | undefined,
  id: string,
): SavedView[] {
  return persist(
    registerKey,
    userUuid,
    loadSavedViews(registerKey, userUuid).filter((v) => v.id !== id),
  )
}

/**
 * Whether a saved view is the one currently on screen.
 *
 * Compared as sorted key/value pairs rather than as strings: `?to=x&from=y` asks the same
 * question as `?from=y&to=x`, and a menu that failed to tick the view a reader had just
 * applied would send them clicking it again.
 */
export function viewMatchesQuery(view: SavedView, query: string): boolean {
  const normalise = (q: string) =>
    [...new URLSearchParams(q.replace(/^\?/, ''))]
      .filter(([, value]) => value !== '')
      .map(([key, value]) => `${key}=${value}`)
      .sort()
      .join('&')
  return normalise(view.query) === normalise(query)
}
