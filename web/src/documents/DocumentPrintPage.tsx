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
import { errorMessage, isApiError } from '../services/api'
import { documentsApi } from '../services/documentsApi'
import { formatDateTime } from '../utils/format'
import { COPY_SETS, COPY_SET_LABELS, buildDocumentSheet, defaultCopySet } from '../export/documentSheet'
import type { CopySetId } from '../export/documentSheet'
import { DocumentSheetPreview } from '../export/DocumentSheetPreview'
import { exportDocumentPdf, printDocumentSheet } from '../export/documentExport'
import { exportErrorMessage } from '../export/exportActions'
import { getExportTheme } from '../export/exportTheme'
import { useExportIdentity } from '../export/useExportIdentity'
import type { DocumentSheetOptions } from '../export/sheetHtml'
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

  const snapshot = useQuery((signal) => documentsApi.printSnapshot(docId, signal), [docId], {
    enabled: Number.isFinite(docId),
  })
  // Only a 404 means "no snapshot was captured". Any other failure is a real
  // error and must not be papered over with a live render.
  const missing = !!snapshot.error && isApiError(snapshot.error) && snapshot.error.status === 404
  const live = useQuery((signal) => documentsApi.get(docId, signal), [docId], { enabled: missing })

  const sheet = useMemo(
    () =>
      buildDocumentSheet({
        snapshot: snapshot.data ?? null,
        live: live.data ?? null,
        warehouseName,
        typeLabel: (code) => labelForCode(code),
      }),
    [snapshot.data, live.data, warehouseName],
  )

  // A goods movement defaults to three captioned copies; an internal record to
  // one. The reader can override, and the choice applies to print and PDF alike.
  const effectiveCopySet: CopySetId = copySet ?? (sheet ? defaultCopySet(sheet.documentCode) : 'single')

  const sheetOptions = useMemo<DocumentSheetOptions | null>(() => {
    if (!sheet) return null
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
      copies: COPY_SETS[effectiveCopySet],
      orientation: 'portrait',
      paperSize: 'A4',
      generatedAt: formatDateTime(new Date().toISOString().replace('T', ' ')),
      theme: getExportTheme(),
    }
  }, [sheet, identity, effectiveCopySet])

  const runPrint = useCallback(() => {
    if (!sheetOptions) return
    setBusy('print')
    try {
      if (!printDocumentSheet(sheetOptions)) {
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
      await exportDocumentPdf({ ...sheetOptions, filenameBase: sheet.filenameBase })
      notify.success(`${sheet.title} downloaded as PDF.`)
    } catch (err) {
      notify.error(exportErrorMessage(err, 'PDF export failed.'))
    } finally {
      setBusy(null)
    }
  }, [sheetOptions, sheet])

  // Ctrl+P prints the sheet, not the surrounding app.
  usePageKeyboard({ onPrint: runPrint })

  if (snapshot.loading || (missing && live.loading)) {
    return (
      <PageShell compact>
        <LoadingState label="Loading document…" />
      </PageShell>
    )
  }

  if (snapshot.error && !missing) {
    return (
      <PageShell compact>
        <ErrorState
          title="This document could not be loaded"
          description={errorMessage(snapshot.error)}
          onRetry={snapshot.reload}
        />
      </PageShell>
    )
  }

  if (!sheet || !sheetOptions) {
    return (
      <PageShell compact>
        <ErrorState
          title="Nothing to print"
          description={live.error ? errorMessage(live.error) : 'This document has no printable content.'}
          onRetry={missing ? live.reload : snapshot.reload}
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
