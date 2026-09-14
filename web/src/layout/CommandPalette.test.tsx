import { describe, expect, it, vi } from 'vitest'
import { act, fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { COMMAND_PALETTE_EVENT } from '../keyboard/shortcutRegistry'

/**
 * Ctrl+K is the headline navigation shortcut of the shell, so it is the one
 * control a keyboard-first user reaches for most. Arrow keys move a highlight,
 * and a highlight that exists only as a background colour is invisible to the
 * people who need the shortcut most.
 */

vi.mock('../access/AccessContext', () => ({
  useAccess: () => ({ can: () => true, loading: false }),
}))

const { CommandPalette } = await import('./CommandPalette')

function openPalette(filter?: string) {
  render(
    <MemoryRouter>
      <CommandPalette />
    </MemoryRouter>,
  )
  act(() => {
    window.dispatchEvent(new CustomEvent(COMMAND_PALETTE_EVENT, { detail: { filter } }))
  })
}

const input = () => screen.getByRole('combobox', { name: 'Search screens' })

describe('CommandPalette accessibility', () => {
  it('exposes the input as a combobox wired to the result list', () => {
    openPalette()
    const listbox = screen.getByRole('listbox')
    expect(input().getAttribute('aria-expanded')).toBe('true')
    expect(input().getAttribute('aria-controls')).toBe(listbox.id)
    expect(listbox.id).toBeTruthy()
  })

  it('exposes each row as a selectable option', () => {
    openPalette()
    const options = screen.getAllByRole('option')
    expect(options.length).toBeGreaterThan(1)
    expect(options[0].getAttribute('aria-selected')).toBe('true')
    expect(options[1].getAttribute('aria-selected')).toBe('false')
  })

  it('announces the arrow-key highlight instead of only colouring it', () => {
    openPalette()
    const options = screen.getAllByRole('option')
    expect(input().getAttribute('aria-activedescendant')).toBe(options[0].id)

    act(() => {
      fireEvent.keyDown(screen.getByRole('dialog'), { key: 'ArrowDown' })
    })
    const moved = screen.getAllByRole('option')
    expect(input().getAttribute('aria-activedescendant')).toBe(moved[1].id)
    expect(moved[1].getAttribute('aria-selected')).toBe('true')
    expect(moved[0].getAttribute('aria-selected')).toBe('false')
  })

  it('announces how many screens matched', () => {
    openPalette()
    expect(screen.getByRole('status').textContent).toMatch(/\d+ screens?/)
  })

  it('says so when nothing matched', () => {
    openPalette('zzzzqqq-no-such-screen')
    expect(screen.queryAllByRole('option')).toHaveLength(0)
    expect(screen.getByRole('status').textContent).toBe('No screens match')
    expect(input().getAttribute('aria-activedescendant')).toBeNull()
  })

  it('keeps the rows out of the tab order — the input owns focus', () => {
    openPalette()
    for (const option of screen.getAllByRole('option')) {
      expect(option.getAttribute('tabindex')).toBe('-1')
    }
  })
})
