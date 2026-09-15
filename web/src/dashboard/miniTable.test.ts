import { createElement } from 'react'
import type { ReactElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it } from 'vitest'
import { MiniTable } from './components/MiniTable'
import type { MiniColumn } from './components/MiniTable'
import { SmartTable } from '../ui/shell/SmartTable'
import type { SmartColumn } from '../ui/shell/SmartTable'
import { DASHBOARD_TABLE_PROPS } from '../styles/designTokens'

/**
 * The dashboard's four tables are the shared table, not a second one.
 *
 * A hand-rolled copy drifts silently: it was already a different cell density
 * from every register, with no width the columns were designed for, no totals
 * row and no caption. Rather than re-listing those differences one by one, this
 * renders the same columns through both components and requires the markup to
 * match — a re-divergence fails here whatever form it takes.
 */

function render(node: ReactElement): string {
  return renderToStaticMarkup(createElement(MemoryRouter, null, node))
}

interface Row {
  id: number
  name: string
  qty: number
}

const rows: Row[] = [
  { id: 1, name: 'Widget', qty: 4 },
  { id: 2, name: 'Gadget', qty: 7 },
]

const columns: MiniColumn<Row>[] = [
  { key: 'name', header: 'Item', render: (r) => r.name },
  { key: 'qty', header: 'Qty', align: 'right', render: (r) => r.qty },
]

/** Every class attribute in document order — the table's whole geometry. */
function classes(html: string): string[] {
  return [...html.matchAll(/class="([^"]*)"/g)].map((m) => m[1])
}

describe('MiniTable', () => {
  const mini = render(
    createElement(MiniTable<Row>, { columns, rows, rowKey: (r) => r.id, minWidth: 480 }),
  )

  it('renders the table the registers render', () => {
    const smart = render(
      createElement(SmartTable<Row>, {
        ...DASHBOARD_TABLE_PROPS,
        cardPadding: 'none',
        columns: columns as unknown as SmartColumn<Row>[],
        rows,
        rowKey: (r: Row) => r.id,
        minWidth: 480,
        keyboardNav: false,
      }),
    )
    expect(classes(mini)).toEqual(classes(smart))
  })

  it('sizes the columns instead of leaving them to the browser', () => {
    expect(mini).toContain('min-width:480px')
  })

  it('can pin a totals row and name itself for a screen reader', () => {
    const html = render(
      createElement(MiniTable<Row>, {
        columns,
        rows,
        rowKey: (r) => r.id,
        totals: { name: 'Total', qty: 11 },
        caption: 'Items to reorder',
      }),
    )
    expect(html).toContain('<tfoot>')
    expect(html).toContain('11')
    expect(html).toContain('Items to reorder')
  })
})
