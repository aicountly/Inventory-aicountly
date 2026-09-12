/**
 * Remembered company / financial year / branch selection.
 *
 * Same localStorage keys as the other AICOUNTLY products (`selected_company_id`,
 * `selected_fy_id`, `selected_bo_id`) so the mental model carries over; storage
 * is origin-scoped, so there is no cross-product bleed. Values are validated on
 * the way out: a corrupt or foreign value reads as "nothing remembered".
 */

export const SELECTED_COMPANY_KEY = 'selected_company_id'
export const SELECTED_FY_KEY = 'selected_fy_id'
export const SELECTED_BO_KEY = 'selected_bo_id'

export interface StoredSelection {
  cmpId: number | null
  fyId: number | null
  /** 0 = consolidated; null = nothing remembered. */
  boId: number | null
}

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

function positiveInt(raw: string | null): number | null {
  if (raw === null || raw === '') return null
  const n = Number(raw)
  return Number.isInteger(n) && n > 0 ? n : null
}

function nonNegativeInt(raw: string | null): number | null {
  if (raw === null || raw === '') return null
  const n = Number(raw)
  return Number.isInteger(n) && n >= 0 ? n : null
}

export function readSelection(store: KeyValueStore | null = defaultStore()): StoredSelection {
  if (!store) return { cmpId: null, fyId: null, boId: null }
  try {
    return {
      cmpId: positiveInt(store.getItem(SELECTED_COMPANY_KEY)),
      fyId: positiveInt(store.getItem(SELECTED_FY_KEY)),
      boId: nonNegativeInt(store.getItem(SELECTED_BO_KEY)),
    }
  } catch {
    return { cmpId: null, fyId: null, boId: null }
  }
}

export function writeSelection(sel: Partial<StoredSelection>, store: KeyValueStore | null = defaultStore()): void {
  if (!store) return
  const put = (key: string, value: number | null | undefined) => {
    if (value === undefined) return
    if (value === null) store.removeItem(key)
    else store.setItem(key, String(value))
  }
  try {
    put(SELECTED_COMPANY_KEY, sel.cmpId)
    put(SELECTED_FY_KEY, sel.fyId)
    put(SELECTED_BO_KEY, sel.boId)
  } catch {
    /* quota / private mode — the selection just is not remembered */
  }
}

export function clearSelection(store: KeyValueStore | null = defaultStore()): void {
  if (!store) return
  try {
    store.removeItem(SELECTED_COMPANY_KEY)
    store.removeItem(SELECTED_FY_KEY)
    store.removeItem(SELECTED_BO_KEY)
  } catch {
    /* ignore */
  }
}
