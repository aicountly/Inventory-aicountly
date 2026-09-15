import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { render } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import postcss from 'postcss'
import type { Declaration, Rule } from 'postcss'
import { SmartTable } from '../ui/shell/SmartTable'
import type { SmartColumn } from '../ui/shell/SmartTable'
import { REPORT_TABLE_PROPS } from '../styles/designTokens'

/**
 * What the app itself prints.
 *
 * Ctrl+P on a register goes through the sheet builder, but the browser's own
 * print of any other screen goes through `@media print` in tokens.css, and that
 * block is the only thing standing between the reader and an unreadable page.
 * Three properties are asserted against the real stylesheet and the real
 * SmartTable DOM, because none of them is visible from any other test:
 *
 *  - a dark-mode reader gets light ink on white paper, not white on black;
 *  - a long table breaks across pages instead of being pinned to one;
 *  - a scroll-body table prints all its rows, not the visible screenful.
 */

const CSS = readFileSync(resolve(process.cwd(), 'src/theme/tokens.css'), 'utf8')
const SHEET = postcss.parse(CSS)

function rulesIn(container: postcss.Container): Rule[] {
  const out: Rule[] = []
  container.walkRules((rule) => {
    out.push(rule)
  })
  return out
}

const PRINT_RULES: Rule[] = (() => {
  const out: Rule[] = []
  SHEET.walkAtRules('media', (at) => {
    if (at.params.replace(/\s+/g, ' ').trim() === 'print') out.push(...rulesIn(at))
  })
  return out
})()

/**
 * The stylesheet flattened into something a cascade can be resolved against:
 * every top-level rule plus every rule inside `@media print`, each tagged with
 * its byte offset so source order is the file's own. Rules nested in `@layer`
 * are left out — they carry utilities, never a token on the root element.
 */
interface CascadeRule {
  selectors: string[]
  decls: Array<[string, string]>
  print: boolean
  order: number
}

const CASCADE: CascadeRule[] = (() => {
  const out: CascadeRule[] = []
  const take = (container: postcss.Container, print: boolean) => {
    container.each((node) => {
      if (node.type !== 'rule') return
      const decls: Array<[string, string]> = []
      node.each((child) => {
        if (child.type === 'decl') decls.push([child.prop, child.value])
      })
      out.push({ selectors: node.selectors, decls, print, order: node.source?.start?.offset ?? 0 })
    })
  }
  take(SHEET, false)
  SHEET.walkAtRules('media', (at) => {
    if (at.params.replace(/\s+/g, ' ').trim() === 'print') take(at, true)
  })
  return out
})()

/**
 * Specificity of the flat selectors this stylesheet uses — classes, attributes
 * and pseudo-classes, no ids and no elements, which is the whole vocabulary of
 * the token blocks. `:not()` contributes its argument, as the spec says.
 */
function specificity(selector: string): number {
  const flat = selector.replace(/:not\(([^)]*)\)/g, '$1')
  const classes = flat.match(/\.[A-Za-z_-][\w-]*/g)?.length ?? 0
  const attributes = flat.match(/\[[^\]]*\]/g)?.length ?? 0
  const pseudos = flat.match(/:[A-Za-z-]+/g)?.length ?? 0
  return classes + attributes + pseudos
}

/** The value `el` ends up with for `prop` in the given medium. */
function winning(el: Element, prop: string, medium: 'screen' | 'print'): string | undefined {
  let best: { spec: number; order: number } | undefined
  let value: string | undefined
  for (const rule of CASCADE) {
    if (rule.print && medium !== 'print') continue
    for (const selector of rule.selectors) {
      let matched = false
      try {
        matched = el.matches(selector)
      } catch {
        continue
      }
      if (!matched) continue
      const spec = specificity(selector)
      if (best && (spec < best.spec || (spec === best.spec && rule.order < best.order))) continue
      for (const [declProp, declValue] of rule.decls) {
        if (declProp === prop) {
          value = declValue
          best = { spec, order: rule.order }
        }
      }
    }
  }
  return value
}

/** `<html>` as the pre-paint script leaves it for this reader. */
function rootWith(accent: string | null, dark: boolean): Element {
  const root = document.documentElement
  root.className = dark ? 'dark' : ''
  if (accent === null) root.removeAttribute('data-theme')
  else root.setAttribute('data-theme', accent)
  return root
}

/** Every accent the picker can set, read off the dark blocks themselves. */
const ACCENTS: string[] = (() => {
  const out = new Set<string>(['default'])
  for (const rule of CASCADE) {
    if (rule.print) continue
    for (const selector of rule.selectors) {
      const match = /^\.dark\[data-theme='([^']+)'\]$/.exec(selector)
      if (match) out.add(match[1])
    }
  }
  return [...out]
})()

/** Every token dark mode overrides, and therefore every token paper must undo. */
const DARK_PROPS: string[] = (() => {
  const out = new Set<string>()
  for (const rule of CASCADE) {
    if (rule.print) continue
    if (!rule.selectors.some((sel) => sel === '.dark' || sel.startsWith('.dark['))) continue
    for (const [prop] of rule.decls) out.add(prop)
  }
  return [...out]
})()

/** The three the accent picker owns: the reader's colour travels to paper. */
const READER_OWNED = ['--color-primary', '--color-primary-hover', '--color-primary-active']

/** Declarations of the first top-level rule with exactly this selector. */
function declsOf(selector: string): Record<string, string> {
  const out: Record<string, string> = {}
  SHEET.each((node) => {
    if (node.type === 'rule' && node.selector === selector) {
      node.walkDecls((d: Declaration) => {
        out[d.prop] = d.value
      })
    }
  })
  return out
}

