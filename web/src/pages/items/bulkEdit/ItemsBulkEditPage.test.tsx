import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ReactNode } from 'react'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { ToastProvider } from '../../../ui/ToastContext'
import type { AuditLogRow } from '../../../services/auditApi'
import type { ItemListRow } from '../../../services/items'

/**
 * The bulk edit workspace, tested at the seam that matters: what it asks the
 * API for, what it promises before a write, and what it says afterwards.
 *
 * Two promises are load-bearing and get the most attention here. The number
 * inside the Apply button, the confirmation and the payload must always be the
 * same number — a dialog that says 24 and writes 22 is the one failure a bulk
 * editor cannot have. And HSN / SAC must stay unwritable: Books owns it and the
 * API refuses the change, so the screen has to refuse it first rather than
 * collect typing the server will throw away.
 */

// ---------------------------------------------------------------------------
// Context doubles — mutable so a test can revoke a permission
// ---------------------------------------------------------------------------

const permissions = { read: true, write: true, audit: true }

vi.mock('../../../company/CompanyContext', () => ({
  useCompany: () => ({
    scope: { cmp_id: 1, fy_id: 3, bo_id: 0 },
    companyName: 'Demo Company',
    fy: { fyId: 3, label: 'FY 2026-27' },
    branch: null,
  }),
}))

vi.mock('../../../company/useScopeLabel', () => ({
  useScopeLabel: () => 'Demo Company · FY 2026-27 · All branches',
}))

vi.mock('../../../access/AccessContext', () => ({
  useAccess: () => ({
    can: (key: string) =>
      key === 'masters.items.read'
        ? permissions.read
        : key === 'masters.items.write'
          ? permissions.write
          : key === 'audit.read'
            ? permissions.audit
            : true,
    loading: false,
    member: { uuid: 'member-1', display_name: 'Pranav Sharma', status: 'active', profile_id: 1 },
  }),
}))

const invalidateFormOptions = vi.fn()
vi.mock('../../../hooks/useFormOptions', () => ({
  useFormOptions: () => ({
    options: {
      item_groups: [
        { item_grp_id: 5, grp_name: 'Raw Materials', grp_alias: null, is_primary: 1, parent_grp_id: null },
        { item_grp_id: 6, grp_name: 'General', grp_alias: null, is_primary: 1, parent_grp_id: null },
      ],
      stock_categories: [{ stock_cat_id: 2, cat_name: 'Metals', cat_alias: null }],
      brands: [
        { brand_id: 8, brand_name: 'Finolex' },
        { brand_id: 9, brand_name: 'Havells' },
      ],
      units: [],
      warehouses: [],
      valuation_methods: ['FIFO'],
      default_valuation_method: 'FIFO',
      negative_stock_policies: ['allow'],
      itc_eligibility_options: [],
    },
    loading: false,
    error: null,
    reload: vi.fn(),
  }),
  invalidateFormOptions: () => invalidateFormOptions(),
}))

// ---------------------------------------------------------------------------
// API doubles
// ---------------------------------------------------------------------------

const listItems = vi.fn()
const bulkUpdate = vi.fn()

vi.mock('../../../services/items', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../services/items')>()
  return {
    ...actual,
    itemsApi: {
      ...actual.itemsApi,
      list: (...args: unknown[]) => listItems(...args),
      bulkUpdate: (...args: unknown[]) => bulkUpdate(...args),
    },
  }
})

const auditList = vi.fn()
vi.mock('../../../services/auditApi', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../services/auditApi')>()
  return { ...actual, auditApi: { ...actual.auditApi, list: (...args: unknown[]) => auditList(...args) } }
})

const { ItemsBulkEditPage } = await import('./ItemsBulkEditPage')

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function item(over: Partial<ItemListRow> & { item_id: number; item_name: string }): ItemListRow {
  return {
    item_alias: null,
    print_name: null,
    item_type: 'stock',
    item_sku: null,
    item_upc: null,
    hsn_sac: null,
    mrp: null,
    unit_id: 1,
    stock_cat_id: null,
    item_grp_id: 6,
    brand_id: null,
    valuation_method: 'FIFO',
    track_batch: 0,
    track_serial: 0,
    track_expiry: 0,
    is_active: 1,
    updated_at: '2026-06-12 09:12:00',
    created_at: '2026-01-01 10:00:00',
    unit_symbol: 'Pcs',
    unit_name: 'Pieces',
    grp_name: 'General',
    cat_name: null,
    brand_name: null,
    ...over,
  }
}

