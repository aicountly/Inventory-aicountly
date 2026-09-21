import { AlertTriangle, ArrowRight } from 'lucide-react'
import { Modal } from '../../components/Modal'
import { Button } from '../../ui'
import type { ValuationScope } from './revaluationModel'

const STEPS: readonly { title: string; body: string }[] = [
  { title: 'Choose the warehouse and the reason', body: 'The default warehouse pre-fills every line you add. The reason code is what the audit log and the reconciliation with Books read back later, so it is required.' },
  { title: 'Add the items', body: 'Search by name, SKU or barcode, scan them in, add several at once, or paste a column of codes and rates from a spreadsheet.' },
  { title: 'Read the current cost', body: 'The cost on each line is the one Inventory holds right now, under that item’s valuation method. It is read-only — nothing on this screen may type a cost that stock was never valued at.' },
  { title: 'Enter the revised unit cost', body: 'Per base unit, greater than zero. Copy rates lets you fill the column from FIFO, LIFO, weighted-average or the last purchase rate and edit from there.' },
  { title: 'Review the impact', body: 'The preview multiplies the change in cost by the quantity on hand. It is indicative: the figures are a snapshot, and stock keeps moving while you type.' },
  { title: 'Save a draft, or post', body: 'A draft changes nothing. Posting re-prices the open cost layers and publishes a stock revaluation effect for Books to journal.' },
]

export interface RevaluationHelpModalProps {
  open: boolean
  onClose: () => void
  scope: ValuationScope
}

export function RevaluationHelpModal({ open, onClose, scope }: RevaluationHelpModalProps) {
  return (
    <Modal
      open={open}
      onClose={onClose}
      title="How a stock revaluation works"
      description="Six steps, and the one rule that matters."
      size="lg"
      footer={
        <Button variant="primary" onClick={onClose}>
          Got it
        </Button>
      }
    >
      <div className="space-y-4">
        <div className="flex items-start gap-3 rounded-xl border border-amber-200 bg-amber-50 px-3.5 py-3">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" aria-hidden />
          <p className="text-xs leading-relaxed text-amber-900">
            <strong>A revaluation changes what stock is worth, never how much of it there is.</strong> No quantity, warehouse, batch or serial
            moves, and nothing here touches the sale or purchase values, or the party balances, that Books owns.
          </p>
        </div>

        <ol className="space-y-2.5">
          {STEPS.map((step, index) => (
            <li key={step.title} className="flex gap-3">
              <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-lg bg-primary-light text-[11px] font-bold text-primary">{index + 1}</span>
              <div className="min-w-0">
                <p className="text-sm font-semibold text-gray-900">{step.title}</p>
                <p className="mt-0.5 text-xs leading-relaxed text-gray-600">{step.body}</p>
              </div>
            </li>
          ))}
        </ol>

        <div className="rounded-xl border border-gray-200 bg-gray-50 px-3.5 py-3">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-500">What a posted line re-prices</p>
          <p className="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-gray-700">
            <span>Every open cost layer of the item</span>
            <ArrowRight className="h-3.5 w-3.5 text-gray-400" aria-hidden />
            <strong>{scope === 'warehouse' ? 'in the line’s warehouse' : 'across every warehouse'}</strong>
          </p>
          <p className="mt-1.5 text-[11px] leading-relaxed text-gray-500">
            This company values stock {scope === 'warehouse' ? 'per warehouse' : 'company-wide'} (Settings → valuation scope), so that is the scope the impact preview is
            calculated over. Batches and serials are not narrowed by a revaluation — the whole open balance of the item is re-priced.
          </p>
        </div>
      </div>
    </Modal>
  )
}

export default RevaluationHelpModal
