import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

/**
 * The Masters landing page, end to end from the list endpoints up.
 *
 * Only the services are faked: the real `useMastersOverview`, the real health
 * model and the real cards all run, because the properties worth protecting
 * here are exactly the ones that live between them — that a count comes from
 * `meta.total`, that a master nobody may read is neither shown nor scored, and
 * that a figure the API could not supply renders as an em dash instead of a
 * confident zero.
 */

const h = vi.hoisted(() => {
  const state = {
    /** null = every permission. */
    permissions: null as Set<string> | null,
    stats: {} as Record<string, { total: number; updated_at?: string | null } | 'fail'>,
    auditRows: [] as Record<string, unknown>[],
  }

  const fakeApi = (key: string) => ({
    list: async () => {
      const entry = state.stats[key]
      if (entry === 'fail') throw new Error(`${key} is down`)
      if (!entry) return { data: [], meta: { total: 0, limit: 1, offset: 0 } }
      return {
        data: entry.updated_at === undefined ? [] : [{ updated_at: entry.updated_at }],
        meta: { total: entry.total, limit: 1, offset: 0 },
      }
    },
  })

  return { state, fakeApi }
})

vi.mock('../../company/CompanyContext', () => ({
  useCompany: () => ({ scope: { cmp_id: 1, fy_id: 3, bo_id: 0 }, companyName: 'Demo Company' }),
}))

vi.mock('../../access/AccessContext', () => ({
  useAccess: () => ({
    can: (key: string | readonly string[]) => {
      if (h.state.permissions === null) return true
      const keys = typeof key === 'string' ? [key] : key
      return keys.some((k) => h.state.permissions!.has(k))
    },
    loading: false,
    profile: { profile_name: 'Storekeeper' },
  }),
}))

vi.mock('../../services/masters', () => ({
  itemGroupsApi: h.fakeApi('item-groups'),
  stockCategoriesApi: h.fakeApi('stock-categories'),
  brandsApi: h.fakeApi('brands'),
  uomApi: h.fakeApi('uom'),
  warehouseGroupsApi: h.fakeApi('warehouse-groups'),
  warehousesApi: h.fakeApi('warehouses'),
  locationsApi: h.fakeApi('locations'),
  bomApi: h.fakeApi('bill-of-materials'),
  batchesApi: h.fakeApi('batches'),
  serialsApi: h.fakeApi('serials'),
}))

vi.mock('../../services/items', () => ({ itemsApi: h.fakeApi('items') }))

vi.mock('../../services/auditApi', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../services/auditApi')>()),
  auditApi: { list: async () => ({ data: h.state.auditRows, meta: { total: h.state.auditRows.length, limit: 20, offset: 0 } }) },
}))

const { MastersIndex } = await import('./MastersIndex')
const { MASTER_DEFINITIONS } = await import('./masterDefinitions')

const DAY = 24 * 60 * 60 * 1000
const daysAgo = (n: number) => new Date(Date.now() - n * DAY).toISOString()

/** Every master populated, so the default render is the healthy case. */
function populateAll() {
  h.state.stats = Object.fromEntries(
    MASTER_DEFINITIONS.map((m) => [m.key, { total: 4, updated_at: daysAgo(2) }]),
  )
}

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/masters']}>
      <MastersIndex />
    </MemoryRouter>,
  )
}

const grid = () => screen.getByRole('region', { name: 'Inventory master types' })
const card = (title: string) =>
  within(grid())
    .getByRole('heading', { name: title })
    .closest('article') as HTMLElement

beforeEach(() => {
  h.state.permissions = null
  h.state.stats = {}
  h.state.auditRows = []
  try {
    window.sessionStorage.clear()
  } catch {
    /* not available in this environment */
  }
})

