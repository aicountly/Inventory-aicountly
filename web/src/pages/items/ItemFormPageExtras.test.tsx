import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import type { ItemFormOptions, ItemSearchRow } from '../../services/items'

/**
 * The three things this screen gained after the workspace landed: a duplicate check against the
 * items the company already has, a real camera scanner where the browser has one, and a
 * one-section-at-a-time walk on a phone.
 *
 * They live in their own file rather than in ItemFormPage.test.tsx because two of them need the
 * environment lied to — `matchMedia` for the narrow layout, `BarcodeDetector` for the scanner —
 * and a stub that wide is better kept away from the suite that pins the payload.
 */

const toast = { success: vi.fn(), error: vi.fn(), info: vi.fn() }

vi.mock('../../company/CompanyContext', () => ({
  useCompany: () => ({
    scope: { cmp_id: 1, fy_id: 3, bo_id: 0 },
    companyName: 'Acme Ltd',
    fy: { fyId: 3, label: 'FY 2026-27', start: '2026-04-01', end: '2027-03-31' },
  }),
}))

vi.mock('../../access/AccessContext', () => ({
  useAccess: () => ({ can: () => true, loading: false, member: { uuid: 'user-a' } }),
  useCan: () => true,
}))

vi.mock('../../ui/ToastContext', () => ({ useToast: () => toast }))
vi.mock('../../hooks/useBaseCurrency', () => ({ useBaseCurrencySymbol: () => '₹' }))

const OPTIONS: ItemFormOptions = {
  item_groups: [{ item_grp_id: 1, grp_name: 'General', grp_alias: null, is_primary: 1, parent_grp_id: null }],
  stock_categories: [{ stock_cat_id: 2, cat_name: 'Raw Material', cat_alias: null }],
  brands: [{ brand_id: 5, brand_name: 'Acme' }],
  units: [{ unit_id: 10, unit_name: 'Dozen', unit_symbol: 'DOZ', print_name: null, uqc_gst: null }],
  warehouses: [{ warehouse_id: 7, warehouse_name: 'Main store', warehouse_code: null, warehouse_type: 'store', is_default: 1, bo_id: 0 }],
  valuation_methods: ['FIFO', 'LIFO', 'WAC'],
  default_valuation_method: 'FIFO',
  negative_stock_policies: ['allow', 'warn', 'block'],
  itc_eligibility_options: ['inherit', 'claim', 'block'],
}

vi.mock('../../hooks/useFormOptions', () => ({
  useFormOptions: () => ({ options: OPTIONS, loading: false, error: null, reload: vi.fn() }),
  invalidateFormOptions: vi.fn(),
}))

const search = vi.fn<(q: string, limit?: number, signal?: AbortSignal) => Promise<ItemSearchRow[]>>(async () => [])
const createItem = vi.fn()

vi.mock('../../services/items', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../services/items')>()
  return {
    ...actual,
    itemsApi: {
      ...actual.itemsApi,
      search: (...a: Parameters<typeof search>) => search(...a),
      create: (...a: unknown[]) => createItem(...a),
      openings: async () => ({ rows: [], effective_fy_id: 0, carried_forward: false }),
    },
  }
})

vi.mock('../../services/auditApi', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../services/auditApi')>()
  return { ...actual, auditApi: { ...actual.auditApi, entity: async () => ({ data: [], meta: { total: 0 } }) } }
})

const { ItemFormPage } = await import('./ItemFormPage')

/** The create route: no fetch to wait on, so the form is on screen immediately. */
function mountNew() {
  return render(
    <MemoryRouter initialEntries={['/items/new']}>
      <Routes>
        <Route path="/items/new" element={<ItemFormPage />} />
        <Route path="/items/:id" element={<p>Item workspace</p>} />
        <Route path="/items" element={<p>Items list</p>} />
      </Routes>
    </MemoryRouter>,
  )
}

const nameInput = () => screen.getByLabelText(/Item name/) as HTMLInputElement
const saveButton = () => screen.getByRole('button', { name: /Create Item/ }) as HTMLButtonElement

/** Pretend every media query matches `matches`, the way the drawer suite does. */
function stubMatchMedia(matches: boolean) {
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches,
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  }))
}

const ROW: ItemSearchRow = {
  item_id: 55,
  item_name: 'Ballpoint Pens',
  item_alias: null,
  print_name: null,
  item_sku: 'BP-001',
  item_upc: null,
  hsn_sac: '960810',
  unit_id: 10,
  unit_symbol: 'DOZ',
  track_batch: 0,
  track_serial: 0,
  valuation_method: 'FIFO',
  default_warehouse_id: null,
}

