import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { Badge } from '../Badge'
import { BreadcrumbHeader } from './BreadcrumbHeader'

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