const ROWS: ItemListRow[] = [
  item({ item_id: 1, item_name: 'Dimmy', item_alias: 'Sjs' }),
  item({ item_id: 2, item_name: 'Test Item', item_alias: 'Test Item', hsn_sac: '12345678', brand_id: 8, brand_name: 'Finolex' }),
  item({ item_id: 3, item_name: 'Copper Wire', item_grp_id: 5, grp_name: 'Raw Materials' }),
]

const AUDIT: AuditLogRow[] = [1, 2].map((entity_id) => ({
  audit_id: entity_id,
  cmp_id: 1,
  entity_type: 'item',
  entity_id,
  entity_uuid: null,
  action: 'item.bulk_update',
  actor_uuid: 'member-1',
  source_app: null,
  source_document_type: null,
  source_document_id: null,
  source_document_uuid: null,
  reason: null,
  approval_ref: null,
  reversal_ref: null,
  before: { item_name: `Item ${entity_id}`, brand_id: null },
  after: { brand_id: 9 },
  meta: { fields: ['brand_id'] },
  request_id: 'req-1',
  ip_address: null,
  created_at: '2026-06-12 10:24:00',
}))

beforeEach(() => {
  vi.clearAllMocks()
  permissions.read = true
  permissions.write = true
  permissions.audit = true
  window.localStorage.clear()
  listItems.mockResolvedValue({ data: ROWS, meta: { total: 3, limit: 25, offset: 0 } })
  auditList.mockResolvedValue({ data: AUDIT, meta: { total: 2, limit: 60, offset: 0 } })
  bulkUpdate.mockResolvedValue({ updated: 1, rows: [{ item_id: 1, changed: ['brand_id'] }] })
})

function Harness({ url, children }: { url: string; children: ReactNode }) {
  return (
    <MemoryRouter initialEntries={[url]}>
      <ToastProvider>{children}</ToastProvider>
    </MemoryRouter>
  )
}

/** Brand is the worked example throughout: a writable field with a real picker. */
function renderPage(url = '/items/bulk-edit?field=brand_id') {
  render(
    <Harness url={url}>
      <ItemsBulkEditPage />
    </Harness>,
  )
}

const table = () => screen.getByRole('table')
const kpis = () => screen.getByRole('region', { name: 'Bulk edit summary' })
const applyButton = () => screen.getByRole('button', { name: /^Apply changes to/ })

async function rowsLoaded() {
  await waitFor(() => expect(within(table()).getByText('Dimmy')).toBeTruthy())
}

async function tick(name: string) {
  fireEvent.click(screen.getByRole('checkbox', { name: `Select ${name}` }))
}

// ---------------------------------------------------------------------------

describe('the screen', () => {
  it('renders the workspace with its heading, both steps and the rail', async () => {
    renderPage()
    await rowsLoaded()

    expect(screen.getByRole('heading', { name: 'Bulk edit items' })).toBeTruthy()
    expect(screen.getByRole('heading', { name: /1\. Choose items and field to update/ })).toBeTruthy()
    expect(screen.getByRole('heading', { name: /2\. Review affected items/ })).toBeTruthy()
    expect(screen.getByRole('heading', { name: /AI Assistant/ })).toBeTruthy()
    expect(screen.getByRole('heading', { name: /Preview & validation/ })).toBeTruthy()
    expect(screen.getByRole('heading', { name: 'Recent bulk edits' })).toBeTruthy()
  })

  it('counts the whole filtered catalogue, not the page on screen', async () => {
    listItems.mockResolvedValue({ data: ROWS, meta: { total: 248, limit: 25, offset: 0 } })
    renderPage()
    await rowsLoaded()

    expect(within(kpis()).getByText('out of 248 filtered')).toBeTruthy()
  })
})

