/**
 * Client-side view of Config\DocumentTypeRegistry for the native (user-entered) types.
 *
 * `lineMode` mirrors the server (how lines move stock); `formKind` is purely a UI decision —
 * which editor the create / edit screen renders. `slug` is the lower-case code used in URLs
 * and in permission keys (`documents.<slug>.<action>`, PermissionRegistry::documentPermission).
 */

export type LineMode = 'fixed_in' | 'fixed_out' | 'by_line' | 'transfer' | 'status_only' | 'pending_only'

export type FormKind =
  | 'lines'
  | 'transfer'
  | 'physical_count'
  | 'production'
  | 'job_work_out'
  | 'job_work_in'
  | 'packing'
  | 'delivery_challan'
  | 'inward_challan'
  | 'revaluation'
  | 'landed_cost'

export type PartyRole = 'party' | 'job_worker' | 'consignee' | 'supplier' | 'customer'

export interface StockEffectOption {
  value: string
  label: string
  hint: string
}

export interface DocumentTypeSpec {
  code: string
  slug: string
  label: string
  /** One-line description shown in the "new document" menu. */
  description: string
  lineMode: LineMode
  formKind: FormKind
  /** Lines are valued (FIFO/LIFO/WAC) on posting. */
  valuation: boolean
  /** Out lines produce a COGS_ISSUE accounting effect. */
  cogs: boolean
  /** Which party the header asks for, if any. */
  party: PartyRole | null
  /** `stock_effect` choices for challans; first is the default. */
  stockEffects: StockEffectOption[]
  /** Header shows returnable / expected return date. */
  returnable: boolean
  /** Header shows reason code / movement reason. */
  reason: boolean
  /** Each line shows the entered rate + amount (commercial / opening value). */
  rate: boolean
  /** Each line shows an explicit per-base-unit valuation rate input. */
  valuationRate: boolean
  /** Lines are stock-affecting on post (used for availability hints). */
  movesStock: boolean
}

const CHALLAN_ONLY: StockEffectOption = { value: 'challan_only', label: 'Challan only (pending)', hint: 'Opens a pending quantity; stock moves when the invoice settles it.' }
const PHYSICAL: StockEffectOption = { value: 'physical', label: 'Physical movement', hint: 'Moves stock now and still records the pending quantity against the party.' }
const SETTLE_DEFERRED: StockEffectOption = { value: 'settle_deferred', label: 'Settle a deferred purchase', hint: 'Receives goods against a purchase that was invoiced but not yet received.' }

function spec(partial: Omit<DocumentTypeSpec, 'slug' | 'stockEffects' | 'returnable' | 'reason' | 'rate' | 'valuationRate' | 'party' | 'movesStock'> & Partial<DocumentTypeSpec>): DocumentTypeSpec {
  const movesStock = partial.movesStock ?? ['fixed_in', 'fixed_out', 'by_line', 'transfer'].includes(partial.lineMode)
  return {
    slug: partial.code.toLowerCase(),
    party: null,
    stockEffects: [],
    returnable: false,
    reason: false,
    rate: false,
    valuationRate: false,
    ...partial,
    movesStock,
  }
}

