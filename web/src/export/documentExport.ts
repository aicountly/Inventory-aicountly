/**
 * Excel and PDF writers.
 *
 * Both are built from the same `ExportColumn[]` / `ExportRow[]` pair the print
 * sheet uses, so the three surfaces cannot disagree about which columns exist,
 * what they are called, or what a cell says. Books gets that guarantee from
 * `reportDocumentExport.js`; this is the same contract, flat-table only.
 *
 * The heavy libraries are loaded on demand. jsPDF and xlsx-js-style are ~1.5 MB
 * together and most sessions never export anything, so a static import would
 * make every page load pay for a button that is rarely pressed. The cost is
 * that a chunk failure is possible, which `exportErrorMessage` names precisely.
 *
 * `buildExcelAoa` is pure and unit-tested; everything below it touches the DOM
 * or the network.
 */

import type { jsPDF } from 'jspdf'
import type { ExportColumn, ExportRow } from './exportColumns'
import { excelNumberFormat, isNumericFormat } from './exportColumns'
import type { DocumentSheetOptions, Orientation, TabularSheetOptions } from './sheetHtml'
import { buildDocumentPrintHtml, buildTabularPrintHtml, totalsLabelIndex } from './sheetHtml'
import type { ExportTheme, RGB } from './exportTheme'
import { formatPdfCurrencyLabel, getExportTheme, rgbHex } from './exportTheme'
import { AMOUNT_FONT, ensurePdfFonts, labelFontName, setLabelFont, supportsRupee } from './pdfFonts'

/* ------------------------------------------------------------------ Excel */

export interface ExcelLayout {
  /** 0-based row of the column-header band. */
  headerRowIndex: number
  dataStartRow: number
  /** -1 when the sheet has no totals row. */
  totalsRowIndex: number
  notesStartRow: number
  lastCol: number
  metaCount: number
  rowCount: number
}

export interface ExcelAoaResult {
  aoa: (string | number)[][]
  layout: ExcelLayout
}

export interface TabularExportPayload extends TabularSheetOptions {
  /** Basis for the downloaded filename, before slugging and the extension. */
  filenameBase: string
  sheetName?: string
  /** Notes for the spreadsheet — signature lines belong on paper, not in a grid. */
  excelNotes?: readonly string[]
}

/**
 * The cell grid, exactly as it will be written.
 *
 * Amounts go in as numbers, not as `"₹ 1,200.00"`: the first thing a reader
 * does with an exported register is select a column and look at the sum, and a
 * column of strings sums to zero.
 */
export function buildExcelAoa(payload: TabularExportPayload): ExcelAoaResult {
  const {
    companyName = '',
    title,
    metaLines = [],
    columns,
    rows,
    totalsRow,
    totalsLabel,
    excelNotes = [],
  } = payload

  const meta = metaLines.filter(Boolean)
  const aoa: (string | number)[][] = [[companyName], [title], ...meta.map((m) => [m]), []]

  const headerRowIndex = aoa.length
  aoa.push(columns.map((c) => c.label))

  const dataStartRow = aoa.length
  for (const row of rows) {
    aoa.push(columns.map((c) => row[c.key]?.value ?? ''))
  }

  let totalsRowIndex = -1
  if (totalsRow) {
    totalsRowIndex = aoa.length
    const labelIndex = totalsLabelIndex(columns)
    aoa.push(
      columns.map((c, i) => {
        const cell = totalsRow[c.key]
        if (cell && cell.value !== '') return cell.value
        return i === labelIndex && totalsLabel ? totalsLabel : (cell?.text ?? '')
      }),
    )
  }

  const notesStartRow = aoa.length
  for (const note of excelNotes.filter(Boolean)) aoa.push([note])

  return {
    aoa,
    layout: {
      headerRowIndex,
      dataStartRow,
      totalsRowIndex,
      notesStartRow,
      lastCol: Math.max(columns.length - 1, 0),
      metaCount: meta.length,
      rowCount: rows.length,
    },
  }
}

