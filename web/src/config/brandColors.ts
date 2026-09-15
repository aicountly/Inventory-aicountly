/**
 * AICOUNTLY theme options — typed port of
 * books-react-app/web/src/config/brandColors.js.
 *
 * `dataTheme` values match the legacy ERP theme keys, which is why the static
 * `[data-theme="…"]` blocks in theme/tokens.css can stay verbatim copies of
 * Books'. Keep the triples in sync with that stylesheet.
 */

export const BRAND = {
  primary: '#25B003',
  primaryRgb: '37 176 3',
  primaryHover: '#28A003',
  nav: '#003F85',
  secondary: '#555555',
  pageBg: '#F5F7FA',
  error: '#ED2000',
} as const

/** Fixed workspace canvas background — independent of the colour theme picker. */
export const WORKSPACE_BG = BRAND.pageBg

export interface ErpThemeOption {
  key: string
  dataTheme: string
  swatch: string
  primary: string
  primaryHover: string
  primaryActive: string
  secondary: string
  label: string
  /** Shown in the settings swatch grid ("default" is the reset chip instead). */
  inGrid: boolean
}

export const ERP_THEME_OPTIONS: readonly ErpThemeOption[] = [
  { key: 'default', dataTheme: 'default', swatch: '#25B003', primary: '37 176 3', primaryHover: '40 160 3', primaryActive: '30 108 2', secondary: '21 128 61', label: 'Default', inGrid: false },
  { key: 'red', dataTheme: 'red', swatch: '#DD0026', primary: '221 0 38', primaryHover: '198 0 34', primaryActive: '160 0 28', secondary: '127 29 29', label: 'Red', inGrid: true },
  { key: 'orange', dataTheme: 'orange', swatch: '#EC7B2D', primary: '236 123 45', primaryHover: '214 110 40', primaryActive: '180 90 32', secondary: '154 52 18', label: 'Orange', inGrid: true },
  { key: 'sky', dataTheme: 'sky', swatch: '#2FA1DA', primary: '47 161 218', primaryHover: '40 145 198', primaryActive: '30 120 170', secondary: '30 64 98', label: 'Sky', inGrid: true },
  { key: 'purpl', dataTheme: 'purpl', swatch: '#D97CF8', primary: '217 124 248', primaryHover: '195 100 230', primaryActive: '160 80 200', secondary: '88 28 135', label: 'Purple', inGrid: true },
  { key: 'yelow', dataTheme: 'yelow', swatch: '#D3B000', primary: '211 176 0', primaryHover: '190 158 0', primaryActive: '150 125 0', secondary: '113 63 18', label: 'Yellow', inGrid: true },
  { key: 'part', dataTheme: 'part', swatch: '#A2C42E', primary: '162 196 46', primaryHover: '145 175 40', primaryActive: '120 145 32', secondary: '63 98 18', label: 'Lime', inGrid: true },
  { key: 'grn', dataTheme: 'grn', swatch: '#5BBBB1', primary: '91 187 177', primaryHover: '75 165 156', primaryActive: '55 140 132', secondary: '19 78 74', label: 'Teal', inGrid: true },
  { key: 'blue', dataTheme: 'blue', swatch: '#3874FF', primary: '56 116 255', primaryHover: '45 100 230', primaryActive: '37 80 200', secondary: '37 99 235', label: 'Blue', inGrid: true },
]

export const ERP_THEME_BY_KEY: Record<string, ErpThemeOption> = Object.fromEntries(
  ERP_THEME_OPTIONS.map((t) => [t.key, t]),
)

/** Maps legacy / Books preset ids → ERP theme keys. */
export const LEGACY_COLOR_PRESET_ALIASES: Record<string, string> = {
  green: 'default',
  sky_blue: 'sky',
  purple: 'purpl',
  yellow: 'yelow',
  lime: 'part',
  teal: 'grn',
  indigo: 'blue',
}

export const DEFAULT_THEME_PRESET = 'default'

export interface ErpFontOption {
  id: string
  label: string
  value: string
}

export const ERP_FONT_OPTIONS: readonly ErpFontOption[] = [
  { id: 'noto', label: 'Noto Sans', value: '"Noto Sans", sans-serif' },
  { id: 'nunito', label: 'Nunito', value: '"Nunito", sans-serif' },
  { id: 'montserrat', label: 'Montserrat', value: '"Montserrat", sans-serif' },
  { id: 'mooli', label: 'Mooli', value: '"Mooli", sans-serif' },
  { id: 'roboto', label: 'Roboto Slab', value: '"Roboto Slab", serif' },
]

export interface ErpZoomOption {
  id: string
  label: string
  /** Written to --font-size-base; the whole app is rem-scaled off it. */
  base: string
}

export const ERP_ZOOM_OPTIONS: readonly ErpZoomOption[] = [
  { id: 'zoomcompact', label: 'Compact', base: '13px' },
  { id: 'zoomsmall', label: 'Small', base: '14px' },
  { id: 'zoomnormal', label: 'Normal', base: '16px' },
  { id: 'zoomin', label: 'Large', base: '18px' },
  { id: 'zoommore', label: 'XL', base: '20px' },
]

const LEGACY_FONT_ALIASES: Record<string, string> = {
  normal: 'noto',
  system: 'noto',
  inter: 'noto',
  poppins: 'noto',
}

const LEGACY_SIZE_ALIASES: Record<string, string> = {
  sm: 'zoomcompact',
  md: 'zoomnormal',
  lg: 'zoomin',
}

export function resolveColorPreset(stored: string | null | undefined): string {
  if (!stored) return DEFAULT_THEME_PRESET
  if (ERP_THEME_BY_KEY[stored]) return stored
  return LEGACY_COLOR_PRESET_ALIASES[stored] ?? DEFAULT_THEME_PRESET
}

export function resolveFontId(stored: string | null | undefined): string {
  if (!stored) return 'noto'
  if (ERP_FONT_OPTIONS.some((f) => f.id === stored)) return stored
  return LEGACY_FONT_ALIASES[stored] ?? 'noto'
}

export function resolveSizeId(stored: string | null | undefined): string {
  if (!stored) return 'zoomnormal'
  if (ERP_ZOOM_OPTIONS.some((s) => s.id === stored)) return stored
  return LEGACY_SIZE_ALIASES[stored] ?? 'zoomnormal'
}

export function getThemeOption(key: string | null | undefined): ErpThemeOption {
  return (key ? ERP_THEME_BY_KEY[key] : undefined) ?? ERP_THEME_BY_KEY[DEFAULT_THEME_PRESET]
}

export function getFontOption(id: string | null | undefined): ErpFontOption {
  return ERP_FONT_OPTIONS.find((f) => f.id === id) ?? ERP_FONT_OPTIONS[0]
}

export function getZoomOption(id: string | null | undefined): ErpZoomOption {
  return ERP_ZOOM_OPTIONS.find((s) => s.id === id) ?? ERP_ZOOM_OPTIONS[0]
}
