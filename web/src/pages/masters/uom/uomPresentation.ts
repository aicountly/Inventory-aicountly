/**
 * What the Units of measure screen knows about a unit beyond its columns.
 *
 * Every function here is pure and derived from the row the API returned, which
 * is the point: the screen's "intelligence" — the duplicate warning, the
 * converter, the GST code suggestion, the row icon — is a set of rules that can
 * be read and tested, not a model's opinion rendered as fact. Where a rule
 * cannot answer, it returns null and the UI says so rather than guessing.
 *
 * No React, no DOM, no network.
 */

import {
  Beaker,
  Box,
  Boxes,
  Droplet,
  Grid3x3,
  Hash,
  Package,
  Ruler,
  Scale,
  ShoppingBag,
  Square,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import type { Uom } from '../../../services/masters'

// ---------------------------------------------------------------------------
// Normalisation
// ---------------------------------------------------------------------------

/**
 * A unit's name reduced to the token two spellings of the same unit share.
 *
 * "Kilogram", "kilograms", "Kilo-gram" and "KILOGRAM " all become `kilogram`,
 * which is what lets the duplicate warning notice them.
 *
 * Two rules, in this order. `-es` is stripped only after the letters that
 * actually take it — s, x, z, ch, sh — so "boxes" folds to "box" while "litres"
 * folds to "litre" rather than the "litr" that a blanket `-es` rule produced,
 * which silently stopped Litre and Litres being seen as the same unit.
 * Otherwise a trailing `-s` goes. Tokens of three characters or fewer are left
 * alone: in "gms" and "pcs" the `s` is part of the code, not a plural.
 */
export function normaliseUnitToken(value: string | null | undefined): string {
  const base = String(value ?? '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '')
  if (base.length > 3 && /(?:s|x|z|ch|sh)es$/.test(base)) return base.slice(0, -2)
  if (base.length > 3 && base.endsWith('s')) return base.slice(0, -1)
  return base
}

/** Every spelling of a unit worth comparing: name, symbol, print name. */
export function unitTokens(row: Pick<Uom, 'unit_name' | 'unit_symbol' | 'print_name'>): string[] {
  return [row.unit_name, row.unit_symbol, row.print_name]
    .map(normaliseUnitToken)
    .filter((t) => t !== '')
}

// ---------------------------------------------------------------------------
// Dimensions and conversion
// ---------------------------------------------------------------------------

export type UnitDimension = 'mass' | 'length' | 'volume' | 'area' | 'count'

export const DIMENSION_LABEL: Record<UnitDimension, string> = {
  mass: 'Mass',
  length: 'Length',
  volume: 'Volume',
  area: 'Area',
  count: 'Count',
}

/** The unit expressed in its dimension's base (gram, metre, litre, m², one). */
export interface UnitMagnitude {
  dimension: UnitDimension
  /** How many base units one of this unit is worth. */
  factor: number
  base: string
}

interface DimensionEntry {
  dimension: UnitDimension
  factor: number
}

const BASE_OF: Record<UnitDimension, string> = {
  mass: 'gram',
  length: 'metre',
  volume: 'litre',
  area: 'square metre',
  count: 'unit',
}

/**
 * Units whose magnitude is fixed by definition, keyed by normalised token.
 *
 * Packaging is deliberately absent. A box is not a quantity — one supplier's
 * box is twelve and another's is a hundred — so "25 boxes in grams" has no
 * answer here and the converter says so instead of inventing a factor. The
 * counts that ARE fixed (a dozen, a gross) are in, because they are definitions
 * rather than conventions.
 */
const MAGNITUDES: Record<string, DimensionEntry> = {
  // mass, in grams
  milligram: { dimension: 'mass', factor: 0.001 },
  mg: { dimension: 'mass', factor: 0.001 },
  gram: { dimension: 'mass', factor: 1 },
  gramme: { dimension: 'mass', factor: 1 },
  g: { dimension: 'mass', factor: 1 },
  gm: { dimension: 'mass', factor: 1 },
  gms: { dimension: 'mass', factor: 1 },
  kilogram: { dimension: 'mass', factor: 1000 },
  kilo: { dimension: 'mass', factor: 1000 },
  kg: { dimension: 'mass', factor: 1000 },
  kgs: { dimension: 'mass', factor: 1000 },
  quintal: { dimension: 'mass', factor: 100_000 },
  qtl: { dimension: 'mass', factor: 100_000 },
  tonne: { dimension: 'mass', factor: 1_000_000 },
  ton: { dimension: 'mass', factor: 1_000_000 },
  metricton: { dimension: 'mass', factor: 1_000_000 },
  mts: { dimension: 'mass', factor: 1_000_000 },

  // length, in metres
  millimetre: { dimension: 'length', factor: 0.001 },
  millimeter: { dimension: 'length', factor: 0.001 },
  mm: { dimension: 'length', factor: 0.001 },
  centimetre: { dimension: 'length', factor: 0.01 },
  centimeter: { dimension: 'length', factor: 0.01 },
  cm: { dimension: 'length', factor: 0.01 },
  cms: { dimension: 'length', factor: 0.01 },
  metre: { dimension: 'length', factor: 1 },
  meter: { dimension: 'length', factor: 1 },
  mtr: { dimension: 'length', factor: 1 },
  kilometre: { dimension: 'length', factor: 1000 },
  kilometer: { dimension: 'length', factor: 1000 },
  km: { dimension: 'length', factor: 1000 },
  kme: { dimension: 'length', factor: 1000 },
  inch: { dimension: 'length', factor: 0.0254 },
  foot: { dimension: 'length', factor: 0.3048 },
  feet: { dimension: 'length', factor: 0.3048 },
  ft: { dimension: 'length', factor: 0.3048 },
  yard: { dimension: 'length', factor: 0.9144 },
  yd: { dimension: 'length', factor: 0.9144 },
  yds: { dimension: 'length', factor: 0.9144 },

  // volume, in litres
  millilitre: { dimension: 'volume', factor: 0.001 },
  milliliter: { dimension: 'volume', factor: 0.001 },
  ml: { dimension: 'volume', factor: 0.001 },
  mlt: { dimension: 'volume', factor: 0.001 },
  cubiccentimetre: { dimension: 'volume', factor: 0.001 },
  ccm: { dimension: 'volume', factor: 0.001 },
  litre: { dimension: 'volume', factor: 1 },
  liter: { dimension: 'volume', factor: 1 },
  ltr: { dimension: 'volume', factor: 1 },
  kilolitre: { dimension: 'volume', factor: 1000 },
  kiloliter: { dimension: 'volume', factor: 1000 },
  klr: { dimension: 'volume', factor: 1000 },
  cubicmetre: { dimension: 'volume', factor: 1000 },
  cbm: { dimension: 'volume', factor: 1000 },

  // area, in square metres
  squaremetre: { dimension: 'area', factor: 1 },
  squaremeter: { dimension: 'area', factor: 1 },
  sqm: { dimension: 'area', factor: 1 },
  squarefeet: { dimension: 'area', factor: 0.09290304 },
  squarefoot: { dimension: 'area', factor: 0.09290304 },
  sqft: { dimension: 'area', factor: 0.09290304 },
  sqf: { dimension: 'area', factor: 0.09290304 },
  squareyard: { dimension: 'area', factor: 0.83612736 },
  sqyd: { dimension: 'area', factor: 0.83612736 },
  sqy: { dimension: 'area', factor: 0.83612736 },

  // count, in units
  number: { dimension: 'count', factor: 1 },
  no: { dimension: 'count', factor: 1 },
  nos: { dimension: 'count', factor: 1 },
  piece: { dimension: 'count', factor: 1 },
  pc: { dimension: 'count', factor: 1 },
  pcs: { dimension: 'count', factor: 1 },
  unit: { dimension: 'count', factor: 1 },
  unt: { dimension: 'count', factor: 1 },
  each: { dimension: 'count', factor: 1 },
  ea: { dimension: 'count', factor: 1 },
  pair: { dimension: 'count', factor: 2 },
  pr: { dimension: 'count', factor: 2 },
  prs: { dimension: 'count', factor: 2 },
  dozen: { dimension: 'count', factor: 12 },
  doz: { dimension: 'count', factor: 12 },
  gross: { dimension: 'count', factor: 144 },
  grs: { dimension: 'count', factor: 144 },
  greatgross: { dimension: 'count', factor: 1728 },
  ggk: { dimension: 'count', factor: 1728 },
  tengross: { dimension: 'count', factor: 1440 },
  tgm: { dimension: 'count', factor: 1440 },
  thousand: { dimension: 'count', factor: 1000 },
  thd: { dimension: 'count', factor: 1000 },
}

/**
 * What quantity this unit measures, or null when nothing here can say.
 *
 * The name is consulted first, then the symbol, then the GST code — in that
 * order and with no merging, because the three can disagree and the name is the
 * one a person chose for this unit. A company that files its Feet under NOS
 * (which is common: the schema has no code for feet) must not thereby have its
 * Feet treated as a countable number and offered a conversion to Dozens.
 */
export function unitMagnitude(
  row: Pick<Uom, 'unit_name' | 'unit_symbol' | 'uqc_gst'>,
): UnitMagnitude | null {
  for (const candidate of [row.unit_name, row.unit_symbol, row.uqc_gst]) {
    const entry = MAGNITUDES[normaliseUnitToken(candidate)]
    if (entry) return { ...entry, base: BASE_OF[entry.dimension] }
  }
  return null
}

export type ConversionResult =
  | { ok: true; value: number; dimension: UnitDimension }
  | { ok: false; reason: 'unknown-from' | 'unknown-to' | 'different-dimensions' | 'bad-value' }

/**
 * Convert a quantity between two units of the SAME dimension.
 *
 * It refuses rather than approximates. Two units whose relationship is a
 * per-item packing factor (how many bottles are in this supplier's carton) have
 * no company-wide answer, and inventing one here would put a wrong quantity in
 * front of someone who trusted it.
 */
export function convertUnits(
  from: Pick<Uom, 'unit_name' | 'unit_symbol' | 'uqc_gst'>,
  to: Pick<Uom, 'unit_name' | 'unit_symbol' | 'uqc_gst'>,
  value: number,
): ConversionResult {
  if (!Number.isFinite(value)) return { ok: false, reason: 'bad-value' }
  const a = unitMagnitude(from)
  if (!a) return { ok: false, reason: 'unknown-from' }
  const b = unitMagnitude(to)
  if (!b) return { ok: false, reason: 'unknown-to' }
  if (a.dimension !== b.dimension) return { ok: false, reason: 'different-dimensions' }
  return { ok: true, value: (value * a.factor) / b.factor, dimension: a.dimension }
}

// ---------------------------------------------------------------------------
// Duplicates
// ---------------------------------------------------------------------------

export type DuplicateConfidence = 'high' | 'medium'

export interface DuplicateMatch {
  row: Uom
  /** Which spelling collided — what the warning tells the user. */
  reason: 'name' | 'symbol' | 'related'
  confidence: DuplicateConfidence
}

export interface UnitDraft {
  unit_name: string
  unit_symbol: string
  print_name?: string
  uqc_gst?: string
}

/**
 * Units already on record that the draft may be a second copy of.
 *
 * Three rungs, and the UI shows the rung: an exact name or symbol collision is
 * a near-certainty (the server will refuse it anyway), while "these two reduce
 * to the same token, or are the same size of the same quantity" is a prompt to
 * look, not a verdict. Nothing is merged and nothing is blocked — §23's rule
 * that the user decides is the whole design.
 */
export function findSimilarUnits(draft: UnitDraft, rows: readonly Uom[], excludeId?: number | null): DuplicateMatch[] {
  const name = normaliseUnitToken(draft.unit_name)
  const symbol = normaliseUnitToken(draft.unit_symbol)
  if (name === '' && symbol === '') return []
  const draftMagnitude = unitMagnitude({
    unit_name: draft.unit_name,
    unit_symbol: draft.unit_symbol,
    uqc_gst: draft.uqc_gst ?? null,
  })

  const out: DuplicateMatch[] = []
  for (const row of rows) {
    if (excludeId != null && row.unit_id === excludeId) continue
    const tokens = unitTokens(row)
    if (name !== '' && normaliseUnitToken(row.unit_name) === name) {
      out.push({ row, reason: 'name', confidence: 'high' })
      continue
    }
    if (symbol !== '' && normaliseUnitToken(row.unit_symbol) === symbol) {
      out.push({ row, reason: 'symbol', confidence: 'high' })
      continue
    }
    if ((name !== '' && tokens.includes(name)) || (symbol !== '' && tokens.includes(symbol))) {
      out.push({ row, reason: 'related', confidence: 'medium' })
      continue
    }
    if (draftMagnitude) {
      const rowMagnitude = unitMagnitude(row)
      if (
        rowMagnitude &&
        rowMagnitude.dimension === draftMagnitude.dimension &&
        rowMagnitude.factor === draftMagnitude.factor
      ) {
        out.push({ row, reason: 'related', confidence: 'medium' })
      }
    }
  }
  // Certainties first: the reader should see the blocking collision before the
  // "worth a look" ones.
  return out.sort((a, b) => (a.confidence === b.confidence ? 0 : a.confidence === 'high' ? -1 : 1))
}

export interface DuplicateCluster {
  key: string
  rows: Uom[]
  /** The row the others would most sensibly fold into. Never applied for you. */
  canonical: Uom
  confidence: DuplicateConfidence
  reason: string
}

/**
 * Groups of units on record that look like the same unit spelled differently.
 *
 * The canonical suggestion is the most-used row, with the more complete record
 * breaking a tie — the one that would cost the least to standardise on. It is a
 * suggestion: nothing here merges anything.
 */
export function duplicateClusters(rows: readonly Uom[]): DuplicateCluster[] {
  const byToken = new Map<string, Uom[]>()
  for (const row of rows) {
    for (const token of new Set(unitTokens(row))) {
      const bucket = byToken.get(token)
      if (bucket) bucket.push(row)
      else byToken.set(token, [row])
    }
  }

  const seen = new Set<string>()
  const clusters: DuplicateCluster[] = []
  for (const [token, bucket] of byToken) {
    if (bucket.length < 2) continue
    const ids = bucket
      .map((r) => r.unit_id)
      .sort((a, b) => a - b)
      .join(':')
    if (seen.has(ids)) continue
    seen.add(ids)
    const nameCollision = new Set(bucket.map((r) => normaliseUnitToken(r.unit_name))).size === 1
    clusters.push({
      key: token,
      rows: [...bucket].sort((a, b) => a.unit_name.localeCompare(b.unit_name)),
      canonical: pickCanonical(bucket),
      confidence: nameCollision ? 'high' : 'medium',
      reason: nameCollision
        ? 'These units reduce to the same name.'
        : 'One unit’s name matches another’s symbol or print name.',
    })
  }
  return clusters.sort((a, b) => (a.confidence === b.confidence ? a.key.localeCompare(b.key) : a.confidence === 'high' ? -1 : 1))
}

function completeness(row: Uom): number {
  return [row.uqc_gst, row.print_name, row.unit_symbol].filter((v) => String(v ?? '').trim() !== '').length
}

function pickCanonical(rows: readonly Uom[]): Uom {
  return [...rows].sort((a, b) => {
    const usage = (b.usage_count ?? 0) - (a.usage_count ?? 0)
    if (usage !== 0) return usage
    const full = completeness(b) - completeness(a)
    if (full !== 0) return full
    const active = Number(b.is_active) - Number(a.is_active)
    if (active !== 0) return active
    return a.unit_id - b.unit_id
  })[0]
}

// ---------------------------------------------------------------------------
// GST unit quantity codes
// ---------------------------------------------------------------------------

/**
 * Names and symbols that map to one published UQC beyond doubt.
 *
 * Only the unambiguous ones. Feet and Inch are absent on purpose: the schema
 * has no code for either, so which code a company files them under is its own
 * decision and not one to be nudged into by a suggestion box.
 */
const UQC_BY_TOKEN: Record<string, string> = {
  bag: 'BAG', bale: 'BAL', bundle: 'BDL', bdl: 'BDL', buckle: 'BKL',
  billionofunit: 'BOU', box: 'BOX', bottle: 'BTL', btl: 'BTL', bunch: 'BUN',
  can: 'CAN', cubicmetre: 'CBM', cubicmeter: 'CBM', cbm: 'CBM',
  cubiccentimetre: 'CCM', ccm: 'CCM', centimetre: 'CMS', centimeter: 'CMS', cm: 'CMS',
  carton: 'CTN', ctn: 'CTN', dozen: 'DOZ', doz: 'DOZ', drum: 'DRM',
  greatgross: 'GGK', gram: 'GMS', gramme: 'GMS', gm: 'GMS', g: 'GMS',
  gross: 'GRS', grossyard: 'GYD',
  kilogram: 'KGS', kilo: 'KGS', kg: 'KGS',
  kilolitre: 'KLR', kiloliter: 'KLR', kilometre: 'KME', kilometer: 'KME', km: 'KME',
  millilitre: 'MLT', milliliter: 'MLT', ml: 'MLT',
  metre: 'MTR', meter: 'MTR', m: 'MTR',
  metricton: 'MTS', tonne: 'MTS', ton: 'MTS',
  number: 'NOS', no: 'NOS', nos: 'NOS',
  pack: 'PAC', packet: 'PAC', piece: 'PCS', pc: 'PCS', pcs: 'PCS',
  pair: 'PRS', quintal: 'QTL', roll: 'ROL', set: 'SET',
  squarefeet: 'SQF', squarefoot: 'SQF', sqft: 'SQF',
  squaremetre: 'SQM', squaremeter: 'SQM', sqm: 'SQM',
  squareyard: 'SQY', sqyd: 'SQY',
  tablet: 'TBS', tengross: 'TGM', thousand: 'THD', tonnes: 'TON',
  tube: 'TUB', usgallon: 'UGS', gallon: 'UGS', unit: 'UNT',
  yard: 'YDS', yd: 'YDS',
}

export interface UqcSuggestion {
  code: string
  confidence: DuplicateConfidence
  /** Which spelling produced it, so the user can judge the suggestion. */
  from: 'name' | 'symbol' | 'print name'
}

/**
 * The code this unit most likely files under, or null when nothing is certain.
 *
 * A name match is high confidence; reaching the answer only through the symbol
 * is medium, because symbols are short and a company may mean its own thing by
 * one. Either way the user confirms — §57 and §32 both say the code is never
 * changed for them.
 */
export function suggestUqc(row: Pick<Uom, 'unit_name' | 'unit_symbol' | 'print_name'>): UqcSuggestion | null {
  const sources: { value: string | null | undefined; from: UqcSuggestion['from']; confidence: DuplicateConfidence }[] = [
    { value: row.unit_name, from: 'name', confidence: 'high' },
    { value: row.print_name, from: 'print name', confidence: 'medium' },
    { value: row.unit_symbol, from: 'symbol', confidence: 'medium' },
  ]
  for (const source of sources) {
    const code = UQC_BY_TOKEN[normaliseUnitToken(source.value)]
    if (code) return { code, confidence: source.confidence, from: source.from }
  }
  return null
}

export function hasUqc(row: Pick<Uom, 'uqc_gst'>): boolean {
  return String(row.uqc_gst ?? '').trim() !== ''
}

// ---------------------------------------------------------------------------
// Row decoration
// ---------------------------------------------------------------------------

const PACKAGING_ICON: Record<string, LucideIcon> = {
  bag: ShoppingBag,
  box: Box,
  carton: Boxes,
  bundle: Boxes,
  pack: Package,
  packet: Package,
  bottle: Beaker,
  can: Beaker,
  drum: Beaker,
  tube: Beaker,
}

const DIMENSION_ICON: Record<UnitDimension, LucideIcon> = {
  mass: Scale,
  length: Ruler,
  volume: Droplet,
  area: Square,
  count: Hash,
}

/**
 * A glyph for the row, chosen by the same rules the rest of the file uses.
 *
 * Decoration, and treated as such: an unrecognised unit gets the neutral tile
 * rather than a wrong picture, and nothing downstream reads the icon back.
 */
export function unitIcon(row: Pick<Uom, 'unit_name' | 'unit_symbol' | 'uqc_gst'>): LucideIcon {
  const packaging = PACKAGING_ICON[normaliseUnitToken(row.unit_name)] ?? PACKAGING_ICON[normaliseUnitToken(row.unit_symbol)]
  if (packaging) return packaging
  const magnitude = unitMagnitude(row)
  if (magnitude) {
    if (magnitude.dimension === 'count' && magnitude.factor >= 12) return Grid3x3
    return DIMENSION_ICON[magnitude.dimension]
  }
  return Package
}

/** The screen's own reading of a row's type, for rows served before the API said. */
export function unitType(row: Pick<Uom, 'uqc_gst' | 'uom_type'>): 'standard' | 'custom' {
  return row.uom_type ?? (hasUqc(row) ? 'standard' : 'custom')
}

// ---------------------------------------------------------------------------
// Form validation
// ---------------------------------------------------------------------------

export const MAX_DECIMALS = 4
const MAX_NAME = 128
const MAX_SYMBOL = 16

export interface DraftErrors {
  [field: string]: string
}

/**
 * What the form refuses to send.
 *
 * Shape and range only — the things the API would reject on a round trip the
 * user did not need to take. Uniqueness is NOT decided here: this screen holds
 * one page of units and a name can collide with a row on another page, so a
 * likely duplicate is shown as the warning in §23 and the server's 409 remains
 * the authority.
 */
export function validateUnitDraft(
  draft: UnitDraft & { decimal_places?: string | number },
  ctx: { knownUqcCodes?: readonly string[] } = {},
): DraftErrors {
  const errors: DraftErrors = {}
  const name = String(draft.unit_name ?? '').trim()
  const symbol = String(draft.unit_symbol ?? '').trim()

  if (name === '') errors.unit_name = 'Give the unit a name.'
  else if (name.length > MAX_NAME) errors.unit_name = `Keep the name to ${MAX_NAME} characters.`

  if (symbol === '') errors.unit_symbol = 'Give the unit a symbol — it is what documents print.'
  else if (symbol.length > MAX_SYMBOL) errors.unit_symbol = `Keep the symbol to ${MAX_SYMBOL} characters.`

  const printName = String(draft.print_name ?? '').trim()
  if (printName.length > MAX_NAME) errors.print_name = `Keep the print name to ${MAX_NAME} characters.`

  const uqc = String(draft.uqc_gst ?? '').trim().toUpperCase()
  if (uqc !== '') {
    if (ctx.knownUqcCodes && ctx.knownUqcCodes.length > 0) {
      if (!ctx.knownUqcCodes.includes(uqc)) {
        errors.uqc_gst = `${uqc} is not a GST unit quantity code. Pick one from the list, or leave it blank.`
      }
    } else if (!/^[A-Z]{3}$/.test(uqc)) {
      // The catalogue could not be read; the shape is all that can be checked
      // without turning an offline moment into a blocked save.
      errors.uqc_gst = 'A GST unit quantity code is three letters, such as KGS.'
    }
  }

  const decimalsRaw = draft.decimal_places
  if (decimalsRaw !== undefined && String(decimalsRaw).trim() !== '') {
    const decimals = Number(decimalsRaw)
    if (!Number.isInteger(decimals)) errors.decimal_places = 'Decimal places must be a whole number.'
    else if (decimals < 0 || decimals > MAX_DECIMALS) errors.decimal_places = `Inventory stores 0 to ${MAX_DECIMALS} decimal places.`
  }

  return errors
}

/** Warn before a change that rewrites how existing documents read. */
export function changeWarnings(before: Uom, draft: UnitDraft): string[] {
  const out: string[] = []
  if (String(before.unit_symbol ?? '').trim() !== draft.unit_symbol.trim()) {
    out.push('Changing the symbol changes what every document and report already using this unit prints.')
  }
  if (String(before.uqc_gst ?? '').trim().toUpperCase() !== String(draft.uqc_gst ?? '').trim().toUpperCase()) {
    out.push('Changing the GST UQC changes the code this unit is reported under on GST returns.')
  }
  return out
}