export const NATIVE_DOCUMENT_TYPES: DocumentTypeSpec[] = [
  spec({ code: 'OPENING_STOCK', label: 'Opening Stock', description: 'Bring stock in with its opening value.', lineMode: 'fixed_in', formKind: 'lines', valuation: true, cogs: false, rate: true }),
  spec({ code: 'STOCK_TRANSFER', label: 'Stock Transfer', description: 'Move stock between two warehouses.', lineMode: 'transfer', formKind: 'transfer', valuation: true, cogs: false }),
  spec({ code: 'STOCK_JOURNAL', label: 'Stock Journal', description: 'Free-form in / out lines with a stock adjustment effect.', lineMode: 'by_line', formKind: 'lines', valuation: true, cogs: false, reason: true, rate: true }),
  spec({ code: 'PHYSICAL_ADJUSTMENT', label: 'Physical Stock Count', description: 'Book quantity versus counted quantity per item and warehouse.', lineMode: 'by_line', formKind: 'physical_count', valuation: true, cogs: false, reason: true, valuationRate: true }),
  spec({ code: 'WRITE_OFF', label: 'Stock Write-Off', description: 'Remove damaged, expired or lost stock.', lineMode: 'fixed_out', formKind: 'lines', valuation: true, cogs: false, reason: true }),
  spec({ code: 'WRITE_IN', label: 'Stock Write-In / Excess', description: 'Bring found or excess stock in at a cost.', lineMode: 'fixed_in', formKind: 'lines', valuation: true, cogs: false, reason: true, rate: true }),
  spec({ code: 'CONSUMPTION', label: 'Consumption', description: 'Consume stock internally (COGS).', lineMode: 'fixed_out', formKind: 'lines', valuation: true, cogs: true, reason: true }),
  spec({ code: 'MATERIAL_ISSUE', label: 'Material Issue', description: 'Issue material out of stores (COGS).', lineMode: 'fixed_out', formKind: 'lines', valuation: true, cogs: true, reason: true }),
  spec({ code: 'MATERIAL_RECEIPT', label: 'Material Receipt', description: 'Receive material into stores at a cost.', lineMode: 'fixed_in', formKind: 'lines', valuation: true, cogs: false, rate: true }),
  spec({ code: 'PRODUCTION', label: 'Production', description: 'Consume components from a bill of materials and receive finished goods.', lineMode: 'by_line', formKind: 'production', valuation: true, cogs: true, valuationRate: true }),
  spec({ code: 'ASSEMBLY', label: 'Assembly', description: 'Assemble a kit: components out, assembled item in.', lineMode: 'by_line', formKind: 'lines', valuation: true, cogs: false, valuationRate: true }),
  spec({ code: 'DISASSEMBLY', label: 'Disassembly', description: 'Break a kit back into its components.', lineMode: 'by_line', formKind: 'lines', valuation: true, cogs: false, valuationRate: true }),
  // rate: the challan value of the goods sent. Not a valuation — the stock never leaves
  // ownership, so nothing is costed here — but Table 4 of ITC-04 declares the value each challan
  // went out at, and without the field the return can only ever be filed at 0.00.
  spec({ code: 'JOB_WORK_OUT', label: 'Job Work Outward', description: 'Send material to a job worker (stays yours, tracked as pending).', lineMode: 'status_only', formKind: 'job_work_out', valuation: false, cogs: false, party: 'job_worker', returnable: true, rate: true }),
  // rate: the value on the challan the goods come back on, which is what Table 5 of ITC-04
  // declares. valuationRate: what those goods cost. One column cannot be both — costed at the
  // challan value closing stock is re-priced at whatever was agreed with the job worker, and
  // filed at cost the return's Value column is a basis no challan states.
  spec({ code: 'JOB_WORK_IN', label: 'Job Work Inward', description: 'Settle material with the job worker and receive finished goods.', lineMode: 'by_line', formKind: 'job_work_in', valuation: true, cogs: true, party: 'job_worker', rate: true, valuationRate: true }),
  spec({ code: 'BATCH_ADJUSTMENT', label: 'Batch Adjustment', description: 'Correct batch allocations without changing value.', lineMode: 'by_line', formKind: 'lines', valuation: false, cogs: false, reason: true, movesStock: false }),
  spec({ code: 'SERIAL_ADJUSTMENT', label: 'Serial Adjustment', description: 'Correct serial numbers without changing value.', lineMode: 'by_line', formKind: 'lines', valuation: false, cogs: false, reason: true, movesStock: false }),
  spec({ code: 'REVALUATION', label: 'Stock Revaluation', description: 'Re-price the cost of stock on hand.', lineMode: 'status_only', formKind: 'revaluation', valuation: true, cogs: false, reason: true, valuationRate: true }),
  // rate: false. The charges are not line rates — collecting them in the commercial
  // source_transaction_* pair Books owns was the broken shape of this type before it was built, an
  // amount that may never become a cost by falling through to valuation. A landed cost allocation
  // carries no item lines at all: it names a posted receipt and the charges to spread over it.
  spec({ code: 'LANDED_COST', label: 'Landed Cost Allocation', description: 'Allocate freight, duty and other landing costs to received stock.', lineMode: 'status_only', formKind: 'landed_cost', valuation: true, cogs: false, party: 'supplier', rate: false }),
  spec({ code: 'DELIVERY_CHALLAN', label: 'Delivery Challan / Dispatch', description: 'Dispatch goods to a customer ahead of the invoice.', lineMode: 'pending_only', formKind: 'delivery_challan', valuation: false, cogs: false, party: 'customer', stockEffects: [CHALLAN_ONLY, PHYSICAL], returnable: true }),
  spec({ code: 'INWARD_CHALLAN', label: 'Inward Challan / GRN', description: 'Receive goods from a supplier ahead of, or against, the purchase.', lineMode: 'pending_only', formKind: 'inward_challan', valuation: false, cogs: false, party: 'supplier', stockEffects: [CHALLAN_ONLY, SETTLE_DEFERRED, PHYSICAL] }),
  spec({ code: 'PACKING', label: 'Packing List', description: 'Pack goods for a consignee; packed stock is held until sold or unpacked.', lineMode: 'status_only', formKind: 'packing', valuation: false, cogs: false, party: 'consignee' }),
]

