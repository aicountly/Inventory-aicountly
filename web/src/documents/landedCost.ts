/**
 * Landed cost: the charges (freight, duty, insurance, handling, a non-creditable tax) that are part
 * of what received stock actually cost, and how they are spread over the lines of the receipt.
 *
 * Everything here is pure and MIRRORS the server allocator
 * (DocumentPostingService::allocateCharge / settleResidual), residual rule included, so the split
 * the user is shown before saving is the split that gets stored. A preview that rounds differently
 * from the engine is worse than no preview: it teaches the operator a number that is not the one in
 * closing stock.
 *
 * The one rule that matters: the shares sum EXACTLY to the charge. Rounding every share to four
 * places and dropping what is left loses rupees out of stock value, and the residual goes onto the
 * largest line, where it is smallest in proportion.
 */

import { round4 } from './formModel'
import { toNumber } from '../utils/format'

/** Config\DocumentTypeRegistry-side vocabulary; DocumentService::LANDED_COST_TYPES is the truth. */
export const LANDED_COST_TYPES = ['freight', 'duty', 'insurance', 'handling', 'other', 'non_creditable_tax'] as const
export type LandedCostType = (typeof LANDED_COST_TYPES)[number]

/**
 * DocumentService::LANDED_COST_BASES. Weight is deliberately absent: there is no item weight master
 * to allocate by, so the control would silently fall back to something else.
 */
export const ALLOCATION_BASES = ['value', 'qty', 'manual', 'direct'] as const
export type AllocationBasis = (typeof ALLOCATION_BASES)[number]

export const COST_TYPE_LABELS: Record<LandedCostType, string> = {
  freight: 'Freight',
  duty: 'Customs duty',
  insurance: 'Insurance',
  handling: 'Handling',
  other: 'Other',
  non_creditable_tax: 'Non-creditable tax',
}

export const BASIS_LABELS: Record<AllocationBasis, string> = {
  value: 'Pro-rata by value',
  qty: 'Pro-rata by quantity',
  manual: 'Entered per line',
  direct: 'One line only',
}

/**
 * The company's landed-cost capitalisation policy, as GET /v1/settings/landed-cost-policy returns
 * it. Which charges are part of the cost of inventory is an accounting policy of the company that
 * holds the stock, so it lives in Inventory settings and every screen that offers a cost type reads
 * it from there.
 */
export interface LandedCostPolicy {
  capitalisable_cost_types: LandedCostType[]
  excluded_cost_types: LandedCostType[]
  switchable_cost_types: LandedCostType[]
  always_capitalised_cost_types: LandedCostType[]
  all_cost_types: LandedCostType[]
}

export const COST_TYPE_HELP: Record<LandedCostType, string> = {
  freight: 'Inward carriage on the goods.',
  duty: 'Customs duty and cess paid to bring the goods in.',
  insurance: 'Insurance of the consignment in transit.',
  handling: 'Loading, unloading, clearing and similar handling of the consignment.',
  other: 'Any other charge of bringing the goods to their present location and condition — and the type an amount with no breakdown is recorded under.',
  non_creditable_tax: 'Tax on the purchase that cannot be recovered from the authority. Always part of the cost of stock: AS-2 puts non-recoverable tax into the cost of purchase, so it is not a policy choice here. Whether the credit is claimable at all is decided in Books.',
}

/**
 * The cost types a charge row may offer.
 *
 * Two rules, and the second is the one worth stating. First: only what the company capitalises is
 * offered, because a charge it does not capitalise is refused by the server with a 422 and there is
 * no point letting anyone type it. Second: a type ALREADY on the row is still offered even when the
 * policy has since switched it off. A `<select>` whose value is not among its options renders as
 * blank and the next change silently rewrites the stored charge to whatever is first in the list —
 * so a draft saved last month would quietly become a freight charge. The server still refuses that
 * charge on save, with a message naming the type; that refusal is the honest place to learn it.
 */
export function offeredCostTypes(policy: LandedCostPolicy | null, current?: LandedCostType): LandedCostType[] {
  const allowed = policy === null ? [...LANDED_COST_TYPES] : LANDED_COST_TYPES.filter((t) => policy.capitalisable_cost_types.includes(t))
  if (current && !allowed.includes(current)) return [...allowed, current]
  return allowed
}

/** The default type for a NEW charge row: freight where it is capitalised, else whatever is. */
export function defaultCostType(policy: LandedCostPolicy | null): LandedCostType {
  const offered = offeredCostTypes(policy)
  return offered.includes('freight') ? 'freight' : (offered[0] ?? 'freight')
}

/**
 * The basis a NEW charge row of a given type starts on.
 *
 * 'direct' is not a preference for a non-creditable tax, it is what the charge IS: the blocked
 * input tax of ONE line, which by nature belongs to that line alone. Seeding it on 'value' — which
 * is what a single 'value' default did the moment a company switched all five switchable types off
 * and left non_creditable_tax as the only thing the panel could offer — smears one line's blocked
 * tax pro-rata across every line of the receipt. The server accepts it (any basis is valid for any
 * type), no total moves and nothing is dropped, so the only symptom is a per-line stock cost that
 * is wrong, silently.
 */
