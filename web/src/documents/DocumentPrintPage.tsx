import { useCallback, useMemo, useState } from 'react'
import { useParams } from 'react-router-dom'
import { FileText, Printer, ShieldCheck, TriangleAlert } from 'lucide-react'
import { Badge } from '../ui/Badge'
import { Select } from '../ui/Select'
import { Button } from '../ui/Button'
import { ErrorState } from '../ui/ErrorState'
import { LoadingState } from '../ui/LoadingState'
import { notify } from '../ui/notify'
import { PageShell } from '../ui/shell/PageShell'
import { BreadcrumbHeader } from '../ui/shell/BreadcrumbHeader'
import { useQuery } from '../hooks/useQuery'
import { usePageKeyboard } from '../keyboard/usePageKeyboard'
import { errorMessage } from '../services/api'
import { formatGeneratedStamp } from '../utils/format'
import { COPY_SETS, COPY_SET_LABELS, buildDocumentSheet, defaultCopySet } from '../export/documentSheet'
import type { CopySetId } from '../export/documentSheet'
import { DocumentSheetPreview } from '../export/DocumentSheetPreview'
import { exportDocumentPdf, printDocumentSheet } from '../export/documentExport'
import { exportErrorMessage } from '../export/exportActions'
import { useExportIdentity } from '../export/useExportIdentity'
import type { DocumentSheetOptions } from '../export/sheetHtml'
import { documentSheetOptions, loadDocumentSource } from './printDocument'
import { labelForCode } from './registry'
import { useReferenceData } from './useReferenceData'

/**
 * `/documents/:id/print` — the immutable print snapshot, or the live document
 * when none was captured.
 *
 * The fallback order is the whole point and is unchanged from the screen this
 * replaces: ask for the snapshot; only a 404 (no snapshot exists) falls through
 * to the live document, and the page says which one it is showing. What is new
 * is that the preview, the print sheet and the PDF are all built from one
 * `DocumentSheetBody`, so a printed challan is the same document as the one on
 * screen — and it is drawn in the same house style as a printed register.
 *
 * See `src/export/documentSheet.ts` for why a snapshot print never touches a
 * live master.
 */
