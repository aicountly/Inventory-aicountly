import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import type { Uom } from '../../../services/masters'
import type { UomSummary } from '../../../services/uomApi'

/**
 * What the screen promises, held to it.
 *
 * The cases that matter here are the ones a redesign quietly loses: the figures
 * staying server-counted rather than summed from the page, the delete refusing
 * a unit items depend on, and the permission gates still hiding what a profile
 * may not do. The rest — search, tabs, paging, sorting — is checked at the
 * seam where it can actually break, which is the query the page sends.
 */

const permissions = { read: true, write: true, delete: true, items: true }

vi.mock('../../../company/CompanyContext', () => ({
  useCompany: () => ({
    scope: { cmp_id: 1, fy_id: 3, bo_id: 0 },
    companyName: 'Acme Ltd',
    addressLines: [],
    gstin: null,
    logo: null,
  }),
}))

vi.mock('../../../company/useScopeLabel', () => ({ useScopeLabel: () => 'Acme Ltd' }))

vi.mock('../../../access/AccessContext', () => ({
  useAccess: () => ({
    loading: false,
    member: { uuid: 'u1' },
    can: (key: string) => {
      if (key === 'masters.uom.read') return permissions.read
      if (key === 'masters.uom.write') return permissions.write
      if (key === 'masters.uom.delete') return permissions.delete
      if (key === 'masters.items.read') return permissions.items
      return true
    },
  }),
  useCan: () => true,
}))

const toast = { success: vi.fn(), error: vi.fn(), info: vi.fn() }
vi.mock('../../../ui/ToastContext', () => ({ useToast: () => toast }))

const listUnits = vi.fn()
const removeUnit = vi.fn()
const updateUnit = vi.fn()
const createUnit = vi.fn()

vi.mock('../../../services/masters', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../services/masters')>()
  return {
    ...actual,
    uomApi: {
      ...actual.uomApi,
      list: (...args: unknown[]) => listUnits(...args),
      remove: (...args: unknown[]) => removeUnit(...args),
      update: (...args: unknown[]) => updateUnit(...args),
      create: (...args: unknown[]) => createUnit(...args),
    },
  }
})

const summaryFn = vi.fn()
const usageFn = vi.fn()
const uqcFn = vi.fn()

vi.mock('../../../services/uomApi', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../services/uomApi')>()
  return {
    ...actual,
    uomExtras: {
      summary: (...args: unknown[]) => summaryFn(...args),
      usage: (...args: unknown[]) => usageFn(...args),
      uqcCodes: (...args: unknown[]) => uqcFn(...args),
    },
  }
})

const { UnitsOfMeasurePage } = await import('./UnitsOfMeasurePage')

function unit(over: Partial<Uom> & { unit_id: number; unit_name: string }): Uom {
  return {
    unit_symbol: over.unit_name.slice(0, 3).toUpperCase(),
    print_name: over.unit_name,
    uqc_gst: null,
    decimal_places: 4,
    is_active: 1,
    usage_count: 0,
    updated_at: '2026-07-02 11:23:00',
    created_at: '2026-01-05 09:00:00',
    ...over,
  }
}

const ROWS: Uom[] = [
  unit({ unit_id: 1, unit_name: 'Kilogram', unit_symbol: 'KG', uqc_gst: 'KGS', usage_count: 18, uom_type: 'standard' }),
  unit({ unit_id: 2, unit_name: 'Feet', unit_symbol: 'FT', uqc_gst: 'NOS', usage_count: 4, uom_type: 'standard' }),
  unit({ unit_id: 3, unit_name: 'Widget', unit_symbol: 'WGT', uqc_gst: null, usage_count: 0, uom_type: 'custom', is_active: 0 }),
]

const SUMMARY: UomSummary = {
  total: 21,
  active: 20,
  inactive: 1,
  standard: 15,
  custom: 6,
  used_in_items: 5,
  unused: 16,
  missing_uqc: 6,
  created_last_30d: 2,
  created_prev_30d: 0,
  active_rate: 95,
  inactive_rate: 5,
  usage_rate: 24,
}

/**
 * The desktop table.
 *
 * Both renderings are in the DOM — `hidden md:block` and `md:hidden` decide
 * which is displayed, and there is no CSS here — so a row-level query has to
 * say which one it means. Page-level things (cards, tabs, dialogs) are queried
 * from `screen` as usual.
 */
const table = () => within(screen.getByRole('table'))

/**
 * Resolves once the rows have landed.
 *
 * `selector: 'strong'` picks the unit-name cell's own element: without it the
 * enclosing `<td>` matches the same text and the query is ambiguous.
 */
const loaded = () => table().findByText('Kilogram', { selector: 'strong' })
const unitCell = (name: string) => table().getByText(name, { selector: 'strong' })