/** xlsx-js-style's bundled typings are SheetJS's, which have no style member. */
interface CellStyle {
  font?: { bold?: boolean; italic?: boolean; sz?: number; color?: { rgb: string } }
  fill?: { patternType: string; fgColor: { rgb: string } }
  alignment?: { horizontal?: string; vertical?: string; wrapText?: boolean; indent?: number }
  border?: Record<string, { style: string; color: { rgb: string } }>
}
type StyledCell = { t?: string; v?: unknown; z?: string; s?: CellStyle }
type StyledSheet = Record<string, StyledCell | unknown>

function border(style = 'thin', color = 'CBD5E1') {
  return { style, color: { rgb: color } }
}

function bandStyle(theme: ExportTheme, kind: 'company' | 'title' | 'meta', last: boolean): CellStyle {
  const base: CellStyle = {
    alignment: { vertical: 'center', horizontal: 'left', wrapText: true },
    border: { left: border('medium', rgbHex(theme.primary)), right: border('thin', 'E2E8F0') },
  }
  if (kind === 'company') {
    return {
      ...base,
      font: { bold: true, sz: 16, color: { rgb: '0F172A' } },
      fill: { patternType: 'solid', fgColor: { rgb: rgbHex(theme.primaryLight) } },
      border: { ...base.border, top: border('medium', rgbHex(theme.primary)) },
    }
  }
  if (kind === 'title') {
    return {
      ...base,
      font: { bold: true, sz: 13, color: { rgb: rgbHex(theme.primary) } },
      fill: { patternType: 'solid', fgColor: { rgb: 'FFFFFF' } },
      border: { ...base.border, ...(last ? { bottom: border('medium', '94A3B8') } : {}) },
    }
  }
  return {
    ...base,
    font: { sz: 10, color: { rgb: '64748B' } },
    fill: { patternType: 'solid', fgColor: { rgb: 'F8FAFC' } },
    border: { ...base.border, ...(last ? { bottom: border('medium', '94A3B8') } : {}) },
  }
}

function applyMergedRowStyle(
  ws: StyledSheet,
  rowIndex: number,
  lastCol: number,
  style: CellStyle,
  encode: (a: { r: number; c: number }) => string,
): void {
  for (let c = 0; c <= lastCol; c += 1) {
    const ref = encode({ r: rowIndex, c })
    const cell = (ws[ref] as StyledCell | undefined) ?? { t: 's', v: '' }
    cell.s = style
    ws[ref] = cell
  }
}