export function DocumentPrintPage() {
  const { id } = useParams()
  const docId = Number(id)
  const { warehouseName } = useReferenceData()
  const identity = useExportIdentity()
  const [busy, setBusy] = useState<'print' | 'pdf' | null>(null)
  const [copySet, setCopySet] = useState<CopySetId | null>(null)

  /*
   * Snapshot first, live only on a 404 — and the rule itself lives in
   * `printDocument.ts`, which is also what the register's bulk print calls.
   * This screen used to carry its own copy of the fallback order, so relaxing
   * one of the two (say, to render live data on any snapshot error during an
   * outage) would have printed the same challan two different ways depending on
   * which screen it was printed from.
   */
  const source = useQuery((signal) => loadDocumentSource(docId, signal), [docId], {
    enabled: Number.isFinite(docId),
  })

  // Built here rather than inside the query so the preview re-derives when the
  // warehouse masters arrive: only the LIVE path reads them, and a live render
  // must not be stuck showing "Warehouse #3" because it happened to load first.
  const sheet = useMemo(
    () =>
      buildDocumentSheet({
        snapshot: source.data?.snapshot ?? null,
        live: source.data?.live ?? null,
        warehouseName,
        typeLabel: (code) => labelForCode(code),
      }),
    [source.data, warehouseName],
  )

  // A goods movement defaults to three captioned copies; an internal record to
  // one. The reader can override, and the choice applies to print and PDF alike.
  const effectiveCopySet: CopySetId = copySet ?? (sheet ? defaultCopySet(sheet.documentCode) : 'single')

  // Built by the shared helper, which the register's bulk print also calls: one
  // challan printed from here and the same challan printed in a batch of forty
  // have to be the same piece of paper.
  const sheetOptions = useMemo<DocumentSheetOptions | null>(
    () => (sheet ? documentSheetOptions(sheet, identity, effectiveCopySet) : null),
    [sheet, identity, effectiveCopySet],
  )

  const runPrint = useCallback(() => {
    if (!sheetOptions) return
    setBusy('print')
    try {
      // Stamped here, not in the memo: the sheet says when it was printed.
      if (!printDocumentSheet({ ...sheetOptions, generatedAt: formatGeneratedStamp() })) {
        notify.error('The print sheet could not be opened. Check the browser’s popup settings.')
      }
    } finally {
      setBusy(null)
    }
  }, [sheetOptions])

  const runPdf = useCallback(async () => {
    if (!sheetOptions || !sheet) return
    setBusy('pdf')
    try {
      await exportDocumentPdf({ ...sheetOptions, filenameBase: sheet.filenameBase, generatedAt: formatGeneratedStamp() })
      notify.success(`${sheet.title} downloaded as PDF.`)
    } catch (err) {
      notify.error(exportErrorMessage(err, 'PDF export failed.'))
    } finally {
      setBusy(null)
    }
  }, [sheetOptions, sheet])

  // Ctrl+P prints the sheet, not the surrounding app.
  usePageKeyboard({ onPrint: runPrint })

  if (source.loading) {
    return (
      <PageShell compact>
        <LoadingState label="Loading document…" />
      </PageShell>
    )
  }

  // A 403 or a 500 on the snapshot is rethrown by `loadDocumentSource` and
  // lands here as a red page. It is NEVER papered over with a live render that
  // would look like the record and is not.
  if (source.error) {
    return (
      <PageShell compact>
        <ErrorState
          title="This document could not be loaded"
          description={errorMessage(source.error)}
          onRetry={source.reload}
        />
      </PageShell>
    )
  }

  if (!sheet || !sheetOptions) {
    return (
      <PageShell compact>
        <ErrorState
          title="Nothing to print"
          description="This document has no printable content."
          onRetry={source.reload}
        />
      </PageShell>
    )
  }

  const fromSnapshot = sheet.source === 'snapshot'

  return (
    <PageShell compact>
      <BreadcrumbHeader
        breadcrumbs={[
          { label: 'Documents', to: '/documents' },
          { label: sheet.documentNo || `#${docId}`, to: `/documents/${docId}` },
          { label: 'Print' },
        ]}
        title={sheet.title}
        description={sheet.documentNo ? `${sheet.documentNo} · ${sheet.documentDate}` : sheet.documentDate}
        icon={FileText}
        backTo={`/documents/${docId}`}
        backLabel="Back to document"
        badge={
          <Badge tone={fromSnapshot ? 'success' : 'warning'}>
            {fromSnapshot ? 'Snapshot' : 'Live document'}
          </Badge>
        }
        actions={
          <div className="flex flex-wrap items-center gap-1.5 print:hidden">
            <Select
              size="sm"
              aria-label="Copies to print"
              value={effectiveCopySet}
              onChange={(e) => setCopySet(e.target.value as CopySetId)}
              className="w-56"
            >
              {(Object.keys(COPY_SETS) as CopySetId[]).map((id) => (
                <option key={id} value={id}>
                  {COPY_SET_LABELS[id]}
                </option>
              ))}
            </Select>
            <Button
              variant="secondary"
              size="sm"
              icon={FileText}
              onClick={() => void runPdf()}
              loading={busy === 'pdf'}
              disabled={busy !== null}
            >
              Download PDF
            </Button>
            <Button
              variant="primary"
              size="sm"
              icon={Printer}
              onClick={runPrint}
              loading={busy === 'print'}
              disabled={busy !== null}
              kbd="Ctrl+P"
            >
              Print
            </Button>
          </div>
        }
      />

      {/*
        Provenance is not decoration. A reader holding two copies of the same
        challan needs to know which one is the record and which one is a view
        of something that can still change.
      */}
      <div
        className={`flex items-start gap-2 rounded-lg border px-3 py-2 text-xs print:hidden ${
          fromSnapshot
            ? 'border-primary/30 bg-primary-light/50 text-gray-700'
            : 'border-amber-300 bg-amber-50 text-amber-900'
        }`}
      >
        {fromSnapshot ? (
          <ShieldCheck className="mt-px h-4 w-4 shrink-0 text-primary" />
        ) : (
          <TriangleAlert className="mt-px h-4 w-4 shrink-0 text-amber-600" />
        )}
        <span>{sheet.provenance}</span>
      </div>

      <DocumentSheetPreview sheet={sheet} identity={identity} />
    </PageShell>
  )
}

export default DocumentPrintPage