describe('narrowing the catalogue', () => {
  it('sends the search to the server once the typing settles', async () => {
    renderPage()
    await rowsLoaded()

    fireEvent.change(screen.getByLabelText('Search items'), { target: { value: 'wire' } })
    await waitFor(() => expect(listItems.mock.calls.at(-1)?.[0]).toMatchObject({ q: 'wire' }))
    // One request for the settled value, not one per keystroke.
    expect(listItems.mock.calls.filter((c) => (c[0] as { q?: string }).q === 'wire')).toHaveLength(1)
  })

  it('sends the item group filter', async () => {
    renderPage()
    await rowsLoaded()

    fireEvent.change(screen.getByLabelText('Item group'), { target: { value: '5' } })
    await waitFor(() => expect(listItems.mock.calls.at(-1)?.[0]).toMatchObject({ item_grp_id: 5 }))
  })

  it('asks for active items by default and widens on request', async () => {
    renderPage()
    await rowsLoaded()
    expect(listItems.mock.calls.at(-1)?.[0]).toMatchObject({ status: 'active' })

    fireEvent.change(screen.getByLabelText('Status'), { target: { value: 'all' } })
    await waitFor(() => expect(listItems.mock.calls.at(-1)?.[0]).toMatchObject({ status: '' }))

    fireEvent.change(screen.getByLabelText('Status'), { target: { value: 'inactive' } })
    await waitFor(() => expect(listItems.mock.calls.at(-1)?.[0]).toMatchObject({ status: 'inactive' }))
  })

  it('offers a way back when the filters match nothing', async () => {
    listItems.mockResolvedValue({ data: [], meta: { total: 0, limit: 25, offset: 0 } })
    renderPage('/items/bulk-edit?field=brand_id&q=zzz')

    await waitFor(() => expect(screen.getByText('No matching items')).toBeTruthy())
    fireEvent.click(screen.getByRole('button', { name: 'Clear filters' }))
    await waitFor(() => expect(listItems.mock.calls.at(-1)?.[0]).toMatchObject({ q: undefined }))
  })
})

describe('selecting items', () => {
  it('moves the count as rows are ticked', async () => {
    renderPage()
    await rowsLoaded()

    await tick('Dimmy')
    await waitFor(() => expect(within(kpis()).getByText('out of 3 filtered')).toBeTruthy())
    expect(applyButton().textContent).toMatch(/Apply changes to 1 item$/)

    await tick('Copper Wire')
    await waitFor(() => expect(applyButton().textContent).toMatch(/Apply changes to 2 items$/))
  })

  it('ticks and clears every row on the page from the header box', async () => {
    renderPage()
    await rowsLoaded()

    const header = screen.getByRole('checkbox', { name: /Select the 3 items on this page/ })
    fireEvent.click(header)
    await waitFor(() => expect(applyButton().textContent).toMatch(/Apply changes to 3 items$/))

    fireEvent.click(screen.getByRole('checkbox', { name: /Clear the 3 items on this page/ }))
    await waitFor(() => expect(applyButton().textContent).toMatch(/Apply changes to 0 items$/))
  })

  it('never claims to select more than the page it can see', async () => {
    listItems.mockResolvedValue({ data: ROWS, meta: { total: 248, limit: 25, offset: 0 } })
    renderPage()
    await rowsLoaded()

    expect(screen.queryByText(/Select all 248/)).toBeNull()
    expect(screen.getByRole('checkbox', { name: /Select the 3 items on this page/ })).toBeTruthy()
  })
})

describe('choosing what to change', () => {
  it('swaps the editor for the field — a picker for brand, a number for MRP', async () => {
    renderPage()
    await rowsLoaded()

    expect((screen.getByLabelText('New value') as HTMLSelectElement).tagName).toBe('SELECT')
    expect(within(screen.getByLabelText('New value')).getByRole('option', { name: 'Finolex' })).toBeTruthy()

    fireEvent.change(screen.getByLabelText('Field to update'), { target: { value: 'mrp' } })
    await waitFor(() => expect((screen.getByLabelText('New value') as HTMLInputElement).type).toBe('number'))
  })

  it('renames the current-value column after the field', async () => {
    renderPage()
    await rowsLoaded()
    expect(within(table()).getByText('Current brand')).toBeTruthy()

    fireEvent.change(screen.getByLabelText('Field to update'), { target: { value: 'mrp' } })
    await waitFor(() => expect(within(table()).getByText('Current MRP')).toBeTruthy())
  })

  it('rejects a value the field cannot take', async () => {
    renderPage('/items/bulk-edit?field=mrp')
    await rowsLoaded()
    await tick('Dimmy')

    fireEvent.change(screen.getByLabelText('New value'), { target: { value: '-5' } })
    // Stated twice on purpose — beside the editor and in the validation rail.
    await waitFor(() => expect(screen.getAllByText('Enter zero or more.').length).toBeGreaterThan(0))
    expect((applyButton() as HTMLButtonElement).disabled).toBe(true)
  })

  it('says what a blank means rather than leaving the reader to guess', async () => {
    renderPage('/items/bulk-edit?field=mrp')
    await rowsLoaded()
    expect(screen.getByText(/Blank clears mrp on every ticked item/i)).toBeTruthy()
  })
})

