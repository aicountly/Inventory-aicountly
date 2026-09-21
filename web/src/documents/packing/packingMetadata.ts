/**
 * Pure readers/helpers for the packing-only corner of `HeaderDraft.metadata`. Nothing here
 * mutates: components read through these and write back with `patchHeader({ metadata: { ...
 * header.metadata, package_info: {...} } })`, same as the existing `box_marks` field.
 */

import type { HeaderDraft } from '../formModel'
import type { PackagePackingInfo, PackingAdditionalInfo } from '../types'

export const HANDLING_INSTRUCTIONS = ['Fragile', 'Handle with care', 'Keep dry', 'This side up'] as const

/** No transport-mode master exists yet (checked server + client) — a small fixed vocabulary, like a unit list. */
export const TRANSPORT_MODES = ['Road', 'Air', 'Rail', 'Sea', 'Courier', 'Other'] as const

export function packageInfoOf(header: Pick<HeaderDraft, 'metadata'>): PackagePackingInfo {
  return header.metadata.package_info ?? {}
}

export function additionalInfoOf(header: Pick<HeaderDraft, 'metadata'>): PackingAdditionalInfo {
  return header.metadata.additional ?? {}
}

export function handlingInstructionsOf(header: Pick<HeaderDraft, 'metadata'>): string[] {
  return header.metadata.handling_instructions ?? []
}

export function boxMarksOf(header: Pick<HeaderDraft, 'metadata'>): string[] {
  const raw = header.metadata.box_marks
  return Array.isArray(raw) ? (raw as string[]) : []
}

export interface DimensionsCm {
  l: number
  w: number
  h: number
}

/** Loosely parses "40 x 30 x 20" (separators x × X *, optional spaces, optional unit trailing) into cm. */
export function parseDimensionsCm(text: string | undefined | null): DimensionsCm | null {
  if (!text) return null
  const m = text.trim().match(/^(\d+(?:\.\d+)?)\s*[x×X*]\s*(\d+(?:\.\d+)?)\s*[x×X*]\s*(\d+(?:\.\d+)?)/)
  if (!m) return null
  const [, l, w, h] = m
  const dims = { l: Number(l), w: Number(w), h: Number(h) }
  return dims.l > 0 && dims.w > 0 && dims.h > 0 ? dims : null
}

/** Estimated volume in m³ for `boxes` boxes of the given cm dimensions — null until both are usable. */
export function estimateVolumeM3(dimensionsCm: string | undefined, boxes: number | undefined | null): number | null {
  const d = parseDimensionsCm(dimensionsCm)
  if (!d || !boxes || boxes <= 0) return null
  const perBoxM3 = (d.l / 100) * (d.w / 100) * (d.h / 100)
  return Number.isFinite(perBoxM3) && perBoxM3 > 0 ? perBoxM3 * boxes : null
}
