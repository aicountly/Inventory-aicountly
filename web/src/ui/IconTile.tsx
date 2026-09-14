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

const SIZE_STYLES: Record<IconTileSize, string> = {
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

export function IconTile({ icon: Icon, tone = 'primary', size = 'md', className }: IconTileProps) {
  return (
    <span
      className={cx(
        AIC,
        'inline-flex items-center justify-center shrink-0',
        SIZE_STYLES[size],
        TONE_STYLES[tone],
        className,
      )}
      aria-hidden
    >
      {Icon ? <Icon className={GLYPH_SIZE[size]} /> : null}
    </span>
  )
}


export default IconTile
