/**
 * Per-item variance: which items account for a method's difference from the
 * basis.
 *
 * The valuation endpoint already returns a valued row per item — closing
 * quantity, unit cost and stock value, all computed by the engine. So the
 * breakdown is a join of two answers it has already given (the basis and the
 * method) on `item_id`, and a subtraction. Nothing is re-costed and no
 * transaction is read in the browser; if it were, this screen would be
 * recomputing the company's valuation on a laptop, which is exactly what it
 * must not do.
 *
 * Pure. The fetching lives in the drawer that renders this.
 */

import type { ValuationSnapshotRow } from '../../../services/valuationApi'
import { roundToScale } from './model'

export interface VarianceItem {
  itemId: number
  name: string
  sku: string | null
  closingQty: number
  basisValue: number
  methodValue: number
  basisMethod: string | null
  difference: number
  /** Against this item's own basis value, null when that is zero. */
  variancePercent: number | null
}

export interface VarianceBreakdown {
  items: VarianceItem[]
  /** Items whose value is identical under both — the ones with nothing to show. */
  unchanged: number
  /** Sum of every difference; reconciles with the row's `vs item master`. */
  total: number
}

function label(row: ValuationSnapshotRow): string {
  return row.item_name || row.item_alias || `Item #${row.item_id}`
}

/**
 * Join the two snapshots and rank by what moved most.
 *
 * Ranked on the absolute difference rather than the percentage on purpose: a
 * ₹40 item that doubled is a 100% variance and explains nothing, while the
 * ₹80,000 line that moved 2% is the reason the totals differ. The percentage is
 * still shown per row, as context for the money.
 *
 * An item present under one method and not the other is treated as zero on the
 * missing side — the snapshot only drops an item when it holds no stock, so the
 * two sides cover the same items in practice and this is a guard, not a path.
 */
export function buildVarianceBreakdown(
  basisRows: readonly ValuationSnapshotRow[],
  methodRows: readonly ValuationSnapshotRow[],
): VarianceBreakdown {
  const basis = new Map(basisRows.map((r) => [r.item_id, r]))
  const seen = new Set<number>()
  const items: VarianceItem[] = []
  let unchanged = 0
  let total = 0

  const push = (itemId: number, basisRow?: ValuationSnapshotRow, methodRow?: ValuationSnapshotRow) => {
    const reference = methodRow ?? basisRow
    if (!reference) return
    const basisValue = basisRow?.stock_value ?? 0
    const methodValue = methodRow?.stock_value ?? 0
    const difference = roundToScale(methodValue - basisValue)
    total = roundToScale(total + difference)
    if (difference === 0) {
      unchanged += 1
      return
    }
    items.push({
      itemId,
      name: label(reference),
      sku: reference.item_sku ?? reference.item_alias ?? null,
      closingQty: reference.closing_qty,
      basisValue,
      methodValue,
      basisMethod: basisRow?.valuation_method_applied ?? null,
      difference,
      variancePercent: basisValue === 0 ? null : (difference / Math.abs(basisValue)) * 100,
    })
  }

  for (const methodRow of methodRows) {
    seen.add(methodRow.item_id)
    push(methodRow.item_id, basis.get(methodRow.item_id), methodRow)
  }
  for (const basisRow of basisRows) {
    if (!seen.has(basisRow.item_id)) push(basisRow.item_id, basisRow, undefined)
  }

  items.sort((a, b) => Math.abs(b.difference) - Math.abs(a.difference))
  return { items, unchanged, total }
}
