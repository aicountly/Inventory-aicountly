import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, useLocation } from 'react-router-dom'
import type { CrudApi } from '../services/masters'
import type { MasterConfig } from './types'

/**
 * `?new=1` — the link the Masters landing page's Quick Create menu hands out.
 *
 * Most masters create through MasterPage's modal, which no URL could reach, so
 * a "Create a new master" menu had nothing to link to. These tests hold the
 * three properties that make the deep link safe: it opens the form, it is
 * consumed on arrival so it cannot reopen behind the user's back, and it is
 * still subject to the write permission the server enforces anyway.
 */

const h = vi.hoisted(() => ({ permissions: new Set<string>(), accessLoading: false }))

vi.mock('../company/CompanyContext', () => ({
  useCompany: () => ({ scope: { cmp_id: 1, fy_id: 3, bo_id: 0 }, companyName: 'Acme Ltd' }),
}))

vi.mock('../company/useScopeLabel', () => ({ useScopeLabel: () => 'Acme Ltd' }))

vi.mock('../access/AccessContext', () => ({
  useAccess: () => ({
    can: (key: string | readonly string[]) =>
      (typeof key === 'string' ? [key] : key).some((k) => h.permissions.has(k)),
    loading: h.accessLoading,
  }),
  useCan: () => true,
}))

vi.mock('../ui/ToastContext', () => ({
  useToast: () => ({ success: vi.fn(), error: vi.fn(), info: vi.fn() }),
}))

vi.mock('../hooks/useFormOptions', () => ({
  useFormOptions: () => ({ options: null, loading: false, error: null, reload: vi.fn() }),
  invalidateFormOptions: vi.fn(),
}))

const { MasterPage } = await import('./MasterPage')

interface Warehouse {
  warehouse_id: number
  warehouse_name: string
  is_active: number
}

const ROWS: Warehouse[] = [{ warehouse_id: 1, warehouse_name: 'Main Warehouse', is_active: 1 }]

const api: CrudApi<Warehouse> = {
  list: async () => ({ data: ROWS, meta: { total: ROWS.length, limit: 50, offset: 0 } }),
  get: async () => ROWS[0],
  create: async () => ROWS[0],
  update: async () => ROWS[0],
  remove: async () => {},
}

const config: MasterConfig<Warehouse> = {
  slug: 'warehouses',
  permissionSlug: 'warehouses',
  title: 'Warehouses',
  singular: 'Warehouse',
  idKey: 'warehouse_id',
  nameOf: (r) => r.warehouse_name,
  api,
  defaultSort: 'warehouse_name',
  needsFormOptions: false,
  columns: [{ key: 'warehouse_name', header: 'Warehouse' }],
  fields: [{ name: 'warehouse_name', label: 'Name', type: 'text', required: true }],
}

function LocationProbe() {
  const location = useLocation()
  return <output data-testid="search">{location.search}</output>
}

function renderPage(url: string) {
  return render(
    <MemoryRouter initialEntries={[url]}>
      <MasterPage config={config} />
      <LocationProbe />
    </MemoryRouter>,
  )
}

const search = () => screen.getByTestId('search').textContent ?? ''
const createForm = () => screen.queryByRole('dialog', { name: 'New warehouse' })

beforeEach(() => {
  h.permissions = new Set(['masters.warehouses.read', 'masters.warehouses.write'])
  h.accessLoading = false
})

describe('MasterPage ?new=1', () => {
  it('opens the create form on arrival', async () => {
    renderPage('/masters/warehouses?new=1')
    await waitFor(() => expect(createForm()).toBeTruthy())
  })

  it('consumes the flag, so closing the form does not reopen it', async () => {
    renderPage('/masters/warehouses?new=1')
    await waitFor(() => expect(createForm()).toBeTruthy())
    await waitFor(() => expect(search()).not.toContain('new=1'))

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    await waitFor(() => expect(createForm()).toBeNull())
    // Still shut a tick later: nothing re-reads the flag.
    await waitFor(() => expect(search()).not.toContain('new=1'))
    expect(createForm()).toBeNull()
  })

  it('keeps the rest of the query string intact', async () => {
    renderPage('/masters/warehouses?status=active&new=1')
    await waitFor(() => expect(search()).not.toContain('new=1'))
    expect(search()).toContain('status=active')
  })

  it('does not open the form for a profile that may not write', async () => {
    h.permissions = new Set(['masters.warehouses.read'])
    renderPage('/masters/warehouses?new=1')
    await waitFor(() => expect(screen.getByText('Main Warehouse')).toBeTruthy())
    expect(createForm()).toBeNull()
  })

  it('waits for permissions rather than swallowing the request while they load', async () => {
    h.accessLoading = true
    renderPage('/masters/warehouses?new=1')
    // Access is still in flight: the flag must survive, not be spent on a
    // `can()` that answers false only because nothing has loaded yet.
    await waitFor(() => expect(search()).toContain('new=1'))
    expect(createForm()).toBeNull()
  })

  it('leaves the screen alone without the flag', async () => {
    renderPage('/masters/warehouses')
    await waitFor(() => expect(screen.getByText('Main Warehouse')).toBeTruthy())
    expect(createForm()).toBeNull()
  })
})
