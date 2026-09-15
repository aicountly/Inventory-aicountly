import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { LegacyRedirect } from './LegacyRedirect'

function Landed() {
  const { pathname, search } = useLocation()
  return <div data-testid="landed">{pathname + search}</div>
}

function renderAt(entry: string) {
  render(
    <MemoryRouter initialEntries={[entry]}>
      <Routes>
        <Route path="/stock" element={<LegacyRedirect to="/registers/stock-balances" />} />
        <Route path="/stock/ledger" element={<LegacyRedirect to="/registers/stock-ledger" />} />
        <Route path="/registers/:path" element={<Landed />} />
      </Routes>
    </MemoryRouter>,
  )
  return screen.getByTestId('landed').textContent
}

describe('LegacyRedirect', () => {
  it('sends a retired screen to the register that replaced it', () => {
    expect(renderAt('/stock')).toBe('/registers/stock-balances')
  })

  it('carries the question, not just the screen', () => {
    // `/stock/ledger?item_id=9` is a bookmark, a Books link and this app's own
    // drill target: landing on an empty register would lose the row the reader
    // asked for.
    expect(renderAt('/stock/ledger?item_id=9&from=2026-04-01')).toBe(
      '/registers/stock-ledger?item_id=9&from=2026-04-01',
    )
  })
})
