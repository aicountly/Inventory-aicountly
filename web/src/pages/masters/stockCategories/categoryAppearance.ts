import { Blocks, Box, Boxes, Building2, Cog, Factory, Layers, Package, PackageCheck, Shapes, ShoppingCart, Tag, Timer, Wrench } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import type { IconTone } from '../../../ui/IconTile'

/**
 * The glyph and the wash a category wears in the list.
 *
 * Two rules, in order:
 *
 *  1. A category whose name says what it holds gets the icon for that thing.
 *     "Raw Material" is a factory in every Aicountly company, so a reader who
 *     learns the row here recognises it in the next company's books.
 *  2. Anything else is hashed from its **id**, which never changes, so the
 *     colour survives a rename, a re-sort and every rerender. Hashing the name
 *     would repaint the row the moment somebody fixed a typo in it.
 *
 * The tones are `IconTile`'s, not raw Tailwind: those nine are the ones
 * theme/dark-overrides.css remaps, so a category tile that is soft violet on
 * white is soft violet on the dark surface too. A hand-picked wash off that
 * ramp has no dark-mode rule and would render as a bright block on the dark
 * surface — which is exactly what theme/darkAccents.test.ts checks for.
 */

export interface CategoryAppearance {
  icon: LucideIcon
  tone: IconTone
}

interface Rule {
  /** Matched against the lower-cased name and alias. */
  test: RegExp
  appearance: CategoryAppearance
}

/*
 * Order matters: "Semi-Finished Goods" contains "finished", so the narrower
 * rule has to be asked first or every semi-finished category turns green.
 */
const RULES: readonly Rule[] = [
  { test: /\b(semi[-\s]?finished|sfg)\b/, appearance: { icon: Blocks, tone: 'violet' } },
  { test: /\b(work[-\s]?in[-\s]?progress|wip|in[-\s]?process)\b/, appearance: { icon: Timer, tone: 'primary' } },
  { test: /\b(capital|asset|machinery|equipment)\b/, appearance: { icon: Building2, tone: 'violet' } },
  { test: /\b(consumables?|con)\b/, appearance: { icon: Box, tone: 'info' } },
  { test: /\b(finished|fg)\b/, appearance: { icon: PackageCheck, tone: 'success' } },
  { test: /\b(packing|packaging|pm)\b/, appearance: { icon: Package, tone: 'warning' } },
  { test: /\b(raw|materials?|rm)\b/, appearance: { icon: Factory, tone: 'rose' } },
  { test: /\b(services?|labour|labor|svc)\b/, appearance: { icon: Wrench, tone: 'teal' } },
  { test: /\b(spares?|parts?|components?|sp)\b/, appearance: { icon: Cog, tone: 'warning' } },
  { test: /\b(trading|trade|resale|tg)\b/, appearance: { icon: ShoppingCart, tone: 'info' } },
]

/** The fallback wheel for a name none of the rules recognise. */
const FALLBACK: readonly CategoryAppearance[] = [
  { icon: Tag, tone: 'primary' },
  { icon: Boxes, tone: 'info' },
  { icon: Shapes, tone: 'violet' },
  { icon: Box, tone: 'teal' },
  { icon: Package, tone: 'rose' },
  { icon: Layers, tone: 'warning' },
  { icon: Tag, tone: 'slate' },
  { icon: Boxes, tone: 'success' },
]

/** Stable, order-independent slot. Same id → same slot, in every session. */
function slotOf(id: number, name: string): number {
  if (Number.isFinite(id) && id > 0) return Math.floor(id) % FALLBACK.length
  let h = 0
  for (let i = 0; i < name.length; i += 1) h = (h * 31 + name.charCodeAt(i)) >>> 0
  return h % FALLBACK.length
}

export interface CategoryLike {
  stock_cat_id?: number
  cat_name?: string | null
  cat_alias?: string | null
}

export function categoryAppearance(category: CategoryLike): CategoryAppearance {
  const haystack = `${category.cat_name ?? ''} ${category.cat_alias ?? ''}`.toLowerCase()
  for (const rule of RULES) {
    if (rule.test.test(haystack)) return rule.appearance
  }
  return FALLBACK[slotOf(Number(category.stock_cat_id ?? 0), String(category.cat_name ?? ''))] as CategoryAppearance
}
