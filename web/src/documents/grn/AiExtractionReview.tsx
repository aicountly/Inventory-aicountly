import { useEffect, useMemo, useState } from 'react'
import { AlertTriangle, ShieldCheck } from 'lucide-react'
import { Badge } from '../../ui/Badge'
import { Button } from '../../ui/Button'
import { Drawer } from '../../ui/Drawer'
import { cx } from '../../ui/cx'
import { formatDate, formatMoney, formatQty } from '../../utils/format'
import type { ExtractedLine, GrnExtraction } from '../../services/aiDocumentApi'

export interface AiExtractionApproval {
  supplier: boolean
  reference: boolean
  documentDate: boolean
  /** Indices into `extraction.lines` the user accepted. */
  lineIndexes: number[]
}

export interface AiExtractionReviewProps {
  open: boolean
  extraction: GrnExtraction | null
  fileName: string | null
  onClose: () => void
  onApply: (approval: AiExtractionApproval) => void
}

function confidenceTone(confidence: number | null): 'success' | 'warning' | 'neutral' {
  if (confidence === null) return 'neutral'
  if (confidence >= 0.85) return 'success'
  return 'warning'
}

function confidenceLabel(confidence: number | null): string | null {
  return confidence === null ? null : `${Math.round(confidence * 100)}%`
}

/**
 * The approval step between an extraction and the form.
 *
 * This is the whole reason the AI panel is safe to have: everything read out of a supplier's
 * paperwork is listed here, per field and per line, and only what is ticked reaches the draft.
 * Lines the extractor could not match to an Inventory item are shown too — they come in as a
 * named line the clerk then picks the item for, which is more useful than silently dropping them
 * and far safer than guessing.
 *
 * Nothing here saves or posts anything. It fills a draft, and the draft is still reviewed,
 * validated and confirmed before it moves a single unit of stock.
 */
export function AiExtractionReview({ open, extraction, fileName, onClose, onApply }: AiExtractionReviewProps) {
  const [supplier, setSupplier] = useState(true)
  const [reference, setReference] = useState(true)
  const [documentDate, setDocumentDate] = useState(false)
  const [skipped, setSkipped] = useState<Set<number>>(new Set())

  // A fresh extraction starts from a fresh set of choices: carrying the previous document's
  // ticks over to the next one is how a value nobody looked at gets applied.
  useEffect(() => {
    if (!open) return
    setSupplier(true)
    setReference(true)
    setDocumentDate(false)
    setSkipped(new Set())
  }, [open, extraction])

  const lines = extraction?.lines ?? []
  const accepted = useMemo(() => lines.map((_, i) => i).filter((i) => !skipped.has(i)), [lines, skipped])

  const count =
    (supplier && extraction?.supplier ? 1 : 0) +
    (reference && extraction?.reference ? 1 : 0) +
    (documentDate && extraction?.document_date ? 1 : 0) +
    accepted.length

  const toggleLine = (index: number) =>
    setSkipped((current) => {
      const next = new Set(current)
      if (next.has(index)) next.delete(index)
      else next.add(index)
      return next
    })

  return (
    <Drawer
      open={open}
      onClose={onClose}
      width="xl"
      title="Review what Aicountly AI read"
      badge={extraction?.confidence !== null && extraction?.confidence !== undefined ? <Badge tone={confidenceTone(extraction.confidence)} size="xs">{confidenceLabel(extraction.confidence)} confident</Badge> : undefined}
      description={fileName ? `From ${fileName}. Nothing is applied until you choose it.` : 'Nothing is applied until you choose it.'}
      footer={
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="text-xs text-gray-500">
            {count === 0 ? 'Nothing selected' : `${count} value${count === 1 ? '' : 's'} will be applied to the draft`}
          </span>
          <div className="flex items-center gap-2">
            <Button variant="secondary" onClick={onClose}>
              Cancel
            </Button>
            <Button
              disabled={count === 0}
              onClick={() => onApply({ supplier, reference, documentDate, lineIndexes: accepted })}
            >
              Apply to draft
            </Button>
          </div>
        </div>
      }
    >
      {!extraction ? null : (
        <div className="space-y-4">
          <p className="flex items-start gap-2 rounded-lg border border-violet-200 bg-violet-50 px-3 py-2 text-xs leading-snug text-violet-900">
            <ShieldCheck className="mt-px h-4 w-4 shrink-0" aria-hidden />
            These are suggestions read from a scanned document. Check the quantities and batches against the goods in front of
            you before posting — the receipt, not the paperwork, is what moves stock.
          </p>

          {extraction.notes.length > 0 ? (
            <ul className="space-y-1">
              {extraction.notes.map((note) => (
                <li key={note} className="flex items-start gap-1.5 text-xs text-amber-700">
                  <AlertTriangle className="mt-px h-3.5 w-3.5 shrink-0" aria-hidden />
                  {note}
                </li>
              ))}
            </ul>
          ) : null}

          <section>
            <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-gray-500">Document details</h3>
            <div className="divide-y divide-gray-100 rounded-lg border border-gray-200">
              <HeaderRow
                checked={supplier}
                onChange={setSupplier}
                available={Boolean(extraction.supplier)}
                label="Supplier"
                value={
                  extraction.supplier
                    ? [extraction.supplier.party_name, extraction.supplier.party_ref !== null ? `Ledger ${extraction.supplier.party_ref}` : null, extraction.supplier.gstin]
                        .filter(Boolean)
                        .join(' · ')
                    : null
                }
              />
              <HeaderRow checked={reference} onChange={setReference} available={Boolean(extraction.reference)} label="Reference" value={extraction.reference} />
              <HeaderRow
                checked={documentDate}
                onChange={setDocumentDate}
                available={Boolean(extraction.document_date)}
                label="Document date"
                value={extraction.document_date ? formatDate(extraction.document_date) : null}
                hint="Off by default — a receipt is dated when the goods arrived, not when the invoice was raised."
              />
              <HeaderRow available={Boolean(extraction.purchase_order_no)} label="Purchase order" value={extraction.purchase_order_no} readOnlyNote="Use Import from PO to pull its lines." />
            </div>
          </section>

          <section>
            <div className="mb-2 flex items-center justify-between">
              <h3 className="text-[11px] font-semibold uppercase tracking-wide text-gray-500">
                Lines ({accepted.length} of {lines.length} selected)
              </h3>
              {lines.length > 0 ? (
                <div className="flex gap-2">
                  <Button variant="link" size="xs" onClick={() => setSkipped(new Set())}>
                    Select all
                  </Button>
                  <Button variant="link" size="xs" onClick={() => setSkipped(new Set(lines.map((_, i) => i)))}>
                    Clear
                  </Button>
                </div>
              ) : null}
            </div>
            {lines.length === 0 ? (
              <p className="rounded-lg border border-dashed border-gray-200 px-3 py-4 text-center text-xs text-gray-500">
                No item lines could be read from this document.
              </p>
            ) : (
              <ul className="space-y-1.5">
                {lines.map((line, index) => (
                  <LineRow key={`${line.item_name}-${index}`} line={line} checked={!skipped.has(index)} onToggle={() => toggleLine(index)} />
                ))}
              </ul>
            )}
          </section>
        </div>
      )}
    </Drawer>
  )
}

