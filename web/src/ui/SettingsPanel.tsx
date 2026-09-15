import { useEffect } from 'react'
import { Check, Monitor, Moon, Palette, RotateCcw, Sun, Type, X, ZoomIn } from 'lucide-react'
import { useTheme } from '../theme/ThemeProvider'
import type { AppearanceMode } from '../theme/ThemeProvider'
import { Button } from './Button'
import { cx } from './cx'

const MODES: { id: AppearanceMode; label: string; icon: typeof Sun }[] = [
  { id: 'light', label: 'Light', icon: Sun },
  { id: 'dark', label: 'Dark', icon: Moon },
  { id: 'system', label: 'System', icon: Monitor },
]

function SectionTitle({ icon: Icon, children }: { icon: typeof Sun; children: React.ReactNode }) {
  return (
    <h3 className="mb-2 flex items-center gap-1.5 text-label-xs font-semibold uppercase tracking-wide text-gray-500">
      <Icon className="h-3.5 w-3.5 text-gray-400" aria-hidden />
      {children}
    </h3>
  )
}

/**
 * Appearance drawer — mode, accent, font and zoom.
 *
 * This is the control Inventory never had: dark mode was `prefers-color-scheme`
 * only, with no way to choose, and there was no accent or type scale at all.
 * Every change writes straight through ThemeProvider to localStorage, so it
 * survives a reload and the pre-paint script applies it before first paint.
 */