/**
 * Declared so an existing document and every register that lists one keep their label, but not
 * available to create: the server refuses one (Config\DocumentTypeRegistry::UNIMPLEMENTED),
 * because nothing happens when the type posts. Mirror of the server list, which is the truth.
 *
 * Empty, as the server's list now is. LANDED_COST was the only entry and is built on both sides:
 * a receipt line carries the landed cost Books allocated to it, and a landed cost allocation
 * spreads later-arriving charges over a posted receipt. The set stays for the next type declared
 * ahead of its implementation.
 */
export const UNAVAILABLE_TYPES = new Set<string>([])

/** Types with their own screens elsewhere (reservations), unavailable, or created only by other products. */
export const HIDDEN_FROM_NEW_MENU = new Set(['RESERVATION', 'RESERVATION_RELEASE', ...UNAVAILABLE_TYPES])

/**
 * Document types Inventory holds but never authors — the stock half of a Books
 * commercial voucher, plus the two reservation types other products raise.
 *
 * Mirror of the `'native' => false` rows of `Config\DocumentTypeRegistry::TYPES`
 * plus RESERVATION / RESERVATION_RELEASE. They are not in
 * `NATIVE_DOCUMENT_TYPES` because nothing here creates one, but they ARE in the
 * documents register — a register whose whole point is seeing both products'
 * documents side by side. `GET /v1/document-types` returns them, so this list is
 * only the fallback for a request that is still in flight or that failed; a Type
 * filter that silently drops "Sales Issue" while that request is pending is a
 * filter the reader cannot use on exactly the screen they came to it for.
 */
export const SOURCED_DOCUMENT_TYPES: { code: string; label: string }[] = [
  { code: 'SALES_ISSUE', label: 'Sales Issue' },
  { code: 'PURCHASE_RECEIPT', label: 'Purchase Receipt' },
  { code: 'SALES_RETURN', label: 'Sales Return (Credit Note)' },
  { code: 'PURCHASE_RETURN', label: 'Purchase Return (Debit Note)' },
  { code: 'JOURNAL_ADJUSTMENT', label: 'Journal with Item' },
  { code: 'RESERVATION', label: 'Inventory Reservation' },
  { code: 'RESERVATION_RELEASE', label: 'Reservation Release' },
]

const BY_CODE = new Map(NATIVE_DOCUMENT_TYPES.map((s) => [s.code, s]))

export function specForCode(code: string | null | undefined): DocumentTypeSpec | null {
  if (!code) return null
  return BY_CODE.get(code.toUpperCase()) ?? null
}

export function specForSlug(slug: string | null | undefined): DocumentTypeSpec | null {
  if (!slug) return null
  return specForCode(slug.replace(/-/g, '_').toUpperCase())
}

export function slugForCode(code: string): string {
  return code.toLowerCase()
}

/** Label for any code, including Books-sourced types the registry does not edit. */
export function labelForCode(code: string, fallback?: string): string {
  return specForCode(code)?.label ?? fallback ?? code.replace(/_/g, ' ').toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase())
}

/** Human labels for the stock_effect values that Books-sourced documents may carry. */
export const STOCK_EFFECT_LABELS: Record<string, string> = {
  on_invoice: 'On invoice',
  from_challan: 'From challan',
  defer_inward: 'Deferred inward',
  settle_deferred: 'Settles deferred purchase',
  challan_only: 'Challan only',
  physical: 'Physical movement',
  from_packing: 'From packing list',
  from_physical_challan: 'From physical challan',
}
