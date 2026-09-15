/**
 * Export a dashboard to PDF.
 *
 * Not a screenshot. The browser's own print pipeline is handed a purpose-built
 * document containing the SAME figures the screen is showing, laid out for
 * paper: the scope line, the KPI figures with their definitions, and every
 * table in full rather than the eight rows a card has room for.
 *
 * Why not print the live DOM: a dashboard card scrolls, clips and lazy-renders.
 * Printing it produces a page with half a table on it and a scrollbar drawn
 * down the side — the specific failure this function exists to avoid. Building
 * the sheet from data instead means:
 *
 *  - every row the caller passes is on the page, and where the caller only HAS
 *    a page of rows it says so in a note rather than implying it is the lot;
 *  - `thead` repeats on every page (`display: table-header-group`) and rows do
 *    not break across pages, so a long table reads correctly on paper;
 *  - charts are replaced by their own data tables, which is what a chart is for
 *    on paper anyway — no clipped SVG, no missing web font, no lost icons;
 *  - the definitions travel WITH the figures, so a printed "24" is still
 *    reconcilable a week later.
 *
 * The house stylesheet, the accent and the letterhead all come from the
 * existing export pipeline (`src/export`), so a dashboard PDF looks like a
 * register PDF and a document PDF.
 */

import { getExportTheme, rgbCss } from '../export/exportTheme'
import { buildSheetCss, escapeHtml } from '../export/sheetHtml'
import { printHtmlDocument } from '../export/documentExport'
import { formatGeneratedStamp } from '../utils/format'

export interface DashboardExportTable {
  title: string
  columns: readonly string[]
  rows: readonly (readonly string[])[]
  /** Said out loud when the rows are a subset — never implied by silence. */
  note?: string
  /** Column indexes to right-align (figures). */
  numericColumns?: readonly number[]
}

export interface DashboardExportOptions {
  title: string
  description: string
  companyName: string
  fyLabel: string
  branchLabel: string
  warehouseLabel: string
  asOf: string
  /** ISO timestamp the server computed the figures at. */
  generatedAt: string | null
  /** `[label, value, definition]` — the definition is printed under the figure. */
  metrics: readonly (readonly [string, string | null, string])[]
  tables: readonly DashboardExportTable[]
  /** Methodology and caveats, printed at the foot. */
  notes?: readonly string[]
  /** Injected in tests so the output is deterministic. */
  now?: Date
}

export function buildDashboardPrintHtml(options: DashboardExportOptions): string {
  const {
    title,
    description,
    companyName,
    fyLabel,
    branchLabel,
    warehouseLabel,
    asOf,
    generatedAt,
    metrics,
    tables,
    notes = [],
    now = new Date(),
  } = options

  const theme = getExportTheme()
  const scopeLine = [companyName || 'Company', fyLabel, branchLabel, warehouseLabel, `As at ${asOf}`]
    .filter(Boolean)
    .join(' · ')

  const metricCards = metrics
    .map(
      ([label, value, definition]) => `
        <div class="kpi">
          <div class="kpi-label">${escapeHtml(label)}</div>
          <div class="kpi-value">${escapeHtml(value ?? 'Unavailable')}</div>
          <div class="kpi-def">${escapeHtml(definition)}</div>
        </div>`,
    )
    .join('')

  const tableHtml = tables
    .map((table) => {
      const numeric = new Set(table.numericColumns ?? [])
      const head = table.columns
        .map((c, i) => `<th scope="col"${numeric.has(i) ? ' class="num"' : ''}>${escapeHtml(c)}</th>`)
        .join('')
      const body =
        table.rows.length === 0
          ? `<tr><td colspan="${table.columns.length}" class="empty">Nothing to show for this scope.</td></tr>`
          : table.rows
              .map(
                (row) =>
                  `<tr>${row
                    .map((cell, i) => `<td${numeric.has(i) ? ' class="num"' : ''}>${escapeHtml(cell)}</td>`)
                    .join('')}</tr>`,
              )
              .join('')
      return `
        <section class="block">
          <h2>${escapeHtml(table.title)}</h2>
          ${table.note ? `<p class="note">${escapeHtml(table.note)}</p>` : ''}
          <table>
            <thead><tr>${head}</tr></thead>
            <tbody>${body}</tbody>
          </table>
        </section>`
    })
    .join('')

  const noteHtml = notes.length
    ? `<section class="block notes">
         <h2>How these figures are counted</h2>
         <ul>${notes.map((n) => `<li>${escapeHtml(n)}</li>`).join('')}</ul>
       </section>`
    : ''

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>${escapeHtml(title)}</title>
<style>
${buildSheetCss(theme)}
/* Dashboard-specific layout on top of the house sheet. */
@page { size: A4 portrait; margin: 12mm 10mm 14mm; }
.head { border-bottom: 2px solid ${rgbCss(theme.primary)}; padding-bottom: 8px; margin-bottom: 12px; }
.head h1 { margin: 0; font-size: 18px; }
.head .desc { margin: 2px 0 0; font-size: 11px; color: #555; }
.head .scope { margin: 4px 0 0; font-size: 10px; color: #333; font-weight: 600; }
.head .stamp { margin: 2px 0 0; font-size: 9px; color: #666; }
.kpis { display: grid; grid-template-columns: repeat(2, 1fr); gap: 8px; margin-bottom: 14px; }
.kpi { border: 1px solid #dce6df; border-radius: 6px; padding: 8px; break-inside: avoid; }
.kpi-label { font-size: 9px; text-transform: uppercase; letter-spacing: .04em; color: #596b63; }
.kpi-value { font-size: 16px; font-weight: 700; margin-top: 2px; }
.kpi-def { font-size: 8.5px; color: #666; margin-top: 3px; line-height: 1.35; }
.block { margin-bottom: 14px; }
.block h2 { font-size: 12px; margin: 0 0 4px; }
.block .note { font-size: 9px; color: #925600; margin: 0 0 4px; }
.block table { width: 100%; border-collapse: collapse; font-size: 9.5px; }
.block th { background: #f1f6f3; text-align: left; padding: 5px 6px; border-bottom: 1px solid #dce6df; }
.block td { padding: 5px 6px; border-bottom: 1px solid #eef2ef; }
.block .num { text-align: right; font-variant-numeric: tabular-nums; }
.block .empty { text-align: center; color: #666; padding: 14px; }
.notes ul { margin: 0; padding-left: 16px; }
.notes li { font-size: 9px; color: #444; line-height: 1.45; margin-bottom: 3px; }
/* The two rules that make a long table survive paper: the header repeats on
   every page, and a row never splits across a page break. The CONTAINER is
   deliberately breakable — a table pinned with break-inside:avoid simply runs
   off the bottom of page one. */
thead { display: table-header-group; }
tr { break-inside: avoid; }
.block { break-inside: auto; }
</style>
</head>
<body>
<header class="head">
  <h1>${escapeHtml(title)}</h1>
  <p class="desc">${escapeHtml(description)}</p>
  <p class="scope">${escapeHtml(scopeLine)}</p>
  <p class="stamp">Generated ${escapeHtml(formatGeneratedStamp(now))}${
    generatedAt ? ` · figures computed ${escapeHtml(generatedAt)}` : ''
  }</p>
</header>
<section class="kpis">${metricCards}</section>
${tableHtml}
${noteHtml}
</body>
</html>`
}

/** Build the sheet and hand it to the browser's print dialog. */
export function exportDashboardPdf(options: DashboardExportOptions): boolean {
  return printHtmlDocument(buildDashboardPrintHtml(options))
}