export function defaultBasisFor(costType: LandedCostType): AllocationBasis {
  return costType === 'non_creditable_tax' ? 'direct' : 'value'
}

export const BASIS_HINTS: Record<AllocationBasis, string> = {
  value: 'Split in proportion to what each line is worth.',
  qty: 'Split in proportion to each line’s base quantity.',
  manual: 'You type each line’s share; they must add up to the charge.',
  direct: 'The whole charge belongs to a single line — a non-creditable tax is the case.',
}

/** One inward line of the receipt being loaded. */
export interface TargetLine {
  line_id: number
  label: string
  base_qty: number
  /** What the line is currently valued at — the weight the `value` basis uses. */
  valuation_amount: number
  unit_symbol?: string | null
}

/** A charge as the form holds it: amounts are text while the user is typing. */
export interface ChargeDraft {
  key: string
  cost_type: LandedCostType
  description: string
  amount: string
  allocation_basis: AllocationBasis
  /** Per-line overrides, keyed by line id, used by the manual and direct bases. */
  lines: Record<number, string>
}

/** A charge as the payload carries it (metadata.charges[]). */
export interface ChargePayload {
  cost_type: LandedCostType
  description?: string
  amount: number
  allocation_basis: AllocationBasis
  lines?: { line_id: number; amount: number }[]
}

export interface Share {
  line_id: number
  amount: number
}

/** Put whatever rounding left over onto the largest share, so the shares sum exactly to `amount`. */
export function settleResidual(shares: Share[], amount: number): Share[] {
  if (shares.length === 0) return []
  const out = shares.map((s) => ({ line_id: s.line_id, amount: round4(s.amount) }))
  let sum = 0
  for (const s of out) sum = round4(sum + s.amount)
  const residual = round4(amount - sum)
  if (Math.abs(residual) < 0.00005) return out
  let biggest = 0
  for (let i = 1; i < out.length; i += 1) {
    if (Math.abs(out[i].amount) > Math.abs(out[biggest].amount)) biggest = i
  }
  out[biggest] = { ...out[biggest], amount: round4(out[biggest].amount + residual) }
  return out
}

/**
 * Spread a charge in proportion to the weights. Every weight zero returns no shares at all — the
 * server refuses that case rather than spreading arbitrarily, and the preview says the same thing
 * by showing nothing to allocate.
 */
export function allocateCharge(amount: number, weights: { line_id: number; weight: number }[]): Share[] {
  let total = 0
  for (const w of weights) total += Math.max(0, w.weight)
  if (total <= 0) return []
  return settleResidual(
    weights.map((w) => ({ line_id: w.line_id, amount: round4((amount * Math.max(0, w.weight)) / total) })),
    amount,
  )
}

export function chargeAmount(charge: ChargeDraft): number {
  return toNumber(charge.amount) ?? 0
}

/** The shares ONE charge takes on the target's lines, on the basis it was given. */
export function sharesForCharge(charge: ChargeDraft, lines: TargetLine[]): Share[] {
  const amount = chargeAmount(charge)
  if (amount <= 0 || lines.length === 0) return []
  if (charge.allocation_basis === 'manual' || charge.allocation_basis === 'direct') {
    const given = lines
      .filter((l) => (charge.lines[l.line_id] ?? '').trim() !== '')
      .map((l) => ({ line_id: l.line_id, amount: round4(toNumber(charge.lines[l.line_id]) ?? 0) }))
    let sum = 0
    for (const s of given) sum = round4(sum + s.amount)
    // Only ROUNDING slack is settled, which is the same order the server works in: it refuses a
    // charge whose per-line shares miss it by more than a paisa before any residual is placed.
    // Topping up a genuine shortfall here would show the user a charge that adds up and then hand
    // them a 422 on save, and hide the very gap validateCharges() exists to name.
    return Math.abs(sum - amount) > 0.01 ? given : settleResidual(given, amount)
  }
  return allocateCharge(
    amount,
    lines.map((l) => ({ line_id: l.line_id, weight: charge.allocation_basis === 'qty' ? l.base_qty : l.valuation_amount })),
  )
}

export interface AllocationPreview {
  /** line_id -> total landed cost, and line_id -> charge key -> share. */
  perLine: Record<number, number>
  byCharge: Record<string, Record<number, number>>
  total: number
  allocated: number
}