describe('Apply is refused until it can be honoured', () => {
  it('is disabled with nothing selected, and says why', async () => {
    renderPage()
    await rowsLoaded()

    expect((applyButton() as HTMLButtonElement).disabled).toBe(true)
    expect(screen.getByText('Tick at least one item.')).toBeTruthy()
  })

  it('is disabled when every ticked item already holds the value', async () => {
    renderPage()
    await rowsLoaded()
    await tick('Test Item') // already brand 8

    fireEvent.change(screen.getByLabelText('New value'), { target: { value: '8' } })
    await waitFor(() => expect(screen.getByText(/already has this brand/i)).toBeTruthy())
    expect((applyButton() as HTMLButtonElement).disabled).toBe(true)
  })

  it('is disabled without the write permission, and the screen says it is read-only', async () => {
    permissions.write = false
    renderPage()
    await rowsLoaded()
    await tick('Dimmy')

    expect(screen.getByText('You can review, but not apply')).toBeTruthy()
    expect((applyButton() as HTMLButtonElement).disabled).toBe(true)
  })

  it('refuses the whole screen without the read permission', async () => {
    permissions.read = false
    renderPage()

    expect(await screen.findByText('Not permitted')).toBeTruthy()
    expect(screen.queryByRole('table')).toBeNull()
  })
})

describe('HSN / SAC belongs to Smart Books', () => {
  it('cannot be typed into, whatever is ticked', async () => {
    renderPage('/items/bulk-edit?field=hsn_sac')
    await rowsLoaded()
    await tick('Dimmy')

    expect((screen.getByLabelText('New value') as HTMLInputElement).disabled).toBe(true)
    expect((applyButton() as HTMLButtonElement).disabled).toBe(true)
    expect(screen.getByText('HSN / SAC is maintained in Smart Books')).toBeTruthy()
  })

  it('still shows what every item holds, which is the useful half', async () => {
    renderPage('/items/bulk-edit?field=hsn_sac')
    await rowsLoaded()

    expect(within(table()).getByText('Current HSN / SAC')).toBeTruthy()
    expect(within(table()).getByText('12345678')).toBeTruthy()
  })

  it('marks the ticked rows read-only rather than pretending they will update', async () => {
    renderPage('/items/bulk-edit?field=hsn_sac')
    await rowsLoaded()
    await tick('Dimmy')

    await waitFor(() => expect(within(table()).getByText('Read only')).toBeTruthy())
  })
})

describe('preview', () => {
  it('lists exactly the rows that would change, with before and after', async () => {
    renderPage()
    await rowsLoaded()
    await tick('Dimmy')
    await tick('Test Item')
    fireEvent.change(screen.getByLabelText('New value'), { target: { value: '8' } })

    fireEvent.click(screen.getByRole('button', { name: 'Preview changes' }))
    const dialog = await screen.findByRole('dialog')

    // Dimmy has no brand and would change; Test Item is already Finolex.
    expect(within(dialog).getByText('Dimmy')).toBeTruthy()
    expect(within(dialog).queryByText('Test Item')).toBeNull()
    expect(within(dialog).getByText(/already/i)).toBeTruthy()
  })

  it('says plainly when nothing would change', async () => {
    renderPage()
    await rowsLoaded()

    fireEvent.click(screen.getByRole('button', { name: 'Preview changes' }))
    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByText('Nothing would change')).toBeTruthy()
  })
})

