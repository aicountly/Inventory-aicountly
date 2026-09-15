import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import tailwindConfig from '../../tailwind.config.js'

/**
 * With `corePlugins.preflight` off, `border` and `border-t` emit a width and no
 * style, and a `<button>` keeps its UA chrome — everywhere outside an `.aic`
 * subtree. That is invisible: no build error, no type error, no failing test,
 * just a missing rule on someone's screen. The opt-in therefore has to be
 * guaranteed at the document root rather than remembered component by
 * component.
 */

const root = new URL('../../', import.meta.url).pathname

function bodyClasses(): string[] {
  const html = readFileSync(`${root}index.html`, 'utf8')
  const body = /<body([^>]*)>/i.exec(html)
  expect(body, 'index.html has no <body>').toBeTruthy()
  const cls = /class="([^"]*)"/i.exec(body?.[1] ?? '')
  return (cls?.[1] ?? '').split(/\s+/).filter(Boolean)
}

describe('scoped preflight', () => {
  it('opts the whole document in, for as long as preflight is disabled', () => {
    if (tailwindConfig.corePlugins && (tailwindConfig.corePlugins as { preflight?: boolean }).preflight === false) {
      expect(bodyClasses()).toContain('aic')
    } else {
      // Preflight is back on: the scoped copy should have gone with it.
      expect(readFileSync(`${root}src/theme/tokens.css`, 'utf8')).not.toContain(':where(.aic) :where(*, *::before')
    }
  })

  it('still ships the scoped reset the opt-in refers to', () => {
    const tokens = readFileSync(`${root}src/theme/tokens.css`, 'utf8')
    expect(tokens).toContain(':where(.aic) :where(*, *::before, *::after)')
    expect(tokens).toContain('border: 0 solid')
  })
})
