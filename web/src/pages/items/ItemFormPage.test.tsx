import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import type { ItemFormOptions, ItemSearchRow } from '../../services/items'
import { ApiError } from '../../services/api'

const can = vi.fn<(key: string | readonly string[]) => boolean>(() => true)
const create = vi.fn()
const update = vi.fn()
const search = vi.fn<(q: string, limit?: number, signal?: AbortSignal) => Promise<ItemSearchRow[]>>(async () => [])
const openings = vi.fn(async () => ({ rows: [], effective_fy_id: 0, carried_forward: false }))
const saveOpenings = vi.fn(async () => ({ rows: [], effective_fy_id: 0, carried_forward: false }))
const toastSuccess = vi.fn()

const OPTIONS: ItemFormOptions = {
  item_groups: [
    { item_grp_id: 3, grp_name: 'Medicines', grp_alias: null, is_primary: 1, parent_grp_id: null },
    { item_grp_id: 4, grp_name: 'Stationery', grp_alias: null, is_primary: 1, parent_grp_id: null },
  ],
  stock_categories: [{ stock_cat_id: 7, cat_name: 'Tablets', cat_alias: null }],
  brands: [{ brand_id: 9, brand_name: 'Acme' }],
  units: [
    { unit_id: 1, unit_name: 'Pieces', unit_symbol: 'Pcs', print_name: null, uqc_gst: null },
    { unit_id: 2, unit_name: 'Box', unit_symbol: 'Box', print_name: null, uqc_gst: null },
  ],
  warehouses: [{ warehouse_id: 11, warehouse_name: 'Main store', warehouse_code: 'MS', warehouse_type: 'main', is_default: 1, bo_id: 0 }],
  valuation_methods: ['FIFO', 'LIFO', 'WAC'],
  default_valuation_method: 'FIFO',
  negative_stock_policies: ['allow', 'warn', 'block'],
  itc_eligibility_options: ['inherit', 'claim', 'block'],
}

const formOptionsState = { options: OPTIONS as ItemFormOptions | null, loading: false, error: null as string | null, reload: vi.fn() }

vi.mock('../../access/AccessContext', () => ({
  useAccess: () => ({ can, loading: false, isOwner: true }),
  useCan: () => true,
}))

vi.mock('../../company/CompanyContext', () => ({
  useCompany: () => ({
    scope: { cmp_id: 7, fy_id: 2, bo_id: 0 },
    companyName: 'Demo Company',
    fy: { fyId: 2, label: 'FY 2026-27', start: '2026-04-01', end: '2027-03-31' },
    branch: null,
  }),
}))

vi.mock('../../ui/ToastContext', () => ({
  useToast: () => ({ success: toastSuccess, error: vi.fn(), info: vi.fn(), notify: vi.fn() }),
}))

vi.mock('../../hooks/useFormOptions', () => ({
  useFormOptions: () => formOptionsState,
  invalidateFormOptions: vi.fn(),
}))

vi.mock('../../hooks/useBaseCurrency', () => ({ useBaseCurrency: () => 'INR' }))

vi.mock('../../services/items', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../services/items')>()
  return {
    ...actual,
    itemsApi: { ...actual.itemsApi, create, update, search, openings, saveOpenings },
  }
})

const { ItemFormPage } = await import('./ItemFormPage')

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/items/new']}>
      <Routes>
        <Route path="/items/new" element={<ItemFormPage />} />
        <Route path="/items" element={<p>Items list</p>} />
      </Routes>
    </MemoryRouter>,
  )
}

const nameInput = () => screen.getByLabelText(/^item name/i) as HTMLInputElement
const baseUnitSelect = () => screen.getByLabelText(/^base unit/i) as HTMLSelectElement
/** The header and the sticky bar both carry the primary action; either will do. */
const createButton = () => screen.getAllByRole('button', { name: /create item/i })[0]
/** The stepper, so a step button is not confused with the same word in the setup checklist. */
const stepper = () => within(screen.getByRole('navigation', { name: /item setup progress/i }))

function fillMinimum() {
  fireEvent.change(nameInput(), { target: { value: 'Bolt M8' } })
  fireEvent.change(baseUnitSelect(), { target: { value: '1' } })
}

