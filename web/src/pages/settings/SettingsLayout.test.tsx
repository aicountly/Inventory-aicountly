import { useEffect } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { SettingsLayout } from './SettingsLayout'
import { useSettingsChrome } from './SettingsChrome'

const can = vi.fn<(key: string | readonly string[]) => boolean>(() => true)

vi.mock('../../access/AccessContext', () => ({
  useAccess: () => ({ can, loading: false }),
  useCan: () => true,
}))

/** Stands in for the Company tab: mounts, and says it holds unsaved edits. */
function DirtyTab({ dirty = true }: { dirty?: boolean }) {
  const { setDirty } = useSettingsChrome()
  useEffect(() => {
    setDirty(dirty)
  }, [setDirty, dirty])
  return <p>Company tab</p>
}

function renderSettings(child = <DirtyTab />) {
  render(
    <MemoryRouter initialEntries={['/settings']}>
      <Routes>
        <Route path="/settings" element={<SettingsLayout />}>
          <Route index element={child} />
          <Route path="period-locks" element={<p>Period locks tab</p>} />
        </Route>
      </Routes>
    </MemoryRouter>,
  )
}

const periodLocksTab = () => screen.getByRole('link', { name: /period locks/i })

beforeEach(() => {
  can.mockReset()
  can.mockReturnValue(true)
})

describe('Settings chrome', () => {
  it('offers only the sections this app actually serves', () => {
    renderSettings()
    for (const label of ['Company', 'Period locks', 'Access & permissions', 'Document types']) {
      expect(screen.getByRole('link', { name: new RegExp(label, 'i') }), label).toBeTruthy()
    }
    // The reference design also showed these two. Neither has a route or a setting behind it, and a
    // tab that opens nothing reads as a broken feature rather than an unbuilt one.
    expect(screen.queryByRole('link', { name: /integrations/i })).toBeNull()
    expect(screen.queryByRole('link', { name: /advanced/i })).toBeNull()
  })

  it('marks the open section for assistive technology, not just with colour', () => {
    renderSettings()
    expect(screen.getByRole('link', { name: /company/i }).getAttribute('aria-current')).toBe('page')
    expect(periodLocksTab().getAttribute('aria-current')).toBeNull()
  })

  it('drops the sections the user may not open', () => {
    // An access administrator who cannot read the company settings: one tab, not four.
    can.mockImplementation((key) => {
      const asked = Array.isArray(key) ? key : [key as string]
      return asked.includes('access.manage')
    })
    renderSettings()
    expect(screen.getByRole('link', { name: /access & permissions/i })).toBeTruthy()
    for (const gone of ['Company', 'Period locks', 'Document types']) {
      expect(screen.queryByRole('link', { name: new RegExp(gone, 'i') }), gone).toBeNull()
    }
  })

  it('holds a tab change while the open tab has unsaved edits', () => {
    renderSettings()
    fireEvent.click(periodLocksTab())

    expect(screen.getByText('Unsaved changes')).toBeTruthy()
    // Still on the tab that has the edits.
    expect(screen.getByText('Company tab')).toBeTruthy()
    expect(screen.queryByText('Period locks tab')).toBeNull()
  })

  it('stays put on Continue editing', () => {
    renderSettings()
    fireEvent.click(periodLocksTab())
    fireEvent.click(screen.getByRole('button', { name: /cancel/i }))

    expect(screen.queryByText('Unsaved changes')).toBeNull()
    expect(screen.getByText('Company tab')).toBeTruthy()
  })

  it('goes through once the change is discarded', () => {
    renderSettings()
    fireEvent.click(periodLocksTab())
    fireEvent.click(screen.getByRole('button', { name: /discard changes/i }))

    expect(screen.getByText('Period locks tab')).toBeTruthy()
    expect(screen.queryByText('Company tab')).toBeNull()
  })

  it('does not interrupt navigation when nothing was edited', () => {
    renderSettings(<DirtyTab dirty={false} />)
    fireEvent.click(periodLocksTab())

    expect(screen.queryByText('Unsaved changes')).toBeNull()
    expect(screen.getByText('Period locks tab')).toBeTruthy()
  })
})
