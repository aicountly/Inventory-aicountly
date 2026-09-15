/**
 * The printed page.
 *
 * Books builds a complete, self-contained HTML document and hands it to a
 * hidden iframe rather than printing the app itself
 * (books-react-app/web/src/modules/reports/shared/reportDocumentExport.js).
 * Three things fall out of that choice and all of them matter here:
 *
 *  - the sheet cannot be broken by an app stylesheet, a `print:hidden` class
 *    that was forgotten, or a component that happens to be scrolled;
 *  - printing never navigates away and never disturbs what is on screen;
 *  - the same builder produces the print preview and the PDF, so a challan and
 *    a register look like two pages of one product.
 *
 * Two documents are built here — a tabular sheet (registers, reports) and a
 * voucher sheet (delivery challans, transfers, every native document type).
 * They share the company header, the paper CSS and the footer, which is what
 * makes them recognisably the same stationery.
 *
 * Everything in this file is pure. No DOM, no network, fully unit-tested.
 */

import type { ExportColumn, ExportRow } from './exportColumns'
import { columnWidthPercents } from './exportColumns'
import type { ExportTheme } from './exportTheme'
import { getExportTheme, rgbCss } from './exportTheme'

const ESCAPES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
}

/** Every caller-supplied string passes through here before it reaches the page. */
export function escapeHtml(value: unknown): string {
  if (value === null || value === undefined) return ''
  return String(value).replace(/[&<>"']/g, (ch) => ESCAPES[ch] ?? ch)
}

export type PaperSize = 'A4' | 'A5' | 'A3' | 'Letter' | 'Legal'
export type Orientation = 'portrait' | 'landscape'

export interface SheetIdentity {
  companyName?: string
  /** Free-form registered-office lines. Empty until Manage relays an address. */
  addressLines?: readonly string[]
  gstin?: string
  /** Data URL. Never a remote URL — the print iframe may render before it loads. */
  logo?: string | null
  /** `Acme Ltd · FY 2026-27 · Head office`, from `useScopeLabel()`. */
  scopeLabel?: string
}

export interface SheetSummaryCard {
  label: string
  value: string
  hint?: string
  /**
   * The emphasis the card carries on screen. `credit` is the house red for a
   * figure that is wrong or negative, `warn` the amber for one that needs
   * watching. A card the reader is meant to notice has to stay noticeable on
   * paper, or the emphasis is the one thing the export loses.
   */
  tone?: 'default' | 'credit' | 'warn'
}

export interface TabularSheetOptions extends SheetIdentity {
  title: string
  description?: string
  /** Period, filters, row count — one pill each. */
  metaLines?: readonly string[]
  summaryCards?: readonly SheetSummaryCard[]
  columns: readonly ExportColumn[]
  rows: readonly ExportRow[]
  /** The server's total over the whole filtered set, not the page on screen. */
  totalsRow?: ExportRow | null
  totalsLabel?: string
  footerNotes?: readonly string[]
  /** A red line when the export pager capped the result. */
  warningNote?: string
  orientation?: Orientation
  paperSize?: PaperSize
  /** Injected so the builder stays pure. */
  generatedAt?: string
  theme?: ExportTheme
  emptyMessage?: string
}

/* ------------------------------------------------------------------ paper */

function pageRule(paperSize: PaperSize, orientation: Orientation): string {
  return `@page { size: ${paperSize} ${orientation}; margin: 10mm 8mm 12mm; }`
}

/**
 * The house stylesheet, shared by both sheets.
 *
 * Fixed light surfaces on purpose: the screen may be in dark mode and paper
 * has no dark mode, so only the accent travels from the live theme.
 */
export function buildSheetCss(theme: ExportTheme): string {
  const g = theme.gray
  return `
*, *::before, *::after { box-sizing: border-box; }
html, body { margin: 0; padding: 0; background: #fff; }
body {
  font-family: ${theme.fontFamily};
  font-size: 11px;
  line-height: 1.4;
  color: ${rgbCss(g[700])};
  -webkit-print-color-adjust: exact;
  print-color-adjust: exact;
}
.sheet { padding: 12px 14px; }
.card {
  background: #fff;
  border: 1px solid ${rgbCss(g[200])};
  border-left: 3px solid ${rgbCss(theme.primary)};
  border-radius: 10px;
  box-shadow: ${theme.cardShadow};
  padding: 10px 14px;
  margin-bottom: 9px;
}
.head-top { display: flex; align-items: flex-start; gap: 12px; }
.logo { width: 52px; height: 52px; object-fit: contain; flex-shrink: 0; }
.head-text { flex: 1; min-width: 0; }
.head-right { text-align: right; flex-shrink: 0; font-size: 9.5px; color: ${rgbCss(g[500])}; line-height: 1.55; }
.company { font-size: 13px; font-weight: 800; color: ${rgbCss(g[900])}; letter-spacing: .01em; }
.addr { font-size: 9.5px; color: ${rgbCss(g[600])}; margin-top: 1px; }
.gstin { font-size: 9.5px; font-weight: 700; color: ${rgbCss(g[700])}; margin-top: 2px; font-variant-numeric: tabular-nums; }
.title { font-size: 16px; font-weight: 800; color: ${rgbCss(g[900])}; margin-top: 6px; }
.desc { font-size: 10px; color: ${rgbCss(g[500])}; margin-top: 2px; max-width: 78ch; }
.scope { font-size: 10px; color: ${rgbCss(g[600])}; margin-top: 2px; font-weight: 600; }
.pills { margin-top: 8px; display: flex; flex-wrap: wrap; gap: 5px; }
.pill {
  display: inline-block; padding: 3px 9px; border-radius: 999px;
  background: ${rgbCss(theme.primaryLight, 0.65)};
  border: 1px solid ${rgbCss(theme.primary, 0.25)};
  color: ${rgbCss(g[700])};
  font-size: 8.5px; font-weight: 700; text-transform: uppercase; letter-spacing: .04em;
}
.cards { display: grid; grid-template-columns: repeat(auto-fit, minmax(118px, 1fr)); gap: 7px; margin-bottom: 9px; }
.kpi {
  background: #fff; border: 1px solid ${rgbCss(g[200])}; border-left: 3px solid ${rgbCss(theme.primary)};
  border-radius: 10px; padding: 8px 10px; box-shadow: ${theme.cardShadow};
}
.kpi.credit { border-left-color: ${rgbCss(theme.red600)}; }
.kpi.warn { border-left-color: ${rgbCss(theme.amber600)}; }
.kpi .k { font-size: 8px; font-weight: 800; text-transform: uppercase; letter-spacing: .05em; color: ${rgbCss(g[500])}; }
.kpi .v { margin-top: 3px; font-size: 13px; font-weight: 800; color: ${rgbCss(g[900])}; font-variant-numeric: tabular-nums; }
.kpi.credit .v { color: ${rgbCss(theme.red600)}; }
.kpi.warn .v { color: ${rgbCss(theme.amber600)}; }
.kpi .h { margin-top: 1px; font-size: 8.5px; color: ${rgbCss(g[500])}; }
.table-card {
  background: #fff; border: 1px solid ${rgbCss(g[200])}; border-radius: 10px;
  box-shadow: ${theme.cardShadow}; overflow: hidden;
}
table { width: 100%; border-collapse: collapse; }
thead { display: table-header-group; }
tfoot { display: table-footer-group; }
tr { break-inside: avoid; page-break-inside: avoid; }
th, td { padding: 4px 8px; border-bottom: 1px solid ${rgbCss(g[100])}; vertical-align: top; text-align: left; }
th {
  background: ${rgbCss(g[50])}; color: ${rgbCss(g[500])};
  font-size: 8.5px; font-weight: 800; text-transform: uppercase; letter-spacing: .05em;
  border-bottom: 1px solid ${rgbCss(g[200])}; white-space: nowrap;
}
td { font-size: 10px; color: ${rgbCss(g[700])}; word-break: break-word; }
td.num, th.num { text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; font-family: 'Noto Sans', ${theme.fontFamily}; }
td.mid, th.mid { text-align: center; }
td.credit { color: ${rgbCss(theme.red600)}; }
td.name { font-weight: 600; color: ${rgbCss(g[900])}; }
tbody tr:nth-child(even) td { background: ${rgbCss(g[50], 0.6)}; }
tfoot td {
  background: ${rgbCss(theme.primaryLight, 0.55)};
  font-weight: 800; color: ${rgbCss(g[900])};
  border-top: 1.5px solid ${rgbCss(g[500])}; border-bottom: none;
  font-size: 10.5px;
}
tfoot td.credit { color: ${rgbCss(theme.red600)}; }
.empty { padding: 26px; text-align: center; color: ${rgbCss(g[500])}; font-size: 11px; }
.notes { margin-top: 9px; padding: 9px 12px; background: #fff; border: 1px solid ${rgbCss(g[200])}; border-radius: 10px; }
.note { margin: 0 0 4px; font-size: 9.5px; color: ${rgbCss(g[700])}; }
.note:last-child { margin-bottom: 0; }
.warn { margin-top: 8px; font-size: 9.5px; color: ${rgbCss(theme.red600)}; font-weight: 700; }
.foot-bar {
  margin-top: 10px; padding: 0 3px; display: flex; justify-content: space-between;
  font-size: 8.5px; color: ${rgbCss(g[500])};
}
.blocks { display: flex; flex-wrap: wrap; gap: 9px; margin-bottom: 9px; }
.block {
  flex: 1 1 200px; background: #fff; border: 1px solid ${rgbCss(g[200])};
  border-left: 3px solid ${rgbCss(theme.primary)}; border-radius: 10px; padding: 8px 12px;
  box-shadow: ${theme.cardShadow};
}
.block .k { font-size: 8px; font-weight: 800; text-transform: uppercase; letter-spacing: .06em; color: ${rgbCss(g[500])}; }
.block .n { font-size: 12px; font-weight: 800; color: ${rgbCss(g[900])}; margin-top: 2px; }
.block .l { font-size: 9.5px; color: ${rgbCss(g[600])}; margin-top: 1px; }
.pairs { display: grid; grid-template-columns: repeat(auto-fit, minmax(160px, 1fr)); gap: 2px 14px; }
.pair { font-size: 9.5px; color: ${rgbCss(g[700])}; }
.pair .k { color: ${rgbCss(g[500])}; text-transform: none; letter-spacing: 0; font-weight: 600; font-size: 9.5px; }
.sign { margin-top: 26px; display: flex; justify-content: space-between; gap: 20px; }
.sign div { flex: 1; text-align: center; font-size: 9px; color: ${rgbCss(g[600])};
  border-top: 1px solid ${rgbCss(g[500])}; padding-top: 4px; }
.prov { margin-top: 8px; font-size: 8.5px; color: ${rgbCss(g[500])}; font-style: italic; }
.copy-tag {
  display: inline-block; margin-top: 4px; padding: 2px 8px; border-radius: 999px;
  border: 1px solid ${rgbCss(theme.primary, 0.35)}; background: ${rgbCss(theme.primaryLight, 0.7)};
  color: ${rgbCss(g[700])}; font-size: 8px; font-weight: 800;
  text-transform: uppercase; letter-spacing: .06em;
}
.page-break { break-after: page; page-break-after: always; height: 0; }
.page-break:last-child { break-after: auto; page-break-after: auto; }
`.trim()
}

/* ----------------------------------------------------------------- pieces */

function headerCard(
  id: SheetIdentity,
  title: string,
  description: string | undefined,
  metaLines: readonly string[],
  rightLines: readonly string[],
  copyLabel?: string,
): string {
  const logo = id.logo ? `<img class="logo" src="${escapeHtml(id.logo)}" alt="" />` : ''
  const addr = (id.addressLines ?? [])
    .filter(Boolean)
    .map((line) => `<div class="addr">${escapeHtml(line)}</div>`)
    .join('')
  const gstin = id.gstin ? `<div class="gstin">GSTIN: ${escapeHtml(id.gstin)}</div>` : ''
  const company = id.companyName ? `<div class="company">${escapeHtml(id.companyName)}</div>` : ''
  const scope = id.scopeLabel ? `<div class="scope">${escapeHtml(id.scopeLabel)}</div>` : ''
  const desc = description ? `<div class="desc">${escapeHtml(description)}</div>` : ''
  const pills = metaLines.filter(Boolean).length
    ? `<div class="pills">${metaLines
        .filter(Boolean)
        .map((line) => `<span class="pill">${escapeHtml(line)}</span>`)
        .join('')}</div>`
    : ''
  const copyTag = copyLabel ? `<div class="copy-tag">${escapeHtml(copyLabel)}</div>` : ''
  const right = rightLines.filter(Boolean).length || copyTag
    ? `<div class="head-right">${rightLines
        .filter(Boolean)
        .map((line) => `<div>${escapeHtml(line)}</div>`)
        .join('')}${copyTag}</div>`
    : ''

  return `<div class="card"><div class="head-top">${logo}<div class="head-text">${company}${addr}${gstin}<div class="title">${escapeHtml(
    title,
  )}</div>${desc}${scope}${pills}</div>${right}</div></div>`
}

function summaryCardsHtml(cards: readonly SheetSummaryCard[]): string {
  if (!cards.length) return ''
  return `<div class="cards">${cards
    .map(
      (c) =>
        `<div class="kpi${c.tone && c.tone !== 'default' ? ` ${c.tone}` : ''}"><div class="k">${escapeHtml(
          c.label,
        )}</div><div class="v">${escapeHtml(c.value)}</div>${
          c.hint ? `<div class="h">${escapeHtml(c.hint)}</div>` : ''
        }</div>`,
    )
    .join('')}</div>`
}

function cellClass(col: ExportColumn, isName: boolean): string {
  const classes: string[] = []
  if (col.align === 'right') classes.push('num')
  else if (col.align === 'center') classes.push('mid')
  if (col.tone === 'credit') classes.push('credit')
  if (isName) classes.push('name')
  return classes.length ? ` class="${classes.join(' ')}"` : ''
}

function headClass(col: ExportColumn): string {
  if (col.align === 'right') return ' class="num"'
  if (col.align === 'center') return ' class="mid"'
  return ''
}

/** The first free-text column carries the row's name and gets the emphasis. */
export function nameColumnIndex(columns: readonly ExportColumn[]): number {
  const index = columns.findIndex((c) => c.format === 'text')
  return index >= 0 ? index : 0
}

/**
 * Where a totals label goes when the totals row leaves every cell blank.
 *
 * It must be the column the *screen* puts it in, or the printed footer and the
 * on-screen footer disagree about which figure is labelled what.
 * `registers/registerTotals.ts` picks the first column that is not
 * right-aligned, so this does too.
 */
export function totalsLabelIndex(columns: readonly ExportColumn[]): number {
  const index = columns.findIndex((c) => c.align !== 'right')
  return index >= 0 ? index : 0
}

function notesHtml(notes: readonly string[]): string {
  const kept = notes.filter(Boolean)
  if (!kept.length) return ''
  return `<div class="notes">${kept.map((n) => `<p class="note">${escapeHtml(n)}</p>`).join('')}</div>`
}

function footBar(generatedAt: string | undefined, product: string): string {
  return `<div class="foot-bar"><span>${escapeHtml(product)}</span><span>${
    generatedAt ? `Generated ${escapeHtml(generatedAt)}` : ''
  }</span></div>`
}

/**
 * Font faces are per-document, so the print iframe inherits nothing from the
 * SPA around it. Without this link the sheet asks for Nunito and Noto Sans and
 * silently falls through to whatever the OS offers, while the PDF — which
 * embeds both faces — comes out in the real ones. Same register, two products.
 *
 * A stylesheet blocks rendering until it answers, and this one is on a CDN the
 * reader's network may not reach. `data-webfont` is how the print path finds it
 * again: see WEBFONT_LINK_SELECTOR in documentExport.ts, which drops it once
 * the wait is over so the sheet prints in the fallback stack rather than not
 * at all.
 */
function fontLinks(theme: ExportTheme): string {
  if (!theme.googleFontsUrl) return ''
  return `<link rel="preconnect" href="https://fonts.googleapis.com" />
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
<link href="${escapeHtml(theme.googleFontsUrl)}" rel="stylesheet" data-webfont="1" />`
}

function htmlDocument(title: string, theme: ExportTheme, css: string, body: string): string {
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8" />
<title>${escapeHtml(title)}</title>
${fontLinks(theme)}
<style>${css}</style>
</head><body><div class="sheet">${body}</div></body></html>`
}

/* ---------------------------------------------------------------- tabular */

/** A register / report as a standalone printable document. */
export function buildTabularPrintHtml(options: TabularSheetOptions): string {
  const {
    title,
    description,
    metaLines = [],
    summaryCards = [],
    columns,
    rows,
    totalsRow,
    totalsLabel,
    footerNotes = [],
    warningNote,
    orientation = 'landscape',
    paperSize = 'A4',
    generatedAt,
    emptyMessage = 'No rows match these filters.',
  } = options
  const theme = options.theme ?? getExportTheme()

  const widths = columnWidthPercents(columns)
  const colgroup = `<colgroup>${columns
    .map((_, i) => `<col style="width:${widths[i].toFixed(3)}%">`)
    .join('')}</colgroup>`

  const head = `<thead><tr>${columns
    .map((c) => `<th${headClass(c)}>${escapeHtml(c.label)}</th>`)
    .join('')}</tr></thead>`

  const nameIndex = nameColumnIndex(columns)
  const body = rows.length
    ? `<tbody>${rows
        .map(
          (row) =>
            `<tr>${columns
              .map(
                (c, i) =>
                  `<td${cellClass(c, i === nameIndex)}>${escapeHtml(row[c.key]?.text ?? '')}</td>`,
              )
              .join('')}</tr>`,
        )
        .join('')}</tbody>`
    : `<tbody><tr><td colspan="${columns.length}" class="empty">${escapeHtml(
        emptyMessage,
      )}</td></tr></tbody>`

  // The totals row is the server's figure for the whole filtered set. It is
  // printed even when the page on screen is 1 of 17 — that is the difference
  // between a register and a screenshot of a table.
  let foot = ''
  if (totalsRow) {
    const labelIndex = totalsLabelIndex(columns)
    const cells = columns.map((c, i) => {
      let text = totalsRow[c.key]?.text ?? ''
      if (!text && i === labelIndex && totalsLabel) text = totalsLabel
      return `<td${cellClass(c, false)}>${escapeHtml(text)}</td>`
    })
    foot = `<tfoot><tr>${cells.join('')}</tr></tfoot>`
  }

  const bodyHtml = [
    headerCard({ ...options }, title, description, metaLines, []),
    summaryCardsHtml(summaryCards),
    `<div class="table-card"><table>${colgroup}${head}${body}${foot}</table></div>`,
    warningNote ? `<div class="warn">${escapeHtml(warningNote)}</div>` : '',
    notesHtml(footerNotes),
    footBar(generatedAt, 'Aicountly Inventory'),
  ].join('')

  return htmlDocument(
    title,
    theme,
    `${pageRule(paperSize, orientation)}\n${buildSheetCss(theme)}`,
    bodyHtml,
  )
}

/* --------------------------------------------------------------- document */

export interface SheetBlock {
  /** `Supplier`, `From warehouse`, `Transport`. */
  label: string
  /** The headline value — a party name, a warehouse name. */
  value?: string
  /** Address / reference lines under it. */
  lines?: readonly string[]
}

export interface SheetPair {
  label: string
  value: string
}

export interface DocumentSheetOptions extends SheetIdentity {
  /** `Delivery challan`, `Stock transfer`. */
  title: string
  /** `DC-000412` */
  documentNo?: string
  /** Already formatted for display. */
  documentDate?: string
  /** Status, currency, anything that belongs beside the number. */
  headerPairs?: readonly SheetPair[]
  /** Party / from / to / transport cards. */
  blocks?: readonly SheetBlock[]
  columns: readonly ExportColumn[]
  rows: readonly ExportRow[]
  totalsRow?: ExportRow | null
  totalsLabel?: string
  /** Narration, terms, footer snapshot fields. */
  footerPairs?: readonly SheetPair[]
  footerNotes?: readonly string[]
  /** `Prepared by` / `Authorised signatory` etc. Empty array prints none. */
  signatures?: readonly string[]
  /**
   * Where the printed figures came from. A snapshot is the legally meaningful
   * answer and the page says so; a live render says that too, because the
   * reader needs to know the difference.
   */
  provenance?: string
  /**
   * Copy captions, one printed sheet each — `Original for Consignee`,
   * `Duplicate for Transporter`, `Triplicate for Consignor`.
   *
   * A goods movement travels with more than one copy and each is annotated for
   * whoever keeps it. Printing one sheet three times leaves the driver and the
   * consignee holding identical paper with no way to tell which is whose, so
   * the caption is part of the document, not an instruction to the printer.
   * Omit for a single unmarked sheet.
   */
  copies?: readonly string[]
  orientation?: Orientation
  paperSize?: PaperSize
  generatedAt?: string
  theme?: ExportTheme
}

function blocksHtml(blocks: readonly SheetBlock[]): string {
  const kept = blocks.filter((b) => b.value || (b.lines ?? []).some(Boolean))
  if (!kept.length) return ''
  return `<div class="blocks">${kept
    .map(
      (b) =>
        `<div class="block"><div class="k">${escapeHtml(b.label)}</div>${
          b.value ? `<div class="n">${escapeHtml(b.value)}</div>` : ''
        }${(b.lines ?? [])
          .filter(Boolean)
          .map((l) => `<div class="l">${escapeHtml(l)}</div>`)
          .join('')}</div>`,
    )
    .join('')}</div>`
}

function pairsHtml(pairs: readonly SheetPair[], className: string): string {
  const kept = pairs.filter((p) => p.value !== '')
  if (!kept.length) return ''
  return `<div class="${className}">${kept
    .map(
      (p) =>
        `<div class="pair"><span class="k">${escapeHtml(p.label)}: </span>${escapeHtml(p.value)}</div>`,
    )
    .join('')}</div>`
}

/** One native inventory document — challan, transfer, adjustment — on paper. */
export function buildDocumentPrintHtml(options: DocumentSheetOptions): string {
  const {
    title,
    documentNo,
    documentDate,
    headerPairs = [],
    blocks = [],
    columns,
    rows,
    totalsRow,
    totalsLabel,
    footerPairs = [],
    footerNotes = [],
    signatures = ['Prepared by', 'Checked by', 'Authorised signatory'],
    provenance,
    orientation = 'portrait',
    paperSize = 'A4',
    generatedAt,
  } = options
  const theme = options.theme ?? getExportTheme()

  const rightLines = [
    documentNo ? `No. ${documentNo}` : '',
    documentDate ? `Date ${documentDate}` : '',
    ...headerPairs.map((p) => `${p.label}: ${p.value}`),
  ]

  const widths = columnWidthPercents(columns)
  const colgroup = `<colgroup>${columns
    .map((_, i) => `<col style="width:${widths[i].toFixed(3)}%">`)
    .join('')}</colgroup>`
  const head = `<thead><tr>${columns
    .map((c) => `<th${headClass(c)}>${escapeHtml(c.label)}</th>`)
    .join('')}</tr></thead>`
  const nameIndex = nameColumnIndex(columns)
  const body = rows.length
    ? `<tbody>${rows
        .map(
          (row) =>
            `<tr>${columns
              .map(
                (c, i) =>
                  `<td${cellClass(c, i === nameIndex)}>${escapeHtml(row[c.key]?.text ?? '')}</td>`,
              )
              .join('')}</tr>`,
        )
        .join('')}</tbody>`
    : `<tbody><tr><td colspan="${columns.length}" class="empty">This document has no lines.</td></tr></tbody>`
  let foot = ''
  if (totalsRow) {
    const labelIndex = totalsLabelIndex(columns)
    const cells = columns.map((c, i) => {
      let text = totalsRow[c.key]?.text ?? ''
      if (!text && i === labelIndex && totalsLabel) text = totalsLabel
      return `<td${cellClass(c, false)}>${escapeHtml(text)}</td>`
    })
    foot = `<tfoot><tr>${cells.join('')}</tr></tfoot>`
  }

  const signHtml = signatures.length
    ? `<div class="sign">${signatures.map((s) => `<div>${escapeHtml(s)}</div>`).join('')}</div>`
    : ''

  // One sheet per copy, each captioned for whoever keeps it.
  const copyLabels = options.copies?.length ? options.copies : [undefined]
  const sheets = copyLabels.map((copyLabel) =>
    [
      headerCard({ ...options }, title, undefined, [], rightLines, copyLabel),
      blocksHtml(blocks),
      `<div class="table-card"><table>${colgroup}${head}${body}${foot}</table></div>`,
      footerPairs.length ? `<div class="card">${pairsHtml(footerPairs, 'pairs')}</div>` : '',
      notesHtml(footerNotes),
      signHtml,
      provenance ? `<div class="prov">${escapeHtml(provenance)}</div>` : '',
      footBar(generatedAt, 'Aicountly Inventory'),
    ].join(''),
  )

  return htmlDocument(
    documentNo ? `${title} ${documentNo}` : title,
    theme,
    `${pageRule(paperSize, orientation)}\n${buildSheetCss(theme)}`,
    sheets.join('<div class="page-break"></div>'),
  )
}
