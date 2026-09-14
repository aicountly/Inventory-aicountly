import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
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

    // Every rule in the print block that a dark root on the default accent
    // picks up, merged in source order.
    const darkRootSelectors = [':root', '.dark', '.dark:not([data-theme])', ".dark[data-theme='default']"]
    const reset: Record<string, string> = {}
    for (const rule of PRINT_RULES) {
      if (!rule.selectors.some((sel) => darkRootSelectors.includes(sel))) continue
      rule.walkDecls((d) => {
        reset[d.prop] = d.value
      })
    }

    for (const [prop, darkValue] of Object.entries(dark)) {
      if (prop === 'color-scheme') {
        expect(reset[prop], 'the print reset must switch the UA back to light').toBe('light')
        continue
      }
      // The three the accent picker owns and paper does not care about: the
      // base green is the same in both themes and hover has no meaning in ink.
      if (['--color-primary', '--color-primary-hover', '--color-primary-active'].includes(prop)) continue
      expect(reset[prop], `${prop} is still the dark value (${darkValue}) on paper`).toBe(light[prop])
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
