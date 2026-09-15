import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { NewDocumentMenu } from './NewDocumentMenu'
import { SIDEBAR_NAV, SIDEBAR_SHORTCUTS, collectNavLeaves } from '../config/navRegistry'

/*
 * The menu used to `return null` when nothing passed its permission filter
 * (NewDocumentMenu.tsx:31 on the deployed build). A control that disappears is
 * indistinguishable from one that was never built, and that is how it was read.
 */

const can = vi.fn<(key: string | readonly string[]) => boolean>(() => true)
const profile = { profile_name: 'Owner', template_key: 'owner' }

vi.mock('../access/AccessContext', () => ({
  useAccess: () => ({ can, loading: false, member: { uuid: 'user-a' }, profile }),
  useCan: () => true,
}))

function renderMenu() {
  return render(
    <MemoryRouter>
      <NewDocumentMenu />
    </MemoryRouter>,
  )
}

beforeEach(() => {
  can.mockReset()
  can.mockReturnValue(true)
  profile.profile_name = 'Owner'
})

describe('the new-document menu', () => {
  it('offers the types the user may raise, grouped', () => {
    renderMenu()
    fireEvent.click(screen.getByRole('button', { name: /New document/ }))
    expect(screen.getByRole('menuitem', { name: /Stock Journal/ }).getAttribute('href')).toBe(
      '/documents/new/stock_journal',
    )
    expect(screen.getByText('Adjustments')).toBeTruthy()
    expect(screen.getByText('Job work')).toBeTruthy()
  })

  it('always links to the full list, so the dropdown is not the only door', () => {
    renderMenu()
    fireEvent.click(screen.getByRole('button', { name: /New document/ }))
    expect(screen.getByRole('menuitem', { name: /All document types/ }).getAttribute('href')).toBe(
      '/documents/new',
    )
  })

  it('still renders, and says why, when the profile may raise nothing', () => {
    can.mockReturnValue(false)
    profile.profile_name = 'Auditor'
    renderMenu()

    // The button is there — it did not silently vanish.
    const button = screen.getByRole('button', { name: /New document/ })
    fireEvent.click(button)

    expect(screen.getByText('No document type is available to you')).toBeTruthy()
    expect(screen.getByText(/the Auditor profile holds no create permission/)).toBeTruthy()
    // And the hub is still one click away, so the user can see what exists.
    expect(screen.getByRole('menuitem', { name: /All document types/ })).toBeTruthy()
  })

  it('never shows an empty panel', () => {
    can.mockReturnValue(false)
    renderMenu()
    fireEvent.click(screen.getByRole('button', { name: /New document/ }))
    const panel = screen.getByRole('menu')
    expect(panel.textContent?.trim().length ?? 0).toBeGreaterThan(0)
  })
})

describe('document entry is reachable from the navigation', () => {
  it('names the entry hub in the Documents mega menu', () => {
    const documents = SIDEBAR_NAV.find((item) => item.key === 'documents')
    expect(documents).toBeTruthy()
    const leaves = (documents?.megaMenu ?? []).flatMap((column) => column.items)
    expect(leaves.some((leaf) => leaf.path === '/documents/new')).toBe(true)
  })

  it('points the "New document" shortcut at a create screen, not at the register', () => {
    const shortcut = SIDEBAR_SHORTCUTS.find((s) => s.label === 'New document')
    expect(shortcut?.path).toBe('/documents/new')
  })

  it('puts the entry hub in the command palette corpus', () => {
    expect(collectNavLeaves().some(({ leaf }) => leaf.path === '/documents/new')).toBe(true)
  })
})
