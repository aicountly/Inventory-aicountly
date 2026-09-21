import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import {
  BRAND,
  DEFAULT_THEME_PRESET,
  ERP_FONT_OPTIONS,
  ERP_THEME_OPTIONS,
  ERP_ZOOM_OPTIONS,
  getFontOption,
  getThemeOption,
  getZoomOption,
  resolveColorPreset,
  resolveFontId,
  resolveSizeId,
} from '../config/brandColors'
import type { ErpFontOption, ErpThemeOption, ErpZoomOption } from '../config/brandColors'
import { ACCENT_VAR_NAMES, deriveAccentVars } from './appearance'
import type { AccentVars, ThemeMode } from './appearance'

/**
 * Appearance (mode / accent / font / zoom) for the whole app — typed port of
 * books-react-app/web/src/context/ThemeProvider.jsx.
 *
 * Differences from Books, both deliberate:
 *  - storage key is `inventory.appearance` (same shape, so index.html's
 *    pre-paint script is Books' script with one string changed);
 *  - no server persistence. Books posts to `userPreferencesApi`; Inventory has
 *    no such endpoint and inventing one is a server change, not a UI one.
 *    localStorage is the source of truth.
 */

export const APPEARANCE_STORAGE_KEY = 'inventory.appearance'

export type AppearanceMode = 'light' | 'dark' | 'system'

const MODES: readonly AppearanceMode[] = ['light', 'dark', 'system']

export interface Appearance {
  mode: AppearanceMode
  colorPreset: string
  customPrimary: string
  /** Pre-derived light+dark variable sets, persisted so the pre-paint script
   *  in index.html can apply a custom accent without doing colour maths. */
  customVars: { light: AccentVars; dark: AccentVars } | null
  fontId: string
  sizeId: string
}

const DEFAULTS: Appearance = {
  mode: 'system',
  colorPreset: DEFAULT_THEME_PRESET,
  customPrimary: '',
  customVars: null,
  fontId: 'noto',
  sizeId: 'zoomnormal',
}

export interface ThemeContextValue {
  appearance: Appearance
  setAppearance: (patch: Partial<Appearance>) => void
  mode: AppearanceMode
  resolvedMode: ThemeMode
  isDark: boolean
  setMode: (mode: AppearanceMode) => void
  settingsOpen: boolean
  setSettingsOpen: (open: boolean) => void
  themeOptions: readonly ErpThemeOption[]
  themeGridOptions: readonly ErpThemeOption[]
  fontOptions: readonly ErpFontOption[]
  sizeOptions: readonly ErpZoomOption[]
  brand: typeof BRAND
  reset: () => void
}

const ThemeContext = createContext<ThemeContextValue | null>(null)

function resolveModePreference(stored: unknown): AppearanceMode {
  return MODES.includes(stored as AppearanceMode) ? (stored as AppearanceMode) : 'system'
}

function buildCustomVars(customPrimary: string): Appearance['customVars'] {
  const light = deriveAccentVars(customPrimary, 'light')
  const dark = deriveAccentVars(customPrimary, 'dark')
  return light && dark ? { light, dark } : null
}

export function loadAppearance(): Appearance {
  try {
    const raw = localStorage.getItem(APPEARANCE_STORAGE_KEY)
    const parsed: Appearance = raw
      ? { ...DEFAULTS, ...(JSON.parse(raw) as Partial<Appearance>) }
      : { ...DEFAULTS }
    parsed.mode = resolveModePreference(parsed.mode)
    parsed.colorPreset = resolveColorPreset(parsed.colorPreset)
    parsed.fontId = resolveFontId(parsed.fontId)
    parsed.sizeId = resolveSizeId(parsed.sizeId)
    // A blob saved before a customVars snapshot existed still has the hex —
    // backfill so the no-flash script works on the next load.
    if (parsed.customPrimary && !parsed.customVars) {
      parsed.customVars = buildCustomVars(parsed.customPrimary)
    }
    return parsed
  } catch {
    return { ...DEFAULTS }
  }
}

function prefersDark(): boolean {
  return Boolean(
    typeof window !== 'undefined' &&
      window.matchMedia &&
      window.matchMedia('(prefers-color-scheme: dark)').matches,
  )
}

/**
 * Apply the accent + typography for the current appearance and resolved mode.
 *
 * Presets are pure CSS: only `data-theme` is set and every accent variable is
 * removed from the inline style so the `[data-theme]` / `.dark[data-theme]`
 * blocks in tokens.css cascade normally. Inline variables are written ONLY for
 * a custom colour, derived for the resolved mode — inline styles would
 * otherwise override `.dark` and freeze the app in one mode's colours.
 */
