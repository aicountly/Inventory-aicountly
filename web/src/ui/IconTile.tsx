import type { LucideIcon } from 'lucide-react'
import { AIC, cx } from './cx'

export type IconTone =
  | 'primary'
  | 'success'
  | 'warning'
  | 'danger'
  | 'info'
  | 'violet'
  | 'slate'
  | 'rose'
  | 'teal'

export type IconTileSize = 'sm' | 'md' | 'lg'

const TONE_STYLES: Record<IconTone, string> = {
  primary: 'bg-primary-light text-primary',
  success: 'bg-emerald-50 text-emerald-600',
  warning: 'bg-amber-50 text-amber-600',
  danger: 'bg-red-50 text-red-600',
  info: 'bg-sky-50 text-sky-600',
  violet: 'bg-violet-50 text-violet-600',
  slate: 'bg-slate-100 text-slate-600',
  rose: 'bg-rose-50 text-rose-600',
  teal: 'bg-teal-50 text-teal-600',
}

/** Exported so a placeholder can reserve exactly the box a tile will occupy. */
export const ICON_TILE_SIZE: Record<IconTileSize, string> = {
  sm: 'w-8 h-8 rounded-lg',
  md: 'w-10 h-10 rounded-xl',
  lg: 'w-12 h-12 rounded-xl',
}

const GLYPH_SIZE: Record<IconTileSize, string> = {
  sm: 'w-4 h-4',
  md: 'w-4 h-4',
  lg: 'w-5 h-5',
}

export interface IconTileProps {
  icon?: LucideIcon
  tone?: IconTone
  size?: IconTileSize
  className?: string
}

/**
 * The tile is the icon's backing, not a decoration in its own right: with no
 * icon to hold it would draw an empty coloured square, so it draws nothing and
 * the layout closes up around it.
 */
export function IconTile({ icon: Icon, tone = 'primary', size = 'md', className }: IconTileProps) {
  if (!Icon) return null
  return (
    <span
      className={cx(
        AIC,
        'inline-flex items-center justify-center shrink-0',
        ICON_TILE_SIZE[size],
        TONE_STYLES[tone],
        className,
      )}
      aria-hidden
    >
      <Icon className={GLYPH_SIZE[size]} />
    </span>
  )
}


export default IconTile
