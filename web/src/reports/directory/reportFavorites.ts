/**
 * Favourite reports — the stars on the report directory.
 *
 * Stored per *user*, not per browser, for the same reason column preferences
 * are (`registers/columnPrefs.ts`): on a shared machine the reports one person
 * pinned must not greet the next person who signs in. Until the member uuid is
 * known nothing is read or written, so favourites appear when the user is
 * known and never leak between them.
 *
 * Only directory ids are stored — `stock-summary`, `near-expiry`. They are the
 * same strings this file's own module declares, carry nothing about the
 * company, the user or the data, and are useless to anyone reading the
 * browser's storage.
 */

const KEY_PREFIX = 'inventory.reports.favorites'

/** Minimal Storage surface, so tests can pass a Map-backed fake. */
export interface KeyValueStore {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
  removeItem(key: string): void
}

export function defaultStore(): KeyValueStore | null {
  try {
    return window.localStorage
  } catch {
    return null
  }
}

function storageKey(userUuid: string | null | undefined): string | null {
  const id = String(userUuid ?? '').trim()
  return id ? `${KEY_PREFIX}.${id}` : null
}

/**
 * The stored favourites, narrowed to ids the directory still declares.
 *
 * A report that has been renamed or withdrawn leaves its id behind in storage;
 * honouring it would make "View favourites" show a count with no card under
 * it. `known` is the current id list, and anything outside it is dropped.
 */
export function readFavorites(
  userUuid: string | null | undefined,
  known: readonly string[],
  store: KeyValueStore | null = defaultStore(),
): ReadonlySet<string> {
  const key = storageKey(userUuid)
  if (!key || !store) return new Set()
  try {
    const raw = store.getItem(key)
    if (!raw) return new Set()
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return new Set()
    const allowed = new Set(known)
    return new Set(parsed.filter((id): id is string => typeof id === 'string' && allowed.has(id)))
  } catch {
    return new Set()
  }
}

export function writeFavorites(
  userUuid: string | null | undefined,
  ids: ReadonlySet<string>,
  store: KeyValueStore | null = defaultStore(),
): void {
  const key = storageKey(userUuid)
  if (!key || !store) return
  try {
    if (ids.size === 0) store.removeItem(key)
    else store.setItem(key, JSON.stringify([...ids]))
  } catch {
    /* quota or private mode — a star is not worth failing the page over */
  }
}

/** Toggle one report's star. Returns the new set; does not persist. */
export function toggleFavorite(ids: ReadonlySet<string>, id: string): ReadonlySet<string> {
  const next = new Set(ids)
  if (next.has(id)) next.delete(id)
  else next.add(id)
  return next
}