beforeEach(() => {
  can.mockReset()
  can.mockReturnValue(true)
  create.mockReset()
  create.mockResolvedValue({ item_id: 42 })
  update.mockReset()
  search.mockReset()
  search.mockResolvedValue([])
  openings.mockClear()
  saveOpenings.mockClear()
  toastSuccess.mockReset()
  formOptionsState.options = OPTIONS
  formOptionsState.loading = false
  formOptionsState.error = null
})

afterEach(() => {
  vi.clearAllTimers()
})

describe('ItemFormPage — new item', () => {
  it('renders the four steps and every identity field the old form had', () => {
    renderPage()
    for (const step of ['Identity', 'Classification', 'Units', 'Valuation']) {
      expect(stepper().getByRole('button', { name: new RegExp(`^${step}`) })).toBeTruthy()
    }
    expect(nameInput()).toBeTruthy()
    expect(screen.getByLabelText(/^alias/i)).toBeTruthy()
    expect(screen.getByLabelText(/^print name/i)).toBeTruthy()
    expect(screen.getByLabelText(/^type/i)).toBeTruthy()
    expect(screen.getByLabelText(/^sku/i)).toBeTruthy()
    expect(screen.getByLabelText(/barcode/i)).toBeTruthy()
    expect(screen.getByLabelText(/hsn/i)).toBeTruthy()
    expect(screen.getByLabelText(/^mrp/i)).toBeTruthy()
    expect(screen.getByRole('switch', { name: /active item/i })).toBeTruthy()
  })

  it('keeps the fields the screenshot never reached — tax attribute, stock levels and opening stock', () => {
    renderPage()
    expect(screen.getByLabelText(/input tax credit/i)).toBeTruthy()
    expect(screen.getByLabelText(/^reorder point/i)).toBeTruthy()
    expect(screen.getByLabelText(/^safety stock/i)).toBeTruthy()
    expect(screen.getByLabelText(/^lead time/i)).toBeTruthy()
    expect(screen.getByLabelText(/^default warehouse/i)).toBeTruthy()
    expect(screen.getByRole('button', { name: /add opening row/i })).toBeTruthy()
  })

  it('fills the master selects from the form-options API', () => {
    renderPage()
    const group = screen.getByLabelText(/^item group/i) as HTMLSelectElement
    expect([...group.options].map((o) => o.textContent)).toEqual(['— None —', 'Medicines', 'Stationery'])
    expect(([...(screen.getByLabelText(/^brand/i) as HTMLSelectElement).options]).map((o) => o.textContent)).toContain('Acme')
    expect(([...baseUnitSelect().options]).map((o) => o.textContent)).toContain('Pieces (Pcs)')
  })

  it('explains a master list that failed to load and offers a retry', () => {
    formOptionsState.options = null
    formOptionsState.error = 'Could not load form options.'
    renderPage()
    expect(screen.getAllByText(/could not load form options/i).length).toBeGreaterThan(0)
    expect(screen.getAllByRole('button', { name: /retry/i }).length).toBeGreaterThan(0)
  })

  it('refuses to submit without an item name and marks the step', async () => {
    renderPage()
    fireEvent.click(createButton())
    expect(await screen.findByText('Item name is required', {}, { timeout: 3000 })).toBeTruthy()
    expect(create).not.toHaveBeenCalled()
    expect(stepper().getByRole('button', { name: /^Identity/ }).getAttribute('aria-invalid')).toBe('true')
  })

  it('refuses to submit without a base unit', async () => {
    renderPage()
    fireEvent.change(nameInput(), { target: { value: 'Bolt M8' } })
    fireEvent.click(createButton())
    expect(await screen.findByText('Pick the base unit', {}, { timeout: 3000 })).toBeTruthy()
    expect(create).not.toHaveBeenCalled()
  })

  it('adds and removes an alternate unit, showing the conversion in words', async () => {
    renderPage()
    fillMinimum()
    fireEvent.click(screen.getByRole('button', { name: /add alternate unit/i }))
    const altSelect = screen.getByLabelText(/^alternate unit 1$/i) as HTMLSelectElement
    // The base unit is never offered as its own alternate.
    expect([...altSelect.options].map((o) => o.value)).not.toContain('1')
    fireEvent.change(altSelect, { target: { value: '2' } })
    fireEvent.change(screen.getByLabelText(/^quantity/i), { target: { value: '12' } })
    expect(await screen.findByText('1 Box (Box) = 12 Pcs', {}, { timeout: 3000 })).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: /remove alternate unit 1/i }))
    await waitFor(() => expect(screen.queryByLabelText(/^alternate unit 1$/i)).toBeNull())
  })

  it('submits the same payload shape the API already accepts', async () => {
    renderPage()
    fillMinimum()
    fireEvent.change(screen.getByLabelText(/hsn/i), { target: { value: '7318ab' } })
    fireEvent.click(screen.getByRole('switch', { name: /track batches/i }))
    fireEvent.click(screen.getByRole('switch', { name: /track serials/i }))
    fireEvent.click(screen.getByRole('button', { name: /add alternate unit/i }))
    fireEvent.change(screen.getByLabelText(/^alternate unit 1$/i), { target: { value: '2' } })
    fireEvent.change(screen.getByLabelText(/^quantity/i), { target: { value: '12' } })

    fireEvent.click(createButton())
    await waitFor(() => expect(create).toHaveBeenCalledTimes(1), { timeout: 3000 })
    expect(create.mock.calls[0][0]).toMatchObject({
      item_name: 'Bolt M8',
      item_type: 'stock',
      unit_id: 1,
      hsn_sac: '7318AB',
      valuation_method: 'FIFO',
      track_batch: 1,
      track_serial: 1,
      track_expiry: 0,
      itc_eligibility: 'inherit',
      is_active: 1,
      unit_lines: [
        { unit_id: 1, is_default: 1, conversion_factor: 1, uom_role: 'base' },
        { unit_id: 2, is_default: 0, conversion_factor: 12, uom_role: null },
      ],
    })
    await waitFor(() => expect(toastSuccess).toHaveBeenCalledWith('Item created'), { timeout: 3000 })
  })

  it('submits once however many times the button is pressed', async () => {
    let release: (value: { item_id: number }) => void = () => {}
    create.mockImplementation(() => new Promise((resolve) => { release = resolve }))
    renderPage()
    fillMinimum()
    const button = createButton()
    fireEvent.click(button)
    fireEvent.click(button)
    fireEvent.click(button)
    expect(create).toHaveBeenCalledTimes(1)
    release({ item_id: 42 })
    await waitFor(() => expect(toastSuccess).toHaveBeenCalled(), { timeout: 3000 })
  })

  it('puts a server field error on the field the server blamed', async () => {
    create.mockRejectedValue(new ApiError(409, 'conflict', 'SKU "BLT-1" already exists', { field: 'item_sku' }))
    renderPage()
    fillMinimum()
    fireEvent.change(screen.getByLabelText(/^sku/i), { target: { value: 'BLT-1' } })
    fireEvent.click(createButton())
    expect(await screen.findByText(/sku "blt-1" already exists/i, {}, { timeout: 3000 })).toBeTruthy()

    // The message is about the SKU that was sent; typing a new one retires it.
    fireEvent.change(screen.getByLabelText(/^sku/i), { target: { value: 'BLT-2' } })
    await waitFor(() => expect(screen.queryByText(/sku "blt-1" already exists/i)).toBeNull())
  })

  it('reports a possible duplicate from the existing item search without blocking', async () => {
    search.mockResolvedValue([
      { item_id: 5, item_name: 'Bolt M8', item_alias: null, print_name: null, item_sku: 'BLT-8', item_upc: null, hsn_sac: '7318', unit_id: 1, unit_symbol: 'Pcs', track_batch: 0, track_serial: 0, valuation_method: 'FIFO', default_warehouse_id: null },
    ])
    renderPage()
    fillMinimum()
    expect(await screen.findByText(/a possible duplicate/i, {}, { timeout: 3000 })).toBeTruthy()
    expect(screen.getByText('Same name')).toBeTruthy()
    // Nothing is blocked: the create button is still live.
    expect((createButton() as HTMLButtonElement).disabled).toBe(false)
    fireEvent.click(screen.getByRole('button', { name: /continue anyway/i }))
    await waitFor(() => expect(screen.queryByText(/a possible duplicate/i)).toBeNull())
  })

  it('offers a neighbour’s HSN rather than inventing one', async () => {
    search.mockResolvedValue([
      { item_id: 5, item_name: 'Bolt M8 galvanised', item_alias: null, print_name: null, item_sku: null, item_upc: null, hsn_sac: '7318', unit_id: 1, unit_symbol: 'Pcs', track_batch: 0, track_serial: 0, valuation_method: 'FIFO', default_warehouse_id: null },
    ])
    renderPage()
    fillMinimum()
    const suggest = await screen.findByTitle(/use 7318, from a similar item/i, {}, { timeout: 3000 })
    expect((screen.getByLabelText(/hsn/i) as HTMLInputElement).value).toBe('')
    fireEvent.click(suggest)
    expect((screen.getByLabelText(/hsn/i) as HTMLInputElement).value).toBe('7318')
  })
})

