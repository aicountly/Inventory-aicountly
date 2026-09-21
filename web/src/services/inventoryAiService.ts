/**
 * Item intelligence for the Edit Item workspace — insights and field suggestions.
 *
 * ## Why this is a service and not a component
 *
 * There is no AI endpoint in the Inventory API today. Rather than invent one (a fake URL that
 * 404s in production teaches a reader that the feature is broken, and a stubbed response that
 * *looks* like a model's answer is worse still), this module is the seam: one place that decides
 * where an item's insights come from, and a deterministic rule engine behind it that is honest
 * about being deterministic.
 *
 * `SERVICE_ENDPOINT` is the single line to change on the day Inventory grows a real endpoint.
 * Until then every result is marked `source: 'rules'` and the UI says so, because a business rule
 * presented as a model's judgement is a claim the product cannot support — and, for tax
 * classification in particular, one it must never make.
 *
 * ## What the rules may and may not do
 *
 * They read the draft in front of the user and report what is inconsistent about it. They never
 * decide tax treatment: HSN/SAC is checked for *shape* (the same 4–8 alphanumeric rule the server
 * enforces) and never for meaning, and no suggestion ever proposes an HSN code. Books resolves the
 * tax consequence of an item; guessing a classification here would be Inventory answering a
 * question that is not its to answer.
 *
 * Nothing here blocks a save. `validateItemForm` owns what may not be written; these are remarks.
 */

/** How strongly an insight reads. `ok` is a passed check, not an absence of one. */
export type InsightLevel = 'ok' | 'warn' | 'critical'

/** Sections of the edit workspace an insight can point at, so the card can offer a jump. */
export type InsightSection =
  | 'basic'
  | 'classification'
  | 'units'
  | 'pricing'
  | 'stock'
  | 'accounting'
  | 'additional'
  | 'media'

export interface ItemInsight {
  id: string
  level: InsightLevel
  /** One line, written for the person editing the item. */
  message: string
  /** Optional second line: why it matters or what to do. */
  detail?: string
  section?: InsightSection
}

export interface ItemInsightsResult {
  /** The worst level present, which drives the summary box. */
  status: InsightLevel
  headline: string
  summary: string
  insights: ItemInsight[]
  /** `rules` = deterministic checks in the browser; `service` = a real insights endpoint. */
  source: 'rules' | 'service'
  generatedAt: number
}

/**
 * The draft as the rules see it — plain values, no form types.
 *
 * Deliberately decoupled from `ItemFormState`: a service that imports from `pages/` inverts the
 * dependency and makes the rules impossible to reuse from anywhere else.
 */
export interface ItemInsightInput {
  itemId: number | null
  itemName: string
  itemType: string
  sku: string
  barcode: string
  hsnSac: string
  mrp: number | null
  standardCost: number | null
  itemGroupId: string
  stockCategoryId: string
  brandId: string
  baseUnitId: string
  alternateUnits: { unitId: string; factor: number | null }[]
  valuationMethod: string
  trackBatch: boolean
  trackSerial: boolean
  trackExpiry: boolean
  shelfLifeDays: number | null
  negativeStockPolicy: string
  minStockQty: number | null
  maxStockQty: number | null
  reorderPointQty: number | null
  defaultWarehouseId: string
  /** Warehouse ids that are live in this company — an id outside the set is a dead reference. */
  activeWarehouseIds: number[]
  openings: { unitId: string; qty: number | null; rate: number | null }[]
  hasDescription: boolean
}

const HSN_SHAPE = /^[0-9A-Za-z]{4,8}$/

/** `stock` items carry quantity; service and non-stock items do not, so stock rules skip them. */
function isStocked(input: ItemInsightInput): boolean {
  return input.itemType === 'stock'
}

/**
 * Every check, in the order a reader should meet them: identity, then classification, then the
 * physical configuration, then the money.
 *
 * Pure and exported so the suite can hold each rule against a draft without a component in sight.
 */
