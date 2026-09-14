/**
 * The pinned totals row of a register.
 *
 * Books' registers put a `<tfoot>` under every list whose figures come from the
 * server's total over the *whole filtered set*, not the page on screen — that
 * distinction is the whole point of a register, and it is why
 * `buildTotalsRow` takes an explicit value map rather than summing rows itself.
 * `sumColumn` exists for the handful of endpoints that send no summary block;
 * anything summed that way must be labelled "(page)" at the call site, exactly
 * as the legacy screens already do.
 *
 * Typed port in spirit of
 * books-react-app/web/src/modules/registers/registerTableTotals.js.
 */

import type { ReactNode } from 'react'

export interface TotalsColumn {
  key: string
  align?: 'left' | 'right' | 'center'
}

export interface BuildTotalsOptions {
  /** Row label, e.g. `Total (412 movements)`. */
  label?: ReactNode
  /** Column the label goes in. Defaults to the first non-right-aligned column. */
  labelKey?: string
}

/**
 * A totals record that mirrors the column list exactly.
 *
 * SmartTable reads `totals[col.key]` for every column, so a map with keys the
 * table does not have would silently vanish and a column the map does not have
 * would render `undefined`. Building it from the columns themselves means the
 * footer can never drift from the header — which is the bug this replaces:
 * hand-written footer rows that stop lining up the moment a column is hidden.
 */
export function buildTotalsRow(
  columns: readonly TotalsColumn[],
  values: Readonly<Record<string, ReactNode>> = {},
  options: BuildTotalsOptions = {},
): Record<string, ReactNode> {
  const out: Record<string, ReactNode> = {}
  if (!columns.length) return out

  const labelKey =
    options.labelKey && columns.some((c) => c.key === options.labelKey)
      ? options.labelKey
      : (columns.find((c) => c.align !== 'right') ?? columns[0]).key

  for (const col of columns) {
    const supplied = values[col.key]
    if (supplied !== undefined && supplied !== null) {
      out[col.key] = supplied
      continue
    }
    out[col.key] = col.key === labelKey && options.label !== undefined ? options.label : ''
  }

  // An explicit value for the label column wins, but the label still has to go
  // somewhere or the reader sees a row of numbers with no word against them.
  if (options.label !== undefined && out[labelKey] !== options.label) {
    const spare = columns.find((c) => c.align !== 'right' && out[c.key] === '')
    if (spare) out[spare.key] = options.label
  }

  return out
}

/**
 * The totals row as plain text, in column order, for the print sheet.
 *
 * A total built from JSX (a badge, a coloured span) has no text form, so it
 * prints blank rather than `[object Object]`. Configs that want a figure on
 * paper return a formatted string, which is what every one of them does.
 */
export function totalsRowToText(
  columns: readonly TotalsColumn[],
  totals: Readonly<Record<string, ReactNode>> | null | undefined,
): string[] | null {
  if (!totals) return null
  const out = columns.map((col) => {
    const value = totals[col.key]
    if (typeof value === 'string') return value
    if (typeof value === 'number') return String(value)
    return ''
  })
  return out.some((cell) => cell !== '') ? out : null
}

/** Sum one numeric field over the rows on screen. Rounded like the API does. */
export function sumColumn<T>(rows: readonly T[], key: string): number {
  let total = 0
  for (const row of rows) {
    const value = Number((row as Record<string, unknown>)[key])
    if (Number.isFinite(value)) total += value
  }
  return Math.round(total * 10_000) / 10_000
}

/** Sum several fields in one pass — the shape a totals map wants. */
export function sumColumns<T>(rows: readonly T[], keys: readonly string[]): Record<string, number> {
  const out: Record<string, number> = {}
  for (const key of keys) out[key] = 0
  for (const row of rows) {
    const record = row as Record<string, unknown>
    for (const key of keys) {
      const value = Number(record[key])
      if (Number.isFinite(value)) out[key] += value
    }
  }
  for (const key of keys) out[key] = Math.round(out[key] * 10_000) / 10_000
  return out
}

/** `Total (412 movements)` — one phrasing for every register. */
export function totalsLabel(count: number | null | undefined, noun: string, pluralNoun?: string): string {
  const n = Number(count)
  if (!Number.isFinite(n) || n <= 0) return 'Total'
  const word = n === 1 ? noun : (pluralNoun ?? `${noun}s`)
  return `Total (${n.toLocaleString('en-IN')} ${word})`
}
