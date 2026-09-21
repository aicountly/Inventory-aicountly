import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import type { Item, ItemFormOptions, ItemOpeningsResponse } from '../../services/items'

/**
 * The Edit Item workspace, mounted against stubbed services.
 *
 * What this suite is for: the page carries every field of the item master, and the two ways to
 * break it silently are (a) initialising the form before the fetch lands, so the user's values are
 * replaced by defaults, and (b) sending a payload that drops something the old screen sent. Both
 * typecheck. Both are pinned below, along with the behaviour the redesign added — dirty tracking,
 * Ctrl+S, the delete moving behind More Actions, and the guard on the way out.
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

// The base-currency probe is a label detail behind `settings.read`; it must never be what decides
// whether the page renders, so it is stubbed to the quiet "not known here" answer.
vi.mock('../../hooks/useBaseCurrency', () => ({ useBaseCurrencySymbol: () => '₹' }))

const OPTIONS: ItemFormOptions = {
  item_groups: [{ item_grp_id: 1, grp_name: 'General', grp_alias: null, is_primary: 1, parent_grp_id: null }],
  stock_categories: [{ stock_cat_id: 2, cat_name: 'Raw Material', cat_alias: null }],
  brands: [{ brand_id: 5, brand_name: 'Acme' }],
  units: [
    { unit_id: 10, unit_name: 'Dozen', unit_symbol: 'DOZ', print_name: null, uqc_gst: null },
    { unit_id: 11, unit_name: 'Piece', unit_symbol: 'Pcs', print_name: null, uqc_gst: null },
  ],
  warehouses: [
    { warehouse_id: 7, warehouse_name: 'Main store', warehouse_code: null, warehouse_type: 'store', is_default: 1, bo_id: 0 },
  ],
  valuation_methods: ['FIFO', 'LIFO', 'WAC'],
  default_valuation_method: 'FIFO',
  negative_stock_policies: ['allow', 'warn', 'block'],
  itc_eligibility_options: ['inherit', 'claim', 'block'],
}

vi.mock('../../hooks/useFormOptions', () => ({
  useFormOptions: () => ({ options: OPTIONS, loading: false, error: null, reload: vi.fn() }),
  invalidateFormOptions: vi.fn(),
}))

const getItem = vi.fn()
const updateItem = vi.fn()
const removeItem = vi.fn()
const saveOpenings = vi.fn()
const getOpenings = vi.fn()

vi.mock('../../services/items', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../services/items')>()
  return {
    ...actual,
    itemsApi: {
      ...actual.itemsApi,
      get: (...a: unknown[]) => getItem(...a),
      update: (...a: unknown[]) => updateItem(...a),
      remove: (...a: unknown[]) => removeItem(...a),
      openings: (...a: unknown[]) => getOpenings(...a),
      saveOpenings: (...a: unknown[]) => saveOpenings(...a),
    },
  }
})

const auditEntity = vi.fn()
vi.mock('../../services/auditApi', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../services/auditApi')>()
  return { ...actual, auditApi: { ...actual.auditApi, entity: (...a: unknown[]) => auditEntity(...a) } }
})

const { ItemFormPage } = await import('./ItemFormPage')

const ITEM: Item = {
  item_id: 17859,
  item_name: 'Ballpoint Pens',
  item_alias: 'Pen',
  print_name: 'Pen',
  item_type: 'stock',
  item_sku: 'BP-001',
  item_upc: '8901234567890',
  hsn_sac: '960810',
  mrp: '15.0000',
  unit_id: 10,
  purchase_unit_id: null,
  sales_unit_id: null,
  parent_item_id: null,
  stock_cat_id: 2,
  item_grp_id: 1,
  brand_id: null,
  books_sales_acc_id: 44,
  books_purchase_acc_id: null,
  books_tax_cat_id: 9,
  itc_eligibility: 'inherit',
  valuation_method: 'FIFO',
  standard_cost: '9.0000',
  negative_stock_policy: null,
  track_batch: 0,
  track_serial: 0,
  track_expiry: 0,
  shelf_life_days: null,
  min_stock_qty: '10.0000',
  max_stock_qty: null,
  reorder_point_qty: null,
  reorder_qty: null,
  safety_stock_qty: null,
  lead_time_days: null,
  default_warehouse_id: 7,
  is_active: 1,
  updated_at: '2026-09-16 10:24:00',
  created_at: '2026-01-02 09:00:00',
  updated_by: 'Rahul Gupta',
  unit_symbol: 'DOZ',
  unit_name: 'Dozen',
  grp_name: 'General',
  cat_name: 'Raw Material',
  brand_name: null,
  attributes: { description: 'Smooth writing ballpoint pens.', tags: ['Stationery'], gsm: 70 },
  variant_attributes: null,
  unit_lines: [
    { unit_id: 10, is_default: 1, conversion_factor: 1, uom_role: 'base' },
    { unit_id: 11, is_default: 0, conversion_factor: 0.0833, uom_role: 'purchase' },
  ],
  openings: [],
  stock: { on_hand: -1, available: -1, reserved: 0 },
}

const OPENINGS: ItemOpeningsResponse = { rows: [], effective_fy_id: 0, carried_forward: false }

function mount() {
  return render(
    <MemoryRouter initialEntries={['/items/17859']}>
      <Routes>
        <Route path="/items/:id" element={<ItemFormPage />} />
        <Route path="/items" element={<p>Items list</p>} />
      </Routes>
    </MemoryRouter>,
  )
}

/** The page paints a skeleton first; every test starts once the real form is on screen. */
async function mountLoaded() {
  mount()
  await screen.findByDisplayValue('Ballpoint Pens')
}