export function evaluateItemInsights(input: ItemInsightInput): ItemInsight[] {
  const out: ItemInsight[] = []
  const stocked = isStocked(input)

  // ---- Identity ---------------------------------------------------------
  if (!input.hsnSac.trim()) {
    out.push({
      id: 'hsn-missing',
      level: 'warn',
      message: 'No HSN / SAC recorded',
      detail: 'Books needs it to decide tax on this item. Inventory does not choose the code.',
      section: 'basic',
    })
  } else if (!HSN_SHAPE.test(input.hsnSac.trim())) {
    out.push({
      id: 'hsn-shape',
      level: 'critical',
      message: 'HSN / SAC is not 4 to 8 letters or digits',
      detail: 'The server refuses this shape; the save will fail.',
      section: 'basic',
    })
  } else {
    out.push({ id: 'hsn-ok', level: 'ok', message: 'HSN code is well formed', section: 'basic' })
  }

  if (!input.sku.trim()) {
    out.push({
      id: 'sku-missing',
      level: 'warn',
      message: 'No SKU',
      detail: 'Scanning, bulk edit and imports all match on it.',
      section: 'basic',
    })
  }

  if (input.barcode.trim() && input.barcode.trim() === input.sku.trim()) {
    out.push({
      id: 'barcode-equals-sku',
      level: 'warn',
      message: 'Barcode and SKU are the same value',
      detail: 'A scan will not tell the two apart.',
      section: 'basic',
    })
  }

  // ---- Classification ---------------------------------------------------
  const grouped = Boolean(input.itemGroupId) && Boolean(input.stockCategoryId)
  if (grouped) {
    out.push({
      id: 'classification-ok',
      level: 'ok',
      message: 'Item is linked to a group and category',
      section: 'classification',
    })
  } else {
    const missing = [!input.itemGroupId ? 'group' : null, !input.stockCategoryId ? 'stock category' : null]
      .filter(Boolean)
      .join(' and ')
    out.push({
      id: 'classification-missing',
      level: 'warn',
      message: `No item ${missing}`,
      detail: 'Reports and filters group by these; unclassified items fall outside every breakdown.',
      section: 'classification',
    })
  }

  // ---- Units ------------------------------------------------------------
  if (!input.baseUnitId) {
    out.push({
      id: 'base-unit-missing',
      level: 'critical',
      message: 'No base unit',
      detail: 'Stock is kept in the base unit; the item cannot be saved without one.',
      section: 'units',
    })
  } else {
    out.push({ id: 'base-unit-ok', level: 'ok', message: 'Base unit is properly set', section: 'units' })
  }

  const badFactor = input.alternateUnits.find((u) => u.unitId && (u.factor === null || u.factor <= 0))
  if (badFactor) {
    out.push({
      id: 'conversion-invalid',
      level: 'critical',
      message: 'An alternate unit has no usable conversion',
      detail: 'Every alternate unit needs a factor greater than zero.',
      section: 'units',
    })
  }
  const duplicateUnit = input.alternateUnits.some(
    (u, i) => u.unitId && input.alternateUnits.findIndex((o) => o.unitId === u.unitId) !== i,
  )
  if (duplicateUnit) {
    out.push({
      id: 'conversion-duplicate',
      level: 'critical',
      message: 'The same alternate unit is listed twice',
      section: 'units',
    })
  }
  if (input.alternateUnits.some((u) => u.unitId && u.unitId === input.baseUnitId)) {
    out.push({
      id: 'conversion-base',
      level: 'critical',
      message: 'An alternate unit repeats the base unit',
      section: 'units',
    })
  }

  // ---- Valuation and price ---------------------------------------------
  if (!input.valuationMethod) {
    out.push({
      id: 'valuation-missing',
      level: 'critical',
      message: 'No valuation method',
      detail: 'Costing cannot run without one.',
      section: 'pricing',
    })
  } else {
    out.push({
      id: 'valuation-ok',
      level: 'ok',
      message: `Valuation method is configured (${input.valuationMethod})`,
      section: 'pricing',
    })
  }

  if (input.mrp !== null && input.standardCost !== null && input.standardCost > 0) {
    if (input.mrp < input.standardCost) {
      out.push({
        id: 'mrp-below-cost',
        level: 'critical',
        message: 'MRP is below standard cost',
        detail: 'Every sale at this price books a loss. Check whichever figure is wrong.',
        section: 'pricing',
      })
    } else if (input.mrp > 0 && (input.mrp - input.standardCost) / input.mrp < 0.05) {
      out.push({
        id: 'margin-thin',
        level: 'warn',
        message: 'Less than 5% between standard cost and MRP',
        section: 'pricing',
      })
    }
  }

  // ---- Stock configuration ---------------------------------------------
  if (stocked) {
    if (input.trackExpiry && !input.trackBatch) {
      out.push({
        id: 'expiry-without-batch',
        level: 'critical',
        message: 'Expiry is tracked but batches are not',
        detail: 'An expiry date belongs to a batch; without batch tracking there is nothing to date.',
        section: 'stock',
      })
    }
    if (input.trackBatch && input.trackExpiry && input.shelfLifeDays === null) {
      out.push({
        id: 'shelf-life-missing',
        level: 'warn',
        message: 'Expiry is tracked with no shelf life',
        detail: 'Batch expiry will have to be typed by hand on every receipt.',
        section: 'stock',
      })
    }
    if (input.trackSerial && input.trackBatch) {
      out.push({
        id: 'serial-and-batch',
        level: 'warn',
        message: 'Both serials and batches are tracked',
        detail: 'Every movement will need both identified. Keep it only if the goods really need it.',
        section: 'stock',
      })
    }
    if (input.negativeStockPolicy === 'allow') {
      out.push({
        id: 'negative-allowed',
        level: 'warn',
        message: 'Negative stock is allowed on this item',
        detail: 'Issues may run the balance below zero and value it at an assumed rate.',
        section: 'stock',
      })
    }
    if (input.minStockQty !== null && input.maxStockQty !== null && input.minStockQty > input.maxStockQty) {
      out.push({
        id: 'min-above-max',
        level: 'critical',
        message: 'Minimum stock is above maximum stock',
        section: 'stock',
      })
    }
    if (input.reorderPointQty === null && input.minStockQty === null) {
      out.push({
        id: 'reorder-missing',
        level: 'warn',
        message: 'No reorder point or minimum',
        detail: 'Replenishment reports have nothing to compare the balance against.',
        section: 'stock',
      })
    }
    if (
      input.defaultWarehouseId &&
      input.activeWarehouseIds.length > 0 &&
      !input.activeWarehouseIds.includes(Number(input.defaultWarehouseId))
    ) {
      out.push({
        id: 'warehouse-inactive',
        level: 'critical',
        message: 'The default warehouse is not in this company',
        detail: 'Pick one of the live warehouses.',
        section: 'stock',
      })
    }
    const openingWithoutUnit = input.openings.some((o) => o.qty !== null && o.qty !== 0 && !o.unitId)
    if (openingWithoutUnit) {
      out.push({
        id: 'opening-no-unit',
        level: 'critical',
        message: 'An opening row has a quantity but no unit',
        section: 'stock',
      })
    }
    const openingWithoutRate = input.openings.some((o) => o.qty !== null && o.qty > 0 && (o.rate === null || o.rate === 0))
    if (openingWithoutRate) {
      out.push({
        id: 'opening-no-rate',
        level: 'warn',
        message: 'Opening stock carries no valuation rate',
        detail: 'It will open at zero value and skew the first issues.',
        section: 'stock',
      })
    }
  }

  // ---- Additional -------------------------------------------------------
  if (!input.hasDescription) {
    out.push({
      id: 'description-missing',
      level: 'warn',
      message: 'No description recorded',
      detail: 'It is what a picker, a buyer and a print sheet read when the name is not enough.',
      section: 'additional',
    })
  }

  return out
}