describe('applying', () => {
  async function setUpOneChange() {
    renderPage()
    await rowsLoaded()
    await tick('Dimmy')
    fireEvent.change(screen.getByLabelText('New value'), { target: { value: '8' } })
    await waitFor(() => expect((applyButton() as HTMLButtonElement).disabled).toBe(false))
  }

  it('confirms with the same count and value the button promised', async () => {
    await setUpOneChange()
    fireEvent.click(applyButton())

    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByText('Apply changes to 1 item?')).toBeTruthy()
    expect(within(dialog).getByText('Brand')).toBeTruthy()
    expect(within(dialog).getByText('Finolex')).toBeTruthy()
    expect(within(dialog).getByRole('button', { name: 'Apply to 1 item' })).toBeTruthy()
  })

  it('writes only the rows that would change', async () => {
    await setUpOneChange()
    fireEvent.click(applyButton())
    fireEvent.click(await screen.findByRole('button', { name: 'Apply to 1 item' }))

    await waitFor(() => expect(bulkUpdate).toHaveBeenCalledWith([{ item_id: 1, brand_id: 8 }]))
  })

  it('refetches the rows and the history after a write', async () => {
    await setUpOneChange()
    const listCallsBefore = listItems.mock.calls.length
    const auditCallsBefore = auditList.mock.calls.length

    fireEvent.click(applyButton())
    fireEvent.click(await screen.findByRole('button', { name: 'Apply to 1 item' }))

    await waitFor(() => expect(listItems.mock.calls.length).toBeGreaterThan(listCallsBefore))
    expect(auditList.mock.calls.length).toBeGreaterThan(auditCallsBefore)
    expect(invalidateFormOptions).toHaveBeenCalled()
  })

  it('reports success once the server has confirmed it', async () => {
    await setUpOneChange()
    fireEvent.click(applyButton())
    fireEvent.click(await screen.findByRole('button', { name: 'Apply to 1 item' }))

    expect(await screen.findByText('Bulk update applied')).toBeTruthy()
  })

  it('keeps the dialog open and shows the reason when the write is refused', async () => {
    bulkUpdate.mockRejectedValue(new Error('The HSN / SAC is maintained in Smart Books'))
    await setUpOneChange()
    fireEvent.click(applyButton())
    fireEvent.click(await screen.findByRole('button', { name: 'Apply to 1 item' }))

    const dialog = await screen.findByRole('dialog')
    expect(await within(dialog).findByText(/maintained in Smart Books/)).toBeTruthy()
    expect(screen.queryByText('Bulk update applied')).toBeNull()
  })

  it('never calls a short write a success', async () => {
    // Two rows sent, one acknowledged.
    bulkUpdate.mockResolvedValue({ updated: 1, rows: [{ item_id: 1, changed: ['brand_id'] }] })
    renderPage()
    await rowsLoaded()
    await tick('Dimmy')
    await tick('Copper Wire')
    fireEvent.change(screen.getByLabelText('New value'), { target: { value: '8' } })
    await waitFor(() => expect((applyButton() as HTMLButtonElement).disabled).toBe(false))

    fireEvent.click(applyButton())
    fireEvent.click(await screen.findByRole('button', { name: 'Apply to 2 items' }))

    expect((await screen.findAllByText('Bulk update completed with issues')).length).toBeGreaterThan(0)
    expect(screen.getByText(/did not come back from the server/)).toBeTruthy()
  })
})