beforeEach(() => {
  vi.clearAllMocks()
  getItem.mockResolvedValue(ITEM)
  getOpenings.mockResolvedValue(OPENINGS)
  updateItem.mockResolvedValue(ITEM)
  removeItem.mockResolvedValue(undefined)
  auditEntity.mockResolvedValue({
    data: [
      {
        audit_id: 1,
        action: 'item.updated',
        actor_uuid: '7',
        created_at: '2026-09-16 10:24:00',
        entity_type: 'item',
        entity_id: 17859,
      },
    ],
    meta: { total: 1 },
  })
})

describe('ItemFormPage', () => {
  it('shows a skeleton rather than an empty form while the item loads', () => {
    mount()
    expect(screen.getByRole('status').textContent).toContain('Loading item')
    expect(screen.queryByDisplayValue('Ballpoint Pens')).toBeNull()
  })

  /**
   * The failure this pins: initialising the form from defaults and letting the fetched item land
   * behind it. Everything below would still render — with the wrong values.
   */
  it('populates every section from the fetched item', async () => {
    await mountLoaded()
    expect((screen.getByLabelText(/^Alias/) as HTMLInputElement).value).toBe('Pen')
    expect((screen.getByLabelText(/^SKU/) as HTMLInputElement).value).toBe('BP-001')
    expect((screen.getByLabelText(/Barcode/) as HTMLInputElement).value).toBe('8901234567890')
    expect((screen.getByLabelText(/HSN/) as HTMLInputElement).value).toBe('960810')
    expect((screen.getByLabelText(/^MRP/) as HTMLInputElement).value).toBe('15')
    expect((screen.getByLabelText(/Item group/) as HTMLSelectElement).value).toBe('1')
    expect((screen.getByLabelText(/Stock category/) as HTMLSelectElement).value).toBe('2')
    expect((screen.getByLabelText(/Base unit/) as HTMLSelectElement).value).toBe('10')
    expect((screen.getByLabelText(/Valuation method/) as HTMLSelectElement).value).toBe('FIFO')
    expect((screen.getByLabelText(/Standard cost/) as HTMLInputElement).value).toBe('9')
    expect((screen.getByLabelText(/Minimum/) as HTMLInputElement).value).toBe('10')
    expect((screen.getByLabelText(/Default warehouse/) as HTMLSelectElement).value).toBe('7')
    // Attributes come out of `attributes_json`, which no earlier screen surfaced.
    expect((screen.getByLabelText(/Description/) as HTMLTextAreaElement).value).toBe('Smooth writing ballpoint pens.')
    // Once in the Additional card's tag editor, once in the preview that mirrors the draft.
    expect(screen.getAllByText('Stationery')).toHaveLength(2)
    expect((screen.getByLabelText(/Custom field 1 name/) as HTMLInputElement).value).toBe('gsm')
  })

  it('reads an alternate-unit conversion back in both directions', async () => {
    await mountLoaded()
    expect(screen.getByText('1 Pcs = 0.0833 DOZ')).toBeTruthy()
    expect(screen.getByText('≈ 12.0048 Pcs = 1 DOZ')).toBeTruthy()
  })

  it('sends the whole item on save and keeps attributes it did not touch', async () => {
    await mountLoaded()
    fireEvent.change(screen.getByLabelText(/Item name/), { target: { value: 'Ballpoint Pens XL' } })
    fireEvent.click(screen.getByRole('button', { name: /Save Changes/ }))

    await waitFor(() => expect(updateItem).toHaveBeenCalled())
    const [id, body] = updateItem.mock.calls[0] as [number, Record<string, unknown>]
    expect(id).toBe(17859)
    expect(body).toMatchObject({
      item_name: 'Ballpoint Pens XL',
      item_alias: 'Pen',
      item_sku: 'BP-001',
      hsn_sac: '960810',
      mrp: 15,
      item_grp_id: 1,
      stock_cat_id: 2,
      unit_id: 10,
      valuation_method: 'FIFO',
      standard_cost: 9,
      itc_eligibility: 'inherit',
      min_stock_qty: 10,
      default_warehouse_id: 7,
      is_active: 1,
    })
    expect(body.unit_lines).toEqual([
      { unit_id: 10, is_default: 1, conversion_factor: 1, uom_role: 'base' },
      { unit_id: 11, is_default: 0, conversion_factor: 0.0833, uom_role: 'purchase' },
    ])
    // Untouched attributes must not ride along: the server only rewrites the column when they do.
    expect('attributes' in body).toBe(false)
    // Books' own columns are never sent from here.
    expect('books_sales_acc_id' in body).toBe(false)
    expect('books_tax_cat_id' in body).toBe(false)
    // Openings were not touched, so the separate endpoint is left alone.
    expect(saveOpenings).not.toHaveBeenCalled()
    expect(toast.success).toHaveBeenCalledWith('Item updated successfully')
  })

  it('carries attributes once one of them is edited, preserving the keys it does not model', async () => {
    await mountLoaded()
    fireEvent.change(screen.getByLabelText(/Description/), { target: { value: 'New copy.' } })
    fireEvent.click(screen.getByRole('button', { name: /Save Changes/ }))

    await waitFor(() => expect(updateItem).toHaveBeenCalled())
    const body = (updateItem.mock.calls[0] as [number, Record<string, unknown>])[1]
    expect(body.attributes).toEqual({ description: 'New copy.', tags: ['Stationery'], gsm: '70' })
  })

  it('saves on Ctrl+S', async () => {
    await mountLoaded()
    fireEvent.change(screen.getByLabelText(/Item name/), { target: { value: 'Edited' } })
    fireEvent.keyDown(window, { key: 's', ctrlKey: true })
    await waitFor(() => expect(updateItem).toHaveBeenCalled())
  })

  it('refuses to save an invalid HSN and says which field is wrong', async () => {
    await mountLoaded()
    fireEvent.change(screen.getByLabelText(/HSN/), { target: { value: '12' } })
    fireEvent.click(screen.getByRole('button', { name: /Save Changes/ }))

    await screen.findByText('HSN/SAC must be 4 to 8 letters or digits')
    expect(updateItem).not.toHaveBeenCalled()
  })

  it('keeps the edits when the server refuses the save', async () => {
    await mountLoaded()
    updateItem.mockRejectedValue(new Error('SKU "BP-001" already exists'))
    fireEvent.change(screen.getByLabelText(/^SKU/), { target: { value: 'BP-002' } })
    fireEvent.click(screen.getByRole('button', { name: /Save Changes/ }))

    await screen.findByText('SKU "BP-001" already exists')
    expect((screen.getByLabelText(/^SKU/) as HTMLInputElement).value).toBe('BP-002')
  })

  /** The old screen put Delete beside Save. It is one deliberate step further away now. */
  it('keeps delete out of the header and behind a confirmation', async () => {
    await mountLoaded()
    expect(screen.queryByRole('button', { name: /^Delete$/ })).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: /More Actions/ }))
    fireEvent.click(await screen.findByRole('menuitem', { name: /Delete item/ }))

    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByText(/about to delete/)).toBeTruthy()
    expect(removeItem).not.toHaveBeenCalled()

    fireEvent.click(within(dialog).getByRole('button', { name: /Delete item/ }))
    await waitFor(() => expect(removeItem).toHaveBeenCalledWith(17859))
  })

  it('reports the item as unsaved once it is edited, and clean again after a save', async () => {
    await mountLoaded()
    expect(screen.queryByText('Unsaved changes')).toBeNull()
    fireEvent.change(screen.getByLabelText(/Item name/), { target: { value: 'Edited' } })
    expect(screen.getByText('Unsaved changes')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: /Save Changes/ }))
    await waitFor(() => expect(screen.queryByText('Unsaved changes')).toBeNull())
  })

  it('holds an in-app navigation while the form is dirty', async () => {
    await mountLoaded()
    fireEvent.change(screen.getByLabelText(/Item name/), { target: { value: 'Edited' } })
    fireEvent.click(screen.getByRole('link', { name: /Back to items/ }))

    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByText(/unsaved changes/i)).toBeTruthy()
    expect(screen.queryByText('Items list')).toBeNull()
  })

  it('shows the real audit trail rather than composing its own', async () => {
    await mountLoaded()
    await waitFor(() => expect(auditEntity).toHaveBeenCalledWith('item', 17859, expect.anything(), expect.anything()))
    expect(await screen.findByText('Item updated')).toBeTruthy()
  })

  it('fetches the item once, not once per render', async () => {
    await mountLoaded()
    fireEvent.change(screen.getByLabelText(/Item name/), { target: { value: 'Edited' } })
    fireEvent.change(screen.getByLabelText(/Item name/), { target: { value: 'Edited twice' } })
    await new Promise((r) => setTimeout(r, 450))
    expect(getItem).toHaveBeenCalledTimes(1)
    expect(getOpenings).toHaveBeenCalledTimes(1)
    expect(auditEntity).toHaveBeenCalledTimes(1)
  })

  /**
   * The rule the Suggest drawer exists to enforce. A button that rewrote fields on click would be
   * the most destructive control on the page and nobody would find out until the next save.
   */
  it('previews suggestions and writes nothing until one is applied', async () => {
    getItem.mockResolvedValue({ ...ITEM, item_alias: null, print_name: null, attributes: null })
    await mountLoaded()

    // By id, not by label: the drawer's own row is labelled "Print name" too, and the point of
    // the test is that the two are different things.
    const printName = () => document.getElementById('item-field-print_name') as HTMLInputElement

    fireEvent.click(screen.getByRole('button', { name: /Suggest with AI/ }))
    const drawer = await screen.findByRole('dialog')
    // Wait for the list, not just the panel: it is fetched after the drawer opens.
    expect(await within(drawer).findByText('Print name')).toBeTruthy()
    // Shown, not applied.
    expect(printName().value).toBe('')
    // And never a tax classification.
    expect(within(drawer).queryByText(/HSN \/ SAC$/)).toBeNull()
    expect(within(drawer).getByText(/Tax classification is resolved in Books/)).toBeTruthy()

    fireEvent.click(within(drawer).getByRole('button', { name: /Select all/ }))
    fireEvent.click(await within(drawer).findByRole('button', { name: /Apply \d+ suggestion/ }))

    await waitFor(() => expect(printName().value).toBe('Ballpoint Pens'))
    // Applying fills the form in; it does not save.
    expect(updateItem).not.toHaveBeenCalled()
    expect(screen.getByText('Unsaved changes')).toBeTruthy()
  })

  it('runs the deterministic insight checks over the draft', async () => {
    await mountLoaded()
    // The fixture sells at 15 against a cost of 9, so the card opens healthy…
    expect(await screen.findByText('Looks good!')).toBeTruthy()
    // …and turns critical the moment the price stops covering the cost.
    fireEvent.change(screen.getByLabelText(/^MRP/), { target: { value: '5' } })
    expect(await screen.findByText('Configuration issue detected')).toBeTruthy()
    // Said in both places it matters: the insight card, and beside the fields themselves.
    expect(screen.getAllByText(/MRP is below standard cost/).length).toBeGreaterThanOrEqual(2)
  })
})
