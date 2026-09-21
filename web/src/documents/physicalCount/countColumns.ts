/**
 * Which columns the count sheet offers, and which of them disclose cost.
 *
 * Declared as a module-level constant — not built inside the component —
 * because `useColumnConfig` keys the reader's stored preference off this list
 * and re-reads it whenever the array identity changes. One stable list here
 * means one read per (register, user), and the Columns dialog, the rendered
 * grid and the stored preference cannot drift apart.
 */

export interface CountColumnDef {
  key: string
  label: string
  /** Identifies the row; listed as fixed rather than as a checkbox that does nothing. */
  alwaysVisible?: boolean
  defaultVisible?: boolean
  configureHint?: string
  /** Shown only to a reader who may see inventory cost. */
  cost?: boolean
}

export const COUNT_COLUMNS: readonly CountColumnDef[] = [
  { key: 'index', label: '#', alwaysVisible: true },
  { key: 'item', label: 'Item', alwaysVisible: true },
  { key: 'warehouse', label: 'Warehouse', configureHint: 'Where the line was counted.' },
  { key: 'batch', label: 'Batch', configureHint: 'Only filled when the sheet was loaded batch-wise.' },
  { key: 'unit', label: 'Unit' },
  { key: 'book_qty', label: 'Book qty', alwaysVisible: true },
  { key: 'counted_qty', label: 'Counted qty', alwaysVisible: true },
  { key: 'difference', label: 'Difference', alwaysVisible: true },
  { key: 'unit_cost', label: 'Unit cost', cost: true, configureHint: 'Valuation cost per base unit.' },
  { key: 'serials', label: 'Serials', configureHint: 'Serial numbers named against the difference.' },
  { key: 'availability', label: 'Availability', defaultVisible: false, configureHint: 'Free-to-use quantity behind the book figure.' },
  { key: 'variance_value', label: 'Variance value', cost: true, configureHint: 'Difference × unit cost.' },
  { key: 'status', label: 'Status', alwaysVisible: true },
] as const

/** The preference key. Scoped per user by `columnPrefs`, per this register here. */
export const COUNT_COLUMNS_PREF_KEY = 'documents.physical_count'

/** The columns a given reader may configure at all. */
export function columnsFor(canViewCost: boolean): CountColumnDef[] {
  return canViewCost ? [...COUNT_COLUMNS] : COUNT_COLUMNS.filter((c) => !c.cost)
}