/** Every print rule whose selector list matches `el`. */
function printRulesFor(el: Element): Rule[] {
  return PRINT_RULES.filter((rule) =>
    rule.selectors.some((sel) => {
      try {
        return el.matches(sel)
      } catch {
        return false
      }
    }),
  )
}

/** The winning print declaration of `prop` on `el`, with `!important` spelled out. */
function declaredOn(el: Element, prop: string): string | undefined {
  let value: string | undefined
  for (const rule of printRulesFor(el)) {
    rule.walkDecls(prop, (d) => {
      value = d.important ? `${d.value} !important` : d.value
    })
  }
  return value
}

interface Row {
  id: number
  item: string
}

const COLUMNS: SmartColumn<Row>[] = [
  { key: 'item', header: 'Item' },
  { key: 'id', header: 'Id', align: 'right' },
]

function renderRegisterTable() {
  return render(
    <MemoryRouter>
      <SmartTable {...REPORT_TABLE_PROPS} columns={COLUMNS} rows={[{ id: 1, item: 'Bolt' }]} rowKey="id" />
    </MemoryRouter>,
  )
}

describe('the print stylesheet', () => {
  // `rootWith` drives the real <html>, which the rendering tests below share.
  afterEach(() => {
    rootWith(null, false)
  })

  /** One bad selector invalidates the whole list, so the rule with it silently stops applying. */
  it('has no selector the browser will throw the rule away over', () => {
    const selectors = PRINT_RULES.flatMap((rule) => rule.selectors)
    expect(selectors.length).toBeGreaterThan(5)
    for (const selector of selectors) {
      expect(() => document.querySelectorAll(selector), selector).not.toThrow()
    }
  })

  it('prints on the light palette even when the screen is in dark mode', () => {
    const light = declsOf(':root,\n[data-theme=\'default\']')
    const dark = declsOf('.dark')
    expect(Object.keys(dark).length).toBeGreaterThan(5)

    // The reader who never opened the accent picker: no data-theme at all.
    for (const [prop, darkValue] of Object.entries(dark)) {
      if (READER_OWNED.includes(prop)) continue
      const onPaper = winning(rootWith(null, true), prop, 'print')
      const expected = prop === 'color-scheme' ? 'light' : light[prop]
      expect(onPaper, `${prop} is still the dark value (${darkValue}) on paper`).toBe(expected)
    }
  })

  /**
   * Nine palettes, thirteen spellings, and a dark block for every one of them
   * that blends the accent wash into the dark surface. Asserting the merged
   * print block cannot see a palette that was left out, so each is resolved
   * against the real cascade and held to what the light reader already sees.
   */
  it.each(ACCENTS)('prints the %s accent as light paper wants it, not as the dark screen has it', (accent) => {
    expect(ACCENTS.length, 'no dark accent blocks found — re-point this test').toBeGreaterThan(8)
    expect(DARK_PROPS.length).toBeGreaterThan(5)

    for (const prop of DARK_PROPS) {
      if (READER_OWNED.includes(prop)) continue
      const onPaper = winning(rootWith(accent, true), prop, 'print')
      const onLightScreen = winning(rootWith(accent, false), prop, 'screen')
      expect(
        onPaper,
        `${prop} on the ${accent} accent prints its dark value — a selected row goes near-black on paper`,
      ).toBe(onLightScreen)
    }
  })

  it.each(ACCENTS)('leaves the %s accent exactly as it is for a reader already on light', (accent) => {
    for (const prop of DARK_PROPS) {
      const onPaper = winning(rootWith(accent, false), prop, 'print')
      const onScreen = winning(rootWith(accent, false), prop, 'screen')
      expect(onPaper, `${prop} is repainted on paper for a light reader on ${accent}`).toBe(onScreen)
    }
  })

  it('leaves the accent the reader picked alone, so a red company prints red', () => {
    // A reset at plain `.dark` specificity is later in the file than
    // `[data-theme='red']` and would silently win over it.
    const clobbered: string[] = []
    for (const rule of PRINT_RULES) {
      if (!rule.selectors.some((sel) => sel === ':root' || sel === '.dark')) continue
      rule.walkDecls(/^--color-primary/, (d) => {
        clobbered.push(d.prop)
      })
      rule.walkDecls('--color-secondary', (d) => {
        clobbered.push(d.prop)
      })
    }
    expect(clobbered).toEqual([])
  })

  it('lets a long register break across pages, keeping only rows whole', () => {
    const breakRules = PRINT_RULES.filter((rule) =>
      rule.some((d) => d.type === 'decl' && d.prop === 'break-inside' && d.value === 'avoid'),
    )
    const selectors = breakRules.flatMap((rule) => rule.selectors)
    expect(selectors).toContain('.aic tr')
    expect(selectors, 'a whole table that may not break is a table that prints once').not.toContain('.aic table')
  })

  it('repeats the header on every printed page', () => {
    const { container } = renderRegisterTable()
    const thead = container.querySelector('thead') as Element
    expect(declaredOn(thead, 'display')).toBe('table-header-group')
  })

  it('opens every box that clips the register, so all the rows reach the paper', () => {
    const { container } = renderRegisterTable()
    const table = container.querySelector('table') as Element

    const clipping = /(^|\s|:)(overflow-|max-h-|h-full|h-\[calc)/
    let node: Element | null = table.parentElement
    let checked = 0
    while (node && node !== container) {
      if (clipping.test(node.className)) {
        checked += 1
        expect(declaredOn(node, 'overflow'), `${node.className} still clips on paper`).toBe(
          'visible !important',
        )
        expect(declaredOn(node, 'height')).toBe('auto !important')
        expect(declaredOn(node, 'max-height')).toBe('none !important')
      }
      node = node.parentElement
    }
    expect(checked, 'SmartTable no longer scrolls its body — re-point this test').toBeGreaterThan(1)
  })
})
