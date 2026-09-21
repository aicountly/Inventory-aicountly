import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import type { Brand, BrandMetrics } from '../../../services/masters'
import type { BrandSales } from '../../../services/brandAnalyticsApi'

/**
 * The Brands workspace, from the endpoints up.
 *
 * Only the services are faked. The real toolbar, the real table, the real
 * insight model and the real empty states all run, because the properties worth
 * protecting live between them:
 *
 *  - a filter reaches the API as a parameter, not as a browser-side slice;
 *  - "no brands" and "no matches" are different screens;
 *  - analytics failing does not take the list down with it;
 *  - nothing invents a revenue figure when Books is not connected;
 *  - an action the profile may not take is not on the screen at all.
 */

const h = vi.hoisted(() => {
  const state = {
    permissions: null as Set<string> | null,
    accessLoading: false,
    rows: [] as Brand[],
    total: 0,
    listError: null as Error | null,
    metrics: null as BrandMetrics | null,
    metricsError: null as Error | null,
    sales: null as BrandSales | null,
    listCalls: [] as Record<string, unknown>[],
    created: [] as Record<string, unknown>[],
    removeError: null as Error | null,
    toasts: [] as string[],
  }
  return { state }
})

vi.mock('../../../company/CompanyContext', () => ({
  useCompany: () => ({
    scope: { cmp_id: 1, fy_id: 3, bo_id: 0 },
    companyName: 'Acme Ltd',
    fyRange: { from: '2026-04-01', to: '2027-03-31' },
    addressLines: [],
    gstin: '',
    logo: null,
  }),
}))

vi.mock('../../../company/useScopeLabel', () => ({ useScopeLabel: () => 'Acme Ltd' }))

vi.mock('../../../access/AccessContext', () => ({
  useAccess: () => ({
    can: (key: string | readonly string[]) => {
      if (h.state.permissions === null) return true
      const keys = typeof key === 'string' ? [key] : key
      return keys.some((k) => h.state.permissions!.has(k))
    },
    loading: h.state.accessLoading,
  }),
  useCan: () => true,
}))

vi.mock('../../../ui/ToastContext', () => ({
  useToast: () => ({
    success: (m: string) => h.state.toasts.push(`success:${m}`),
    error: (m: string) => h.state.toasts.push(`error:${m}`),
    info: (m: string) => h.state.toasts.push(`info:${m}`),
  }),
}))

vi.mock('../../../services/masters', () => ({
  brandsApi: {
    list: async (query: Record<string, unknown>) => {
      h.state.listCalls.push(query)
      if (h.state.listError) throw h.state.listError
      return {
        data: h.state.rows,
        meta: { total: h.state.total, limit: Number(query.limit ?? 50), offset: 0 },
      }
    },
    metrics: async () => {
      if (h.state.metricsError) throw h.state.metricsError
      return h.state.metrics as BrandMetrics
    },
    create: async (body: Record<string, unknown>) => {
      h.state.created.push(body)
      return { ...body, brand_id: 99 } as unknown as Brand
    },
    update: async () => h.state.rows[0],
    remove: async () => {
      if (h.state.removeError) throw h.state.removeError
    },
    setActive: async () => h.state.rows[0],
  },
}))

vi.mock('../../../services/brandAnalyticsApi', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../services/brandAnalyticsApi')>()),
  fetchBrandSales: async () => h.state.sales as BrandSales,
}))

vi.mock('../../../services/auditApi', () => ({
  auditApi: { entity: async () => ({ data: [], meta: { total: 0, limit: 8, offset: 0 } }) },
}))

const { BrandsPage } = await import('./BrandsPage')

const NOT_CONNECTED: BrandSales = {
  available: false,
  reason: 'not_configured',
  currency: null,
  rows: [],
}

const METRICS: BrandMetrics = {
  total: 24,
  active: 22,
  inactive: 2,
  new_this_month: 3,
  new_prev_month: 1,
  without_items: 4,
  with_items: 20,
  top_by_items: { brand_id: 7, brand_name: 'Apple', item_count: 12 },
  as_of: '2026-09-18T09:00:00Z',
}

function brand(over: Partial<Brand> & Pick<Brand, 'brand_id' | 'brand_name'>): Brand {
  return {
    brand_alias: null,
    brand_code: null,
    description: null,
    is_active: 1,
    item_count: 0,
    created_at: '2026-01-12 10:30:00',
    updated_at: '2026-02-01 09:00:00',
    created_by: '7',
    updated_by: '7',
    ...over,
  }
}

