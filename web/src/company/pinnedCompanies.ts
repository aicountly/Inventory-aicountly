/**
 * Companies pinned to the top of the switcher's list.
 *
 * Purely a per-browser convenience — client-side only, never sent to the
 * server, never affects which company is actually selected. A company with
 * many entities benefits from being able to put the two or three it opens
 * every day at the top of a list that is otherwise in whatever order Manage
 * returns it, the same affordance Books offers via its star.
 *
 * Deliberately NOT the same thing as Books' star, which sets a *default*
 * company persisted server-side (`userPreferencesApi`) and changes what opens
 * on next sign-in. Inventory already remembers the last-opened company per
 * browser (`companyStorage.ts`) — that is the "default" here. Pinning only
 * changes display order in this list; it never changes what loads on its own.
 */

const STORAGE_KEY = 'inventory.company.pinned'

/** Minimal Storage surface so tests can pass a Map-backed fake. */
export interface KeyValueStore {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
  removeItem(key: string): void
}

function defaultStore(): KeyValueStore | null {
  try {
    return window.localStorage
  } catch {
    return null
  }
}

/** Positive integers only — anything else in storage is treated as absent. */
export function readPinnedCompanies(store: KeyValueStore | null = defaultStore()): ReadonlySet<number> {
  if (!store) return new Set()
  try {
    const raw = store.getItem(STORAGE_KEY)
    if (!raw) return new Set()
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return new Set()
    return new Set(parsed.filter((n): n is number => Number.isInteger(n) && n > 0))
  } catch {
    return new Set()
  }
}

function writePinnedCompanies(ids: ReadonlySet<number>, store: KeyValueStore | null = defaultStore()): void {
  if (!store) return
  try {
    if (ids.size === 0) store.removeItem(STORAGE_KEY)
    else store.setItem(STORAGE_KEY, JSON.stringify([...ids]))
  } catch {
    /* quota / private mode — pinning just does not persist this session */
  }
}

/** Toggle one company's pin and persist the result. Returns the new set. */
export function togglePinnedCompany(cmpId: number, store: KeyValueStore | null = defaultStore()): ReadonlySet<number> {
  const current = readPinnedCompanies(store)
  const next = new Set(current)
  if (next.has(cmpId)) next.delete(cmpId)
  else next.add(cmpId)
  writePinnedCompanies(next, store)
  return next
}