function HeaderRow({
  checked,
  onChange,
  available,
  label,
  value,
  hint,
  readOnlyNote,
}: {
  checked?: boolean
  onChange?: (next: boolean) => void
  available: boolean
  label: string
  value: string | null
  hint?: string
  readOnlyNote?: string
}) {
  return (
    <div className={cx('flex items-start gap-3 px-3 py-2', !available && 'opacity-60')}>
      {onChange ? (
        <input
          type="checkbox"
          className="mt-0.5 h-4 w-4 shrink-0 rounded border-gray-300 text-primary focus:ring-primary/30"
          checked={available && Boolean(checked)}
          disabled={!available}
          onChange={(e) => onChange(e.target.checked)}
          aria-label={`Apply ${label.toLowerCase()}`}
        />
      ) : (
        <span className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
      )}
      <div className="min-w-0 flex-1">
        <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-500">{label}</p>
        <p className="truncate text-sm text-gray-900">{value ?? 'Not found in the document'}</p>
        {hint ? <p className="mt-0.5 text-[11px] text-gray-500">{hint}</p> : null}
        {readOnlyNote && available ? <p className="mt-0.5 text-[11px] text-gray-500">{readOnlyNote}</p> : null}
      </div>
    </div>
  )
}

function LineRow({ line, checked, onToggle }: { line: ExtractedLine; checked: boolean; onToggle: () => void }) {
  return (
    <li>
      <label
        className={cx(
          'flex cursor-pointer items-start gap-3 rounded-lg border px-3 py-2 transition-colors',
          checked ? 'border-gray-200 bg-white' : 'border-gray-100 bg-gray-50 opacity-70',
        )}
      >
        <input
          type="checkbox"
          className="mt-0.5 h-4 w-4 shrink-0 rounded border-gray-300 text-primary focus:ring-primary/30"
          checked={checked}
          onChange={onToggle}
        />
        <span className="min-w-0 flex-1">
          <span className="flex flex-wrap items-center gap-1.5">
            <span className="truncate text-sm font-medium text-gray-900">{line.item_name}</span>
            {line.item_id !== null ? (
              <Badge tone="success" size="xs">
                Matched
              </Badge>
            ) : (
              <Badge tone="warning" size="xs">
                Pick item
              </Badge>
            )}
            {line.confidence !== null ? (
              <Badge tone={confidenceTone(line.confidence)} size="xs">
                {confidenceLabel(line.confidence)}
              </Badge>
            ) : null}
          </span>
          <span className="mt-0.5 block truncate text-[11px] text-gray-500">
            {[
              line.item_sku ? `SKU ${line.item_sku}` : null,
              line.barcode ? `Barcode ${line.barcode}` : null,
              line.batch_no ? `Batch ${line.batch_no}` : null,
              line.expiry_date ? `Exp ${formatDate(line.expiry_date)}` : null,
              line.serials.length ? `${line.serials.length} serial(s)` : null,
            ]
              .filter(Boolean)
              .join(' · ') || 'No batch or serial details found'}
          </span>
        </span>
        <span className="shrink-0 text-right">
          <span className="block text-sm font-semibold tabular-nums text-gray-900">
            {formatQty(line.qty, '—')} {line.unit_symbol ?? ''}
          </span>
          <span className="block text-[11px] tabular-nums text-gray-500">{line.rate !== null ? formatMoney(line.rate) : '—'}</span>
        </span>
      </label>
    </li>
  )
}

export default AiExtractionReview
