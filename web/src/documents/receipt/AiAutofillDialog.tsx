import { useEffect, useState } from 'react'
import { FileText, Loader2, Sparkles, TriangleAlert, Upload } from 'lucide-react'
import { Modal } from '../../components/Modal'
import { errorMessage } from '../../services/api'
import { Button } from '../../ui/Button'
import { cx } from '../../ui/cx'
import { formatMoney, formatQty } from '../../utils/format'
import { aiInvoiceApi } from './integrations'
import type { ExtractedReceipt } from './integrations'
import type { ExtractionPatch } from './receiptSources'

export interface AiAutofillDialogProps {
  open: boolean
  onClose: () => void
  /** Turns the raw extraction into what the form would actually receive. */
  toPatch: (extraction: ExtractedReceipt) => ExtractionPatch
  onApply: (patch: ExtractionPatch, mode: 'replace' | 'append') => void
}

const ACCEPT = '.pdf,.jpg,.jpeg,.png'
const MAX_BYTES = 10 * 1024 * 1024

function confidenceTone(confidence: number | null | undefined): { label: string; cls: string } | null {
  if (confidence === null || confidence === undefined) return null
  const pct = Math.round(confidence * 100)
  if (confidence >= 0.85) return { label: `${pct}% confident`, cls: 'bg-emerald-50 text-emerald-700' }
  if (confidence >= 0.6) return { label: `${pct}% confident — check it`, cls: 'bg-amber-50 text-amber-800' }
  return { label: `${pct}% confident — check every line`, cls: 'bg-red-50 text-red-700' }
}

/**
 * Read a supplier invoice or challan and PROPOSE the receipt.
 *
 * Three steps, and the third is a person: upload, extract, confirm. Nothing is
 * saved and nothing is posted from here — the reader fills a form, the user
 * checks it, and the ordinary Save & post does the rest. A receipt moves real
 * stock at a real cost, and no extraction confidence is a good enough reason to
 * skip the person who signed for the goods.
 *
 * What it will not do: overwrite the receipt date (that is the day the goods
 * reached the store, not the date on the invoice), and add a line whose item it
 * could not match — those are listed, not guessed.
 */
