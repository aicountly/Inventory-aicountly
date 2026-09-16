/**
 * The one place a dashboard tone becomes a colour or an icon.
 *
 * model.ts deliberately knows nothing about React or lucide — it returns a
 * `Tone` and an icon *key*. These tables turn those into the Books design
 * language, so a tone means the same thing on a KPI tile, a bar and a legend
 * swatch, and changing the meaning of "warning" is a one-line edit.
 */

import type { LucideIcon } from 'lucide-react'
import {
  AlertTriangle,
  CalendarClock,
  CalendarX2,
  ClipboardCheck,
  Coins,
  Package,
  PackageCheck,
  ShoppingCart,
} from 'lucide-react'
import type { IconTone } from '../ui/IconTile'
import type { Tone } from './model'

export const KPI_ICONS: Record<string, LucideIcon> = {
  value: Coins,
  qty: PackageCheck,
  items: Package,
  negative: AlertTriangle,
  reorder: ShoppingCart,
  expiring: CalendarClock,
  expired: CalendarX2,
  approval: ClipboardCheck,
}

/** Dashboard tone → the IconTile palette (which has no `critical`). */
export const ICON_TONE: Record<Tone, IconTone> = {
  primary: 'primary',
  success: 'success',
  info: 'info',
  warning: 'warning',
  danger: 'danger',
  critical: 'rose',
  neutral: 'slate',
  teal: 'teal',
  violet: 'violet',
}

/** Bar fill. */
export const BAR_FILL: Record<Tone, string> = {
  primary: 'bg-primary',
  success: 'bg-emerald-500',
  info: 'bg-sky-500',
  warning: 'bg-amber-500',
  danger: 'bg-orange-500',
  critical: 'bg-rose-500',
  neutral: 'bg-gray-300',
  teal: 'bg-teal-500',
  violet: 'bg-violet-500',
}

/**
 * Bar track behind the fill — deliberately ONE neutral for every tone.
 *
 * A tinted track per tone (emerald-100 under emerald-500, and so on) looks
 * richer in light mode and wrong in dark: the theme's dark-mode retrofit layer
 * remaps the gray/slate utilities onto the semantic surface tokens but leaves
 * the accent tints alone, so a full-width `bg-emerald-100` row would stay pale
 * on a dark surface. `bg-gray-100` is remapped, so the track follows the theme
 * and the coloured fill does all the work — which reads better anyway.
 */
export const BAR_TRACK = 'bg-gray-100'

/** Legend swatch / small dot. */
export const DOT_FILL: Record<Tone, string> = BAR_FILL

/**
 * Donut palette — hex, because an SVG `stroke` cannot read a Tailwind class.
 * Same hues as the Books dashboard charts so the two products' charts match.
 */
export const CHART_PALETTE = ['#10b981', '#0ea5e9', '#a78bfa', '#f59e0b', '#f43f5e', '#94a3b8'] as const

/**
 * A restrained single-hue ramp, for a donut whose slices are all the same
 * KIND of thing.
 *
 * The multi-hue palette above says "these categories are different". A split of
 * stock value by item is not that: every slice is rupees of stock, and five
 * unrelated hues invite a reader to look for a meaning in the colours that is
 * not there. Ordered darkest first, so the largest slice is also the heaviest.
 */
export const CHART_RAMP_PRIMARY = ['#176c05', '#25b003', '#4cc22f', '#72cf5c', '#a2dc93', '#c8e9bd'] as const

export function chartColor(index: number, palette: readonly string[] = CHART_PALETTE): string {
  return palette[index % palette.length]
}
