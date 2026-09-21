import { Boxes, Calculator, FileText, IndianRupee, Layers3, Paperclip, Scale, Tags } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import type { InsightSection } from '../../services/inventoryAiService'

/**
 * The eight anchored sections of the Edit Item workspace, in the order they are read.
 *
 * One list, used by the sticky nav, by the section spy, by the skeleton and by the insight card's
 * "take me there" links — so a section can never exist in the nav and not on the page, or be
 * pointed at by an insight that leads nowhere.
 */
export interface ItemSection {
  id: InsightSection
  label: string
  icon: LucideIcon
  /** Sections that only apply to an item that holds quantity. */
  stockOnly?: boolean
}

export const ITEM_SECTIONS: readonly ItemSection[] = [
  { id: 'basic', label: 'Basic Details', icon: FileText },
  { id: 'classification', label: 'Classification', icon: Tags },
  { id: 'units', label: 'Units & Packaging', icon: Scale },
  { id: 'pricing', label: 'Pricing & Valuation', icon: IndianRupee },
  { id: 'stock', label: 'Stock & Locations', icon: Boxes },
  { id: 'accounting', label: 'Accounting', icon: Calculator },
  { id: 'additional', label: 'Additional', icon: Layers3 },
  { id: 'media', label: 'Media & Documents', icon: Paperclip },
]

/** DOM id of a section, and therefore its scroll target. */
export function sectionDomId(id: InsightSection): string {
  return `item-section-${id}`
}

/** The section id a DOM id names, or null when it names something else. */
export function sectionFromDomId(domId: string): InsightSection | null {
  const found = ITEM_SECTIONS.find((s) => sectionDomId(s.id) === domId)
  return found ? found.id : null
}

/**
 * Which section holds a given form field.
 *
 * Only needed where the page has to REACH a field rather than scroll near it: on a narrow screen
 * the workspace shows one section at a time, so a validation error on a field in a section that is
 * not on screen has to bring that section forward before anything can be focused. Keyed off the
 * `name` each card passes its field, so a field that moves cards is one line here.
 */
const FIELD_SECTION: Record<string, InsightSection> = {
  item_name: 'basic',
  item_type: 'basic',
  item_sku: 'basic',
  item_alias: 'basic',
  item_upc: 'basic',
  print_name: 'basic',
  hsn_sac: 'basic',
  mrp: 'basic',
  is_active: 'basic',

  item_grp_id: 'classification',
  stock_cat_id: 'classification',
  brand_id: 'classification',

  unit_id: 'units',
  purchase_unit_id: 'units',
  sales_unit_id: 'units',

  valuation_method: 'pricing',
  standard_cost: 'pricing',

  negative_stock_policy: 'stock',
  track_batch: 'stock',
  track_serial: 'stock',
  track_expiry: 'stock',
  shelf_life_days: 'stock',
  min_stock_qty: 'stock',
  max_stock_qty: 'stock',
  reorder_point_qty: 'stock',
  reorder_qty: 'stock',
  safety_stock_qty: 'stock',
  lead_time_days: 'stock',
  default_warehouse_id: 'stock',

  itc_eligibility: 'accounting',

  description: 'additional',
  notes: 'additional',
  manufacturer: 'additional',
  country_of_origin: 'additional',
  weight: 'additional',
  dimensions: 'additional',
}

export function sectionOfField(key: string): InsightSection | null {
  if (key.startsWith('unitLines.')) return 'units'
  if (key.startsWith('openings.')) return 'stock'
  return FIELD_SECTION[key] ?? null
}
