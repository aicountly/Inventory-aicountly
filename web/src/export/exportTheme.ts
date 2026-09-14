/**
 * The theme an exported document is drawn in.
 *
 * Books snapshots the *live* CSS variables off `<html>` at export time
 * (books-react-app/web/src/modules/reports/shared/reportExportTheme.js), so a
 * PDF carries the accent colour the user actually chose rather than a colour
 * compiled in months ago. This is the same idea in TypeScript, reading the
 * token layer ported in `src/theme/tokens.css`.
 *
 * Everything here is pure except `readCssTriple`, which is guarded so the
 * module imports cleanly in the node test environment.
 */

export type RGB = [number, number, number]

export interface ExportGrayScale {
  50: RGB
  100: RGB
  200: RGB
  500: RGB
  600: RGB
  700: RGB
  800: RGB
  900: RGB
}

export interface ExportTheme {
  /** CSS font stack for the printed page. */
  fontFamily: string
  /** The jsPDF font family name registered for labels. */
  fontFamilyName: string
  /** Webfont stylesheet for the print iframe. */
  googleFontsUrl: string
  primary: RGB
  primaryLight: RGB
  nav: RGB
  workspaceBg: RGB
  gray: ExportGrayScale
  red600: RGB
  amber600: RGB
  /** Positive / debit figures. */
  debitColor: RGB
  /** Negative / credit figures — the house rule is red. */
  creditColor: RGB
  cardShadow: string
}

const GRAY: ExportGrayScale = {
  50: [249, 250, 251],
  100: [243, 244, 246],
  200: [229, 231, 235],
  500: [107, 114, 128],
  600: [75, 85, 99],
  700: [55, 65, 81],
  800: [31, 41, 55],
  900: [17, 24, 39],
}

const WORKSPACE_BG: RGB = [245, 247, 250]
const RED_600: RGB = [220, 38, 38]
const AMBER_600: RGB = [217, 119, 6]

/** Books' brand defaults, used when no stylesheet is available (tests, SSR). */
export const DEFAULT_PRIMARY: RGB = [37, 176, 3]
export const DEFAULT_PRIMARY_LIGHT: RGB = [233, 252, 233]
export const DEFAULT_NAV: RGB = [0, 63, 133]

export const GOOGLE_FONTS_URL =
  'https://fonts.googleapis.com/css2?family=Nunito:wght@400;600;700;800&family=Noto+Sans:wght@400;700&display=swap'

/** `"37 176 3"` → `[37, 176, 3]`. Anything malformed keeps the fallback. */
export function parseRgbTriple(raw: string | null | undefined, fallback: RGB): RGB {
  if (!raw) return fallback
  const parts = raw
    .trim()
    .split(/[\s,]+/)
    .map((p) => Number(p))
    .filter((n) => Number.isFinite(n))
  if (parts.length < 3) return fallback
  return [parts[0], parts[1], parts[2]]
}

function readCssTriple(styles: CSSStyleDeclaration | null, name: string, fallback: RGB): RGB {
  if (!styles) return fallback
  return parseRgbTriple(styles.getPropertyValue(name), fallback)
}

/**
 * Snapshot of the accent currently on screen.
 *
 * Only the accent travels. The screen may be in dark mode and a dark-mode
 * snapshot would put white text on a white page — every printed register blank
 * but for the rules — so the surfaces in `buildSheetCss` are fixed light. This
 * is the one place an export deliberately ignores the user's appearance
 * setting, and the reason is that paper has no dark mode.
 *
 * Safe to call with no DOM: the brand defaults are returned instead, which is
 * what the unit tests build against.
 */
export function getExportTheme(): ExportTheme {
  const styles =
    typeof document !== 'undefined' && typeof getComputedStyle === 'function'
      ? getComputedStyle(document.documentElement)
      : null

  const fontFamily =
    (styles?.getPropertyValue('--font-family') ?? '').trim() || '"Nunito", sans-serif'

  return {
    fontFamily,
    fontFamilyName: 'Nunito',
    googleFontsUrl: GOOGLE_FONTS_URL,
    primary: readCssTriple(styles, '--color-primary', DEFAULT_PRIMARY),
    primaryLight: readCssTriple(styles, '--color-primary-light', DEFAULT_PRIMARY_LIGHT),
    nav: readCssTriple(styles, '--color-nav', DEFAULT_NAV),
    workspaceBg: WORKSPACE_BG,
    gray: GRAY,
    red600: RED_600,
    amber600: AMBER_600,
    debitColor: GRAY[900],
    creditColor: RED_600,
    cardShadow: '0 1px 2px rgba(15, 23, 42, 0.04)',
  }
}

export function rgbCss(rgb: RGB, alpha?: number): string {
  const [r, g, b] = rgb
  return alpha === undefined ? `rgb(${r}, ${g}, ${b})` : `rgba(${r}, ${g}, ${b}, ${alpha})`
}

export function rgbHex(rgb: RGB): string {
  return rgb
    .map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0'))
    .join('')
    .toUpperCase()
}

/**
 * jsPDF's standard fonts cannot render ₹ — it comes out as a blank box or
 * throws. Noto Sans is registered alongside Nunito purely so amount cells can
 * show the rupee sign; labels stay in Nunito and swap ₹ for `INR`.
 */
export function formatPdfCurrencyLabel(text: unknown): string {
  return String(text ?? '')
    .replace(/\(\s*₹\s*\)/g, '(INR)')
    .replace(/₹/g, 'INR')
}

export function buildThemeStylesheet(theme: ExportTheme): string {
  return `
    body {
      font-family: ${theme.fontFamily};
      font-size: 13px;
      color: ${rgbCss(theme.gray[700])};
      background: #fff;
      margin: 0;
      -webkit-print-color-adjust: exact;
      print-color-adjust: exact;
    }
  `
}
