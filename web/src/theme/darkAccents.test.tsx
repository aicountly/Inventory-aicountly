import { readFileSync, readdirSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import postcss from 'postcss'
import tailwind from 'tailwindcss'
import tailwindConfig from '../../tailwind.config.js'

/**
 * Dark mode has to cover the accent ramp, not just the greys.
 *
 * The retrofit layer remaps what the app hardcodes. It started with
 * gray/slate/white because that is what most screens use, but the tones that
 * carry meaning — an expiry chip, a failed-document row, the icon tile on every
 * KPI card — are built on the -50 wash, which is a pale tint designed for white
 * and a bright block on a dark card. Nothing in the type system or the build can
 * see that, so the check is here: every accent wash, line and ink the app
 * actually renders is built with real Tailwind and read back through the dark
 * cascade.
 */

const SRC = resolve(process.cwd(), 'src')

/**
 * Washes (-50/-100), the lines drawn around them (-100..-300) and the ink on
 * top (-600 and darker). Solid accents (-500 and up as a background) are left
 * out on purpose: they are already dark-safe, and a button is not a surface
 * this file should be repainting.
 */
const USAGE =
  /(?:hover:|focus:|group-hover:|focus-visible:)?(?:bg-(?:emerald|amber|red|sky|violet|rose|teal|blue|orange|green|indigo|purple|fuchsia|cyan|lime|yellow|pink)-(?:50|100)|border-(?:emerald|amber|red|sky|violet|rose|teal|blue|orange)-(?:50|100|200|300)|text-(?:emerald|amber|red|sky|violet|rose|teal|blue|orange)-(?:600|700|800|900))(?:\/\d+)?(?![\d])/g

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const path = join(dir, e.name)
    if (e.isDirectory()) return sourceFiles(path)
    if (/\.test\.tsx?$/.test(e.name)) return []
    return /\.tsx?$/.test(e.name) ? [path] : []
  })
}

function usedClasses(): string[] {
  const found = new Set<string>()
  for (const file of sourceFiles(SRC)) {
    for (const match of readFileSync(file, 'utf8').matchAll(USAGE)) found.add(match[0])
  }
  return [...found].sort()
}

async function utilitiesFor(classes: readonly string[]): Promise<string> {
  const result = await postcss([
    tailwind({ ...tailwindConfig, content: [{ raw: `<div class="${classes.join(' ')}">` }] }),
  ]).process('@tailwind utilities;', { from: undefined })
  return result.css
}

/** `hover:bg-red-50` → `.hover\:bg-red-50:hover`, `bg-red-50/40` → `.bg-red-50\/40`. */
function selectorFor(className: string): string {
  const [variant, ...rest] = className.split(':')
  const base = rest.length ? rest.join(':') : variant
  const escaped = `.${(rest.length ? `${variant}:` : '') + base}`.replace(/[:/]/g, (c) => `\\${c}`)
  return rest.length ? `${escaped}:${variant}` : escaped
}

interface Rgba {
  r: number
  g: number
  b: number
  a: number
}

function parseColor(value: string): Rgba | null {
  const match = /rgba?\(([^)]+)\)/.exec(value)
  if (!match) return null
  const parts = match[1].split(/[\s,/]+/).filter(Boolean).map(Number)
  if (parts.length < 3 || parts.some((n) => Number.isNaN(n))) return null
  return { r: parts[0], g: parts[1], b: parts[2], a: parts[3] ?? 1 }
}

/** WCAG relative luminance, 0 (black) to 1 (white). */
function luminance({ r, g, b }: Rgba): number {
  const channel = (c: number) => {
    const v = c / 255
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4
  }
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b)
}

function mount(css: string): void {
  const style = document.createElement('style')
  style.textContent = css
  style.dataset.sheet = 'dark-accents'
  document.head.append(style)
  // The class the pre-paint script in index.html puts on <html>.
  document.documentElement.classList.add('dark')
}

/** Computed style is read once per element, so build it after `.dark` is on. */
function computed(className: string): CSSStyleDeclaration {
  const el = document.createElement('div')
  el.className = className
  document.body.append(el)
  return getComputedStyle(el)
}

const DARK_SHEET = readFileSync(resolve(process.cwd(), 'src/theme/dark-overrides.css'), 'utf8')

afterEach(() => {
  document.querySelectorAll('style[data-sheet]').forEach((el) => el.remove())
  document.documentElement.className = ''
  document.body.innerHTML = ''
})

describe('accent surfaces in dark mode', () => {
  it('covers every accent class the app renders', async () => {
    const classes = usedClasses()
    expect(classes.length).toBeGreaterThan(0)
    for (const className of classes) {
      expect(DARK_SHEET, `${className} has no dark-mode rule`).toContain(`.dark ${selectorFor(className)}`)
    }
  })

  it('paints no pale wash and no dark ink on a dark card', async () => {
    const classes = usedClasses()
    // :hover cannot be provoked here; the coverage test above pins those.
    const plain = classes.filter((c) => !c.includes(':'))
    mount((await utilitiesFor(classes)) + DARK_SHEET)

    for (const className of plain) {
      const style = computed(className)
      if (className.startsWith('text-')) {
        const ink = parseColor(style.color)
        expect(ink, `${className} has no colour`).not.toBeNull()
        expect(luminance(ink as Rgba), `${className} stays dark ink on a dark card`).toBeGreaterThan(0.45)
        continue
      }
      const prop = className.startsWith('bg-') ? style.backgroundColor : style.borderColor
      const paint = parseColor(prop)
      expect(paint, `${className} has no colour`).not.toBeNull()
      const safe = (paint as Rgba).a <= 0.5 || luminance(paint as Rgba) <= 0.35
      expect(safe, `${className} stays a light wash in dark mode (${prop})`).toBe(true)
    }
  })

  /**
   * A gradient stop is not a background colour.
   *
   * `dark-overrides.css` works by out-specifying utilities like `.bg-white`,
   * but `from-white` sets `--tw-gradient-from` and nothing in that sheet can
   * reach it. A KPI strip built with `bg-gradient-to-b from-white` therefore
   * stayed white-on-black in dark mode while every surface around it turned,
   * and no test above could see it: the scanner looks for accent ramps, and
   * white is not one.
   */
  it('never paints a surface with a hardcoded white or grey gradient stop', () => {
    const offenders: string[] = []
    const PATTERN = /\b(?:from|via|to)-(?:white|gray-(?:50|100|200)|slate-(?:50|100|200))\b/g
    for (const file of sourceFiles(SRC)) {
      for (const match of readFileSync(file, 'utf8').matchAll(PATTERN)) {
        offenders.push(`${file.replace(SRC, 'src')}: ${match[0]}`)
      }
    }
    expect(
      offenders,
      `these gradient stops cannot be remapped for dark mode — use a token-backed surface instead:\n${offenders.join('\n')}`,
    ).toEqual([])
  })

  it('leaves the light theme alone', async () => {
    mount((await utilitiesFor(['bg-red-50'])) + DARK_SHEET)
    document.documentElement.classList.remove('dark')
    const paint = parseColor(computed('bg-red-50').backgroundColor)
    expect(luminance(paint as Rgba)).toBeGreaterThan(0.8)
  })
})
