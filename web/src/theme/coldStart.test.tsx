import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { getZoomOption } from '../config/brandColors'
import { loadAppearance } from './ThemeProvider'

/**
 * The first paint is decided entirely by index.html's pre-paint script and the
 * token layer — ThemeProvider has not run yet, and on a sign-in screen it is
 * not even mounted. Either one disagreeing with the provider's own default
 * means the whole app is painted at one size and reflowed to another.
 */

/** The size ThemeProvider settles on when nothing has ever been stored. */
function providerDefaultSize(): string {
  return getZoomOption(loadAppearance().sizeId).base
}

function tokenDefaultSize(): string {
  const css = readFileSync(resolve(process.cwd(), 'src/theme/tokens.css'), 'utf8')
  return /--font-size-base:\s*([^;]+);/.exec(css)?.[1]?.trim() ?? ''
}

function runPrePaintScript(): void {
  const html = readFileSync(resolve(process.cwd(), 'index.html'), 'utf8')
  const script = /<script>([\s\S]*?)<\/script>/.exec(html)
  expect(script, 'index.html no longer has a pre-paint script').toBeTruthy()
  new Function(script?.[1] ?? '')()
}

beforeEach(() => {
  localStorage.clear()
  document.documentElement.removeAttribute('style')
  document.documentElement.removeAttribute('data-theme')
  document.documentElement.className = ''
})

afterEach(() => {
  localStorage.clear()
  document.documentElement.removeAttribute('style')
  document.documentElement.removeAttribute('data-theme')
  document.documentElement.className = ''
})

describe('cold start appearance', () => {
  it('ships the provider default text size as the CSS default', () => {
    expect(tokenDefaultSize()).toBe(providerDefaultSize())
  })

  it('applies that size pre-paint even when nothing is stored', () => {
    runPrePaintScript()
    expect(document.documentElement.style.fontSize).toBe(providerDefaultSize())
    expect(document.documentElement.style.getPropertyValue('--font-size-base')).toBe(
      providerDefaultSize(),
    )
  })

  it('still honours a stored size over the default', () => {
    localStorage.setItem('inventory.appearance', JSON.stringify({ sizeId: 'zoomin' }))
    runPrePaintScript()
    expect(document.documentElement.style.fontSize).toBe('18px')
  })
})