/** Write the register as a styled `.xlsx`. */
export async function exportTabularExcel(payload: TabularExportPayload): Promise<void> {
  const XLSX = await import('xlsx-js-style')
  const theme = payload.theme ?? getExportTheme()
  const { columns, rows } = payload
  const { aoa, layout } = buildExcelAoa(payload)
  const encode = XLSX.utils.encode_cell

  const ws = XLSX.utils.aoa_to_sheet(aoa) as StyledSheet
  const { lastCol, headerRowIndex, dataStartRow, totalsRowIndex, notesStartRow, metaCount } = layout

  ws['!merges'] = [
    { s: { r: 0, c: 0 }, e: { r: 0, c: lastCol } },
    { s: { r: 1, c: 0 }, e: { r: 1, c: lastCol } },
    ...Array.from({ length: metaCount }, (_, i) => ({
      s: { r: i + 2, c: 0 },
      e: { r: i + 2, c: lastCol },
    })),
  ]
  ws['!cols'] = columns.map((c) => ({ wch: c.excelWidth }))
  // No frozen header row: SheetJS's community writer emits `<sheetView>`
  // without a `<pane>`, so setting `!freeze` would look like a feature and
  // produce nothing. The autofilter below is the part that does survive the
  // round trip, and it is what a reader reaches for first.

  applyMergedRowStyle(ws, 0, lastCol, bandStyle(theme, 'company', false), encode)
  applyMergedRowStyle(ws, 1, lastCol, bandStyle(theme, 'title', metaCount === 0), encode)
  for (let i = 0; i < metaCount; i += 1) {
    applyMergedRowStyle(ws, 2 + i, lastCol, bandStyle(theme, 'meta', i === metaCount - 1), encode)
  }

  columns.forEach((col, c) => {
    const cell = ws[encode({ r: headerRowIndex, c })] as StyledCell | undefined
    if (!cell) return
    cell.s = {
      font: { bold: true, sz: 10, color: { rgb: '64748B' } },
      fill: { patternType: 'solid', fgColor: { rgb: 'F9FAFB' } },
      alignment: { vertical: 'center', wrapText: true, horizontal: col.align },
      border: {
        top: border(),
        bottom: border('medium', '94A3B8'),
        left: border(),
        right: border(),
      },
    }
  })

  for (let r = dataStartRow; r < dataStartRow + rows.length; r += 1) {
    columns.forEach((col, c) => {
      const cell = ws[encode({ r, c })] as StyledCell | undefined
      if (!cell) return
      const fmt = excelNumberFormat(col)
      if (fmt && cell.t === 'n') cell.z = fmt
      cell.s = {
        font: { sz: 11, color: { rgb: col.tone === 'credit' ? 'DC2626' : '0F172A' } },
        alignment: { horizontal: col.align, vertical: 'center' },
      }
    })
  }

  if (totalsRowIndex >= 0) {
    columns.forEach((col, c) => {
      const cell = ws[encode({ r: totalsRowIndex, c })] as StyledCell | undefined
      if (!cell) return
      const fmt = excelNumberFormat(col)
      if (fmt && cell.t === 'n') cell.z = fmt
      cell.s = {
        font: { bold: true, sz: 11, color: { rgb: col.tone === 'credit' ? 'DC2626' : '0F172A' } },
        fill: { patternType: 'solid', fgColor: { rgb: rgbHex(theme.primaryLight) } },
        alignment: { horizontal: col.align, vertical: 'center' },
        border: { top: border('medium', '64748B'), bottom: border('medium', '64748B') },
      }
    })
  }

  const noteCount = (payload.excelNotes ?? []).filter(Boolean).length
  for (let i = 0; i < noteCount; i += 1) {
    const cell = ws[encode({ r: notesStartRow + i, c: 0 })] as StyledCell | undefined
    if (cell) {
      cell.s = {
        font: { sz: 9, italic: true, color: { rgb: rgbHex(theme.gray[700]) } },
        alignment: { horizontal: 'left', vertical: 'top', wrapText: true },
      }
    }
  }

  if (rows.length) {
    // The filter range deliberately stops short of the totals row, so filtering
    // can never hide the figure the reader came for.
    ws['!autofilter'] = {
      ref: XLSX.utils.encode_range(
        { r: headerRowIndex, c: 0 },
        { r: dataStartRow + rows.length - 1, c: lastCol },
      ),
    }
  }

  const wb = XLSX.utils.book_new()
  // Excel rejects a sheet name over 31 characters or containing []:*?/\
  const sheetName = (payload.sheetName ?? payload.title).replace(/[[\]:*?/\\]/g, ' ').slice(0, 31)
  XLSX.utils.book_append_sheet(wb, ws, sheetName || 'Register')
  XLSX.writeFile(wb, `${payload.filenameBase}.xlsx`)
}

/* -------------------------------------------------------------------- PDF */

const PDF_MARGIN = 10

function pdfFormat(paper: TabularSheetOptions['paperSize']): string {
  switch (paper) {
    case 'A3':
      return 'a3'
    case 'A5':
      return 'a5'
    case 'Letter':
      return 'letter'
    case 'Legal':
      return 'legal'
    default:
      return 'a4'
  }
}

function rgbArgs(rgb: RGB): [number, number, number] {
  return [rgb[0], rgb[1], rgb[2]]
}

interface PdfHeaderArgs {
  companyName: string
  addressLines: readonly string[]
  gstin?: string
  scopeLabel?: string
  title: string
  description?: string
  metaLines: readonly string[]
  rightLines: readonly string[]
  logo?: string | null
}

