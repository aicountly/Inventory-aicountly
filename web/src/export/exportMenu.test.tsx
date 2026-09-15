import { createRef } from 'react'
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { ExportableColumn } from '../registers/registerCells'

/**
 * The Export menu as a keyboard user and a phone meet it.
 *
 * Two things this guards. A menu positioned inside the toolbar runs off the
 * left edge once the toolbar wraps on a narrow screen, and is clipped by the
 * register shell's own `overflow-hidden`; it is therefore portalled and clamped
 * to the viewport. And a container that calls itself `role="menu"` has promised
 * a screen-reader user the menu keyboard contract — arrows, Home/End, Escape
 * back to the trigger — so it has to keep that promise.
 */

const printTabular = vi.fn((_payload: { title: string; generatedAt?: string }) => true)

vi.mock('./documentExport', () => ({
  exportTabularExcel: vi.fn(async () => {}),
  exportTabularPdf: vi.fn(async () => {}),
  printTabular: (payload: { title: string; generatedAt?: string }) => printTabular(payload),
}))

const { ExportActions } = await import('./ExportActions')

interface Row {
  item_name: string
  qty: number
}

const COLUMNS: ExportableColumn<Row>[] = [
  { key: 'item_name', header: 'Item' },
  { key: 'qty', header: 'Qty', align: 'right', format: 'qty' },
]

const ROWS: Row[] = [{ item_name: 'Widget A', qty: 10 }]

function renderActions(props: Record<string, unknown> = {}) {
  return render(
    <ExportActions<Row>
      columns={COLUMNS}
      rows={ROWS}
      filename="stock-movement-register"
      identity={{ companyName: 'Acme Ltd' }}
      title="Stock movement register"
      {...props}
    />,
  )
}

const ORIGINAL_RECT = Element.prototype.getBoundingClientRect

/** A trigger near the left edge of a phone, low on the screen. */
function pinAnchorNearLeftEdge(): void {
  window.innerWidth = 400
  window.innerHeight = 700
  Element.prototype.getBoundingClientRect = function rect(this: Element) {
    return this.tagName === 'BUTTON' || this.className.includes('relative')
      ? ({ top: 600, bottom: 628, left: 60, right: 120, width: 60, height: 28, x: 60, y: 600 } as DOMRect)
      : ORIGINAL_RECT.call(this)
  }
}

beforeEach(() => {
  printTabular.mockClear()
})

afterEach(() => {
  Element.prototype.getBoundingClientRect = ORIGINAL_RECT
})

describe('the Export menu', () => {
  it('escapes the toolbar so no ancestor can clip it', () => {
    const { container } = renderActions()
    fireEvent.click(screen.getByRole('button', { name: /export/i }))
    const menu = screen.getByRole('menu')
    expect(container.contains(menu)).toBe(false)
    expect(document.body.contains(menu)).toBe(true)
    expect(menu.className).toContain('fixed')
  })

  it('flips above the trigger and clamps inside the viewport on a narrow screen', () => {
    pinAnchorNearLeftEdge()
    renderActions()
    fireEvent.click(screen.getByRole('button', { name: /export/i }))
    const menu = screen.getByRole('menu') as HTMLElement
    const left = Number.parseFloat(menu.style.left)
    const top = Number.parseFloat(menu.style.top)
    const width = Number.parseFloat(menu.style.width)
    expect(left).toBeGreaterThanOrEqual(8)
    expect(left + width).toBeLessThanOrEqual(window.innerWidth - 8)
    // No room below 628px of a 700px viewport, so it opens upward.
    expect(top).toBeLessThan(600)
    expect(top).toBeGreaterThanOrEqual(8)
  })

  it('moves focus into the menu on open and walks it with the arrow keys', () => {
    renderActions()
    fireEvent.click(screen.getByRole('button', { name: /export/i }))
    const items = screen.getAllByRole('menuitem')
    expect(document.activeElement).toBe(items[0])

    fireEvent.keyDown(document, { key: 'ArrowDown' })
    expect(document.activeElement).toBe(items[1])
    fireEvent.keyDown(document, { key: 'End' })
    expect(document.activeElement).toBe(items[items.length - 1])
    fireEvent.keyDown(document, { key: 'ArrowDown' })
    expect(document.activeElement, 'the list wraps').toBe(items[0])
    fireEvent.keyDown(document, { key: 'ArrowUp' })
    expect(document.activeElement).toBe(items[items.length - 1])
    fireEvent.keyDown(document, { key: 'Home' })
    expect(document.activeElement).toBe(items[0])
  })

  it('closes on Escape and gives focus back to the trigger', () => {
    renderActions()
    const trigger = screen.getByRole('button', { name: /export/i })
    fireEvent.click(trigger)
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByRole('menu')).toBeNull()
    expect(document.activeElement).toBe(trigger)
  })

  it('shows a keyboard user where the focus is', () => {
    renderActions()
    fireEvent.click(screen.getByRole('button', { name: /export/i }))
    for (const item of screen.getAllByRole('menuitem')) {
      expect(item.className).toContain('focus-visible:ring')
    }
  })
})

describe('the print handle', () => {
  it('lets the page print the sheet without going through the button', async () => {
    const printRef = createRef<(() => void) | null>()
    renderActions({ printRef })
    expect(typeof printRef.current).toBe('function')
    printRef.current?.()
    await waitFor(() => expect(printTabular).toHaveBeenCalledOnce())
    const payload = printTabular.mock.calls[0][0]
    expect(payload.title).toBe('Stock movement register')
    expect(payload.generatedAt, 'the sheet says when it was printed').toBeTruthy()
  })
})
