import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

/**
 * main.tsx imports the legacy stylesheet AFTER the token layer, so anything it
 * declares on `:root` wins on source order at equal specificity — silently,
 * because both files are "just CSS" and neither mentions the other. The theme
 * layer owns the document root; this puts every sheet in one cascade, in the
 * order main.tsx loads them, and asserts that it still does.
 */

// The order main.tsx imports them in — the whole point of the test.
const SHEETS = [
  'src/theme/tokens.css',
  'src/theme/primitives.css',
  'src/theme/dark-overrides.css',
  'src/index.css',
  'src/components/ui.css',
  'src/pages/dashboard.css',
  'src/theme/legacy-bridge.css',
]

/**
 * PostCSS expands the bare `@tailwind` directives and flattens `@layer` blocks
 * into plain rules before a browser ever sees these files. Do the same here:
 * left in, they are at-rules this DOM skips, and the rules inside them would
 * never reach the cascade under test.
 */
function flatten(css: string): string {
  let out = css.replace(/@tailwind[^;]*;/g, '')
  for (;;) {
    const open = /@layer\s+[\w-]+\s*\{/.exec(out)
    if (!open) return out
    const start = open.index + open[0].length
    let depth = 1
    let i = start
    while (i < out.length && depth > 0) {
      if (out[i] === '{') depth += 1
      else if (out[i] === '}') depth -= 1
      i += 1
    }
    out = out.slice(0, open.index) + out.slice(start, i - 1) + out.slice(i)
  }
}

function mountStyles(): void {
  for (const file of SHEETS) {
    const style = document.createElement('style')
    style.textContent = flatten(readFileSync(resolve(process.cwd(), file), 'utf8'))
    style.dataset.sheet = file
    document.head.append(style)
  }
  // index.html puts the scoped preflight opt-in on the body.
  document.body.classList.add('aic')
}

afterEach(() => {
  document.querySelectorAll('style[data-sheet]').forEach((el) => el.remove())
  document.documentElement.className = ''
  document.body.className = ''
})

const rootColorScheme = () =>
  getComputedStyle(document.documentElement).getPropertyValue('color-scheme').trim()

describe('document root cascade', () => {
  it('scopes the root to light, not to whatever the OS prefers', () => {
    mountStyles()
    expect(rootColorScheme()).toBe('light')
  })

  // A user on a light OS who picks dark otherwise gets a dark app with light
  // window scrollbars and light native pickers.
  it('follows the chosen theme into dark', () => {
    mountStyles()
    document.documentElement.classList.add('dark')
    expect(rootColorScheme()).toBe('dark')
  })

  // Books leads off Tailwind preflight's `html { line-height: 1.5 }`; the
  // legacy sheet's 1.6 on :root is why the same ported component reads airier
  // here than it does there.
  it('leads the app the way Books does', () => {
    mountStyles()
    expect(getComputedStyle(document.body).lineHeight).toBe('1.5')
  })
})