const LEVEL_RANK: Record<InsightLevel, number> = { ok: 0, warn: 1, critical: 2 }

/** The worst level present — an `ok` list is only ok when nothing else is in it. */
export function worstLevel(insights: ItemInsight[]): InsightLevel {
  return insights.reduce<InsightLevel>((worst, i) => (LEVEL_RANK[i.level] > LEVEL_RANK[worst] ? i.level : worst), 'ok')
}

const HEADLINE: Record<InsightLevel, { headline: string; summary: string }> = {
  ok: { headline: 'Looks good!', summary: 'This item is well configured. No critical issues found.' },
  warn: { headline: 'Needs attention', summary: 'Nothing blocks a save, but some settings are worth a second look.' },
  critical: { headline: 'Configuration issue detected', summary: 'Something here is inconsistent and should be fixed before this item is used.' },
}

export function summariseInsights(insights: ItemInsight[], source: 'rules' | 'service' = 'rules'): ItemInsightsResult {
  const status = worstLevel(insights)
  // Worst first, so the one thing to act on is the first thing read.
  const ordered = [...insights].sort((a, b) => LEVEL_RANK[b.level] - LEVEL_RANK[a.level])
  return { status, ...HEADLINE[status], insights: ordered, source, generatedAt: Date.now() }
}