function mount(path = '/masters/uom') {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <UnitsOfMeasurePage />
    </MemoryRouter>,
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  permissions.read = true
  permissions.write = true
  permissions.delete = true
  permissions.items = true
  window.sessionStorage.clear()
  listUnits.mockResolvedValue({ data: ROWS, meta: { total: 21, limit: 50, offset: 0 } })
  summaryFn.mockResolvedValue(SUMMARY)
  usageFn.mockResolvedValue({ data: [], meta: { total: 0, limit: 25, offset: 0 } })
  uqcFn.mockResolvedValue([{ code: 'KGS', label: 'Kilograms' }])
  removeUnit.mockResolvedValue(undefined)
  updateUnit.mockResolvedValue(ROWS[0])
})

describe('Units of measure', () => {
  it('renders the live rows the API returned', async () => {
    mount()
    expect(await loaded()).toBeTruthy()
    expect(unitCell('Feet')).toBeTruthy()
    expect(unitCell('Widget')).toBeTruthy()
  })

  it('takes its figures from the summary endpoint, not from the rows on screen', async () => {
    mount()
    await loaded()
    // Three rows are listed; the cards must still say what the server counted
    // over the whole master.
    const stats = screen.getByLabelText('Units of measure summary')
    expect(within(stats).getByText('21')).toBeTruthy()
    expect(within(stats).getByText('20')).toBeTruthy()
    expect(within(stats).getByText('24% in use')).toBeTruthy()
    expect(summaryFn).toHaveBeenCalled()
  })

  it('shows a real comparison when the API counted one', async () => {
    mount()
    expect(await screen.findByText('+2 in 30 days')).toBeTruthy()
  })

  it('shows no comparison at all when it counted none, rather than "+0"', async () => {
    summaryFn.mockResolvedValue({ ...SUMMARY, created_last_30d: 0 })
    mount()
    await loaded()
    expect(screen.queryByText(/in 30 days/)).toBeNull()
  })

  it('labels the tabs with the server counts', async () => {
    mount()
    await loaded()
    const tabs = screen.getByLabelText('Filter units')
    expect(within(tabs).getByText('(15)')).toBeTruthy()
    expect(within(tabs).getByText('(6)')).toBeTruthy()
  })

  it('asks the API for the filter a tab stands for', async () => {
    mount()
    await loaded()
    fireEvent.click(within(screen.getByLabelText('Filter units')).getByRole('button', { name: /Custom/ }))
    await waitFor(() => {
      expect(listUnits.mock.calls.at(-1)?.[0]).toMatchObject({ type: 'custom' })
    })
  })

  it('sends the search to the server rather than filtering the page', async () => {
    mount()
    await loaded()
    fireEvent.change(screen.getByPlaceholderText(/Search by name, symbol or print name/), {
      target: { value: 'kilo' },
    })
    await waitFor(() => {
      expect(listUnits.mock.calls.at(-1)?.[0]).toMatchObject({ q: 'kilo' })
    })
  })

  it('sorts server-side, because the list is paged', async () => {
    mount()
    await loaded()
    fireEvent.click(table().getByRole('button', { name: /Used in/ }))
    await waitFor(() => {
      expect(listUnits.mock.calls.at(-1)?.[0]).toMatchObject({ sort: 'usage_count' })
    })
  })

  it('opens the items behind a usage count', async () => {
    mount()
    await loaded()
    fireEvent.click(table().getByRole('button', { name: 'Show the 18 items using Kilogram' }))
    await waitFor(() => expect(usageFn).toHaveBeenCalledWith(1, expect.anything(), expect.anything()))
    expect(await screen.findByText(/Items using/)).toBeTruthy()
  })

  it('does not offer the drill-down to a profile that cannot read items', async () => {
    permissions.items = false
    mount()
    await loaded()
    expect(table().queryByRole('button', { name: /Show the 18 items/ })).toBeNull()
    // The count is still shown — it is unit data, not item data.
    expect(screen.getAllByText('18 items').length).toBeGreaterThan(0)
  })

  it('refuses to delete a unit that items depend on, and says what is in the way', async () => {
    mount()
    await loaded()
    fireEvent.click(table().getByRole('button', { name: 'More actions for Kilogram' }))
    fireEvent.click(await screen.findByRole('menuitem', { name: /Delete/ }))

    const dialog = within(await screen.findByRole('dialog'))
    expect(dialog.getByText(/is in use/)).toBeTruthy()
    expect(dialog.getByText('18 items')).toBeTruthy()
    expect(removeUnit).not.toHaveBeenCalled()
  })

  it('deletes a unit nothing uses, after a confirmation', async () => {
    mount()
    await loaded()
    fireEvent.click(table().getByRole('button', { name: 'More actions for Widget' }))
    fireEvent.click(await screen.findByRole('menuitem', { name: /Delete/ }))

    expect(await screen.findByText(/will be removed from every list/)).toBeTruthy()
    expect(removeUnit).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: 'Delete unit' }))
    await waitFor(() => expect(removeUnit).toHaveBeenCalledWith(3))
  })

  it('hides create, edit-as-edit and delete from a read-only profile', async () => {
    permissions.write = false
    permissions.delete = false
    mount()
    await loaded()
    expect(screen.queryByRole('button', { name: /New unit/ })).toBeNull()
    expect(table().getByRole('button', { name: 'View Kilogram' })).toBeTruthy()
  })

  it('tells a profile without read access, rather than showing an empty list', async () => {
    permissions.read = false
    mount()
    expect(await screen.findByText(/do not have permission to view units of measure/)).toBeTruthy()
    expect(listUnits).not.toHaveBeenCalled()
  })

  it('offers a way out when a search matches nothing', async () => {
    listUnits.mockResolvedValue({ data: [], meta: { total: 0, limit: 50, offset: 0 } })
    mount('/masters/uom?q=kilometre')
    expect(await screen.findByText(/No units match “kilometre”/)).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Clear filters' })).toBeTruthy()
    expect(screen.getByRole('button', { name: /Create “kilometre”/ })).toBeTruthy()
  })

  it('invites a first unit when the master is genuinely empty', async () => {
    listUnits.mockResolvedValue({ data: [], meta: { total: 0, limit: 50, offset: 0 } })
    summaryFn.mockResolvedValue({ ...SUMMARY, total: 0, active: 0, inactive: 0, standard: 0, custom: 0, used_in_items: 0 })
    mount()
    expect(await screen.findByText('Create your first unit of measure')).toBeTruthy()
  })

  it('reports a failed load with a retry instead of an empty table', async () => {
    listUnits.mockRejectedValue(new Error('Network down'))
    mount()
    expect(await screen.findByText(/We couldn’t load units of measure/)).toBeTruthy()
    expect(screen.getByRole('button', { name: /Retry/i })).toBeTruthy()
  })

  it('only fetches the GST catalogue once a form needs it', async () => {
    mount()
    await loaded()
    expect(uqcFn).not.toHaveBeenCalled()

    fireEvent.click(table().getByRole('button', { name: 'Edit Kilogram' }))
    await waitFor(() => expect(uqcFn).toHaveBeenCalled())
  })

  it('opens the edit drawer on the row that was clicked', async () => {
    mount()
    await loaded()
    fireEvent.click(table().getByRole('button', { name: 'Edit Kilogram' }))
    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByLabelText(/Unit name/).getAttribute('value')).toBe('Kilogram')
  })

  it('blocks a save that the API would reject, without a round trip', async () => {
    mount()
    await loaded()
    fireEvent.click(table().getByRole('button', { name: 'Edit Kilogram' }))
    const dialog = await screen.findByRole('dialog')
    fireEvent.change(within(dialog).getByLabelText(/Unit name/), { target: { value: '   ' } })
    fireEvent.click(within(dialog).getByRole('button', { name: /Save changes/ }))
    expect(await within(dialog).findByText('Give the unit a name.')).toBeTruthy()
    expect(updateUnit).not.toHaveBeenCalled()
  })

  it('warns before a change that rewrites what documents print', async () => {
    mount()
    await loaded()
    fireEvent.click(table().getByRole('button', { name: 'Edit Kilogram' }))
    const dialog = await screen.findByRole('dialog')
    fireEvent.change(within(dialog).getByLabelText(/^Symbol/), { target: { value: 'KGM' } })
    expect(await within(dialog).findByText(/Changing the symbol changes what every document/)).toBeTruthy()
  })

  it('keeps the export and print actions the old screen had', async () => {
    mount()
    await loaded()
    expect(screen.getByRole('button', { name: /Refresh/i })).toBeTruthy()
    expect(screen.getByRole('button', { name: /Export/i })).toBeTruthy()
  })

  it('hides the AI panel when asked, and offers it back', async () => {
    mount()
    await loaded()
    fireEvent.click(screen.getByRole('button', { name: 'Hide the AI panel' }))
    await waitFor(() => expect(screen.queryByLabelText('Aicountly AI')).toBeNull())
    expect(screen.getByRole('button', { name: /Aicountly AI/ })).toBeTruthy()
  })

  it('selects rows and deactivates them in bulk', async () => {
    mount()
    await loaded()
    fireEvent.click(table().getByRole('checkbox', { name: 'Select Kilogram' }))
    fireEvent.click(screen.getByRole('button', { name: /1 selected/ }))
    fireEvent.click(await screen.findByRole('menuitem', { name: /Deactivate 1/ }))
    await waitFor(() => expect(updateUnit).toHaveBeenCalledWith(1, { is_active: 0 }))
  })

  it('keeps a used unit out of a bulk delete instead of failing halfway', async () => {
    mount()
    await loaded()
    fireEvent.click(table().getByRole('checkbox', { name: 'Select Kilogram' }))
    fireEvent.click(table().getByRole('checkbox', { name: 'Select Widget' }))
    fireEvent.click(screen.getByRole('button', { name: /2 selected/ }))
    fireEvent.click(await screen.findByRole('menuitem', { name: /Delete 2/ }))

    expect(await screen.findByText(/Delete 1 of 2 selected units/)).toBeTruthy()
    expect(screen.getByText(/will be kept because it is used by items/)).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'Delete 1' }))
    await waitFor(() => expect(removeUnit).toHaveBeenCalledTimes(1))
    expect(removeUnit).toHaveBeenCalledWith(3)
  })
})