function logoFormat(dataUrl: string): string {
  const m = /^data:image\/(jpeg|jpg|png|webp|gif);/i.exec(dataUrl)
  const kind = (m?.[1] ?? 'png').toLowerCase()
  if (kind === 'jpg' || kind === 'jpeg') return 'JPEG'
  if (kind === 'webp') return 'WEBP'
  return 'PNG'
}

function drawHeader(doc: jsPDF, theme: ExportTheme, a: PdfHeaderArgs, pageWidth: number): number {
  const x = PDF_MARGIN
  const y = 8
  const w = pageWidth - PDF_MARGIN * 2

  const addrCount = a.addressLines.filter(Boolean).length
  const h =
    16 +
    addrCount * 3.4 +
    (a.gstin ? 3.8 : 0) +
    (a.description ? 4.6 : 0) +
    (a.scopeLabel ? 4 : 0) +
    (a.metaLines.length ? 4.4 : 0)

  doc.setFillColor(255, 255, 255)
  doc.setDrawColor(...rgbArgs(theme.gray[200]))
  doc.setLineWidth(0.2)
  doc.roundedRect(x, y, w, h, 1.5, 1.5, 'FD')
  doc.setFillColor(...rgbArgs(theme.primary))
  doc.rect(x, y, 1.2, h, 'F')

  let textX = x + 5
  if (a.logo) {
    try {
      doc.addImage(a.logo, logoFormat(a.logo), x + 5, y + 4, 14, 14, undefined, 'FAST')
      textX = x + 22
    } catch {
      // An undecodable logo must not cost the reader the whole document.
    }
  }
  const maxW = w - (textX - x) - 46

  let cursor = y + 6.5
  setLabelFont(doc, 'bold')
  doc.setFontSize(11)
  doc.setTextColor(...rgbArgs(theme.gray[900]))
  doc.text(a.companyName || ' ', textX, cursor, { maxWidth: maxW })

  setLabelFont(doc, 'normal')
  doc.setFontSize(7.5)
  doc.setTextColor(...rgbArgs(theme.gray[600]))
  for (const line of a.addressLines.filter(Boolean)) {
    cursor += 3.4
    doc.text(String(line), textX, cursor, { maxWidth: maxW })
  }
  if (a.gstin) {
    cursor += 3.8
    setLabelFont(doc, 'bold')
    doc.setTextColor(...rgbArgs(theme.gray[700]))
    doc.text(`GSTIN: ${a.gstin}`, textX, cursor, { maxWidth: maxW })
  }

  cursor += 6.5
  setLabelFont(doc, 'bold')
  doc.setFontSize(14)
  doc.setTextColor(...rgbArgs(theme.gray[900]))
  doc.text(a.title, textX, cursor, { maxWidth: maxW })

  if (a.description) {
    cursor += 4.6
    setLabelFont(doc, 'normal')
    doc.setFontSize(8)
    doc.setTextColor(...rgbArgs(theme.gray[500]))
    doc.text(a.description, textX, cursor, { maxWidth: maxW })
  }
  if (a.scopeLabel) {
    cursor += 4
    setLabelFont(doc, 'bold')
    doc.setFontSize(8)
    doc.setTextColor(...rgbArgs(theme.gray[600]))
    doc.text(a.scopeLabel, textX, cursor, { maxWidth: maxW })
  }
  if (a.metaLines.length) {
    cursor += 4.4
    setLabelFont(doc, 'bold')
    doc.setFontSize(6.8)
    doc.setTextColor(...rgbArgs(theme.gray[500]))
    doc.text(
      formatPdfCurrencyLabel(a.metaLines.filter(Boolean).slice(0, 4).join('   •   ')).toUpperCase(),
      textX,
      cursor,
      { maxWidth: maxW },
    )
  }

  if (a.rightLines.filter(Boolean).length) {
    setLabelFont(doc, 'normal')
    doc.setFontSize(8)
    doc.setTextColor(...rgbArgs(theme.gray[600]))
    let ry = y + 6.5
    for (const line of a.rightLines.filter(Boolean)) {
      doc.text(formatPdfCurrencyLabel(line), x + w - 5, ry, { align: 'right' })
      ry += 4
    }
  }

  doc.setTextColor(...rgbArgs(theme.gray[700]))
  return y + h + 3
}