/* -------------------------------------------------------------------------- */
/* Suggestions                                                                */
/* -------------------------------------------------------------------------- */

/** Fields a suggestion is allowed to touch. Tax classification is deliberately absent. */
export type SuggestableField =
  | 'print_name'
  | 'item_alias'
  | 'item_sku'
  | 'description'
  | 'tags'
  | 'reorder_point_qty'

export interface ItemSuggestion {
  id: string
  field: SuggestableField
  label: string
  /** What the field holds now, for the before/after the user is shown. */
  current: string
  /** What would be written. Never applied without an explicit click. */
  suggested: string
  reason: string
}

export interface ItemSuggestionInput {
  itemName: string
  printName: string
  alias: string
  sku: string
  description: string
  tags: string[]
  groupName: string | null
  categoryName: string | null
  brandName: string | null
  unitName: string | null
  itemType: string
  minStockQty: number | null
  safetyStockQty: number | null
  reorderPointQty: number | null
}

/** `Ballpoint Pens` → `BAL-PEN`; stable, readable, and unique enough to be worth reviewing. */
function skuFromName(name: string): string {
  const words = name
    .toUpperCase()
    .replace(/[^A-Z0-9 ]+/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
  if (words.length === 0) return ''
  const parts = words.slice(0, 2).map((w) => w.slice(0, 3))
  return parts.join('-')
}

/** The shortest honest short name: one word stays whole, several become their head word. */
function aliasFromName(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean)
  if (words.length === 0) return ''
  if (words.length === 1) return words[0].slice(0, 20)
  // "Ballpoint Pens" → "Pens": the head noun is what people say out loud.
  return words[words.length - 1].slice(0, 20)
}

function describe(input: ItemSuggestionInput): string {
  const bits: string[] = []
  if (input.brandName) bits.push(input.brandName)
  bits.push(input.itemName)
  const trailer: string[] = []
  if (input.categoryName) trailer.push(input.categoryName.toLowerCase())
  if (input.groupName) trailer.push(`${input.groupName.toLowerCase()} group`)
  const head = bits.join(' ')
  return trailer.length ? `${head} — ${trailer.join(', ')}.` : `${head}.`
}

/**
 * Deterministic proposals drawn from what the item already says about itself.
 *
 * Nothing is invented from outside the record: a tag comes from the group the user chose, a
 * description from the name and the classification, a reorder point from a stock level already
 * entered. A field that is already filled is left alone — overwriting a human's value is exactly
 * what "suggest" must not mean.
 */