export function AiAutofillDialog({ open, onClose, toPatch, onApply }: AiAutofillDialogProps) {
  const [file, setFile] = useState<File | null>(null)
  const [busy, setBusy] = useState(false)
  const [patch, setPatch] = useState<ExtractionPatch | null>(null)
  const [confidence, setConfidence] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [dragging, setDragging] = useState(false)

  useEffect(() => {
    if (open) return
    setFile(null)
    setPatch(null)
    setConfidence(null)
    setError(null)
    setBusy(false)
  }, [open])

  const take = (picked: File | null | undefined) => {
    if (!picked) return
    if (!/\.(pdf|jpe?g|png)$/i.test(picked.name)) {
      setError('Only PDF, JPG and PNG invoices can be read.')
      return
    }
    if (picked.size > MAX_BYTES) {
      setError('That file is larger than 10 MB.')
      return
    }
    setError(null)
    setFile(picked)
  }

  const extract = async () => {
    if (!file) return
    setBusy(true)
    setError(null)
    try {
      const extraction = await aiInvoiceApi.extract(file)
      setConfidence(extraction.confidence ?? null)
      setPatch(toPatch(extraction))
    } catch (err) {
      setError(errorMessage(err, 'The invoice could not be read. Enter the details by hand.'))
    } finally {
      setBusy(false)
    }
  }

  const tone = confidenceTone(confidence)
  const headerEntries = patch
    ? ([
        ['Supplier', patch.header.party_name],
        ['Supplier ledger', patch.header.party_ref],
        ['Reference no.', patch.header.reference],
        ['Reference date', patch.header.reference_date],
      ] as const).filter(([, value]) => Boolean(value))
    : []

  return (
    <Modal
      open={open}
      title="Read a supplier invoice"
      description="The document is read and the fields are proposed. You confirm before anything reaches the receipt."
      onClose={onClose}
      size="lg"
      busy={busy}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          {patch ? (
            <>
              <Button variant="secondary" onClick={() => onApply(patch, 'append')} disabled={patch.lines.length === 0}>
                Add to the lines
              </Button>
              <Button onClick={() => onApply(patch, 'replace')}>Use these details</Button>
            </>
          ) : (
            <Button icon={Sparkles} onClick={() => void extract()} loading={busy} disabled={!file}>
              Read invoice
            </Button>
          )}
        </>
      }
    >
      {!patch ? (
        <div
          onDragOver={(e) => {
            e.preventDefault()
            setDragging(true)
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => {
            e.preventDefault()
            setDragging(false)
            take(e.dataTransfer.files?.[0])
          }}
          className={cx(
            'rounded-xl border border-dashed px-4 py-8 text-center transition-colors',
            dragging ? 'border-primary bg-primary-light' : 'border-gray-300 bg-white',
          )}
        >
          {file ? (
            <>
              <FileText className="w-7 h-7 mx-auto mb-2 text-primary" aria-hidden />
              <p className="text-sm font-medium text-gray-900 m-0 truncate">{file.name}</p>
              <p className="text-[11px] text-gray-500 mt-0.5 mb-2">{Math.max(1, Math.round(file.size / 1024))} KB</p>
              <Button variant="ghost" size="sm" onClick={() => setFile(null)} disabled={busy}>
                Choose another
              </Button>
            </>
          ) : (
            <>
              <Upload className="w-7 h-7 mx-auto mb-2 text-gray-400" aria-hidden />
              <p className="text-sm font-medium text-gray-700 m-0">Drop the invoice or challan here</p>
              <p className="text-[11px] text-gray-500 mt-0.5 mb-2">PDF, JPG or PNG · up to 10 MB</p>
              <label className="inline-flex">
                <input
                  type="file"
                  accept={ACCEPT}
                  className="hidden"
                  onChange={(e) => {
                    take(e.target.files?.[0])
                    e.target.value = ''
                  }}
                />
                <span className="inline-flex items-center h-8 px-3 rounded-lg border border-gray-200 bg-white text-sm font-medium text-gray-700 cursor-pointer hover:border-primary/40 hover:bg-primary-light hover:text-primary transition-colors">
                  Choose a file
                </span>
              </label>
            </>
          )}
          {busy ? (
            <p className="mt-3 text-[11px] text-gray-500 inline-flex items-center gap-1.5">
              <Loader2 className="w-3 h-3 animate-spin" aria-hidden /> Reading the document…
            </p>
          ) : null}
        </div>
      ) : (
        <div className="space-y-3">
          {tone ? (
            <span className={cx('inline-flex items-center gap-1.5 rounded-lg px-2 py-1 text-[11px] font-semibold', tone.cls)}>
              <Sparkles className="w-3.5 h-3.5" aria-hidden />
              {tone.label}
            </span>
          ) : null}

          {headerEntries.length > 0 ? (
            <div>
              <h4 className="text-[11px] font-semibold uppercase tracking-wide text-gray-500 mb-1">Header</h4>
              <dl className="grid grid-cols-2 gap-x-4 gap-y-1 m-0">
                {headerEntries.map(([label, value]) => (
                  <div key={label} className="contents">
                    <dt className="text-xs text-gray-500">{label}</dt>
                    <dd className="text-xs font-medium text-gray-900 m-0 truncate">{String(value)}</dd>
                  </div>
                ))}
              </dl>
            </div>
          ) : null}

          <div>
            <h4 className="text-[11px] font-semibold uppercase tracking-wide text-gray-500 mb-1">
              {patch.lines.length} line{patch.lines.length === 1 ? '' : 's'} matched to an item
            </h4>
            {patch.lines.length === 0 ? (
              <p className="text-xs text-gray-500 m-0">No line could be matched — add the items by hand.</p>
            ) : (
              <ul className="space-y-1 list-none p-0 m-0 max-h-60 overflow-y-auto">
                {patch.lines.map((line) => (
                  <li key={line.key} className="flex items-baseline justify-between gap-3 rounded-lg border border-gray-200 px-2.5 py-1.5">
                    <span className="min-w-0">
                      <span className="block text-xs font-medium text-gray-900 truncate">{line.item_name}</span>
                      <span className="block text-[11px] text-gray-500">
                        {[line.item_sku, line.batch_no].filter(Boolean).join(' · ') || '—'}
                      </span>
                    </span>
                    <span className="text-[11px] tabular-nums text-gray-600 shrink-0">
                      {formatQty(line.qty, '—')} × {formatMoney(line.rate, '—')}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {patch.notes.length > 0 ? (
            <ul className="space-y-1 list-none p-0 m-0">
              {patch.notes.map((note) => (
                <li key={note} className="flex items-start gap-1.5 text-[11px] font-medium text-amber-800">
                  <TriangleAlert className="w-3.5 h-3.5 mt-px shrink-0" aria-hidden />
                  <span>{note}</span>
                </li>
              ))}
            </ul>
          ) : null}

          <p className="text-[11px] text-gray-500 m-0">
            “Use these details” replaces the lines on the receipt; “Add to the lines” keeps what is already there. The
            receipt date is never changed — that is the day the goods arrived.
          </p>
        </div>
      )}

      {error ? <p className="mt-3 text-xs font-medium text-red-600">{error}</p> : null}
    </Modal>
  )
}

export default AiAutofillDialog
