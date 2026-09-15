import { useCallback, useMemo, useState } from 'react'
import { useAccess } from '../access/AccessContext'
import { loadColumnPrefs, saveColumnPrefs, visibleColumns as filterVisible } from './columnPrefs'
import type { ColumnPrefDef, ColumnVisibility } from './columnPrefs'

export interface ColumnConfig<T extends ColumnPrefDef> {
  visibility: ColumnVisibility
  setVisibility: (next: ColumnVisibility) => void
  /** The columns to render — and to export, and to print. */
  visibleColumns: T[]
  /** Every amount column the register defines, visible or not. */
  amountKeys: string[]
  /** Part of the table's reset key: a changed grid means a stale cursor. */
  columnsKey: string
  /** False until the member uuid is known, so the button can wait its turn. */
  ready: boolean
}

/**
 * Configure-Columns state for one register.
 *
 * The table, the totals row, the CSV and the print sheet all read
 * `visibleColumns`, so the four cannot disagree about which columns exist — a
 * column switched off here is gone from the spreadsheet as well as the screen.
 *
 * `amountKeys` deliberately covers every amount column, hidden ones included:
 * a derived figure still needs its inputs when the column it derives from is
 * off. Only the display picks from `visibleColumns`.
 */
export function useColumnConfig<T extends ColumnPrefDef>(
  reportKey: string,
  columns: readonly T[],
): ColumnConfig<T> {
  const { member } = useAccess()
  const userUuid = member?.uuid ?? null

  // Read once per (register, user). Re-reading on every render would fight the
  // reader's own clicks, and the preference only changes through the setter.
  const [byUser, setByUser] = useState<Record<string, ColumnVisibility>>({})
  const stateKey = `${reportKey}::${userUuid ?? ''}`
  const visibility = useMemo(
    () => byUser[stateKey] ?? loadColumnPrefs(reportKey, columns, userUuid),
    // `columns` is a stable array from the config module.
    [byUser, stateKey, reportKey, columns, userUuid],
  )

  const setVisibility = useCallback(
    (next: ColumnVisibility) => {
      setByUser((prev) => ({ ...prev, [stateKey]: next }))
      saveColumnPrefs(reportKey, next, userUuid)
    },
    [reportKey, stateKey, userUuid],
  )

  const visible = useMemo(() => filterVisible(columns, visibility), [columns, visibility])

  const amountKeys = useMemo(
    () =>
      columns
        .filter((col) => (col as ColumnPrefDef & { amount?: boolean }).amount === true)
        .map((col) => col.key),
    [columns],
  )

  const columnsKey = useMemo(() => visible.map((col) => col.key).join(','), [visible])

  return {
    visibility,
    setVisibility,
    visibleColumns: visible,
    amountKeys,
    columnsKey,
    ready: userUuid !== null,
  }
}