function applyAppearance(appearance: Appearance, resolvedMode: ThemeMode): void {
  const root = document.documentElement
  const theme = getThemeOption(appearance.colorPreset)
  const customVars = appearance.customPrimary
    ? (appearance.customVars?.[resolvedMode] ??
      deriveAccentVars(appearance.customPrimary, resolvedMode))
    : null

  if (customVars) {
    root.dataset.theme = 'custom'
    for (const name of ACCENT_VAR_NAMES) {
      if (customVars[name]) root.style.setProperty(name, customVars[name])
    }
  } else {
    for (const name of ACCENT_VAR_NAMES) root.style.removeProperty(name)
    root.dataset.theme = theme.dataTheme
  }

  const font = getFontOption(appearance.fontId)
  root.style.setProperty('--font-family', font.value)
  const size = getZoomOption(appearance.sizeId)
  root.style.setProperty('--font-size-base', size.base)
  root.style.fontSize = size.base
  document.body.style.fontFamily = font.value
  document.body.style.fontSize = ''
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [appearance, setAppearanceState] = useState<Appearance>(loadAppearance)
  const [systemDark, setSystemDark] = useState<boolean>(prefersDark)
  const [settingsOpen, setSettingsOpen] = useState(false)

  // Track the OS preference so `system` stays live without a reload.
  useEffect(() => {
    if (!window.matchMedia) return undefined
    const mql = window.matchMedia('(prefers-color-scheme: dark)')
    const onChange = (e: MediaQueryListEvent) => setSystemDark(e.matches)
    mql.addEventListener('change', onChange)
    return () => mql.removeEventListener('change', onChange)
  }, [])

  const resolvedMode: ThemeMode =
    appearance.mode === 'system' ? (systemDark ? 'dark' : 'light') : appearance.mode

  useEffect(() => {
    document.documentElement.classList.toggle('dark', resolvedMode === 'dark')
  }, [resolvedMode])

  useEffect(() => {
    applyAppearance(appearance, resolvedMode)
  }, [appearance, resolvedMode])

  const setAppearance = useCallback((patch: Partial<Appearance>) => {
    setAppearanceState((prev) => {
      const next: Appearance = { ...prev, ...patch }
      if (patch.mode !== undefined) next.mode = resolveModePreference(patch.mode)
      if (patch.colorPreset !== undefined) {
        next.colorPreset = resolveColorPreset(patch.colorPreset)
        // A preset and a custom colour are mutually exclusive: the custom hex
        // is written as inline variables, which out-specify the preset's CSS
        // block. Without this, picking a preset while a custom colour is set
        // changes nothing on screen and looks broken.
        if (patch.customPrimary === undefined) {
          next.customPrimary = ''
          next.customVars = null
        }
      }
      if (patch.customPrimary !== undefined) {
        next.customVars = patch.customPrimary ? buildCustomVars(patch.customPrimary) : null
      }
      if (patch.fontId !== undefined) next.fontId = resolveFontId(patch.fontId)
      if (patch.sizeId !== undefined) next.sizeId = resolveSizeId(patch.sizeId)
      try {
        localStorage.setItem(APPEARANCE_STORAGE_KEY, JSON.stringify(next))
      } catch {
        // Private mode / blocked storage — the theme still applies in-session.
      }
      return next
    })
  }, [])

  const setMode = useCallback(
    (mode: AppearanceMode) => setAppearance({ mode }),
    [setAppearance],
  )

  const reset = useCallback(() => setAppearance({ ...DEFAULTS }), [setAppearance])

  const value = useMemo<ThemeContextValue>(
    () => ({
      appearance,
      setAppearance,
      mode: appearance.mode,
      resolvedMode,
      isDark: resolvedMode === 'dark',
      setMode,
      settingsOpen,
      setSettingsOpen,
      themeOptions: ERP_THEME_OPTIONS,
      themeGridOptions: ERP_THEME_OPTIONS.filter((t) => t.inGrid),
      fontOptions: ERP_FONT_OPTIONS,
      sizeOptions: ERP_ZOOM_OPTIONS,
      brand: BRAND,
      reset,
    }),
    [appearance, setAppearance, resolvedMode, setMode, settingsOpen, reset],
  )

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
}

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext)
  if (!ctx) throw new Error('useTheme must be used inside <ThemeProvider>')
  return ctx
}

/** Safe variant for components that may render outside the provider. */
export function useThemeOptional(): ThemeContextValue | null {
  return useContext(ThemeContext)
}