describe('ItemFormPage — the assistant never writes on its own', () => {
  it('leaves a value the user typed alone until it is ticked and applied', async () => {
    renderPage()
    const groupSelect = () => screen.getByRole('combobox', { name: /^item group/i }) as HTMLSelectElement
    fireEvent.change(nameInput(), { target: { value: 'Medicines pack' } })
    fireEvent.change(groupSelect(), { target: { value: '4' } })

    fireEvent.click(screen.getByRole('button', { name: /^assist/i }))
    const drawer = await screen.findByRole('dialog')
    // Opening the drawer changed nothing.
    expect(groupSelect().value).toBe('4')

    const groupRow = within(drawer).getByText('Item group').closest('label') as HTMLLabelElement
    const checkbox = within(groupRow).getByRole('checkbox') as HTMLInputElement
    // A suggestion that would replace a typed value starts unticked.
    expect(checkbox.checked).toBe(false)
    expect(within(groupRow).getByText('Stationery')).toBeTruthy()
    expect(within(groupRow).getByText('Medicines')).toBeTruthy()

    fireEvent.click(checkbox)
    fireEvent.click(within(drawer).getByRole('button', { name: /apply selected/i }))
    await waitFor(() => expect(groupSelect().value).toBe('3'), { timeout: 3000 })
  })

  it('generates a SKU on request and never behind the user’s back', () => {
    renderPage()
    fireEvent.change(nameInput(), { target: { value: 'Bolt M8' } })
    expect((screen.getByLabelText(/^sku/i) as HTMLInputElement).value).toBe('')
    fireEvent.click(screen.getByRole('button', { name: /generate a sku/i }))
    expect((screen.getByLabelText(/^sku/i) as HTMLInputElement).value).toMatch(/^BOLT8-[0-9A-Z]{4}$/)
  })
})

