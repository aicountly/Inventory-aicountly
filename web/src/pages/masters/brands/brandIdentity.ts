/**
 * What a brand looks like when it has no logo — which is every brand here.
 *
 * Inventory stores no brand artwork: there is no upload field on the master and
 * no column to put a URL in, and the screen is deliberately not built to depend
 * on one. Nothing fetches a logo off the internet at render time either — a
 * master-data screen that reaches out to a third party to decorate a row leaks
 * which brands a company carries to whoever is serving the image.
 *
 * So the avatar is drawn from the name itself: initials, in one of a small set
 * of tones picked deterministically from the name. Deterministic matters — the
 * same brand is the same colour on every page, in every company, after every
 * reload, so the colour becomes a way to find a row rather than noise.
 *
 * `brandAvatarTone` is the seam for artwork, when there is any: give the row a
 * logo URL and the component prefers it, falling back to these initials if it
 * fails to load.
 */

/**
 * `Apple` → `A`, `Tata Motors` → `TM`, `LG Electronics India` → `LG`.
 *
 * Two letters at most: three is a monogram nobody reads at 32px. Digits and
 * letters both count, so `3M` keeps its `3M` — dropping it would make every
 * numeric brand share one blank tile.
 */
export function brandInitials(name: string): string {
  const words = String(name ?? '')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean)
  if (words.length === 0) return '?'
  if (words.length === 1) {
    const single = words[0]
    // One word gives up its first two characters rather than one, so "Samsung"
    // and "Sony" are not both an anonymous "S".
    return single.slice(0, 2).toUpperCase()
  }
  return (words[0].charAt(0) + words[1].charAt(0)).toUpperCase()
}

/** The tones an avatar may take. Indexes into the component's class table. */
export const BRAND_AVATAR_TONES = ['slate', 'primary', 'info', 'violet', 'amber', 'teal', 'rose'] as const

export type BrandAvatarTone = (typeof BRAND_AVATAR_TONES)[number]

/**
 * A stable tone for a name.
 *
 * A plain sum of code points would put every two-letter brand in the same few
 * buckets; multiplying by 31 per character (the classic string hash) spreads
 * them. `>>> 0` keeps it unsigned so the modulo cannot come back negative and
 * index off the front of the table.
 */
export function brandAvatarTone(name: string): BrandAvatarTone {
  const s = String(name ?? '')
  let hash = 0
  for (let i = 0; i < s.length; i += 1) {
    hash = (hash * 31 + s.charCodeAt(i)) >>> 0
  }
  return BRAND_AVATAR_TONES[hash % BRAND_AVATAR_TONES.length]
}

/**
 * The one-line operational verdict on a brand, from facts the API returned.
 *
 * Deliberately NOT a score. "Brand health 83" cannot be explained to the person
 * it is shown to, cannot be reproduced from the row, and would be an opinion
 * dressed as a measurement. These four states each name the fact behind them
 * and each has an action a reader can take.
 */
export type BrandHealth = 'inactive' | 'unused' | 'active'

export function brandHealth(brand: { is_active: number; item_count?: number }): BrandHealth {
  if (Number(brand.is_active) !== 1) return 'inactive'
  if ((brand.item_count ?? 0) === 0) return 'unused'
  return 'active'
}