describe('templates', () => {
  it('saves the field and filters, then applies them again', async () => {
    renderPage('/items/bulk-edit?field=mrp&item_grp_id=5')
    await rowsLoaded()
    fireEvent.change(screen.getByLabelText('New value'), { target: { value: '249' } })

    fireEvent.click(screen.getByRole('button', { name: 'Save as template' }))
    const dialog = await screen.findByRole('dialog')
    fireEvent.change(within(dialog).getByLabelText('Template name'), { target: { value: 'Standard MRP' } })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save template' }))

    await waitFor(() => expect(within(dialog).getByText('Standard MRP')).toBeTruthy())

    // Change everything, then apply the template and watch it come back.
    fireEvent.click(
      within(dialog)
        .getAllByRole('button', { name: 'Close' })
        .find((b) => b.textContent === 'Close') as HTMLElement,
    )
    fireEvent.change(screen.getByLabelText('Field to update'), { target: { value: 'brand_id' } })
    await waitFor(() => expect((screen.getByLabelText('New value') as HTMLSelectElement).tagName).toBe('SELECT'))

    fireEvent.click(screen.getByRole('button', { name: 'Save as template' }))
    const reopened = await screen.findByRole('dialog')
    fireEvent.click(within(reopened).getByText('Standard MRP'))

    await waitFor(() => expect((screen.getByLabelText('New value') as HTMLInputElement).value).toBe('249'))
    expect((screen.getByLabelText('Field to update') as HTMLSelectElement).value).toBe('mrp')
  })

  it('says where templates live rather than implying they are shared', async () => {
    renderPage()
    await rowsLoaded()
    fireEvent.click(screen.getByRole('button', { name: 'Save as template' }))
    const dialog = await screen.findByRole('dialog')

    expect(within(dialog).getByText(/stored in this browser/i)).toBeTruthy()
  })
})

describe('the assistant', () => {
  it('ticks the rows with no value instead of proposing one', async () => {
    renderPage()
    await rowsLoaded()

    fireEvent.click(screen.getByRole('button', { name: /Find items missing Brand/ }))
    // Dimmy and Copper Wire have no brand; Test Item does.
    await waitFor(() => expect(applyButton().textContent).toMatch(/Apply changes to 2 items$/))
    expect((screen.getByLabelText('New value') as HTMLSelectElement).value).toBe('')
  })

  it('offers the tidied-up value without applying it on its own', async () => {
    renderPage('/items/bulk-edit?field=mrp')
    await rowsLoaded()

    fireEvent.change(screen.getByLabelText('New value'), { target: { value: '1,250' } })
    const tidy = await screen.findByRole('button', { name: /Auto-normalise MRP/ })
    expect((screen.getByLabelText('New value') as HTMLInputElement).value).toBe('1,250')

    fireEvent.click(tidy)
    await waitFor(() => expect((screen.getByLabelText('New value') as HTMLInputElement).value).toBe('1250'))
  })
})

describe('recent bulk edits', () => {
  it('reads them from the audit trail, grouped back into one operation', async () => {
    renderPage()
    await rowsLoaded()

    await waitFor(() =>
      expect(auditList.mock.calls.at(-1)?.[0]).toMatchObject({
        entity_type: 'item',
        action: 'item.bulk_update',
      }),
    )
    expect(await screen.findByText('Brand set to Havells')).toBeTruthy()
    expect(screen.getByText(/2 items ·/)).toBeTruthy()
  })

  it('opens one operation with its before and after values', async () => {
    renderPage()
    await rowsLoaded()

    fireEvent.click(await screen.findByText('Brand set to Havells'))
    const drawer = await screen.findByRole('dialog')
    expect(within(drawer).getByText('Item 1')).toBeTruthy()
    expect(within(drawer).getAllByText('Havells').length).toBeGreaterThan(0)
  })

  it('says the trail is not visible rather than showing an empty card', async () => {
    permissions.audit = false
    renderPage()
    await rowsLoaded()

    expect(screen.getByText(/your access profile does not include/)).toBeTruthy()
    expect(auditList).not.toHaveBeenCalled()
  })

  it('fails on its own — a broken trail does not stop a bulk edit', async () => {
    auditList.mockRejectedValue(new Error('audit down'))
    renderPage()
    await rowsLoaded()
    await tick('Dimmy')
    fireEvent.change(screen.getByLabelText('New value'), { target: { value: '8' } })

    expect(await screen.findByText('History unavailable')).toBeTruthy()
    await waitFor(() => expect((applyButton() as HTMLButtonElement).disabled).toBe(false))
  })
})

describe('when the items cannot be loaded', () => {
  it('offers a retry rather than an empty table', async () => {
    listItems.mockRejectedValue(new Error('network'))
    renderPage()

    expect(await screen.findByText('Couldn’t load items.')).toBeTruthy()
    listItems.mockResolvedValue({ data: ROWS, meta: { total: 3, limit: 25, offset: 0 } })
    fireEvent.click(screen.getByRole('button', { name: /Retry|Try again/ }))
    await rowsLoaded()
  })
})