/** The ink a KPI tone is drawn in. Anything else keeps the sheet's own colour. */
function toneColor(theme: ExportTheme, tone: string | undefined): RGB | null {
  if (tone === 'credit') return theme.red600
  if (tone === 'warn') return theme.amber600
  return null
}

function drawSummaryCards(
  doc: jsPDF,
  theme: ExportTheme,
  cards: readonly { label: string; value: string; hint?: string; tone?: string }[],
  x: number,
  y: number,
  width: number,
): number {
  if (!cards.length) return y
  const perRow = Math.min(cards.length, 5)
  const gap = 2.5
  const cardW = (width - gap * (perRow - 1)) / perRow
  const cardH = 15
  let cursorY = y

  cards.forEach((card, index) => {
    const col = index % perRow
    if (col === 0 && index > 0) cursorY += cardH + gap
    const cx = x + col * (cardW + gap)
    const accent = toneColor(theme, card.tone) ?? theme.primary

    doc.setFillColor(255, 255, 255)
    doc.setDrawColor(...rgbArgs(theme.gray[200]))
    doc.setLineWidth(0.2)
    doc.roundedRect(cx, cursorY, cardW, cardH, 1.2, 1.2, 'FD')
    doc.setFillColor(...rgbArgs(accent))
    doc.rect(cx, cursorY, 1.2, cardH, 'F')

    setLabelFont(doc, 'bold')
    doc.setFontSize(6.2)
    doc.setTextColor(...rgbArgs(theme.gray[500]))
    doc.text(formatPdfCurrencyLabel(card.label).toUpperCase(), cx + 3, cursorY + 4.2, {
      maxWidth: cardW - 6,
    })

    setLabelFont(doc, 'bold')
    doc.setFontSize(9)
    doc.setTextColor(...rgbArgs(toneColor(theme, card.tone) ?? theme.gray[900]))
    doc.text(formatPdfCurrencyLabel(card.value), cx + cardW - 3, cursorY + 9.5, {
      align: 'right',
      maxWidth: cardW - 6,
    })

    if (card.hint) {
      setLabelFont(doc, 'normal')
      doc.setFontSize(6)
      doc.setTextColor(...rgbArgs(theme.gray[500]))
      doc.text(formatPdfCurrencyLabel(card.hint), cx + 3, cursorY + 13, { maxWidth: cardW - 6 })
    }
  })

  doc.setTextColor(...rgbArgs(theme.gray[700]))
  return cursorY + cardH + 4
}

function drawNotes(
  doc: jsPDF,
  theme: ExportTheme,
  notes: readonly string[],
  x: number,
  y: number,
  width: number,
): number {
  const kept = notes.filter(Boolean)
  if (!kept.length) return y
  let cursor = y + 4
  setLabelFont(doc, 'normal')
  doc.setFontSize(8)
  doc.setTextColor(...rgbArgs(theme.gray[700]))
  for (const note of kept) {
    const lines = doc.splitTextToSize(String(note), width) as string[]
    if (cursor + lines.length * 4 > doc.internal.pageSize.getHeight() - 14) {
      doc.addPage()
      cursor = 16
    }
    for (const line of lines) {
      doc.text(line, x, cursor)
      cursor += 4
    }
    cursor += 1.5
  }
  return cursor
}

function drawSignatures(
  doc: jsPDF,
  theme: ExportTheme,
  signatures: readonly string[],
  x: number,
  y: number,
  width: number,
): void {
  if (!signatures.length) return
  let top = y + 16
  if (top > doc.internal.pageSize.getHeight() - 26) {
    doc.addPage()
    top = 30
  }
  const slot = width / signatures.length
  setLabelFont(doc, 'normal')
  doc.setFontSize(7.5)
  doc.setTextColor(...rgbArgs(theme.gray[600]))
  signatures.forEach((label, i) => {
    const cx = x + i * slot
    doc.setDrawColor(...rgbArgs(theme.gray[500]))
    doc.setLineWidth(0.2)
    doc.line(cx + 4, top, cx + slot - 4, top)
    doc.text(label, cx + slot / 2, top + 4, { align: 'center' })
  })
}