const ROWS: Brand[] = [
  brand({ brand_id: 7, brand_name: 'Apple', brand_alias: 'APPLE', item_count: 12 }),
  brand({ brand_id: 9, brand_name: 'Canon', brand_alias: 'CANON', item_count: 8 }),
  brand({ brand_id: 11, brand_name: 'LG', is_active: 0, item_count: 0 }),
]

function renderPage(entry = '/masters/brands') {
  return render(
    <MemoryRouter initialEntries={[entry]}>
      <BrandsPage />
    </MemoryRouter>,
  )
}

const lastListCall = () => h.state.listCalls[h.state.listCalls.length - 1]

beforeEach(() => {
  h.state.permissions = null
  h.state.accessLoading = false
  h.state.rows = ROWS
  h.state.total = ROWS.length
  h.state.listError = null
  h.state.metrics = METRICS
  h.state.metricsError = null
  h.state.sales = NOT_CONNECTED
  h.state.listCalls = []
  h.state.created = []
  h.state.removeError = null
  h.state.toasts = []
  try {
    window.localStorage.clear()
    window.sessionStorage.clear()
  } catch {
    /* storage unavailable in this environment */
  }
})

describe('the list', () => {
  it('renders the rows the API returned', async () => {
    renderPage()
    expect(await screen.findByRole('button', { name: 'Apple' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Canon' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'LG' })).toBeTruthy()
  })

  it('links the item count to the items list filtered by that brand', async () => {
    renderPage()
    const link = await screen.findByRole('link', { name: /View the 12 items filed under Apple/i })
    expect(link.getAttribute('href')).toBe('/items?brand_id=7')
  })

  it('shows a brand with no items as a plain zero, not a link to an empty list', async () => {
    renderPage()
    await screen.findByRole('button', { name: 'LG' })
    expect(screen.queryByRole('link', { name: /filed under LG/i })).toBeNull()
  })

  it('marks the inactive brand as inactive', async () => {
    renderPage()
    await screen.findByRole('button', { name: 'LG' })
    const row = screen.getByRole('button', { name: 'LG' }).closest('tr') as HTMLElement
    expect(within(row).getByText('Inactive')).toBeTruthy()
  })
})

describe('the figures above the list', () => {
  it('states what the metrics endpoint counted, over the whole company', async () => {
    renderPage()
    const summary = await screen.findByRole('region', { name: 'Brand summary' })
    expect(within(summary).getByText('24')).toBeTruthy()
    expect(within(summary).getByText('22')).toBeTruthy()
    expect(within(summary).getByText('Apple')).toBeTruthy()
  })

  it('calls the largest brand by items exactly that while Sales is not connected', async () => {
    renderPage()
    const summary = await screen.findByRole('region', { name: 'Brand summary' })
    expect(within(summary).getByText('Largest brand')).toBeTruthy()
    expect(within(summary).queryByText('Top selling brand')).toBeNull()
  })

  it('calls it the top selling brand once Books answers with revenue', async () => {
    h.state.sales = {
      available: true,
      reason: null,
      currency: 'INR',
      rows: [{ brand_id: 9, sales: 1_245_670, trend: null }],
    }
    renderPage()
    const summary = await screen.findByRole('region', { name: 'Brand summary' })
    await waitFor(() => expect(within(summary).getByText('Top selling brand')).toBeTruthy())
    expect(within(summary).getByText('Canon')).toBeTruthy()
  })

  it('keeps the list working when only the analytics fail', async () => {
    h.state.metricsError = new Error('metrics are down')
    renderPage()
    expect(await screen.findByRole('button', { name: 'Apple' })).toBeTruthy()
    expect(screen.getByText(/analytics are temporarily unavailable/i)).toBeTruthy()
    expect(screen.queryByRole('region', { name: 'Brand summary' })).toBeNull()
  })
})

describe('revenue', () => {
  it('draws no Sales column at all when nothing is connected', async () => {
    renderPage()
    await screen.findByRole('button', { name: 'Apple' })
    expect(screen.queryByRole('columnheader', { name: /Sales/i })).toBeNull()
  })

  it('draws it, and the figures, once Books answers', async () => {
    h.state.sales = {
      available: true,
      reason: null,
      currency: 'INR',
      rows: [{ brand_id: 7, sales: 1_245_670, trend: null }],
    }
    renderPage()
    await waitFor(() => expect(screen.getByRole('columnheader', { name: /Sales \(FY\)/i })).toBeTruthy())
    expect(screen.getByText(/12,45,670/)).toBeTruthy()
  })

  it('leaves a brand Sales did not report as a dash, never as zero', async () => {
    h.state.sales = {
      available: true,
      reason: null,
      currency: 'INR',
      rows: [{ brand_id: 7, sales: 1_245_670, trend: null }],
    }
    renderPage()
    await waitFor(() => expect(screen.getByRole('columnheader', { name: /Sales \(FY\)/i })).toBeTruthy())
    const canonRow = screen.getByRole('button', { name: 'Canon' }).closest('tr') as HTMLElement
    expect(within(canonRow).queryByText(/₹\s*0\.00/)).toBeNull()
    expect(within(canonRow).getAllByText('—').length).toBeGreaterThan(0)
  })

  it('draws the column, empty, when the service is configured but down', async () => {
    h.state.sales = { available: false, reason: 'unavailable', currency: null, rows: [] }
    renderPage()
    await waitFor(() => expect(screen.getByRole('columnheader', { name: /Sales \(FY\)/i })).toBeTruthy())
    expect(screen.getAllByText(/temporarily unavailable/i).length).toBeGreaterThan(0)
  })
})

describe('filters', () => {
  it('sends the status filter to the API rather than slicing in the browser', async () => {
    renderPage()
    await screen.findByRole('button', { name: 'Apple' })
    fireEvent.change(screen.getByLabelText('Filter brands by status'), { target: { value: 'inactive' } })
    await waitFor(() => expect(lastListCall()?.status).toBe('inactive'))
  })

  it('resolves a period preset to real dates before it reaches the API', async () => {
    renderPage()
    await screen.findByRole('button', { name: 'Apple' })
    fireEvent.change(screen.getByLabelText('Filter brands by when they were created'), {
      target: { value: 'fy' },
    })
    await waitFor(() => expect(lastListCall()?.created_from).toBe('2026-04-01'))
    expect(lastListCall()?.created_to).toBe('2027-03-31')
  })

  it('debounces the search into one request', async () => {
    renderPage()
    await screen.findByRole('button', { name: 'Apple' })
    const before = h.state.listCalls.length
    const box = screen.getByRole('searchbox', { name: /Search brands/i })
    fireEvent.change(box, { target: { value: 'a' } })
    fireEvent.change(box, { target: { value: 'ap' } })
    fireEvent.change(box, { target: { value: 'app' } })
    await waitFor(() => expect(lastListCall()?.q).toBe('app'))
    // Three keystrokes, one extra request — not three.
    expect(h.state.listCalls.length).toBe(before + 1)
  })

  it('shows a removable chip for a filter that is narrowing the list', async () => {
    renderPage('/masters/brands?status=active')
    await screen.findByRole('button', { name: 'Apple' })
    // Scoped to the chip strip: "Active only" is also an <option> in the
    // status select, and a bare getByText would match both.
    const chips = screen.getByLabelText('Active filters')
    expect(within(chips).getByText('Active only')).toBeTruthy()
    fireEvent.click(within(chips).getByRole('button', { name: 'Remove filter: Active only' }))
    await waitFor(() => expect(lastListCall()?.status).toBeUndefined())
  })

  it('sends the chosen order to the API as sort and order', async () => {
    renderPage()
    await screen.findByRole('button', { name: 'Apple' })
    fireEvent.change(screen.getByLabelText('Sort brands'), { target: { value: 'items_desc' } })
    await waitFor(() => expect(lastListCall()?.sort).toBe('item_count'))
    expect(lastListCall()?.order).toBe('desc')
  })

  it('sorts from a column header too, and flips on a second click', async () => {
    renderPage()
    await screen.findByRole('button', { name: 'Apple' })
    const header = screen.getByRole('button', { name: /^Brand/ })
    fireEvent.click(header)
    await waitFor(() => expect(lastListCall()?.order).toBe('desc'))
    expect(lastListCall()?.sort).toBe('brand_name')
  })

  it('offers no revenue order, because the API could not honour one', async () => {
    renderPage()
    await screen.findByRole('button', { name: 'Apple' })
    const sort = screen.getByLabelText('Sort brands') as HTMLSelectElement
    const labels = Array.from(sort.options).map((o) => o.textContent ?? '')
    expect(labels.some((l) => /sales|revenue/i.test(l))).toBe(false)
    expect(labels).toContain('Most items')
  })
})

describe('the empty screens, which are not the same screen', () => {
  it('invites the first brand when the company has none and nothing is filtered', async () => {
    h.state.rows = []
    h.state.total = 0
    renderPage()
    expect(await screen.findByText('No brands yet')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Create brand' })).toBeTruthy()
  })

  it('offers the way out when filters matched nothing', async () => {
    h.state.rows = []
    h.state.total = 0
    renderPage('/masters/brands?status=inactive')
    expect(await screen.findByText('No brands match your filters')).toBeTruthy()
    expect(screen.queryByText('No brands yet')).toBeNull()
    expect(screen.getByRole('button', { name: 'Clear filters' })).toBeTruthy()
  })

  it('quotes the search back so the reader knows what was looked for', async () => {
    h.state.rows = []
    h.state.total = 0
    renderPage('/masters/brands?q=zzz')
    expect(await screen.findByText(/Nothing here is called/)).toBeTruthy()
  })

  it('reports a failed list as a failure, with a way to try again', async () => {
    h.state.listError = new Error('Could not reach the Inventory API.')
    renderPage()
    expect(await screen.findByText('Unable to load brands')).toBeTruthy()
    expect(screen.getByRole('button', { name: /Retry/i })).toBeTruthy()
  })
})

describe('permissions', () => {
  it('refuses the screen without the read permission', async () => {
    h.state.permissions = new Set()
    renderPage()
    expect(
      await screen.findByText(/do not have permission to view brands/i),
    ).toBeTruthy()
  })

  it('hides create and import from a read-only profile', async () => {
    h.state.permissions = new Set(['masters.brands.read'])
    renderPage()
    await screen.findByRole('button', { name: 'Apple' })
    expect(screen.queryByRole('button', { name: /New brand/i })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Import' })).toBeNull()
  })

  it('hides delete from a profile that may write but not delete', async () => {
    h.state.permissions = new Set(['masters.brands.read', 'masters.brands.write'])
    renderPage()
    await screen.findByRole('button', { name: 'Apple' })
    fireEvent.click(screen.getByRole('button', { name: 'More actions for Apple' }))
    expect(await screen.findByRole('menuitem', { name: 'Edit brand' })).toBeTruthy()
    expect(screen.queryByRole('menuitem', { name: 'Delete brand' })).toBeNull()
  })
})

describe('creating', () => {
  it('opens the form from the header button', async () => {
    renderPage()
    await screen.findByRole('button', { name: 'Apple' })
    fireEvent.click(screen.getByRole('button', { name: /New brand/i }))
    expect(await screen.findByRole('dialog', { name: 'New brand' })).toBeTruthy()
  })

  it('opens the form on arrival for ?new=1, and consumes the flag', async () => {
    renderPage('/masters/brands?new=1')
    expect(await screen.findByRole('dialog', { name: 'New brand' })).toBeTruthy()
    // Consumed: the list request carried no `new` parameter into the API either.
    expect(lastListCall()?.new).toBeUndefined()
  })

  it('will not submit without a name', async () => {
    renderPage()
    await screen.findByRole('button', { name: 'Apple' })
    fireEvent.click(screen.getByRole('button', { name: /New brand/i }))
    const dialog = await screen.findByRole('dialog', { name: 'New brand' })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save brand' }))
    expect(await within(dialog).findByText('Brand name is required')).toBeTruthy()
    expect(h.state.created).toHaveLength(0)
  })

  it('trims the name and sends blank optional fields as null', async () => {
    renderPage()
    await screen.findByRole('button', { name: 'Apple' })
    fireEvent.click(screen.getByRole('button', { name: /New brand/i }))
    const dialog = await screen.findByRole('dialog', { name: 'New brand' })
    fireEvent.change(within(dialog).getByLabelText(/Brand name/i), { target: { value: '  Sony  ' } })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save brand' }))
    await waitFor(() => expect(h.state.created).toHaveLength(1))
    expect(h.state.created[0]).toEqual({
      brand_name: 'Sony',
      brand_alias: null,
      brand_code: null,
      description: null,
      is_active: 1,
    })
  })
})

describe('deleting', () => {
  it('asks first, and repeats the API refusal word for word', async () => {
    h.state.removeError = new Error('Brand is used by 14 item(s) and cannot be deleted')
    renderPage()
    await screen.findByRole('button', { name: 'Apple' })
    fireEvent.click(screen.getByRole('button', { name: 'More actions for Apple' }))
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Delete brand' }))

    const dialog = await screen.findByRole('dialog', { name: /Delete brand\?/i })
    expect(within(dialog).getByText('Apple')).toBeTruthy()
    fireEvent.click(within(dialog).getByRole('button', { name: 'Delete' }))
    expect(await screen.findByText(/used by 14 item\(s\)/)).toBeTruthy()
  })
})

describe('selection', () => {
  it('offers bulk actions once rows are ticked, and lets go of them again', async () => {
    renderPage()
    await screen.findByRole('button', { name: 'Apple' })
    fireEvent.click(screen.getByRole('checkbox', { name: 'Select Apple' }))

    const bar = await screen.findByRole('region', { name: 'Bulk actions' })
    expect(within(bar).getByText('1 selected')).toBeTruthy()

    fireEvent.click(within(bar).getByRole('button', { name: /Clear selection/i }))
    await waitFor(() => expect(screen.queryByRole('region', { name: 'Bulk actions' })).toBeNull())
  })

  it('exports exactly the ticked rows, through the app CSV writer', async () => {
    const written: string[] = []
    const createObjectURL = vi
      .spyOn(URL, 'createObjectURL')
      .mockImplementation((obj: Blob | MediaSource) => {
        void (obj as Blob).text().then((t) => written.push(t))
        return 'blob:brands'
      })
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})

    renderPage()
    await screen.findByRole('button', { name: 'Apple' })
    fireEvent.click(screen.getByRole('checkbox', { name: 'Select Apple' }))
    const bar = await screen.findByRole('region', { name: 'Bulk actions' })
    fireEvent.click(within(bar).getByRole('button', { name: /Export selected/i }))

    await waitFor(() => expect(h.state.toasts).toContain('success:1 brand exported'))
    expect(createObjectURL).toHaveBeenCalled()
    await waitFor(() => expect(written.length).toBe(1))
    expect(written[0]).toContain('Apple')
    expect(written[0]).not.toContain('Canon')
    createObjectURL.mockRestore()
  })

  it('selects every row on the page from the header box', async () => {
    renderPage()
    await screen.findByRole('button', { name: 'Apple' })
    fireEvent.click(screen.getByRole('checkbox', { name: /Select all brands on this page/i }))
    const bar = await screen.findByRole('region', { name: 'Bulk actions' })
    expect(within(bar).getByText('3 selected')).toBeTruthy()
  })
})

describe('columns', () => {
  it('remembers a hidden column for the next visit', async () => {
    const { unmount } = renderPage()
    await screen.findByRole('button', { name: 'Apple' })
    expect(screen.getByRole('columnheader', { name: /Alias/i })).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'Choose columns' }))
    fireEvent.click(await screen.findByRole('menuitem', { name: /Alias/ }))
    await waitFor(() => expect(screen.queryByRole('columnheader', { name: /Alias/i })).toBeNull())

    unmount()
    renderPage()
    await screen.findByRole('button', { name: 'Apple' })
    expect(screen.queryByRole('columnheader', { name: /Alias/i })).toBeNull()
  })

  it('never offers to hide the brand itself', async () => {
    renderPage()
    await screen.findByRole('button', { name: 'Apple' })
    fireEvent.click(screen.getByRole('button', { name: 'Choose columns' }))
    const menu = await screen.findByRole('menu')
    expect(within(menu).queryByRole('menuitem', { name: /^\s*(✓\s*)?Brand\s*$/ })).toBeNull()
  })
})

describe('the insights rail', () => {
  it('states only what the metrics support', async () => {
    renderPage()
    expect(await screen.findByText('3 brands added this month')).toBeTruthy()
    expect(screen.getByText('That is 200% more than last month.')).toBeTruthy()
    expect(screen.getByText('4 brands have no items')).toBeTruthy()
  })

  it('says plainly that free-text answering is not connected', async () => {
    renderPage()
    await screen.findByRole('button', { name: 'Apple' })
    const box = screen.getByLabelText('Ask the assistant a question') as HTMLInputElement
    expect(box.disabled).toBe(true)
    expect(screen.getByText(/once the Aicountly assistant service is connected/i)).toBeTruthy()
  })

  it('turns a suggestion into a real filter rather than an answer', async () => {
    renderPage()
    await screen.findByRole('button', { name: 'Apple' })
    fireEvent.click(screen.getByRole('button', { name: 'Which brands have no items?' }))
    await waitFor(() => expect(lastListCall()?.has_items).toBe('0'))
  })
})