describe('MastersIndex', () => {
  it('introduces the page with the company the masters are scoped to', () => {
    renderPage()
    expect(screen.getByRole('heading', { level: 1, name: 'Masters' })).toBeTruthy()
    expect(screen.getByText(/Reference data for/).textContent).toContain('Demo Company')
  })

  it('shows every master, and counts the master types rather than hardcoding them', async () => {
    populateAll()
    renderPage()
    await waitFor(() => expect(within(card('Brands')).getByText('4')).toBeTruthy())

    expect(within(grid()).getAllByRole('heading')).toHaveLength(MASTER_DEFINITIONS.length)
    for (const master of MASTER_DEFINITIONS) {
      expect(within(grid()).getByRole('heading', { name: master.title })).toBeTruthy()
    }
    const summary = screen.getByRole('region', { name: 'Master summary' })
    expect(within(summary).getByText('Master Types').previousSibling?.textContent).toBe(
      String(MASTER_DEFINITIONS.length),
    )
  })

  it('puts the record count and the real last-changed stamp on each card', async () => {
    h.state.stats = {
      items: { total: 1284, updated_at: daysAgo(2) },
      brands: { total: 118, updated_at: daysAgo(5) },
    }
    renderPage()

    await waitFor(() => expect(within(card('Items')).getByText('1,284')).toBeTruthy())
    expect(within(card('Items')).getByText('Updated 2 days ago')).toBeTruthy()
    expect(within(card('Brands')).getByText('118')).toBeTruthy()
    expect(within(card('Brands')).getByText('Updated 5 days ago')).toBeTruthy()
    // Nothing configured is said plainly, not dressed up as a date.
    expect(within(card('Locations')).getByText('No records yet')).toBeTruthy()
  })

  it('opens each card on the route that master already had', async () => {
    populateAll()
    renderPage()
    await waitFor(() => expect(within(card('Items')).getByText('4')).toBeTruthy())
    for (const master of MASTER_DEFINITIONS) {
      const open = within(card(master.title)).getByRole('link', { name: `Open ${master.title}` })
      expect(open.getAttribute('href'), master.key).toBe(master.route)
    }
  })

  it('scores health from the live counts and only then calls the data good', async () => {
    populateAll()
    renderPage()

    const panel = screen.getByRole('complementary', { name: 'Master insights' })
    await waitFor(() => expect(within(panel).getByText('100%')).toBeTruthy())
    expect(within(panel).getByText('Healthy')).toBeTruthy()
    expect(within(panel).getByText('Great! Your master data is in good shape.')).toBeTruthy()
  })

  it('will not call the data good while an essential master is empty', async () => {
    populateAll()
    h.state.stats.uom = { total: 0, updated_at: null }
    renderPage()

    const panel = screen.getByRole('complementary', { name: 'Master insights' })
    await waitFor(() => expect(within(panel).getByText('Missing setup')).toBeTruthy())
    expect(within(panel).queryByText('Great! Your master data is in good shape.')).toBeNull()
    expect(within(panel).getByText('1 essential master has no records yet.')).toBeTruthy()
  })

  it('neither shows nor scores a master the profile cannot read', async () => {
    populateAll()
    h.state.permissions = new Set(
      MASTER_DEFINITIONS.filter((m) => m.key !== 'brands').map((m) => `masters.${m.permissionSlug}.read`),
    )
    renderPage()

    await waitFor(() => expect(within(card('Items')).getByText('4')).toBeTruthy())
    expect(within(grid()).queryByRole('heading', { name: 'Brands' })).toBeNull()
    expect(within(grid()).getAllByRole('heading')).toHaveLength(MASTER_DEFINITIONS.length - 1)
  })

  it('says a figure is unavailable instead of printing a zero it did not get', async () => {
    populateAll()
    h.state.stats.batches = 'fail'
    renderPage()

    await waitFor(() => expect(within(card('Batches')).getByText('Record count unavailable')).toBeTruthy())
    // No count pill at all, rather than a 0 the API never returned.
    expect(within(card('Batches')).queryByText('0')).toBeNull()
  })

  it('offers Quick Create only for masters the profile may write, on their existing create routes', async () => {
    h.state.permissions = new Set([
      ...MASTER_DEFINITIONS.map((m) => `masters.${m.permissionSlug}.read`),
      'masters.items.write',
      'masters.brands.write',
    ])
    renderPage()

    fireEvent.click(screen.getByRole('button', { name: /Quick Create/ }))
    const menu = screen.getByRole('menu', { name: 'Create a new master' })
    const entries = within(menu).getAllByRole('menuitem')
    expect(entries.map((e) => e.textContent)).toEqual(['Items', 'Brands'])
    expect(entries[0].getAttribute('href')).toBe('/items/new')
    expect(entries[1].getAttribute('href')).toBe('/masters/brands?new=1')
  })

  it('still opens Quick Create for a profile that may write nothing, and explains why it is empty', () => {
    h.state.permissions = new Set(MASTER_DEFINITIONS.map((m) => `masters.${m.permissionSlug}.read`))
    renderPage()

    fireEvent.click(screen.getByRole('button', { name: /Quick Create/ }))
    expect(screen.getByRole('note').textContent).toContain('Storekeeper')
  })

  it('lists recent master changes from the audit trail and links on to it', async () => {
    h.state.auditRows = [
      { audit_id: 1, entity_type: 'brand', entity_id: 4, action: 'brand.update', after: { brand_name: 'Acme Electronics' }, created_at: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString() },
      { audit_id: 2, entity_type: 'item', entity_id: 9, action: 'item.create', after: { item_name: 'Wireless Mouse' }, created_at: new Date(Date.now() - 6 * 60 * 60 * 1000).toISOString() },
    ]
    renderPage()

    const panel = screen.getByRole('complementary', { name: 'Master insights' })
    await waitFor(() => expect(within(panel).getByText('Acme Electronics')).toBeTruthy())
    expect(within(panel).getByText('Brand updated')).toBeTruthy()
    expect(within(panel).getByText('2 hours ago')).toBeTruthy()
    expect(within(panel).getByText('Wireless Mouse')).toBeTruthy()
    expect(within(panel).getByRole('link', { name: /View all/ }).getAttribute('href')).toBe('/audit')
  })

  it('distinguishes an audit trail with nothing in it from one you may not read', async () => {
    renderPage()
    const panel = screen.getByRole('complementary', { name: 'Master insights' })
    await waitFor(() => expect(within(panel).getByText('No recent master activity.')).toBeTruthy())
  })

  it('explains, rather than empties, when the profile cannot read the audit trail', () => {
    h.state.permissions = new Set(MASTER_DEFINITIONS.map((m) => `masters.${m.permissionSlug}.read`))
    renderPage()

    const panel = screen.getByRole('complementary', { name: 'Master insights' })
    expect(within(panel).getByText(/cannot read the audit trail/)).toBeTruthy()
    expect(within(panel).queryByRole('link', { name: /View all/ })).toBeNull()
  })

  it('draws the category tabs exactly once — MastersLayout defers to this screen', () => {
    renderPage()
    expect(screen.getAllByRole('navigation', { name: 'Inventory masters' })).toHaveLength(1)
  })

  it('dismisses the pro tip for the session', () => {
    renderPage()
    expect(screen.getByText('Pro tip')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss tip' }))
    expect(screen.queryByText('Pro tip')).toBeNull()
  })
})
