/**
 * The colour each cost type wears, everywhere it appears.
 *
 * Two rules, and both are the reason this is a table rather than an index into an array:
 *
 * 1. The hue follows the COST TYPE, never its rank. The donut is sorted largest-first, so a month
 *    where duty outweighs freight would otherwise repaint both — and a reader who has learned that
 *    blue is freight would be reading the wrong slice.
 * 2. The slots are assigned in fixed order and never cycled. There are six cost types and six
 *    slots, so there is no seventh to generate.
 *
 * The one substitution: slot 6 of the reference order is green, and green is this product's primary
 * accent AND its "good" status token. A green slice would read as a judgement about the charge, so
 * slot 7 (violet) takes the sixth place. The resulting six-colour order was validated in both modes
 * with the design system's own surfaces — every hard gate passes, with a light-mode contrast WARN
 * that the legend discharges: each entry carries a swatch AND its label, percentage and amount, so
 * identity is never colour alone.
 */

import type { LandedCostType } from '../landedCost'

/** Class carrying the slice colour as `currentColor`; the dark step is in landedCost.css. */
export const CHARGE_SERIES_CLASS: Record<LandedCostType, string> = {
  freight: 'lca-series-1',
  duty: 'lca-series-2',
  insurance: 'lca-series-3',
  handling: 'lca-series-4',
  other: 'lca-series-5',
  non_creditable_tax: 'lca-series-6',
}

export function seriesClassFor(costType: string): string {
  return CHARGE_SERIES_CLASS[costType as LandedCostType] ?? 'lca-series-5'
}
