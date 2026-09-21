import { useMemo, useState } from 'react'
import { Printer } from 'lucide-react'
import { Modal } from '../components/Modal'
import { Notice } from '../components/Notice'
import { Button } from '../ui/Button'
import { Select } from '../ui/Select'
import { FormField } from '../ui/shell/FormSectionCard'
import { useToast } from '../ui/ToastContext'
import { printHtmlDocument } from '../export/documentExport'
import { useCompany } from '../company/CompanyContext'
import type { Serial } from '../services/masters'
import { formatInt } from '../utils/format'
import { LABEL_SIZES, buildLabelSheetHtml } from './serialLabels'
import type { LabelSize } from './serialLabels'
import { code128Svg } from './barcode128'

/**
 * Barcode labels for the serials the reader chose.
 *
 * The preview is the real thing: the same `code128Svg` that goes on the paper
 * is drawn here, so what is checked on screen is what comes out of the printer.
 * Printing goes through the shared `printHtmlDocument`, which is the pipeline
 * every register's print sheet already uses.
 */
export interface PrintLabelsDialogProps {
  open: boolean
  onClose: () => void
  serials: readonly Serial[]
}

const SIZE_OPTIONS: LabelSize[] = ['small', 'medium', 'large']

export function PrintLabelsDialog({ open, onClose, serials }: PrintLabelsDialogProps) {
  const toast = useToast()
  const { companyName } = useCompany()
  const [size, setSize] = useState<LabelSize>('medium')
  const [showCompany, setShowCompany] = useState(true)
  const [showWarranty, setShowWarranty] = useState(true)

  const labels = useMemo(
    () =>
      serials.map((s) => ({
        serialNo: s.serial_no,
        itemName: s.item_name,
        sku: s.item_sku,
        warrantyUntil: s.warranty_until,
      })),
    [serials],
  )

  const unencodable = useMemo(() => labels.filter((l) => code128Svg(l.serialNo) === null), [labels])
  const sample = labels[0]
  const sampleSvg = sample ? code128Svg(sample.serialNo, { moduleWidth: 1, height: 34 }) : null

  const print = () => {
    const html = buildLabelSheetHtml({ labels, companyName, size, showCompany, showWarranty })
    const ok = printHtmlDocument(html)
    if (ok) {
      toast.success(`${labels.length} label${labels.length === 1 ? '' : 's'} ready to print`)
      onClose()
    } else {
      toast.error('The print sheet could not be opened. Check the browser’s popup settings.')
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="md"
      title="Print labels"
      description={`${formatInt(labels.length)} serial number${labels.length === 1 ? '' : 's'}. Each label carries the barcode and the number in readable form.`}
      footer={
        <>
          <Button variant="secondary" size="sm" onClick={onClose}>
            Cancel
          </Button>
          <Button size="sm" icon={Printer} onClick={print} disabled={labels.length === 0}>
            Print {formatInt(labels.length)}
          </Button>
        </>
      }
    >
      {labels.length === 0 ? (
        <Notice kind="info">Select one or more serial numbers, or open a serial and print its label from there.</Notice>
      ) : (
        <>
          {unencodable.length > 0 ? (
            <div className="mb-3">
              <Notice kind="warning" title={`${unencodable.length} cannot carry a barcode`}>
                Code 128 holds ordinary ASCII. Those labels still print, with the number in readable form and a note to
                key it — a barcode that scanned as a different serial would be worse.
              </Notice>
            </div>
          ) : null}

          <FormField label="Label size">
            <Select value={size} onChange={(e) => setSize(e.target.value as LabelSize)}>
              {SIZE_OPTIONS.map((key) => (
                <option key={key} value={key}>
                  {LABEL_SIZES[key].label} · {LABEL_SIZES[key].perSheet}
                </option>
              ))}
            </Select>
          </FormField>

          <div className="mt-2 flex flex-col gap-1.5">
            <label className="inline-flex items-center gap-1.5 text-xs text-gray-600">
              <input type="checkbox" checked={showCompany} onChange={(e) => setShowCompany(e.target.checked)} className="accent-[rgb(var(--color-primary))]" />
              Print the company name
            </label>
            <label className="inline-flex items-center gap-1.5 text-xs text-gray-600">
              <input type="checkbox" checked={showWarranty} onChange={(e) => setShowWarranty(e.target.checked)} className="accent-[rgb(var(--color-primary))]" />
              Print the warranty date where there is one
            </label>
          </div>

          {sample ? (
            <div className="mt-4">
              <p className="m-0 mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-gray-400">Preview</p>
              <div className="flex flex-col items-center gap-1 rounded-lg border border-dashed border-gray-300 bg-white px-4 py-3 text-center">
                {showCompany && companyName ? <span className="text-[10px] font-bold text-gray-700">{companyName}</span> : null}
                {sample.itemName ? <span className="max-w-full truncate text-[10px] text-gray-600">{sample.itemName}</span> : null}
                {sampleSvg ? (
                  <span className="w-full max-w-[16rem]" aria-hidden dangerouslySetInnerHTML={{ __html: sampleSvg }} />
                ) : (
                  <span className="text-[10px] text-gray-400">No barcode — key the number</span>
                )}
                <span className="font-mono text-xs font-bold tracking-wider">{sample.serialNo}</span>
                {showWarranty && sample.warrantyUntil ? (
                  <span className="text-[10px] text-gray-500">Warranty {sample.warrantyUntil}</span>
                ) : null}
              </div>
            </div>
          ) : null}
        </>
      )}
    </Modal>
  )
}

export default PrintLabelsDialog
