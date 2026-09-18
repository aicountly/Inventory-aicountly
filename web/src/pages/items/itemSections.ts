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