function stampPageFooters(doc: jsPDF, theme: ExportTheme, generatedAt: string): void {
  const pages = doc.getNumberOfPages()
  const pageWidth = doc.internal.pageSize.getWidth()
  const pageHeight = doc.internal.pageSize.getHeight()
  for (let page = 1; page <= pages; page += 1) {
    doc.setPage(page)
    setLabelFont(doc, 'normal')
    doc.setFontSize(7)
    doc.setTextColor(...rgbArgs(theme.gray[500]))
    doc.text('Aicountly Inventory', PDF_MARGIN, pageHeight - 5)
    if (generatedAt) doc.text(`Generated ${generatedAt}`, PDF_MARGIN + 32, pageHeight - 5)
    doc.text(`Page ${page} of ${pages}`, pageWidth - PDF_MARGIN, pageHeight - 5, { align: 'right' })
  }
}

interface AutoTableCellHook {
  section: 'head' | 'body' | 'foot'
  column: { index: number }
  cell: { styles: Record<string, unknown> }
}

function columnStyles(
  columns: readonly ExportColumn[],
  tableWidth: number,
): Record<number, Record<string, unknown>> {
  const total = columns.reduce((s, c) => s + (c.pdfWeight || 1), 0)
  const out: Record<number, Record<string, unknown>> = {}
  columns.forEach((col, i) => {
    out[i] = {
      halign: col.align,
      cellWidth: ((col.pdfWeight || 1) / total) * tableWidth,
      valign: 'middle',
    }
  })
  return out
}

async function newPdf(orientation: Orientation, paper: TabularSheetOptions['paperSize']) {
  const { jsPDF: Ctor } = await import('jspdf')
  const doc = new Ctor({ orientation, unit: 'mm', format: pdfFormat(paper) })
  try {
    await ensurePdfFonts(doc)
  } catch {
    // Offline or blocked CDN: Helvetica, and `Rs.` wherever ₹ would have gone.
    setLabelFont(doc, 'normal')
  }
  return doc
}

function tableBody(
  columns: readonly ExportColumn[],
  rows: readonly ExportRow[],
  rupee: boolean,
): string[][] {
  return rows.map((row) =>
    columns.map((c) => {
      const text = row[c.key]?.text ?? ''
      return rupee ? text : text.replace(/₹\s?/g, 'Rs. ')
    }),
  )
}

