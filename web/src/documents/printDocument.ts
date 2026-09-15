/**
 * Printing an inventory document, singly or in bulk.
 *
 * This is the one place the snapshot-first rule is implemented. The register's
 * bulk print goes through `loadDocumentSheet`; the single-document screen
 * (`DocumentPrintPage`) runs the same rule through `loadDocumentSource` so it
 * can keep building its preview reactively from the masters it has loaded. Both
 * reach the same function, which is the point: a statutory document has to
 * print the same way every time it is printed. A bulk print that re-derived its
 * figures from the live document would hand a reader a second copy of a challan
 * that does not match the first — different party address after a master edit,
 * different unit symbol after a UoM rename, different value after a revaluation.
 *
 * The rule:
 *
 *   ask for the print snapshot;
 *   ONLY a 404 — meaning no snapshot was ever captured — falls through to the
 *   live document;
 *   any other failure is a real failure and is reported, never papered over
 *   with a live render.
 *
 * Everything except `bulkPrintDocuments` is pure string / object work, so the
 * merge and the fallback order are unit-testable without a DOM.
 */

import { COPY_SETS, buildDocumentSheet, defaultCopySet } from '../export/documentSheet'
import type { CopySetId, DocumentSheetBody } from '../export/documentSheet'
import { printHtmlDocument } from '../export/documentExport'
import { buildDocumentPrintHtml, escapeHtml } from '../export/sheetHtml'
import type { DocumentSheetOptions, SheetIdentity } from '../export/sheetHtml'
import { getExportTheme } from '../export/exportTheme'
import { isApiError } from '../services/api'
import { documentsApi } from '../services/documentsApi'
import { formatGeneratedStamp } from '../utils/format'
import { labelForCode } from './registry'
import type { InventoryDocument, PrintSnapshot } from './types'

export interface DocumentSheetDeps {
  /** Master lookup used ONLY on the live path — see export/documentSheet.ts. */
  warehouseName?: (id: number | null) => string
  typeLabel?: (code: string) => string
}

/** Exactly one of the two is set: the frozen record, or the live document. */
export interface DocumentSource {
  snapshot: PrintSnapshot | null
  live: InventoryDocument | null
}

/**
 * THE snapshot-first rule. There is no second implementation of it.
 *
 * Ask for the immutable print snapshot; ONLY a 404 — meaning no snapshot was
 * ever captured — falls through to the live document. Any other failure is a
 * real failure and is rethrown, because a 403 or a 500 must not silently become
 * a live render that looks like the record.
 *
 * Split out from `loadDocumentSheet` so `DocumentPrintPage` can run the rule
 * through its own `useQuery` and still build the sheet reactively from the
 * masters it has loaded — without owning a second copy of the fallback order.
 * Two copies drift: one gets relaxed to "render live data on any error" during
 * an outage and the same challan then prints two different ways depending on
 * which screen it was printed from.
 */
export async function loadDocumentSource(
  documentId: number,
  signal?: AbortSignal,
): Promise<DocumentSource> {
  try {
    return { snapshot: await documentsApi.printSnapshot(documentId, signal), live: null }
  } catch (err) {
    if (!(isApiError(err) && err.status === 404)) throw err
  }
  return { snapshot: null, live: await documentsApi.get(documentId, signal) }
}

/**
 * One document's sheet body, snapshot first.
 *
 * Throws whatever the API threw when the snapshot request failed for a reason
 * other than "there is no snapshot" — see `loadDocumentSource`.
 */
export async function loadDocumentSheet(
  documentId: number,
  deps: DocumentSheetDeps = {},
  signal?: AbortSignal,
): Promise<DocumentSheetBody | null> {
  const typeLabel = deps.typeLabel ?? ((code: string) => labelForCode(code))
  const { snapshot, live } = await loadDocumentSource(documentId, signal)
  return buildDocumentSheet({ snapshot, live, ...deps, typeLabel })
}

/**
 * The print / PDF options for one sheet.
 *
 * Shared with `DocumentPrintPage` so a bulk print and a single print are the
 * same document: same copy set, same orientation, same paper, same theme.
 */
export function documentSheetOptions(
  sheet: DocumentSheetBody,
  identity: SheetIdentity,
  copySet?: CopySetId | null,
): DocumentSheetOptions {
  return {
    ...identity,
    title: sheet.title,
    documentNo: sheet.documentNo,
    documentDate: sheet.documentDate,
    headerPairs: sheet.headerPairs,
    blocks: sheet.blocks,
    columns: sheet.columns,
    rows: sheet.rows,
    totalsRow: sheet.totalsRow,
    totalsLabel: sheet.totalsLabel,
    footerPairs: sheet.footerPairs,
    footerNotes: sheet.footerNotes,
    provenance: sheet.provenance,
    copies: COPY_SETS[copySet ?? defaultCopySet(sheet.documentCode)],
    orientation: 'portrait',
    paperSize: 'A4',
    theme: getExportTheme(),
  }
}

