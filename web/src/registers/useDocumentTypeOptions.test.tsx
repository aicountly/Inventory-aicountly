import { describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'

/*
 * The Type filter's fallback.
 *
 * `/documents` exists so a reader can see what Inventory entered and what
 * arrived from Books side by side. The dropdown this replaced listed the
 * Books-sourced codes from a static optgroup and so could never lose them; the
 * shared filter loads them from GET /v1/document-types, which can be in flight
 * or can fail. What it falls back to while that is true is the whole of this
 * file.
 */

const documentTypes = vi.fn<() => Promise<{ code: string; label: string }[]>>()

vi.mock('../company/CompanyContext', () => ({
  useCompany: () => ({ scope: { cmp_id: 54, fy_id: 2, bo_id: 0 } }),
}))

vi.mock('../services/settingsApi', () => ({
  settingsApi: { documentTypes: () => documentTypes() },
}))

const { useDocumentTypeOptions } = await import('./useDocumentTypeOptions')

function Probe() {
  const { options } = useDocumentTypeOptions()
  return <div data-testid="codes">{options.map((o) => o.value).join(',')}</div>
}

async function codes(): Promise<string[]> {
  render(<Probe />)
  const node = await screen.findByTestId('codes')
  return node.textContent!.split(',').filter(Boolean)
}

const SOURCED = [
  'SALES_ISSUE',
  'PURCHASE_RECEIPT',
  'SALES_RETURN',
  'PURCHASE_RETURN',
  'JOURNAL_ADJUSTMENT',
  'RESERVATION',
  'RESERVATION_RELEASE',
]

describe('useDocumentTypeOptions', () => {
  it('offers the Books-sourced types when the request fails', async () => {
    documentTypes.mockRejectedValue(new Error('500'))

    const list = await codes()

    // The native types are there...
    expect(list).toContain('STOCK_TRANSFER')
    expect(list).toContain('DELIVERY_CHALLAN')
    // ...and so is every type that only ever arrives from Books. Without them a
    // reader cannot narrow this register to the documents Books sent.
    for (const code of SOURCED) expect(list, code).toContain(code)
  })

  it('offers the same fallback while the request is still in flight', async () => {
    documentTypes.mockReturnValue(new Promise(() => {}))

    const list = await codes()

    expect(list).toContain('STOCK_TRANSFER')
    for (const code of SOURCED) expect(list, code).toContain(code)
  })

  it('prefers the server list once it answers, because it is the company truth', async () => {
    documentTypes.mockResolvedValue([
      { code: 'STOCK_TRANSFER', label: 'Stock Transfer' },
      { code: 'CUSTOM_TYPE', label: 'A type only this company has' },
    ])

    render(<Probe />)
    await waitFor(() =>
      expect(screen.getByTestId('codes').textContent).toContain('CUSTOM_TYPE'),
    )
    // The static fallback is not merged in on top of it.
    expect(screen.getByTestId('codes').textContent).not.toContain('DELIVERY_CHALLAN')
  })
})
