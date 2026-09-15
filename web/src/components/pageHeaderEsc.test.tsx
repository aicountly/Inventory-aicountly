import { fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter, useLocation } from 'react-router-dom'
import type { ReactNode } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { PageHeader } from './PageHeader'
import { BreadcrumbHeader } from '../ui/shell/BreadcrumbHeader'

/**
 * Esc is a destructive key on a form screen, so it is opt-in.
 *
 * `components/PageHeader` is a shim thirty screens already render, three of them
 * data-entry forms (item, BOM, document). They all pass a breadcrumb carrying a
 * `to`, so Esc-to-back resolves a target on every one of them; and the typing
 * guard does not save a form, because it deliberately treats checkboxes, radios,
 * buttons and the body as "not typing". A key that throws away a half-filled
 * document has to be asked for, not inherited.
 */

function Here() {
  const location = useLocation()
  return <output>{location.pathname}</output>
}

function at(path: string, node: ReactNode) {
  render(
    <MemoryRouter initialEntries={[path]}>
      {node}
      <Here />
    </MemoryRouter>,
  )
}

const where = () => screen.getByRole('status').textContent

const crumbs = [{ label: 'Items', to: '/masters/items' }]

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('Esc on a legacy screen', () => {
  it('does not leave a form the user never asked to leave', () => {
    at('/masters/items/new', <PageHeader title="New item" breadcrumbs={crumbs} />)
    // Focus sits on the body — exactly the case isTypingTarget lets through.
    fireEvent.keyDown(document.body, { key: 'Escape' })
    expect(where()).toBe('/masters/items/new')
  })

  it('does not leave when focus is on a checkbox either', () => {
    at(
      '/masters/items/new',
      <>
        <PageHeader title="New item" breadcrumbs={crumbs} />
        <input type="checkbox" aria-label="Track batches" />
      </>,
    )
    fireEvent.keyDown(screen.getByLabelText('Track batches'), { key: 'Escape' })
    expect(where()).toBe('/masters/items/new')
  })
})

describe('Esc on a screen that opts in', () => {
  it('goes back to the breadcrumb parent', () => {
    at('/masters/items/new', <BreadcrumbHeader title="New item" breadcrumbs={crumbs} />)
    fireEvent.keyDown(document.body, { key: 'Escape' })
    expect(where()).toBe('/masters/items')
  })

  it('asks first while the page holds unsaved edits, and stays on no', () => {
    const confirm = vi.fn(() => false)
    vi.stubGlobal('confirm', confirm)
    at('/masters/items/new', <BreadcrumbHeader title="New item" breadcrumbs={crumbs} escDirty />)
    fireEvent.keyDown(document.body, { key: 'Escape' })
    expect(confirm).toHaveBeenCalled()
    expect(where()).toBe('/masters/items/new')
  })

  it('leaves on yes', () => {
    vi.stubGlobal('confirm', vi.fn(() => true))
    at('/masters/items/new', <BreadcrumbHeader title="New item" breadcrumbs={crumbs} escDirty />)
    fireEvent.keyDown(document.body, { key: 'Escape' })
    expect(where()).toBe('/masters/items')
  })
})
