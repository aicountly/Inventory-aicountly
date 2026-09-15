/**
 * Per-mode accent derivation — typed port of
 * books-react-app/web/src/theme/appearance.js.
 *
 * Both products must derive a custom accent identically, otherwise the same
 * hex renders as two different greens in Books and Inventory. The maths here
 * is byte-for-byte the Books maths; only the types are new.
 *
 * All colours are space-separated RGB triples ("37 176 3"), matching the
 * `--color-*` convention in theme/tokens.css.
 */

export type RGB = [number, number, number]
export type ThemeMode = 'light' | 'dark'

/** Every accent variable the provider may write inline for custom colours. */
export const ACCENT_VAR_NAMES = [
  '--color-primary',
  '--color-primary-hover',
  '--color-primary-active',
  '--color-primary-light',
  '--color-secondary',
] as const

export type AccentVarName = (typeof ACCENT_VAR_NAMES)[number]

/** Accent variable set, as written to the document element. */
export type AccentVars = Record<AccentVarName, string>

/** Matches --color-surface in the `.dark` block — dark tints blend toward it. */
export const DARK_SURFACE: RGB = [18, 24, 30]

export function hexToRgbArr(hex: string | null | undefined): RGB | null {
  const h = String(hex ?? '').replace('#', '')
  if (h.length !== 6) return null
  const r = parseInt(h.slice(0, 2), 16)
  const g = parseInt(h.slice(2, 4), 16)
  const b = parseInt(h.slice(4, 6), 16)
  if ([r, g, b].some(Number.isNaN)) return null
  return [r, g, b]
}

export function tripleToArr(triple: string | null | undefined): RGB | null {
  const parts = String(triple ?? '')
    .trim()
    .split(/\s+/)
    .map(Number)
  if (parts.length !== 3 || parts.some(Number.isNaN)) return null
  return [parts[0], parts[1], parts[2]]
}

const clamp = (c: number): number => Math.min(255, Math.max(0, Math.round(c)))

const toTriple = (rgb: RGB): string => rgb.map(clamp).join(' ')

const mix = (rgb: RGB, target: RGB, ratio: number): RGB => [
  rgb[0] + (target[0] - rgb[0]) * ratio,
  rgb[1] + (target[1] - rgb[1]) * ratio,
  rgb[2] + (target[2] - rgb[2]) * ratio,
]

const towardWhite = (rgb: RGB, ratio: number): RGB => mix(rgb, [255, 255, 255], ratio)
const towardBlack = (rgb: RGB, ratio: number): RGB => mix(rgb, [0, 0, 0], ratio)

export function relLuminance(rgb: RGB): number {
  const f = (c: number): number => {
    const v = c / 255
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4
  }
  return 0.2126 * f(rgb[0]) + 0.7152 * f(rgb[1]) + 0.0722 * f(rgb[2])
}

/** Brighten a colour until it reads on the dark surface (~3:1 contrast). */
export function liftForDark(rgb: RGB, floor = 0.18): RGB {
  let out = rgb
  let guard = 0
  while (relLuminance(out) < floor && guard++ < 24) out = towardWhite(out, 0.1)
  return out
}

/** Accept a hex string, an "r g b" triple string, or an RGB array. */
function coerce(color: string | RGB | null | undefined): RGB | null {
  if (Array.isArray(color)) return color
  if (typeof color !== 'string') return null
  return hexToRgbArr(color) ?? tripleToArr(color)
}

/**
 * Derive the full accent variable set for a primary colour in a given mode.
 *
 * Light mode preserves Books' original behaviour: hover/active darken the
 * primary and the row-highlight tint blends 88% toward white. Dark mode lifts
 * the primary for contrast and blends the tint toward the dark surface.
 */
export function deriveAccentVars(
  color: string | RGB | null | undefined,
  mode: ThemeMode,
  secondaryColor?: string | RGB | null,
): AccentVars | null {
  const base = coerce(color)
  if (!base) return null
  const secondaryBase = secondaryColor ? coerce(secondaryColor) : null

  if (mode === 'dark') {
    const p = liftForDark(base)
    const secondary = secondaryBase ? liftForDark(secondaryBase, 0.3) : towardWhite(p, 0.35)
    return {
      '--color-primary': toTriple(p),
      '--color-primary-hover': toTriple(towardWhite(p, 0.1)),
      '--color-primary-active': toTriple(towardBlack(p, 0.12)),
      '--color-primary-light': toTriple(mix(p, DARK_SURFACE, 0.85)),
      '--color-secondary': toTriple(secondary),
    }
  }

  const secondary = secondaryBase ?? towardBlack(base, 0.35)
  return {
    '--color-primary': toTriple(base),
    '--color-primary-hover': toTriple(towardBlack(base, 0.1)),
    '--color-primary-active': toTriple(towardBlack(base, 0.28)),
    '--color-primary-light': toTriple(towardWhite(base, 0.88)),
    '--color-secondary': toTriple(secondary),
  }
}