export function SettingsPanel() {
  const {
    appearance,
    setAppearance,
    mode,
    setMode,
    settingsOpen,
    setSettingsOpen,
    themeGridOptions,
    fontOptions,
    sizeOptions,
    reset,
  } = useTheme()

  useEffect(() => {
    if (!settingsOpen) return undefined
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        setSettingsOpen(false)
      }
    }
    document.addEventListener('keydown', onKey, true)
    return () => document.removeEventListener('keydown', onKey, true)
  }, [settingsOpen, setSettingsOpen])

  if (!settingsOpen) return null

  const customActive = Boolean(appearance.customPrimary)

  return (
    <div
      className="aic fixed inset-0 z-[100] flex justify-end bg-gray-900/40 backdrop-blur-sm print:hidden"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) setSettingsOpen(false)
      }}
      role="presentation"
      data-keyboard-overlay="true"
    >
      <aside
        role="dialog"
        aria-modal="true"
        aria-label="Appearance"
        data-keyboard-overlay="true"
        className="flex h-full w-[min(22rem,100vw)] animate-slide-in-right flex-col border-l border-gray-200 bg-white shadow-overlay"
      >
        <header className="flex shrink-0 items-center justify-between border-b border-gray-100 px-4 py-3">
          <div>
            <h2 className="text-base font-semibold text-gray-900">Appearance</h2>
            <p className="text-xs text-gray-500">Saved on this device.</p>
          </div>
          <button
            type="button"
            onClick={() => setSettingsOpen(false)}
            aria-label="Close"
            className="rounded-lg p-1.5 text-gray-500 transition-colors hover:bg-gray-100 hover:text-gray-700"
          >
            <X className="h-4 w-4" />
          </button>
        </header>

        <div className="min-h-0 flex-1 space-y-5 overflow-auto scrollbar-thin px-4 py-4">
          <section>
            <SectionTitle icon={Sun}>Mode</SectionTitle>
            <div className="grid grid-cols-3 gap-2">
              {MODES.map((m) => {
                const Icon = m.icon
                const active = mode === m.id
                return (
                  <button
                    key={m.id}
                    type="button"
                    onClick={() => setMode(m.id)}
                    aria-pressed={active}
                    className={cx(
                      'flex flex-col items-center gap-1 rounded-xl border px-2 py-2.5 text-xs font-medium transition-colors',
                      active
                        ? 'border-primary/40 bg-primary-light text-primary'
                        : 'border-gray-200 bg-white text-gray-600 hover:border-primary/30 hover:bg-gray-50',
                    )}
                  >
                    <Icon className="h-4 w-4" aria-hidden />
                    {m.label}
                  </button>
                )
              })}
            </div>
          </section>

          <section>
            <SectionTitle icon={Palette}>Accent</SectionTitle>
            <div className="grid grid-cols-6 gap-2">
              <button
                type="button"
                onClick={() => setAppearance({ colorPreset: 'default', customPrimary: '' })}
                aria-label="Default accent"
                title="Default"
                className={cx(
                  'flex h-8 w-full items-center justify-center rounded-lg border-2 transition-transform hover:scale-105',
                  !customActive && appearance.colorPreset === 'default'
                    ? 'border-gray-900'
                    : 'border-transparent',
                )}
                style={{ backgroundColor: '#25B003' }}
              >
                {!customActive && appearance.colorPreset === 'default' ? (
                  <Check className="h-3.5 w-3.5 text-white" aria-hidden />
                ) : null}
              </button>
              {themeGridOptions.map((t) => {
                const active = !customActive && appearance.colorPreset === t.key
                return (
                  <button
                    key={t.key}
                    type="button"
                    onClick={() => setAppearance({ colorPreset: t.key, customPrimary: '' })}
                    aria-label={`${t.label} accent`}
                    title={t.label}
                    className={cx(
                      'flex h-8 w-full items-center justify-center rounded-lg border-2 transition-transform hover:scale-105',
                      active ? 'border-gray-900' : 'border-transparent',
                    )}
                    style={{ backgroundColor: t.swatch }}
                  >
                    {active ? <Check className="h-3.5 w-3.5 text-white" aria-hidden /> : null}
                  </button>
                )
              })}
            </div>
            <label className="mt-2 flex items-center gap-2 text-xs text-gray-600">
              <input
                type="color"
                value={appearance.customPrimary || '#25B003'}
                onChange={(e) => setAppearance({ customPrimary: e.target.value })}
                className="h-7 w-10 cursor-pointer rounded border border-gray-200 bg-white p-0.5"
                aria-label="Custom accent colour"
              />
              <span className="flex-1">
                Custom colour
                {customActive ? (
                  <span className="ml-1 font-mono text-[11px] uppercase text-gray-400">
                    {appearance.customPrimary}
                  </span>
                ) : null}
              </span>
              {customActive ? (
                <button
                  type="button"
                  onClick={() => setAppearance({ customPrimary: '' })}
                  className="text-[11px] font-semibold text-primary hover:underline"
                >
                  Clear
                </button>
              ) : null}
            </label>
          </section>

          <section>
            <SectionTitle icon={Type}>Font</SectionTitle>
            <div className="space-y-1">
              {fontOptions.map((f) => {
                const active = appearance.fontId === f.id
                return (
                  <button
                    key={f.id}
                    type="button"
                    onClick={() => setAppearance({ fontId: f.id })}
                    className={cx(
                      'flex w-full items-center justify-between rounded-lg border px-2.5 py-1.5 text-sm transition-colors',
                      active
                        ? 'border-primary/40 bg-primary-light text-primary'
                        : 'border-gray-200 bg-white text-gray-700 hover:bg-gray-50',
                    )}
                    style={{ fontFamily: f.value }}
                  >
                    {f.label}
                    {active ? <Check className="h-3.5 w-3.5" aria-hidden /> : null}
                  </button>
                )
              })}
            </div>
          </section>

          <section>
            <SectionTitle icon={ZoomIn}>Text size</SectionTitle>
            <div className="grid grid-cols-5 gap-1.5">
              {sizeOptions.map((s) => {
                const active = appearance.sizeId === s.id
                return (
                  <button
                    key={s.id}
                    type="button"
                    onClick={() => setAppearance({ sizeId: s.id })}
                    title={`${s.label} — ${s.base}`}
                    className={cx(
                      'rounded-lg border py-1.5 text-[11px] font-medium transition-colors',
                      active
                        ? 'border-primary/40 bg-primary-light text-primary'
                        : 'border-gray-200 bg-white text-gray-600 hover:bg-gray-50',
                    )}
                  >
                    {s.label}
                  </button>
                )
              })}
            </div>
            <p className="mt-1.5 text-[11px] text-gray-500">
              The whole app scales from this size, so tables fit more rows at Compact.
            </p>
          </section>
        </div>

        <footer className="shrink-0 border-t border-gray-100 px-4 py-3">
          <Button variant="secondary" icon={RotateCcw} onClick={reset} block>
            Reset to defaults
          </Button>
        </footer>
      </aside>
    </div>
  )
}

export default SettingsPanel