beforeEach(() => {
  vi.clearAllMocks()
  search.mockResolvedValue([])
  createItem.mockResolvedValue({ item_id: 99 })
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('duplicate detection', () => {
  it('reports an item this company already has, without blocking the save', async () => {
    search.mockResolvedValue([ROW])
    mountNew()
    fireEvent.change(nameInput(), { target: { value: 'Ballpoint Pens' } })

    const notice = await screen.findByText(/A possible duplicate/i, {}, { timeout: 3000 })
    expect(notice).toBeTruthy()
    expect(screen.getByText('Same name')).toBeTruthy()
    expect(screen.getByText('BP-001')).toBeTruthy()
    // Advisory only: the API is what actually refuses a repeated name.
    expect(saveButton().disabled).toBe(false)
  })

  it('goes away on Continue anyway, and comes back when the name changes again', async () => {
    search.mockResolvedValue([ROW])
    mountNew()
    fireEvent.change(nameInput(), { target: { value: 'Ballpoint Pens' } })
    await screen.findByText(/A possible duplicate/i, {}, { timeout: 3000 })

    fireEvent.click(screen.getByRole('button', { name: /Continue anyway/i }))
    await waitFor(() => expect(screen.queryByText(/A possible duplicate/i)).toBeNull())

    fireEvent.change(nameInput(), { target: { value: 'Ballpoint Pens Blue' } })
    expect(await screen.findByText(/possible duplicate/i, {}, { timeout: 3000 })).toBeTruthy()
  })

  it('says nothing when the lookup fails — a broken check is not a duplicate', async () => {
    search.mockRejectedValue(new Error('network down'))
    mountNew()
    fireEvent.change(nameInput(), { target: { value: 'Ballpoint Pens' } })
    await new Promise((r) => setTimeout(r, 700))
    expect(screen.queryByText(/possible duplicate/i)).toBeNull()
    expect(saveButton().disabled).toBe(false)
  })

  it('does not look up a name too short to mean anything', async () => {
    mountNew()
    fireEvent.change(nameInput(), { target: { value: 'B' } })
    await new Promise((r) => setTimeout(r, 700))
    expect(search).not.toHaveBeenCalled()
  })
})

describe('barcode scanning', () => {
  it('says so plainly on a browser that cannot scan, and leaves the field typeable', () => {
    mountNew()
    fireEvent.click(screen.getByRole('button', { name: /Scan barcode/i }))
    expect(toast.info).toHaveBeenCalledWith(expect.stringMatching(/cannot scan with the camera/i))
    expect(screen.queryByRole('dialog')).toBeNull()

    const field = screen.getByLabelText(/Barcode/) as HTMLInputElement
    fireEvent.change(field, { target: { value: '8901234567890' } })
    expect(field.value).toBe('8901234567890')
  })

  it('opens the scanner where the browser has BarcodeDetector', async () => {
    vi.stubGlobal(
      'BarcodeDetector',
      class {
        async detect() {
          return []
        }
      },
    )
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: { getUserMedia: () => Promise.reject(new Error('no camera in this test')) },
    })

    mountNew()
    fireEvent.click(screen.getByRole('button', { name: /Scan barcode/i }))

    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByText(/Scan barcode/i)).toBeTruthy()
    expect(toast.info).not.toHaveBeenCalled()
  })
})

describe('the narrow-screen walk', () => {
  it('shows one section at a time and moves through them with Continue', async () => {
    stubMatchMedia(false)
    mountNew()

    // Basic Details is on show; Classification is in the DOM but hidden behind it.
    expect(nameInput()).toBeTruthy()
    const classification = document.getElementById('item-section-classification')
    expect(classification?.closest('div.hidden')).toBeTruthy()
    expect(screen.getByText(/Step 1 of 8/)).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: /^Continue$/ }))
    await waitFor(() => expect(screen.getByText(/Step 2 of 8/)).toBeTruthy())
    expect(document.getElementById('item-section-classification')?.closest('div.hidden')).toBeNull()
    expect(document.getElementById('item-section-basic')?.closest('div.hidden')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: /^Back$/ }))
    await waitFor(() => expect(screen.getByText(/Step 1 of 8/)).toBeTruthy())
  })

  it('offers Create rather than Continue on the last section', async () => {
    stubMatchMedia(false)
    mountNew()
    for (let i = 0; i < 7; i += 1) {
      fireEvent.click(screen.getByRole('button', { name: /^Continue$/ }))
    }
    await waitFor(() => expect(screen.getByText(/Step 8 of 8/)).toBeTruthy())
    expect(screen.queryByRole('button', { name: /^Continue$/ })).toBeNull()
    expect(screen.getAllByRole('button', { name: /Create item/i }).length).toBeGreaterThan(0)
  })

  /**
   * The failure this pins: a required field in a section that is not on show. Without bringing its
   * section forward first, the save reports an error the reader cannot see, let alone fix.
   */
  it('brings the offending section forward when validation fails on a hidden field', async () => {
    stubMatchMedia(false)
    mountNew()
    // Walk away from Basic Details, then save with the item name still empty.
    fireEvent.click(screen.getByRole('button', { name: /^Continue$/ }))
    await waitFor(() => expect(screen.getByText(/Step 2 of 8/)).toBeTruthy())

    fireEvent.click(screen.getAllByRole('button', { name: /Create Item/ })[0])

    await waitFor(() => expect(screen.getByText(/Step 1 of 8/)).toBeTruthy())
    expect(document.getElementById('item-section-basic')?.closest('div.hidden')).toBeNull()
    expect(createItem).not.toHaveBeenCalled()
  })

  it('keeps every section on the page on a wide screen', () => {
    stubMatchMedia(true)
    mountNew()
    expect(screen.queryByText(/Step 1 of 8/)).toBeNull()
    for (const id of ['basic', 'classification', 'units', 'pricing', 'stock', 'accounting', 'additional', 'media']) {
      expect(document.getElementById(`item-section-${id}`)?.closest('div.hidden')).toBeNull()
    }
  })
})
