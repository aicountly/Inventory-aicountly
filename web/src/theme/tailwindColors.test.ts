import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import postcss from 'postcss'
import tailwind from 'tailwindcss'
import tailwindConfig from '../../tailwind.config.js'

/**
 * Opacity modifiers only work on colours Tailwind knows about.
 *
 * A hand-written `.bg-primary-light` rule in tokens.css satisfies the compiler,
 * the type checker and the eye reading the JSX — and `hover:bg-primary-light/40`
 * still compiles to nothing at all, so the hover fill that tells the user a card
 * is clickable never renders. Every consumer of the token is checked against a
 * real Tailwind build here, because nothing else in the stack can see this.
 */

const SRC = new URL('..', import.meta.url).pathname
const USAGE = /(?:hover:|focus:|active:)?bg-primary-light(?:\/\d+)?/g

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const path = join(dir, e.name)
    if (e.isDirectory()) return sourceFiles(path)
    return /\.(tsx?|jsx?)$/.test(e.name) ? [path] : []
  })
}

function usedClasses(): string[] {
  const found = new Set<string>()
  for (const file of sourceFiles(SRC)) {
    for (const match of readFileSync(file, 'utf8').matchAll(USAGE)) found.add(match[0])
  }
  return [...found].sort()
}

async function build(classes: readonly string[]): Promise<string> {
  const result = await postcss([
    tailwind({ ...tailwindConfig, content: [{ raw: `<div class="${classes.join(' ')}">` }] }),
  ]).process('@tailwind utilities;', { from: undefined })
  return result.css
}

/** `hover:bg-primary-light/40` → `.hover\:bg-primary-light\/40:hover`. */
function selectorFor(className: string): string {
  const [variant, ...rest] = className.split(':')
  const base = rest.length ? rest.join(':') : variant
  const escaped = `.${(rest.length ? `${variant}:` : '') + base}`.replace(/[:/]/g, (c) => `\\${c}`)
  return rest.length ? `${escaped}:${variant}` : escaped
}

describe('primary-light is a registered Tailwind colour', () => {
  it('emits a rule for every bg-primary-light class the app actually uses', async () => {
    const classes = usedClasses()
    expect(classes.length).toBeGreaterThan(0)
    const css = await build(classes)
    for (const className of classes) {
      expect(css, `${className} generates no CSS`).toContain(selectorFor(className))
    }
  })

  it('scales the 12% wash by the modifier and leaves the bare class at 12%', async () => {
    const css = await build(['bg-primary-light', 'hover:bg-primary-light/40'])
    expect(css).toContain('calc(0.12 * var(--tw-bg-opacity, 1))')
    expect(css).toContain('calc(0.12 * 0.4)')
  })
})
