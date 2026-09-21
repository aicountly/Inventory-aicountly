/**
 * Arc geometry for the Batch Insights ring.
 *
 * A hand-rolled SVG ring rather than a charting package: this is the only chart
 * on the screen, and pulling in a plotting library to draw four arcs would add
 * more to the bundle than the whole Batches feature. The maths is ten lines and
 * is easier to test than it is to configure.
 *
 * Drawn with `stroke-dasharray` on a circle: each segment paints `length` of a
 * `circumference`-long dash pattern and is rotated into place by `offset`.
 */

export interface DonutPart {
  key: string
  value: number
}

export interface DonutSegment extends DonutPart {
  /** 0–1 of the ring. */
  share: number
  /** Stroke length, in the same units as `circumference`. */
  length: number
  /** `stroke-dashoffset` that rotates this segment to its start. */
  offset: number
}

/**
 * Segments in the order given, each starting where the last ended.
 *
 * A zero-valued part still comes back (with a zero-length arc) so a legend
 * built from the same list keeps every row and its colour, rather than the
 * colours shifting when one state happens to be empty.
 */
export function donutSegments(parts: readonly DonutPart[], circumference: number): DonutSegment[] {
  const total = parts.reduce((sum, part) => sum + Math.max(0, part.value), 0)
  let consumed = 0
  return parts.map((part) => {
    const value = Math.max(0, part.value)
    const share = total > 0 ? value / total : 0
    const length = share * circumference
    const offset = -consumed
    consumed += length
    return { ...part, value, share, length, offset }
  })
}

/** `186 (75%)` — the legend's figure. Rounded so the four never read as 101%. */
export function sharePercent(value: number, total: number): number {
  if (total <= 0) return 0
  return Math.round((value / total) * 100)
}
