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

  /*
   * Swept over accents, not asserted for one.
   *
   * `#2563eb` happens to be close to the best case: its dark-mode lift is small,
   * so the exported tint lands within 2/255 per channel of the light-mode screen
   * tint. That is NOT the bound. `theme/appearance.ts::liftForDark` floors a
   * dark accent's luminance at 0.18, so a near-black accent is lifted a long way
   * before it is tinted and the divergence reaches 15/255 (#000000 exports
   * [239,239,239] against a light-mode screen tint of [224,224,224]). Pinning
   * ≤4 against one mid-tone accent reads as a general guarantee and is not one —
   * anyone generalising the test would have found it failing.
   *
   * What IS general, and is what the reader cares about, is asserted for every
   * accent below: the exported tint is light enough to put near-black ink on,
   * and it is derived from the accent rather than read from the near-black
   * dark-mode token, which is ~200 out.
   */
  const ACCENTS: { hex: string; maxDrift: number }[] = [
    { hex: '#2563eb', maxDrift: 4 },
    { hex: '#000000', maxDrift: 16 },
    { hex: '#000080', maxDrift: 16 },
    { hex: '#143c14', maxDrift: 16 },
    { hex: '#ffffff', maxDrift: 4 },
  ]

  it.each(ACCENTS)(
    'ignores the near-black tint ThemeProvider writes inline for accent $hex',
    ({ hex, maxDrift }) => {
      mountTokens()
      const darkVars = deriveAccentVars(hex, 'dark')
      const lightVars = deriveAccentVars(hex, 'light')
      expect(darkVars && lightVars).toBeTruthy()

      document.documentElement.className = 'dark'
      document.documentElement.dataset.theme = 'custom'
      for (const [name, value] of Object.entries(darkVars ?? {})) {
        document.documentElement.style.setProperty(name, value)
      }

      // What the screen is actually showing for a dark accent: a near-black tint.
      const screenTint = getComputedStyle(document.documentElement)
        .getPropertyValue('--color-primary-light')
        .trim()
        .split(/\s+/)
        .map(Number) as RGB
      expect(screenTint).toHaveLength(3)

      const exported = getExportTheme().primaryLight
      // The guarantee: paper stays light whatever the accent and whatever the
      // reader's appearance setting.
      expect(luminance(exported)).toBeGreaterThan(0.7)
      for (const channel of exported) expect(channel).toBeGreaterThanOrEqual(224)

      // ...and it is the light-mode screen tint for the same accent, to within
      // the dark-mode lift. Reading the token instead would be ~200 out.
      const lightScreenTint = lightAccentTint(
        (lightVars?.['--color-primary'] ?? '').split(/\s+/).map(Number) as RGB,
      )
      exported.forEach((channel, i) => {
        expect(Math.abs(channel - lightScreenTint[i])).toBeLessThanOrEqual(maxDrift)
      })
    },
  )

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
