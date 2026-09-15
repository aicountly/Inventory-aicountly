import { afterEach, describe, expect, it, vi } from 'vitest'
import { printTabular } from './documentExport'
import type { ExportColumn, ExportRow } from './exportColumns'

/**
 * What happens to the print dialog when the typeface does not arrive.
 *
 * The sheet is a standalone document, so it links Nunito and Noto Sans from a
 * CDN. A reader behind a captive portal or an office firewall reaches neither,
 * and a render-blocking stylesheet that never answers used to leave the print
 * dialog un-opened with nothing on screen to say why. Paper is allowed to cost
 * a typeface; it is not allowed to cost the document.
 */

const COLUMNS: ExportColumn[] = [
  { key: 'item_name', label: 'Item', format: 'text', align: 'left', excelWidth: 34, pdfWeight: 26 },
  { key: 'out_qty', label: 'Out qty', format: 'qty', align: 'right', excelWidth: 13, pdfWeight: 10 },
]

const ROWS: ExportRow[] = [
  { item_name: { value: 'Widget A', text: 'Widget A' }, out_qty: { value: 10, text: '10' } },
]

const SHEET = {
  title: 'Stock movement register',
  description: 'Every movement in the period',
  companyName: 'Acme Ltd',
  columns: COLUMNS,
  rows: ROWS,
}

interface PrintFrame {
  print: ReturnType<typeof vi.fn>
  doc: Document
}

/**
 * Print into an iframe whose window and font loader are ours, so the CDN that
 * never answers can be reproduced without one.
 */
function printWith(fontsReady: Promise<unknown>): PrintFrame {
  const print = vi.fn()
  const captured: { doc: Document | null } = { doc: null }
  const append = document.body.appendChild.bind(document.body)
  const spy = vi.spyOn(document.body, 'appendChild').mockImplementation(((node: Node) => {
    const out = append(node)
    if (node instanceof HTMLIFrameElement) {
      const win = node.contentWindow as unknown as { print: () => void; focus: () => void }
      win.print = print
      win.focus = () => {}
      captured.doc = node.contentDocument
      Object.defineProperty(node.contentDocument as Document, 'fonts', {
        configurable: true,
        value: { ready: fontsReady },
      })
    }
    return out
  }) as typeof document.body.appendChild)

  expect(printTabular(SHEET)).toBe(true)
  spy.mockRestore()
  expect(captured.doc).toBeTruthy()
  return { print, doc: captured.doc as Document }
}

const webfontLinks = (doc: Document) => doc.querySelectorAll('link[data-webfont]').length

afterEach(() => {
  vi.useRealTimers()
})

describe('printing a sheet whose webfont never arrives', () => {
  it('opens the print dialog anyway, without the stylesheet that is holding it', () => {
    vi.useFakeTimers()
    const { print, doc } = printWith(new Promise(() => {}))
    expect(webfontLinks(doc), 'the sheet links its typeface').toBe(1)

    vi.advanceTimersByTime(600)
    expect(print, 'a short wait for the font is fine').not.toHaveBeenCalled()

    vi.advanceTimersByTime(900)
    expect(print, 'the reader must still get a print dialog').toHaveBeenCalledOnce()
    expect(webfontLinks(doc), 'a stylesheet still pending blocks the render').toBe(0)
  })

  it('still prints once when the font arrives late', async () => {
    vi.useFakeTimers()
    let settle = () => {}
    const { print } = printWith(new Promise<void>((resolve) => { settle = resolve }))
    vi.advanceTimersByTime(1500)
    expect(print).toHaveBeenCalledOnce()

    settle()
    await vi.advanceTimersByTimeAsync(0)
    expect(print, 'one click, one dialog').toHaveBeenCalledOnce()
  })

  it('keeps the typeface when the font loader answers in time', async () => {
    const { print, doc } = printWith(Promise.resolve())
    await Promise.resolve()
    await Promise.resolve()
    expect(print).toHaveBeenCalledOnce()
    expect(webfontLinks(doc), 'nothing is dropped on a network that works').toBe(1)
  })
})