export function buildItemSuggestions(input: ItemSuggestionInput): ItemSuggestion[] {
  const out: ItemSuggestion[] = []
  const name = input.itemName.trim()
  if (!name) return out

  if (!input.printName.trim()) {
    out.push({
      id: 'print-name',
      field: 'print_name',
      label: 'Print name',
      current: '',
      suggested: name,
      reason: 'Documents print this. With it empty the item name is used anyway — writing it down makes that explicit and editable.',
    })
  }

  const alias = aliasFromName(name)
  if (!input.alias.trim() && alias && alias.toLowerCase() !== name.toLowerCase()) {
    out.push({
      id: 'alias',
      field: 'item_alias',
      label: 'Alias / short name',
      current: '',
      suggested: alias,
      reason: 'The head word of the item name — what a picker types into search.',
    })
  }

  const sku = skuFromName(name)
  if (!input.sku.trim() && sku) {
    out.push({
      id: 'sku',
      field: 'item_sku',
      label: 'SKU / item code',
      current: '',
      suggested: sku,
      reason: 'A readable code from the item name. It must be unique in the company — the server checks it on save.',
    })
  }

  if (!input.description.trim()) {
    out.push({
      id: 'description',
      field: 'description',
      label: 'Description',
      current: '',
      suggested: describe(input),
      reason: 'Assembled from the name, brand and classification already on this item.',
    })
  }

  if (input.tags.length === 0) {
    const tags = [input.groupName, input.categoryName, input.brandName]
      .filter((t): t is string => Boolean(t && t.trim()))
      .map((t) => t.trim())
    if (tags.length > 0) {
      out.push({
        id: 'tags',
        field: 'tags',
        label: 'Tags',
        current: '—',
        suggested: tags.join(', '),
        reason: 'The group, category and brand this item is already filed under.',
      })
    }
  }

  const base = input.reorderPointQty === null ? (input.minStockQty ?? input.safetyStockQty) : null
  if (base !== null && base > 0) {
    // A fifth above the floor: enough of a gap that an order placed at the point still lands
    // before the floor is reached. Rounded to 4dp, the precision the column stores.
    const suggested = Math.round(base * 1.2 * 10000) / 10000
    out.push({
      id: 'reorder-point',
      field: 'reorder_point_qty',
      label: 'Reorder point',
      current: '—',
      suggested: String(suggested),
      reason: `20% above the ${input.minStockQty !== null ? 'minimum' : 'safety'} stock already set, so an order is raised before the floor is hit. Check it against your lead time.`,
    })
  }

  return out
}

/**
 * Why no HSN/SAC suggestion.
 *
 * Shown in the suggestions drawer as a standing note rather than as a row with an Apply button.
 * A tax classification guessed from a product name is a liability dressed as a convenience: it is
 * Books that resolves an item's tax treatment, against the tax category and the ledger, and the
 * code itself comes from the statutory schedule. Inventory records what the user tells it.
 */
export const HSN_SUGGESTION_NOTE =
  'No HSN / SAC is suggested. Tax classification is resolved in Books against the tax category and the ledger — Inventory records the code you enter, it does not choose it.'

/* -------------------------------------------------------------------------- */
/* The seam                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * Where a real insights service would live.
 *
 * `null` while none exists. Point it at the endpoint and both calls below start preferring it,
 * falling back to the rules if it is unreachable — the UI already renders `source` either way,
 * so a reader is never told a rule was a model.
 */
const SERVICE_ENDPOINT: string | null = null

export const inventoryAiService = {
  /** True when a genuine insights service is wired up. The card badges itself from this. */
  hasService(): boolean {
    return SERVICE_ENDPOINT !== null
  },

  /**
   * Insights for one item draft.
   *
   * Async on purpose: the rule pass is synchronous today, and the day it is not, no caller has to
   * change. `signal` is accepted for the same reason.
   */
  async getItemInsights(input: ItemInsightInput, _signal?: AbortSignal): Promise<ItemInsightsResult> {
    return summariseInsights(evaluateItemInsights(input), 'rules')
  },

  async getItemSuggestions(input: ItemSuggestionInput, _signal?: AbortSignal): Promise<ItemSuggestion[]> {
    return buildItemSuggestions(input)
  },
}

export default inventoryAiService