/* ------------------------------------------------------------------- merge */

/**
 * The exact wrapper `export/sheetHtml.ts::htmlDocument` emits. Splicing on it
 * rather than parsing HTML is safe because we are the only producer of these
 * strings, and `mergeDocumentPrintHtml` returns null the moment a string does
 * not look like one of ours — the caller then reports a failure instead of
 * printing a partial batch.
 */
const BODY_OPEN = '<body><div class="sheet">'
const BODY_CLOSE = '</div></body></html>'
const PAGE_BREAK = '<div class="page-break"></div>'

/** The sheet markup inside one generated document, or null if it is not ours. */
export function sheetBodyOf(html: string): string | null {
  const start = html.indexOf(BODY_OPEN)
  const end = html.lastIndexOf(BODY_CLOSE)
  if (start < 0 || end < 0 || end <= start + BODY_OPEN.length) return null
  return html.slice(start + BODY_OPEN.length, end)
}

/**
 * Several generated documents as ONE printable document, page-broken between
 * them — so a bulk print opens one print dialog and produces one job, with a
 * letterheaded sheet (and its copies) per document.
 *
 * Returns null if any input is not a document this module produced, rather
 * than dropping it: a print job quietly missing a challan is worse than one
 * that did not start.
 */
export function mergeDocumentPrintHtml(htmls: readonly string[], title?: string): string | null {
  if (htmls.length === 0) return null
  const bodies: string[] = []
  for (const html of htmls) {
    const body = sheetBodyOf(html)
    if (body === null) return null
    bodies.push(body)
  }
  const first = htmls[0]
  const start = first.indexOf(BODY_OPEN) + BODY_OPEN.length
  const end = first.lastIndexOf(BODY_CLOSE)
  const merged = first.slice(0, start) + bodies.join(PAGE_BREAK) + first.slice(end)
  if (!title) return merged
  return merged.replace(/<title>[\s\S]*?<\/title>/, `<title>${escapeHtml(title)}</title>`)
}

/* -------------------------------------------------------------- bulk print */

export interface BulkPrintFailure {
  documentId: number
  reason: string
}

export interface BulkPrintResult {
  /** Documents whose sheet was built and included in the job. */
  printed: number
  failures: BulkPrintFailure[]
  /** False when nothing could be printed, or the print window was refused. */
  opened: boolean
}

export interface BulkPrintOptions extends DocumentSheetDeps {
  identity: SheetIdentity
  /** Forced copy set; by default each document takes its own default. */
  copySet?: CopySetId | null
  generatedAt?: string
  /** Seam for tests; defaults to the real iframe printer. */
  print?: (html: string) => boolean
}

function reasonOf(err: unknown): string {
  if (isApiError(err)) return err.message || `Request failed (${err.status})`
  if (err instanceof Error) return err.message
  return 'Unknown error'
}

/**
 * Print one letterheaded sheet per document, snapshot first.
 *
 * Documents are loaded in the order given (the order they were ticked in the
 * register) and every one that fails is reported by id — a caller must be able
 * to say "3 of 5 printed, and which two did not".
 */
export async function bulkPrintDocuments(
  documentIds: readonly number[],
  options: BulkPrintOptions,
): Promise<BulkPrintResult> {
  const { identity, copySet, warehouseName, typeLabel } = options
  const print = options.print ?? printHtmlDocument
  const generatedAt = options.generatedAt ?? formatGeneratedStamp()

  const htmls: string[] = []
  const failures: BulkPrintFailure[] = []

  for (const documentId of documentIds) {
    try {
      const sheet = await loadDocumentSheet(documentId, { warehouseName, typeLabel })
      if (!sheet) {
        failures.push({ documentId, reason: 'This document has no printable content.' })
        continue
      }
      htmls.push(
        buildDocumentPrintHtml({
          ...documentSheetOptions(sheet, identity, copySet),
          generatedAt,
        }),
      )
    } catch (err) {
      failures.push({ documentId, reason: reasonOf(err) })
    }
  }

  if (htmls.length === 0) return { printed: 0, failures, opened: false }

  const title = htmls.length === 1 ? undefined : `${htmls.length} inventory documents`
  const merged = mergeDocumentPrintHtml(htmls, title)
  if (merged === null) {
    return {
      printed: 0,
      failures: [
        ...failures,
        { documentId: 0, reason: 'The print sheets could not be combined into one document.' },
      ],
      opened: false,
    }
  }

  return { printed: htmls.length, failures, opened: print(merged) }
}