async function renderTable(
  doc: jsPDF,
  theme: ExportTheme,
  columns: readonly ExportColumn[],
  rows: readonly ExportRow[],
  totalsRow: ExportRow | null | undefined,
  totalsLabel: string | undefined,
  startY: number,
  tableWidth: number,
  runningHead: string,
): Promise<number> {
  if (!columns.length) return startY
  const { default: autoTable } = await import('jspdf-autotable')
  const rupee = supportsRupee(doc)
  const labelFont = labelFontName(doc)
  const amountFont = rupee ? AMOUNT_FONT : labelFont
  const labelIndex = totalsLabelIndex(columns)

  const foot = totalsRow
    ? [
        columns.map((c, i) => {
          let text = totalsRow[c.key]?.text ?? ''
          if (!text && i === labelIndex && totalsLabel) text = totalsLabel
          return rupee ? text : text.replace(/₹\s?/g, 'Rs. ')
        }),
      ]
    : undefined

  autoTable(doc, {
    startY,
    head: [columns.map((c) => formatPdfCurrencyLabel(c.label))],
    body: tableBody(columns, rows, rupee),
    foot,
    theme: 'plain',
    tableWidth,
    showHead: 'everyPage',
    showFoot: 'lastPage',
    styles: {
      font: labelFont,
      fontSize: 7.6,
      cellPadding: { top: 2, right: 2.4, bottom: 2, left: 2.4 },
      lineColor: rgbArgs(theme.gray[200]),
      lineWidth: 0.1,
      overflow: 'linebreak',
      minCellHeight: 5.6,
      textColor: rgbArgs(theme.gray[700]),
    },
    headStyles: {
      fillColor: rgbArgs(theme.gray[50]),
      textColor: rgbArgs(theme.gray[500]),
      font: labelFont,
      fontStyle: 'bold',
      fontSize: 6.8,
      lineWidth: { bottom: 0.3 },
      lineColor: rgbArgs(theme.gray[200]),
    },
    footStyles: {
      fillColor: rgbArgs(theme.primaryLight),
      textColor: rgbArgs(theme.gray[900]),
      font: amountFont,
      fontStyle: 'bold',
      fontSize: 7.8,
      lineWidth: { top: 0.3 },
      lineColor: rgbArgs(theme.gray[500]),
    },
    alternateRowStyles: { fillColor: rgbArgs(theme.gray[50]) },
    columnStyles: columnStyles(columns, tableWidth),
    margin: { top: 16, left: PDF_MARGIN, right: PDF_MARGIN, bottom: 12 },
    didParseCell: (data: AutoTableCellHook) => {
      const col = columns[data.column.index]
      if (!col) return
      if (isNumericFormat(col.format)) {
        data.cell.styles.halign = 'right'
        if (data.section !== 'head') data.cell.styles.font = amountFont
      }
      if (col.tone === 'credit' && data.section !== 'head') {
        data.cell.styles.textColor = rgbArgs(theme.red600)
      }
    },
    didDrawPage: (data: { pageNumber: number }) => {
      if (data.pageNumber > 1 && runningHead) {
        setLabelFont(doc, 'bold')
        doc.setFontSize(8)
        doc.setTextColor(...rgbArgs(theme.gray[900]))
        doc.text(runningHead, PDF_MARGIN, 10)
      }
    },
  } as never)

  const last = (doc as unknown as { lastAutoTable?: { finalY: number } }).lastAutoTable
  return last?.finalY ?? startY
}

/** Write the register as a paginated `.pdf`. */
export async function exportTabularPdf(payload: TabularExportPayload): Promise<void> {
  const theme = payload.theme ?? getExportTheme()
  const orientation = payload.orientation ?? 'landscape'
  const doc = await newPdf(orientation, payload.paperSize)
  const pageWidth = doc.internal.pageSize.getWidth()
  const tableWidth = pageWidth - PDF_MARGIN * 2

  let y = drawHeader(
    doc,
    theme,
    {
      companyName: payload.companyName ?? '',
      addressLines: payload.addressLines ?? [],
      gstin: payload.gstin,
      scopeLabel: payload.scopeLabel,
      title: payload.title,
      description: payload.description,
      metaLines: payload.metaLines ?? [],
      rightLines: [],
      logo: payload.logo,
    },
    pageWidth,
  )
  y = drawSummaryCards(doc, theme, payload.summaryCards ?? [], PDF_MARGIN, y, tableWidth)
  y = await renderTable(
    doc,
    theme,
    payload.columns,
    payload.rows,
    payload.totalsRow,
    payload.totalsLabel,
    y,
    tableWidth,
    `${payload.companyName ?? ''} — ${payload.title}`.trim(),
  )
  const notes = [...(payload.warningNote ? [payload.warningNote] : []), ...(payload.footerNotes ?? [])]
  drawNotes(doc, theme, notes, PDF_MARGIN, y, tableWidth)
  stampPageFooters(doc, theme, payload.generatedAt ?? '')

  doc.save(`${payload.filenameBase}.pdf`)
}

export interface DocumentExportPayload extends DocumentSheetOptions {
  filenameBase: string
}

