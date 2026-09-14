import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { act, fireEvent, render, screen } from '@testing-library/react'
import {
  APPEARANCE_STORAGE_KEY,
  ThemeProvider,
  loadAppearance,
  useTheme,
} from './ThemeProvider'

function Probe() {
  const { appearance, resolvedMode, setAppearance, setMode } = useTheme()
  return (
    <div>
      <span data-testid="mode">{resolvedMode}</span>
      <span data-testid="preset">{appearance.colorPreset}</span>
      <span data-testid="font">{appearance.fontId}</span>
      <button type="button" onClick={() => setMode('dark')}>
        dark
      </button>
      <button type="button" onClick={() => setMode('light')}>
        light
      </button>
      <button type="button" onClick={() => setAppearance({ colorPreset: 'blue' })}>
        blue
      </button>
      <button type="button" onClick={() => setAppearance({ customPrimary: '#3874FF' })}>
        custom
      </button>
      <button type="button" onClick={() => setAppearance({ sizeId: 'zoomnormal' })}>
        bigger
      </button>
    </div>
  )
}

const root = () => document.documentElement

beforeEach(() => {
  localStorage.clear()
  root().className = ''
  root().removeAttribute('style')
  root().removeAttribute('data-theme')
})

afterEach(() => {
  localStorage.clear()
})

describe('loadAppearance', () => {
  it('returns the defaults when nothing is stored', () => {
    expect(loadAppearance()).toMatchObject({
      mode: 'system',
      colorPreset: 'default',
      fontId: 'noto',
      sizeId: 'zoomcompact',
    })
  })

  it('resolves legacy preset, font and size ids', () => {
    localStorage.setItem(
      APPEARANCE_STORAGE_KEY,
      JSON.stringify({ colorPreset: 'sky_blue', fontId: 'inter', sizeId: 'md' }),
    )
    expect(loadAppearance()).toMatchObject({
      colorPreset: 'sky',
      fontId: 'noto',
      sizeId: 'zoomnormal',
    })
  })

  it('survives a corrupt blob rather than throwing at boot', () => {
    localStorage.setItem(APPEARANCE_STORAGE_KEY, '{not json')
    expect(loadAppearance().mode).toBe('system')
  })

  it('backfills the derived variables for a stored custom colour', () => {
    localStorage.setItem(
      APPEARANCE_STORAGE_KEY,
      JSON.stringify({ customPrimary: '#3874FF' }),
    )
    const loaded = loadAppearance()
    expect(loaded.customVars?.light['--color-primary']).toBe('56 116 255')
    expect(loaded.customVars?.dark['--color-primary']).toBeTruthy()
  })
})

describe('ThemeProvider', () => {
  it('toggles the dark class on the document element', () => {
    render(
      <ThemeProvider>
        <Probe />
      </ThemeProvider>,
    )
    act(() => {
      fireEvent.click(screen.getByText('dark'))
    })
    expect(root().classList.contains('dark')).toBe(true)
    expect(screen.getByTestId('mode').textContent).toBe('dark')

    act(() => {
      fireEvent.click(screen.getByText('light'))
    })
    expect(root().classList.contains('dark')).toBe(false)
  })

  it('persists the choice under the inventory key', () => {
    render(
      <ThemeProvider>
        <Probe />
      </ThemeProvider>,
    )
    act(() => {
      fireEvent.click(screen.getByText('dark'))
    })
    const stored = JSON.parse(localStorage.getItem(APPEARANCE_STORAGE_KEY) as string)
    expect(stored.mode).toBe('dark')
  })

  it('sets data-theme for a preset and writes no inline accent variables', () => {
    render(
      <ThemeProvider>
        <Probe />
      </ThemeProvider>,
    )
    act(() => {
      fireEvent.click(screen.getByText('blue'))
    })
    expect(root().dataset.theme).toBe('blue')
    expect(root().style.getPropertyValue('--color-primary')).toBe('')
  })

  it('writes inline accent variables for a custom colour', () => {
    render(
      <ThemeProvider>
        <Probe />
      </ThemeProvider>,
    )
    act(() => {
      fireEvent.click(screen.getByText('custom'))
    })
    expect(root().dataset.theme).toBe('custom')
    expect(root().style.getPropertyValue('--color-primary')).toBe('56 116 255')
    expect(root().style.getPropertyValue('--color-primary-light')).not.toBe('')
  })

  it('clears the inline variables again when the custom colour is removed', () => {
    render(
      <ThemeProvider>
        <Probe />
      </ThemeProvider>,
    )
    act(() => {
      fireEvent.click(screen.getByText('custom'))
    })
    act(() => {
      fireEvent.click(screen.getByText('blue'))
    })
    expect(root().style.getPropertyValue('--color-primary')).toBe('')
    expect(root().dataset.theme).toBe('blue')
  })

  it('drives the rem scale from the chosen text size', () => {
    render(
      <ThemeProvider>
        <Probe />
      </ThemeProvider>,
    )
    expect(root().style.getPropertyValue('--font-size-base')).toBe('13px')
    act(() => {
      fireEvent.click(screen.getByText('bigger'))
    })
    expect(root().style.getPropertyValue('--font-size-base')).toBe('16px')
  })

  it('throws a useful error when the hook is used outside the provider', () => {
    expect(() => render(<Probe />)).toThrow(/ThemeProvider/)
  })
})
