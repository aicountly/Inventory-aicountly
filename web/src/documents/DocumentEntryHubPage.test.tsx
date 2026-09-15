import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { DocumentEntryHubPage } from './DocumentEntryHubPage'
import { entryHubTypes } from './entryHub'

/*
 * Point 1 of the product owner's list: "Inventory related vouchers are not
 * available to enter ... nothing is showing". The types were always there; the
 * only way to reach one was a dropdown on a single screen that nothing in the
 * navigation pointed at. This is the screen that makes them visible, and these
 * tests hold the two rules it exists for: everything is listed, and anything
 * you cannot use says why.
 */

const can = vi.fn<(key: string | readonly string[]) => boolean>(() => true)
const profile = { profile_name: 'Owner', template_key: 'owner' }

vi.mock('../access/AccessContext', () => ({
  useAccess: () => ({ can, loading: false, member: { uuid: 'user-a' }, profile }),
  useCan: () => true,
}))

vi.mock('../company/useScopeLabel', () => ({
  useScopeLabel: () => 'Acme Ltd · FY 2026-27 · All branches',
}))

function renderHub() {
  return render(
    <MemoryRouter>
      <DocumentEntryHubPage />
    </MemoryRouter>,
  )
}

/** A profile holding `documents.<slug>.create` for exactly these codes. */
function allowOnly(codes: readonly string[]) {
  const keys = new Set(codes.map((c) => `documents.${c.toLowerCase()}.create`))
  can.mockImplementation((key) =>
    (Array.isArray(key) ? key : [key as string]).some((k) => keys.has(k)),
  )
}

beforeEach(() => {
  can.mockReset()
  can.mockReturnValue(true)
  profile.profile_name = 'Owner'
})

describe('the entry hub shows every document type', () => {
  it('links each type this user may raise straight at its form', () => {
    renderHub()
    for (const spec of entryHubTypes()) {
      const link = screen.getByRole('link', { name: new RegExp(escape(spec.label)) })
      expect(link.getAttribute('href'), spec.code).toBe(`/documents/new/${spec.slug}`)
    }
  })

  it('groups them the way a stores clerk thinks about them', () => {
    renderHub()
    for (const heading of [
      'Receipts',
      'Issues and dispatch',
      'Transfers',
      'Adjustments',
      'Production',
      'Job work',
      'Valuation',
    ]) {
      expect(screen.getByRole('heading', { name: heading }), heading).toBeTruthy()
    }
  })

  it('prints each type’s one-line description', () => {
    renderHub()
    expect(
      screen.getByText('Free-form in / out lines with a stock adjustment effect.'),
    ).toBeTruthy()
    expect(screen.getByText('Move stock between two warehouses.')).toBeTruthy()
  })
})

describe('a type the profile cannot raise', () => {
  it('is still shown, with the reason named and no link to a form that would refuse it', () => {
    // Store Keeper: create on the operational types only.
    allowOnly(['MATERIAL_ISSUE', 'MATERIAL_RECEIPT', 'STOCK_TRANSFER'])
    profile.profile_name = 'Store Keeper'
    renderHub()

    // Present.
    expect(screen.getByText('Stock Journal')).toBeTruthy()
    // With the reason, visibly, not only in a tooltip.
    expect(
      screen.getByText('Your profile does not allow creating a Stock Journal.'),
    ).toBeTruthy()
    // And no link that would land on a form telling them the same thing.
    expect(screen.queryByRole('link', { name: /Stock Journal/ })).toBeNull()
    // The ones they do hold are links.
    expect(screen.getByRole('link', { name: /Material Issue/ }).getAttribute('href')).toBe(
      '/documents/new/material_issue',
    )
  })

  it('never renders a blank page: with no create permission at all, every type is listed and the profile named', () => {
    can.mockReturnValue(false)
    profile.profile_name = 'Auditor'
    renderHub()

    for (const spec of entryHubTypes()) {
      // getAllBy: "Production" and "Valuation" are also group headings.
      expect(screen.getAllByText(spec.label).length, spec.code).toBeGreaterThan(0)
    }
    expect(screen.getByText(/None of these \d+ document types can be raised/)).toBeTruthy()
    expect(screen.getByText(/You are on the Auditor profile/)).toBeTruthy()
  })
})

function escape(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