/** Write one inventory document — challan, transfer, adjustment — as a `.pdf`. */
export async function exportDocumentPdf(payload: DocumentExportPayload): Promise<void> {
  const theme = payload.theme ?? getExportTheme()
  const orientation = payload.orientation ?? 'portrait'
  const doc = await newPdf(orientation, payload.paperSize)
  const pageWidth = doc.internal.pageSize.getWidth()
  const tableWidth = pageWidth - PDF_MARGIN * 2

  const baseRightLines = [
    payload.documentNo ? `No. ${payload.documentNo}` : '',
    payload.documentDate ? `Date ${payload.documentDate}` : '',
    ...(payload.headerPairs ?? []).map((p) => `${p.label}: ${p.value}`),
  ]

  // Party / warehouse / transport blocks read as cards on paper; in the PDF
  // they are the same information as a compact card strip.
  const blockCards = (payload.blocks ?? [])
    .filter((b) => b.value || (b.lines ?? []).some(Boolean))
    .map((b) => ({
      label: b.label,
      value: b.value ?? '',
      hint: (b.lines ?? []).filter(Boolean).join(', '),
    }))

  const footerLines = (payload.footerPairs ?? [])
    .filter((p) => p.value !== '')
    .map((p) => `${p.label}: ${p.value}`)

  // One captioned copy per label — the driver's and the consignee's copies are
  // not interchangeable, so each says which it is.
  const copies = payload.copies?.length ? payload.copies : [undefined]

  for (const [index, copyLabel] of copies.entries()) {
    if (index > 0) doc.addPage()

    let y = drawHeader(
      doc,
      theme,
      {
        companyName: payload.companyName ?? '',
        addressLines: payload.addressLines ?? [],
        gstin: payload.gstin,
        scopeLabel: payload.scopeLabel,
        title: payload.title,
        metaLines: [],
        rightLines: copyLabel ? [...baseRightLines, copyLabel.toUpperCase()] : baseRightLines,
        logo: payload.logo,
      },
      pageWidth,
    )

    y = drawSummaryCards(doc, theme, blockCards, PDF_MARGIN, y, tableWidth)

    y = await renderTable(
      doc,
      theme,
      payload.columns,
      payload.rows,
      payload.totalsRow,
      payload.totalsLabel,
      y,
      tableWidth,
      `${payload.title} ${payload.documentNo ?? ''}`.trim(),
    )

    y = drawNotes(
      doc,
      theme,
      [...footerLines, ...(payload.footerNotes ?? []), ...(payload.provenance ? [payload.provenance] : [])],
      PDF_MARGIN,
      y,
      tableWidth,
    )
    drawSignatures(doc, theme, payload.signatures ?? [], PDF_MARGIN, y, tableWidth)
  }

  stampPageFooters(doc, theme, payload.generatedAt ?? '')

  doc.save(`${payload.filenameBase}.pdf`)
}

/* ------------------------------------------------------------------ print */

/**
 * Print a prepared document through a hidden iframe.
 *
 * Returns false when the iframe could not be created, so the caller can say so
 * rather than leave a button that appears to do nothing.
 */
export function printHtmlDocument(html: string): boolean {
  if (typeof document === 'undefined') return false
  const frame = document.createElement('iframe')
  frame.setAttribute('aria-hidden', 'true')
  frame.setAttribute('title', 'Print preview')
  frame.style.cssText =
    'position:fixed;right:0;bottom:0;width:0;height:0;border:0;visibility:hidden'
  document.body.appendChild(frame)

  const win = frame.contentWindow
  const doc = frame.contentDocument ?? win?.document
  if (!win || !doc) {
    frame.remove()
    return false
  }

  doc.open()
  doc.write(html)
  doc.close()

  const run = () => {
    try {
      win.focus()
      win.print()
    } finally {
      // Long enough for the print dialog to take its own snapshot; removing the
      // iframe synchronously cancels the job in WebKit.
      window.setTimeout(() => frame.remove(), 1000)
    }
  }

  const fonts = (doc as Document & { fonts?: { ready: Promise<unknown> } }).fonts
  if (fonts?.ready) void fonts.ready.then(run, run)
  else window.setTimeout(run, 120)
  return true
}

export function printTabular(options: TabularSheetOptions): boolean {
  return printHtmlDocument(buildTabularPrintHtml(options))
}

export function printDocumentSheet(options: DocumentSheetOptions): boolean {
  return printHtmlDocument(buildDocumentPrintHtml(options))
}