describe('accessibility', () => {
  it('labels every tick box with the item it selects', async () => {
    renderPage()
    await rowsLoaded()
    for (const row of ROWS) expect(screen.getByRole('checkbox', { name: `Select ${row.item_name}` })).toBeTruthy()
  })

  it('announces the selection count for a screen reader', async () => {
    renderPage()
    await rowsLoaded()
    await tick('Dimmy')

    const live = screen.getByRole('status')
    await waitFor(() => expect(live.textContent).toMatch(/1 item selected/))
  })

  it('puts the current value and the status in words, not only in colour', async () => {
    renderPage()
    await rowsLoaded()
    await tick('Dimmy')
    fireEvent.change(screen.getByLabelText('New value'), { target: { value: '8' } })

    await waitFor(() => expect(within(table()).getByText('Will update')).toBeTruthy())
    expect(within(table()).getAllByText('Not selected')).toHaveLength(2)
  })
})

describe('the selection survives paging', () => {
  it('shows every ticked item, not just the ones on the page in front of you', async () => {
    listItems.mockResolvedValue({ data: ROWS, meta: { total: 248, limit: 25, offset: 0 } })
    renderPage()
    await rowsLoaded()
    await tick('Dimmy')

    // Page two carries entirely different items.
    listItems.mockResolvedValue({
      data: [item({ item_id: 40, item_name: 'Brass Rod' })],
      meta: { total: 248, limit: 25, offset: 25 },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Next page' }))
    await waitFor(() => expect(within(table()).getByText('Brass Rod')).toBeTruthy())
    expect(within(table()).queryByText('Dimmy')).toBeNull()

    fireEvent.click(screen.getByRole('checkbox', { name: 'Show only selected' }))
    await waitFor(() => expect(within(table()).getByText('Dimmy')).toBeTruthy())
    // And the catalogue pager is gone, because a selection is not a page of one.
    expect(screen.getByText(/Showing 1 selected item/)).toBeTruthy()
  })
})

describe('leaving with a change set up', () => {
  it('asks before discarding it', async () => {
    renderPage()
    await rowsLoaded()
    await tick('Dimmy')
    fireEvent.change(screen.getByLabelText('New value'), { target: { value: '8' } })
    await waitFor(() => expect((applyButton() as HTMLButtonElement).disabled).toBe(false))

    fireEvent.click(screen.getByRole('link', { name: /Back to items/ }))
    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByText('Leave without applying?')).toBeTruthy()
  })

  it('does not nag when nothing would be written', async () => {
    renderPage()
    await rowsLoaded()

    fireEvent.click(screen.getByRole('link', { name: /Back to items/ }))
    expect(screen.queryByText('Leave without applying?')).toBeNull()
  })
})

describe('keyboard', () => {
  it('opens the preview on Alt+P', async () => {
    renderPage()
    await rowsLoaded()

    fireEvent.keyDown(window, { key: 'p', altKey: true })
    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByText(/Preview changes/)).toBeTruthy()
  })

  it('opens the confirmation on Alt+A once a change is ready', async () => {
    renderPage()
    await rowsLoaded()
    await tick('Dimmy')
    fireEvent.change(screen.getByLabelText('New value'), { target: { value: '8' } })
    await waitFor(() => expect((applyButton() as HTMLButtonElement).disabled).toBe(false))

    fireEvent.keyDown(window, { key: 'a', altKey: true })
    expect(await screen.findByText('Apply changes to 1 item?')).toBeTruthy()
  })

  it('will not open the confirmation for a change that cannot be applied', async () => {
    renderPage()
    await rowsLoaded()

    fireEvent.keyDown(window, { key: 'a', altKey: true })
    expect(screen.queryByRole('dialog')).toBeNull()
  })
})

describe('quick tips', () => {
  it('opens on request and says the suggestions are not tax advice', async () => {
    renderPage()
    await rowsLoaded()

    fireEvent.click(screen.getByRole('button', { name: /Quick tips/ }))
    const tips = await screen.findByRole('region', { name: 'Quick tips' })
    expect(within(tips).getByText(/never propose a value for an item, and never a tax classification/i)).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'Hide quick tips' }))
    await waitFor(() => expect(screen.queryByRole('region', { name: 'Quick tips' })).toBeNull())
  })
})