/** What every line takes once all the charges are spread. */
export function previewAllocation(charges: ChargeDraft[], lines: TargetLine[]): AllocationPreview {
  const perLine: Record<number, number> = {}
  const byCharge: Record<string, Record<number, number>> = {}
  let total = 0
  let allocated = 0
  for (const charge of charges) {
    total = round4(total + chargeAmount(charge))
    const shares = sharesForCharge(charge, lines)
    const map: Record<number, number> = {}
    for (const s of shares) {
      map[s.line_id] = s.amount
      perLine[s.line_id] = round4((perLine[s.line_id] ?? 0) + s.amount)
      allocated = round4(allocated + s.amount)
    }
    byCharge[charge.key] = map
  }
  return { perLine, byCharge, total, allocated }
}

/**
 * Everything the server would refuse with a 422, said next to the field instead. The server's
 * refusal is still the authority; this only means the user is not told by an HTTP error.
 */
export function validateCharges(targetDocumentId: number | null, charges: ChargeDraft[], lines: TargetLine[]): string[] {
  const errors: string[] = []
  if (!targetDocumentId) errors.push('Pick the receipt these charges belong to.')
  if (charges.length === 0) errors.push('Add at least one charge to allocate.')
  charges.forEach((charge, i) => {
    const n = i + 1
    const amount = chargeAmount(charge)
    if (amount <= 0) {
      errors.push(`Charge ${n}: enter an amount greater than zero.`)
      return
    }
    if (charge.allocation_basis === 'manual' || charge.allocation_basis === 'direct') {
      const named = lines.filter((l) => (charge.lines[l.line_id] ?? '').trim() !== '')
      if (named.length === 0) {
        errors.push(`Charge ${n}: enter the share each line carries.`)
        return
      }
      if (charge.allocation_basis === 'direct' && named.length !== 1) {
        errors.push(`Charge ${n}: a charge that belongs to one line by nature cannot name ${named.length}.`)
      }
      let sum = 0
      for (const l of named) sum = round4(sum + (toNumber(charge.lines[l.line_id]) ?? 0))
      if (Math.abs(sum - amount) > 0.01) {
        errors.push(`Charge ${n}: the per-line shares add up to ${sum.toFixed(2)} but the charge is ${amount.toFixed(2)}.`)
      }
      return
    }
    if (sharesForCharge(charge, lines).length === 0 && lines.length > 0) {
      errors.push(`Charge ${n}: every line weighs nothing on this basis, so there is nothing to spread it over. Pick another basis or enter the shares by hand.`)
    }
  })
  return errors
}

/** The charges as metadata.charges[], which is what DocumentService::landedCostCharges() reads. */
export function chargesToPayload(charges: ChargeDraft[], lines: TargetLine[]): ChargePayload[] {
  return charges.map((charge) => {
    const out: ChargePayload = {
      cost_type: charge.cost_type,
      amount: round4(chargeAmount(charge)),
      allocation_basis: charge.allocation_basis,
    }
    if (charge.description.trim()) out.description = charge.description.trim()
    if (charge.allocation_basis === 'manual' || charge.allocation_basis === 'direct') {
      out.lines = lines
        .filter((l) => (charge.lines[l.line_id] ?? '').trim() !== '')
        .map((l) => ({ line_id: l.line_id, amount: round4(toNumber(charge.lines[l.line_id]) ?? 0) }))
    }
    return out
  })
}

let chargeSeq = 0

export function newCharge(partial: Partial<ChargeDraft> = {}, policy: LandedCostPolicy | null = null): ChargeDraft {
  chargeSeq += 1
  const costType = partial.cost_type ?? defaultCostType(policy)
  return {
    key: `c${Date.now().toString(36)}-${chargeSeq}`,
    cost_type: costType,
    description: '',
    amount: '',
    // Chosen WITH the type, never independently of it — see defaultBasisFor.
    allocation_basis: defaultBasisFor(costType),
    lines: {},
    ...partial,
  }
}

/** Charges stored on a draft, back into editable rows. */
export function chargesFromMetadata(raw: unknown): ChargeDraft[] {
  if (!Array.isArray(raw)) return []
  const out: ChargeDraft[] = []
  for (const entry of raw) {
    if (!entry || typeof entry !== 'object') continue
    const e = entry as Record<string, unknown>
    const costType = String(e.cost_type ?? 'other') as LandedCostType
    const basis = String(e.allocation_basis ?? 'value') as AllocationBasis
    const lines: Record<number, string> = {}
    if (Array.isArray(e.lines)) {
      for (const l of e.lines) {
        if (!l || typeof l !== 'object') continue
        const row = l as Record<string, unknown>
        const lineId = Number(row.line_id)
        if (Number.isFinite(lineId) && lineId > 0) lines[lineId] = String(row.amount ?? '')
      }
    }
    out.push(
      newCharge({
        cost_type: LANDED_COST_TYPES.includes(costType) ? costType : 'other',
        allocation_basis: ALLOCATION_BASES.includes(basis) ? basis : 'value',
        description: typeof e.description === 'string' ? e.description : '',
        amount: e.amount === undefined || e.amount === null ? '' : String(e.amount),
        lines,
      }),
    )
  }
  return out
}
