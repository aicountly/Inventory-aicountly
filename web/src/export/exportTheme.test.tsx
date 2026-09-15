import { afterEach, describe, expect, it } from 'vitest'
import { deriveAccentVars } from '../theme/appearance'
import type { RGB } from './exportTheme'
import { DEFAULT_PRIMARY, getExportTheme, lightAccentTint, rgbCss } from './exportTheme'
import { buildTabularPrintHtml } from './sheetHtml'
import { toExportColumns } from './exportColumns'

/**
 * Paper has no dark mode.
 *
 * `getComputedStyle` resolves the *screen* cascade — `@media print` never
 * applies to it — so every CSS variable an export snapshots is the dark-mode
 * value while the reader is in dark mode. `--color-primary-light` is the one
 * that mattered: it is the fill behind the PDF totals band, the XLSX company
 * band and the print sheet's pills, headers and totals, all of which put
 * near-black ink on top. Reading it in dark mode painted near-black on
 * near-black, on paper, for every export in the product.
 *
 * These tests run the *real* cascade: the same token declarations tokens.css
 * ships, mounted as a stylesheet, plus the inline custom-accent variables
 * ThemeProvider writes for a user-chosen colour. Both are how dark mode
 * actually reaches `<html>` in production.
 */

/** The declarations tokens.css ships for the default preset, light and dark. */
const TOKENS = `
:root {
  --color-primary: 37 176 3;
  --color-primary-light: 233 252 233;
  --color-nav: 0 63 133;
}
.dark {
  --color-primary: 37 176 3;
  --color-primary-light: 21 47 26;
  --color-nav: 12 24 36;
}
`

function mountTokens(css = TOKENS): void {
  const style = document.createElement('style')
  style.dataset.sheet = 'export-theme'
  style.textContent = css
  document.head.append(style)
}

/** WCAG relative luminance, 0 (black) to 1 (white). */
function luminance([r, g, b]: RGB): number {
  const channel = (c: number) => {
    const v = c / 255
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4
  }
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b)
}

afterEach(() => {
  document.querySelectorAll('style[data-sheet="export-theme"]').forEach((el) => el.remove())
  document.documentElement.className = ''
  document.documentElement.removeAttribute('style')
  document.documentElement.removeAttribute('data-theme')
})

describe('getExportTheme in dark mode', () => {
  it('returns the light tint for primaryLight when <html> carries .dark', () => {
    mountTokens()

    const light = getExportTheme().primaryLight
    // Guard the fixture itself: if the cascade were not resolving, both reads
    // would be the fallback and the comparison below would pass vacuously.
    expect(
      getComputedStyle(document.documentElement).getPropertyValue('--color-primary-light').trim(),
    ).toBe('233 252 233')

    document.documentElement.className = 'dark'
    expect(
      getComputedStyle(document.documentElement).getPropertyValue('--color-primary-light').trim(),
    ).toBe('21 47 26')

    const dark = getExportTheme().primaryLight
    expect(dark).toEqual(light)
    expect(luminance(dark)).toBeGreaterThan(0.7)
  })

  it('ignores the near-black tint ThemeProvider writes inline for a custom accent', () => {
    mountTokens()
    const custom = '#2563eb'
    const darkVars = deriveAccentVars(custom, 'dark')
    const lightVars = deriveAccentVars(custom, 'light')
    expect(darkVars && lightVars).toBeTruthy()

    document.documentElement.className = 'dark'
    document.documentElement.dataset.theme = 'custom'
    for (const [name, value] of Object.entries(darkVars ?? {})) {
      document.documentElement.style.setProperty(name, value)
    }
    // What the screen is actually showing: the dark tint is near-black.
    expect(luminance(getExportTheme().primary)).toBeGreaterThan(0)
    const screenTint = getComputedStyle(document.documentElement)
      .getPropertyValue('--color-primary-light')
      .trim()
      .split(/\s+/)
      .map(Number) as RGB
    expect(luminance(screenTint)).toBeLessThan(0.1)

    // What the export takes to paper: the tint the light-mode screen shows for
    // the same accent. Not bit-identical — dark mode lifts the accent itself
    // for contrast, and the export snapshots the lifted hue — but within a
    // couple of units per channel, where reading the token would be ~200 out.
    const exported = getExportTheme().primaryLight
    const lightScreenTint = lightAccentTint(
      (lightVars?.['--color-primary'] ?? '').split(/\s+/).map(Number) as RGB,
    )
    expect(luminance(exported)).toBeGreaterThan(0.7)
    exported.forEach((channel, i) => {
      expect(Math.abs(channel - lightScreenTint[i])).toBeLessThanOrEqual(4)
    })
  })

  /** Books and Inventory must tint the same accent to the same colour. */
  it('derives the tint with the light-mode blend theme/appearance.ts uses', () => {
    const vars = deriveAccentVars(DEFAULT_PRIMARY, 'light')
    expect(vars?.['--color-primary-light']).toBe(lightAccentTint(DEFAULT_PRIMARY).join(' '))
  })

  /** No accent, however dark, can darken the paper. */
  it('floors every channel of the tint at 224, for any accent', () => {
    for (const accent of [[0, 0, 0], [12, 12, 12], [21, 47, 26], [255, 255, 255]] as RGB[]) {
      const tint = lightAccentTint(accent)
      for (const channel of tint) expect(channel).toBeGreaterThanOrEqual(224)
    }
  })

  /** The defect as the reader met it: a printed register in dark mode. */
  it('prints the totals band light even when the reader is in dark mode', () => {
    mountTokens()
    document.documentElement.className = 'dark'

    const columns = toExportColumns([
      { key: 'item_name', header: 'Item' },
      { key: 'stock_value', header: 'Stock value', align: 'right', format: 'amount' },
    ])
    const html = buildTabularPrintHtml({
      title: 'Stock summary',
      columns,
      rows: [{ item_name: { value: 'Widget A', text: 'Widget A' }, stock_value: { value: 12, text: '12.00' } }],
      totalsRow: { item_name: { value: 'Total', text: 'Total' }, stock_value: { value: 12, text: '12.00' } },
      theme: getExportTheme(),
    })

    const tfoot = /tfoot td \{\s*background: ([^;]+);/.exec(html)
    expect(tfoot).not.toBeNull()
    const fill = (tfoot?.[1] ?? '').match(/[\d.]+/g)?.slice(0, 3).map(Number) as RGB
    expect(luminance(fill)).toBeGreaterThan(0.7)
    // And the dark token never reaches the page in any form.
    expect(html).not.toContain(rgbCss([21, 47, 26]))
  })
})
