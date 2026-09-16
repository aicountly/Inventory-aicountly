import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import type { CompanySettings, SettingsPatch } from '../../services/settingsApi'

const can = vi.fn<(key: string | readonly string[]) => boolean>(() => true)
const canWrite = vi.fn<() => boolean>(() => true)
const get = vi.fn<(signal?: AbortSignal) => Promise<CompanySettings>>()
const update = vi.fn<(patch: SettingsPatch) => Promise<CompanySettings>>()
const toastSuccess = vi.fn()
const toastError = vi.fn()

vi.mock('../../access/AccessContext', () => ({
  useAccess: () => ({ can, loading: false, isOwner: true }),
  useCan: () => canWrite(),
}))

vi.mock('../../company/CompanyContext', () => ({
  useCompany: () => ({ scope: { cmp_id: 7, fy_id: 1, bo_id: 0 }, companyName: 'Demo Company' }),
}))

vi.mock('../../ui/ToastContext', () => ({
  useToast: () => ({ success: toastSuccess, error: toastError, info: vi.fn(), notify: vi.fn() }),
}))

vi.mock('../../services/settingsApi', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../services/settingsApi')>()
  return { ...actual, settingsApi: { ...actual.settingsApi, get, update } }
})

const { CompanySettingsPage } = await import('./CompanySettingsPage')
const { SettingsChromeContext } = await import('./SettingsChrome')

const SETTINGS: CompanySettings = {
  cmp_id: 7,
  default_valuation_method: 'FIFO',
  valuation_scope: 'company',
  negative_stock_policy: 'allow',
  approval_required: '0',
  fefo_enabled: '1',
  cogs_revision_mode: 'inline',
  base_currency_code: 'INR',
  landed_cost_excluded_types: null,
  landed_cost_policy: {
    capitalisable_cost_types: ['freight', 'duty', 'insurance', 'handling', 'other', 'non_creditable_tax'],
    excluded_cost_types: [],
    switchable_cost_types: ['freight', 'duty', 'insurance', 'handling', 'other'],
    always_capitalised_cost_types: ['non_creditable_tax'],
    all_cost_types: ['freight', 'duty', 'insurance', 'handling', 'other', 'non_creditable_tax'],
  },
  settings: {},
  updated_at: '2026-09-13 06:45:00',
  updated_by: 'migration:prod-20260913-0114',
}

let slot: HTMLDivElement
const setDirty = vi.fn()

function renderPage() {
  slot = document.createElement('div')
  document.body.appendChild(slot)
  return render(
    <MemoryRouter>
      <SettingsChromeContext.Provider value={{ headerSlot: slot, setDirty }}>
        <CompanySettingsPage />
      </SettingsChromeContext.Provider>
    </MemoryRouter>,
  )
}

const saveButton = () => screen.getByRole('button', { name: /save settings/i })
const methodSelect = () => screen.getByLabelText(/default valuation method/i) as HTMLSelectElement

beforeEach(() => {
  can.mockReset()
  can.mockReturnValue(true)
  canWrite.mockReset()
  canWrite.mockReturnValue(true)
  get.mockReset()
  get.mockResolvedValue(SETTINGS)
  update.mockReset()
  toastSuccess.mockReset()
  toastError.mockReset()
  setDirty.mockReset()
})

afterEach(() => {
  slot?.remove()
})

