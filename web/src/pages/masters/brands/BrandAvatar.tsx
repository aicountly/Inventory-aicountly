import { useState } from 'react'
import { cx } from '../../../ui/cx'
import { brandAvatarTone, brandInitials } from './brandIdentity'
import type { BrandAvatarTone } from './brandIdentity'

/**
 * The square beside a brand's name.
 *
 * Render order is logo → initials → nothing that is not one of those two. There
 * is no third state where a generic box stands in, because a generic box in
 * every row is worse than initials in every row: initials are at least the
 * brand's own.
 *
 * `logoUrl` is the seam for artwork Inventory does not store today. The master
 * has no logo column and no upload, and nothing here reaches out to a third
 * party for one at render time — a master screen that fetched brand logos off
 * the internet would tell whoever serves them which brands this company
 * carries. When a logo does arrive, it is preferred; if it fails to load the
 * initials come straight back, so a dead URL never leaves a hole.
 */

const TONE_CLASS: Record<BrandAvatarTone, string> = {
  slate: 'bg-slate-100 text-slate-700 border-slate-200',
  primary: 'bg-primary-light text-primary border-primary/20',
  info: 'bg-sky-50 text-sky-700 border-sky-200',
  violet: 'bg-violet-50 text-violet-700 border-violet-200',
  amber: 'bg-amber-50 text-amber-700 border-amber-200',
  teal: 'bg-teal-50 text-teal-700 border-teal-200',
  rose: 'bg-rose-50 text-rose-700 border-rose-200',
}

const SIZE_CLASS = {
  sm: 'h-8 w-8 rounded-lg text-[11px]',
  md: 'h-10 w-10 rounded-xl text-xs',
  lg: 'h-12 w-12 rounded-xl text-sm',
} as const

export interface BrandAvatarProps {
  name: string
  logoUrl?: string | null
  size?: keyof typeof SIZE_CLASS
  className?: string
}

export function BrandAvatar({ name, logoUrl, size = 'sm', className }: BrandAvatarProps) {
  const [broken, setBroken] = useState(false)
  const showLogo = Boolean(logoUrl) && !broken

  return (
    <span
      // Decorative: the brand's name is the text right beside it in the same
      // cell, so announcing "A" again would only make the row longer to hear.
      aria-hidden
      className={cx(
        'inline-flex shrink-0 items-center justify-center overflow-hidden border font-semibold uppercase tracking-tight',
        SIZE_CLASS[size],
        showLogo ? 'border-gray-200 bg-white' : TONE_CLASS[brandAvatarTone(name)],
        className,
      )}
    >
      {showLogo ? (
        <img
          src={logoUrl ?? ''}
          alt=""
          loading="lazy"
          className="h-full w-full object-contain"
          onError={() => setBroken(true)}
        />
      ) : (
        brandInitials(name)
      )}
    </span>
  )
}

export default BrandAvatar