describe('ItemFormPage — leaving with unsaved edits', () => {
  it('asks before discarding, and does not ask once the item is saved', async () => {
    renderPage()
    fillMinimum()
    fireEvent.click(screen.getAllByRole('button', { name: /^cancel$/i })[0])
    expect(await screen.findByText(/discard unsaved changes\?/i, {}, { timeout: 3000 })).toBeTruthy()

    const dialog = screen.getByRole('dialog')
    fireEvent.click(within(dialog).getByRole('button', { name: /^cancel$/i }))
    await waitFor(() => expect(screen.queryByText(/discard unsaved changes\?/i)).toBeNull())

    fireEvent.click(createButton())
    await waitFor(() => expect(create).toHaveBeenCalled(), { timeout: 3000 })
    await waitFor(() => expect(screen.getByText('Items list')).toBeTruthy(), { timeout: 3000 })
  })
})

describe('ItemFormPage — permissions', () => {
  it('hides every write control from a reader', () => {
    can.mockImplementation((key) => (typeof key === 'string' ? key === 'masters.items.read' : false))
    renderPage()
    expect(screen.queryByRole('button', { name: /create item/i })).toBeNull()
    expect(screen.queryByRole('button', { name: /add alternate unit/i })).toBeNull()
    expect((nameInput()).disabled).toBe(true)
    expect(screen.getAllByRole('button', { name: /^back$/i }).length).toBeGreaterThan(0)
  })

  it('says so plainly when the user may not read items at all', () => {
    can.mockReturnValue(false)
    renderPage()
    expect(screen.getByText(/do not have permission to view items/i)).toBeTruthy()
  })
})
