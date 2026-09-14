/**
 * Configure Columns — which columns of a register a reader wants to see.
 *
 * Typed port of books-react-app/web/src/modules/reports/shared/reportColumnPrefs.js.
 *
 * The choice is stored per *user*, not per browser. On a shared machine one
 * person turning a unit-cost or margin column on must not carry over to the
 * next person who signs in, so keys are scoped by the Inventory member uuid
 * (`access.me.member.uuid`). Until that uuid is known every column reads as its
 * shipped default — the safe direction to fail in, because the columns that are
 * off by default are the ones that disclose cost.
 *
 * One `visibleColumns` list feeds the table, the totals row, the CSV and the
 * print sheet, so a column switched off cannot survive into the spreadsheet.
 */

export interface ColumnPrefDef {
  key: string
  /** Identifies the row — listed as fixed, never as a checkbox that does nothing. */
  alwaysVisible?: boolean
  /** Ships hidden when explicitly false. */
  defaultVisible?: boolean
}

export type ColumnVisibility = Record<string, boolean>

const KEY_PREFIX = 'inventory.reports.columns'

function storageKey(reportKey: string, userUuid: string | null | undefined): string | null {
  const id = String(userUuid ?? '').trim()
  const report = String(reportKey ?? '').trim()
  if (!id || !report) return null
  return `${KEY_PREFIX}.${report}.${id}`
}

function safeStorage(): Storage | null {
  try {
    return window.localStorage
  } catch {
    return null
  }
}

/** Every column's shipped visibility, keyed by column key. */
export function defaultColumnVisibility(columns: readonly ColumnPrefDef[] = []): ColumnVisibility {
  const out: ColumnVisibility = {}
  for (const col of columns) {
    if (!col?.key) continue
    out[col.key] = col.alwaysVisible === true || col.defaultVisible !== false
  }
  return out
}

/**
 * Stored visibility merged over the defaults.
 *
 * Only keys the register still defines are honoured, and only `true`/`false` is
 * taken from storage: a renamed column or a hand-edited value cannot turn a
 * column on by being merely truthy, and a column added in a later release
 * arrives at its own default rather than hidden because an older preference
 * never mentioned it.
 */
export function loadColumnPrefs(
  reportKey: string,
  columns: readonly ColumnPrefDef[] = [],
  userUuid?: string | null,
): ColumnVisibility {
  const defaults = defaultColumnVisibility(columns)
  const key = storageKey(reportKey, userUuid)
  if (!key) return defaults
  const store = safeStorage()
  if (!store) return defaults
  try {
    const raw = store.getItem(key)
    if (!raw) return defaults
    const parsed: unknown = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return defaults
    const stored = parsed as Record<string, unknown>
    const out: ColumnVisibility = { ...defaults }
    for (const col of columns) {
      if (!col?.key || col.alwaysVisible === true) continue
      const value = stored[col.key]
      if (value === true || value === false) out[col.key] = value
    }
    return out
  } catch {
    return defaults
  }
}

/** Persist a full visibility map. Silent when storage is unavailable. */
export function saveColumnPrefs(
  reportKey: string,
  visibility: ColumnVisibility,
  userUuid?: string | null,
): void {
  const key = storageKey(reportKey, userUuid)
  if (!key) return
  const store = safeStorage()
  if (!store) return
  try {
    store.setItem(key, JSON.stringify(visibility ?? {}))
  } catch {
    // A display preference is not worth failing a register render over.
  }
}

/** Drop the stored choice so the register goes back to its shipped columns. */
export function clearColumnPrefs(reportKey: string, userUuid?: string | null): void {
  const key = storageKey(reportKey, userUuid)
  if (!key) return
  const store = safeStorage()
  if (!store) return
  try {
    store.removeItem(key)
  } catch {
    // Nothing to recover from — the caller has already reset its own state.
  }
}

/**
 * Whether one column is on, given a map that may not mention it. The dialog's
 * checkboxes and the rendered column list both go through this, so a partial
 * map cannot leave a column ticked in the dialog and absent from the table.
 */
export function isColumnVisible(col: ColumnPrefDef, visibility: ColumnVisibility = {}): boolean {
  if (!col?.key) return false
  if (col.alwaysVisible === true) return true
  const state = visibility[col.key]
  return state === undefined ? col.defaultVisible !== false : state === true
}

/** The columns to render, in declared order. */
export function visibleColumns<T extends ColumnPrefDef>(
  columns: readonly T[] = [],
  visibility: ColumnVisibility = {},
): T[] {
  return columns.filter((col) => isColumnVisible(col, visibility))
}

/** True when the reader has not moved any column away from the shipped set. */
export function columnPrefsAreDefault(
  columns: readonly ColumnPrefDef[] = [],
  visibility: ColumnVisibility = {},
): boolean {
  const defaults = defaultColumnVisibility(columns)
  return columns.every((col) => isColumnVisible(col, visibility) === defaults[col.key])
}
