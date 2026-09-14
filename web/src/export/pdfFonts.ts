/**
 * Fonts for the PDF export.
 *
 * jsPDF's fourteen standard fonts are Latin-1 and cannot render ₹ — it comes
 * out as a blank box, or throws outright. Books solves this by embedding two
 * families (books-react-app/web/src/modules/reports/shared/reportExportTheme.js):
 * Nunito for labels, so the PDF matches the app, and Noto Sans for amount
 * cells, because Noto has the rupee glyph.
 *
 * The buffers are fetched once per session and cached. Every failure path ends
 * with a PDF that still exports — in Helvetica, with `Rs.` instead of `₹` —
 * because a report with an ugly currency marker is worth more than no report.
 */

import type { jsPDF } from 'jspdf'

const FONT_URLS = {
  nunitoRegular: 'https://cdn.jsdelivr.net/fontsource/fonts/nunito@5.2.5/latin-400-normal.ttf',
  nunitoBold: 'https://cdn.jsdelivr.net/fontsource/fonts/nunito@5.2.5/latin-700-normal.ttf',
  notoRegular: 'https://cdn.jsdelivr.net/npm/notosans-fontface@1.3.0/fonts/NotoSans-Regular.ttf',
  notoBold: 'https://cdn.jsdelivr.net/npm/notosans-fontface@1.3.0/fonts/NotoSans-Bold.ttf',
} as const

export const LABEL_FONT = 'Nunito'
export const AMOUNT_FONT = 'NotoSans'

type FontBuffers = [ArrayBuffer, ArrayBuffer, ArrayBuffer, ArrayBuffer]

let buffersPromise: Promise<FontBuffers> | null = null

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer)
  let binary = ''
  // Chunked: a 200 KB font spread into String.fromCharCode in one call
  // overflows the argument limit in Safari.
  const CHUNK = 0x8000
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK))
  }
  return btoa(binary)
}

async function fetchFont(url: string): Promise<ArrayBuffer> {
  const response = await fetch(url)
  if (!response.ok) throw new Error(`Font fetch failed (${response.status})`)
  const buffer = await response.arrayBuffer()
  // A proxy or captive portal answers 200 with an HTML error page; jsPDF then
  // registers it happily and every glyph in the PDF is a blank box.
  if (buffer.byteLength < 10_000) throw new Error('Font fetch returned invalid data')
  return buffer
}

function loadBuffers(): Promise<FontBuffers> {
  if (!buffersPromise) {
    buffersPromise = Promise.all([
      fetchFont(FONT_URLS.nunitoRegular),
      fetchFont(FONT_URLS.nunitoBold),
      fetchFont(FONT_URLS.notoRegular),
      fetchFont(FONT_URLS.notoBold),
    ]).catch((err: unknown) => {
      // Do not cache a failure: the next export may be online again.
      buffersPromise = null
      throw err
    }) as Promise<FontBuffers>
  }
  return buffersPromise
}

/** Register Nunito + Noto Sans on this document. Throws if the fetch fails. */
export async function ensurePdfFonts(doc: jsPDF): Promise<void> {
  const [nunitoRegular, nunitoBold, notoRegular, notoBold] = await loadBuffers()
  const list = doc.getFontList?.() ?? {}

  if (!list[LABEL_FONT]) {
    doc.addFileToVFS('Nunito-Regular.ttf', arrayBufferToBase64(nunitoRegular))
    doc.addFont('Nunito-Regular.ttf', LABEL_FONT, 'normal')
    doc.addFileToVFS('Nunito-Bold.ttf', arrayBufferToBase64(nunitoBold))
    doc.addFont('Nunito-Bold.ttf', LABEL_FONT, 'bold')
  }
  if (!list[AMOUNT_FONT]) {
    doc.addFileToVFS('NotoSans-Regular.ttf', arrayBufferToBase64(notoRegular))
    doc.addFont('NotoSans-Regular.ttf', AMOUNT_FONT, 'normal')
    doc.addFileToVFS('NotoSans-Bold.ttf', arrayBufferToBase64(notoBold))
    doc.addFont('NotoSans-Bold.ttf', AMOUNT_FONT, 'bold')
  }
  doc.setFont(LABEL_FONT, 'normal')
}

/** True when ₹ will actually render — the gate for `₹` vs `Rs.` in amounts. */
export function supportsRupee(doc: jsPDF): boolean {
  try {
    if (!doc.getFontList()?.[AMOUNT_FONT]) return false
    doc.setFont(AMOUNT_FONT, 'normal')
    const internal = doc.internal as unknown as {
      getFont?: () => { metadata?: { Unicode?: unknown } }
    }
    return Boolean(internal.getFont?.()?.metadata?.Unicode)
  } catch {
    return false
  }
}

/** The label font, falling back to Helvetica when embedding failed. */
export function labelFontName(doc: jsPDF): string {
  return doc.getFontList?.()?.[LABEL_FONT] ? LABEL_FONT : 'helvetica'
}

export function setLabelFont(doc: jsPDF, style: 'normal' | 'bold' = 'normal'): void {
  try {
    doc.setFont(labelFontName(doc), style)
  } catch {
    doc.setFont('helvetica', style)
  }
}

export function setAmountFont(doc: jsPDF, style: 'normal' | 'bold' = 'normal'): void {
  try {
    doc.setFont(doc.getFontList?.()?.[AMOUNT_FONT] ? AMOUNT_FONT : labelFontName(doc), style)
  } catch {
    setLabelFont(doc, style)
  }
}
