import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { Badge } from '../Badge'
import { BreadcrumbHeader } from './BreadcrumbHeader'
import { PageHeader as ShellPageHeader } from './PageHeader'

function renderHeader(props: Partial<Parameters<typeof BreadcrumbHeader>[0]> = {}) {
  render(
    <MemoryRouter>
      <BreadcrumbHeader
        breadcrumbs={[{ label: 'Registers', to: '/registers' }, { label: 'Stock ledger' }]}
        title="Stock ledger"
        {...props}
      />
    </MemoryRouter>,
  )
}

describe('BreadcrumbHeader', () => {
  it('renders the badge in compact mode — the mode every register uses', () => {
    renderHeader({ compact: true, badge: <Badge tone="warning">Draft</Badge> })
    expect(screen.getByText('Draft')).toBeTruthy()
  })

  it('renders the badge in full mode too', () => {
    renderHeader({ badge: <Badge tone="warning">Draft</Badge> })
    expect(screen.getByText('Draft')).toBeTruthy()
  })

  it('keeps the compact order: breadcrumb, badge, toolbar, actions', () => {
    renderHeader({
      compact: true,
      badge: <Badge tone="warning">Draft</Badge>,
      toolbar: <span>Toolbar</span>,
      actions: <span>Actions</span>,
    })
    const text = document.body.textContent ?? ''
    expect(text.indexOf('Draft')).toBeGreaterThan(text.indexOf('Stock ledger'))
    expect(text.indexOf('Draft')).toBeLessThan(text.indexOf('Toolbar'))
    expect(text.indexOf('Toolbar')).toBeLessThan(text.indexOf('Actions'))
  })
})

describe('PageHeader stacked layout', () => {
  it('does not reserve a column-axis flex-basis in the stacked layout', () => {
    /*
     * `flex-basis` resolves along the MAIN axis. The header is `flex-col` below
     * `md`, so an ungated `basis-72` there is not an 18rem minimum width — it is
     * a 288px minimum HEIGHT, and `flex-1` grows the title block to fill it.
     * On a phone that is a title, a subtitle, and a quarter of the screen of
     * white space before the first button.
     */
    const { container } = render(
      <MemoryRouter>
        <ShellPageHeader title="Items" description="Manage your inventory items." />
      </MemoryRouter>,
    )
    // The header's first child: the title column that sits beside the actions.
    const titleBlock = container.querySelector('h1')?.closest('div.items-start.gap-3')
    expect(titleBlock).toBeTruthy()
    const cls = titleBlock?.className ?? ''
    // `basis-72` is the one that has to be gated. `flex-1` alone is harmless:
    // it resolves to `flex: 1 1 0%`, and a column whose height is content-sized
    // has no free space to grow into.
    expect(cls).not.toMatch(/(^|\s)basis-72(\s|$)/)
    // Still a row that shares its width with the actions from `md` up.
    expect(cls).toContain('md:basis-72')
  })
})