describe('Company settings', () => {
  it('shows the saved values and the metadata the API returned', async () => {
    renderPage()
    await waitFor(() => expect(methodSelect().value).toBe('FIFO'))
    // The date is the server's, never a literal in the markup.
    expect(screen.getByText(/Last changed 13 Sept? 2026, 06:45 by migration:prod-20260913-0114/)).toBeTruthy()
  })

  it('keeps Save switched off until something actually changes', async () => {
    renderPage()
    await waitFor(() => expect(methodSelect().value).toBe('FIFO'))
    expect((saveButton() as HTMLButtonElement).disabled).toBe(true)

    fireEvent.change(methodSelect(), { target: { value: 'WAC' } })
    expect((saveButton() as HTMLButtonElement).disabled).toBe(false)
    expect(screen.getByText('Unsaved changes')).toBeTruthy()
    expect(setDirty).toHaveBeenCalledWith(true)
  })

  it('sends only the field that changed, and adopts the response', async () => {
    update.mockResolvedValue({ ...SETTINGS, default_valuation_method: 'WAC', updated_at: '2026-09-16 11:02:00', updated_by: 'rahul' })
    renderPage()
    await waitFor(() => expect(methodSelect().value).toBe('FIFO'))

    fireEvent.change(methodSelect(), { target: { value: 'WAC' } })
    fireEvent.click(saveButton())

    await waitFor(() => expect(update).toHaveBeenCalledWith({ default_valuation_method: 'WAC' }))
    await waitFor(() => expect(toastSuccess).toHaveBeenCalledWith('Inventory settings updated successfully.'))
    // Clean again, and the metadata comes from the save response rather than a re-fetch.
    await waitFor(() => expect((saveButton() as HTMLButtonElement).disabled).toBe(true))
    expect(screen.getByText(/Last changed 16 Sept? 2026, 11:02 by rahul/)).toBeTruthy()
    expect(get).toHaveBeenCalledTimes(1)
  })

  it('keeps the edit and stays dirty when the save fails', async () => {
    update.mockRejectedValue(new Error('Gateway timeout'))
    renderPage()
    await waitFor(() => expect(methodSelect().value).toBe('FIFO'))

    fireEvent.change(methodSelect(), { target: { value: 'LIFO' } })
    fireEvent.click(saveButton())

    await waitFor(() => expect(toastError).toHaveBeenCalled())
    expect(methodSelect().value).toBe('LIFO')
    expect((saveButton() as HTMLButtonElement).disabled).toBe(false)
    expect(screen.getByText('Unsaved changes')).toBeTruthy()
  })

  it('refuses to render a usable form when the settings could not be loaded', async () => {
    get.mockRejectedValue(new Error('Inventory API did not answer.'))
    renderPage()

    expect(await screen.findByText('Unable to load inventory settings')).toBeTruthy()
    // Nothing that could be saved over the real settings, and no Save to do it with.
    expect(screen.queryByLabelText(/default valuation method/i)).toBeNull()
    expect(screen.queryByRole('button', { name: /save settings/i })).toBeNull()
    expect(screen.getByRole('button', { name: /retry/i })).toBeTruthy()
  })

  it('never offers the non-creditable tax as a choice', async () => {
    renderPage()
    await waitFor(() => expect(methodSelect().value).toBe('FIFO'))

    const tax = screen.getByRole('checkbox', { name: /Non-creditable tax/i }) as HTMLInputElement
    expect(tax.checked).toBe(true)
    expect(tax.disabled).toBe(true)
    expect(screen.getByText(/Always included when applicable/i)).toBeTruthy()

    const freight = screen.getByRole('checkbox', { name: /Freight/i }) as HTMLInputElement
    expect(freight.checked).toBe(true)
    expect(freight.disabled).toBe(false)
  })

  it('switching a charge type off sends the excluded list', async () => {
    update.mockResolvedValue({ ...SETTINGS })
    renderPage()
    await waitFor(() => expect(methodSelect().value).toBe('FIFO'))

    fireEvent.click(screen.getByRole('checkbox', { name: /Freight/i }))
    fireEvent.click(saveButton())

    await waitFor(() => expect(update).toHaveBeenCalledWith({ landed_cost_excluded_types: ['freight'] }))
  })

  it('is read-only, with no Save at all, without settings.write', async () => {
    canWrite.mockReturnValue(false)
    renderPage()
    await waitFor(() => expect(methodSelect().value).toBe('FIFO'))

    expect(screen.queryByRole('button', { name: /save settings/i })).toBeNull()
    expect(methodSelect().disabled).toBe(true)
    expect((screen.getByRole('checkbox', { name: /Freight/i }) as HTMLInputElement).disabled).toBe(true)
    expect(screen.getByText('Read-only access')).toBeTruthy()
  })

  it('refuses a half-typed currency instead of letting the server do it', async () => {
    renderPage()
    await waitFor(() => expect(methodSelect().value).toBe('FIFO'))

    fireEvent.change(screen.getByLabelText(/base currency/i), { target: { value: 'IN' } })
    expect((saveButton() as HTMLButtonElement).disabled).toBe(true)
    expect(screen.getByText(/three-letter ISO code/i)).toBeTruthy()
  })
})
