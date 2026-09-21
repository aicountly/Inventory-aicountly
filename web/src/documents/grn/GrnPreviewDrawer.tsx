import { Link } from 'react-router-dom'
import { Printer } from 'lucide-react'
import { Badge } from '../../ui/Badge'
import { Button } from '../../ui/Button'
import { Drawer } from '../../ui/Drawer'
import { cx } from '../../ui/cx'
import { formatDate, formatMoney, formatQty } from '../../utils/format'
import { isBlankLine, lineAmount } from '../formModel'
import type { HeaderDraft, LineDraft } from '../formModel'
import type { DocumentTypeSpec } from '../registry'
import { stockImpact } from './grnModel'
import type { GrnTotals } from './grnModel'
import { toNumber } from '../../utils/format'

export interface GrnPreviewDrawerProps {
  open: boolean
  onClose: () => void
  spec: DocumentTypeSpec
  header: HeaderDraft
  lines: LineDraft[]
  totals: GrnTotals
  warehouseName: (id: number | null | undefined) => string
  unitSymbol: (id: number | null | undefined) => string
  companyName: string
  scopeLabel: string
  currencySymbol: string
  /** Set once the draft has been saved, so the real print view can be offered. */
  savedId: number | null
  status: string
}

/**
 * The document as it will read.
 *
 * A draft has no print snapshot yet — the server writes one when the document posts — so this
 * renders the draft itself and says plainly that it is a preview. Once the document exists, the
 * button at the foot goes to the real print view (`/documents/:id/print`), which is the snapshot
 * the company's letterhead and template are applied to. Two print paths for one document is how
 * the paper and the ledger end up disagreeing, so there is only ever one.
 */
export function GrnPreviewDrawer({
  open,
  onClose,
  spec,
  header,
  lines,
  totals,
  warehouseName,
  unitSymbol,
  companyName,
  scopeLabel,
  currencySymbol,
  savedId,
  status,
}: GrnPreviewDrawerProps) {
  const rows = lines.filter((l) => !isBlankLine(l))
  const impact = stockImpact(header.stock_effect)
  const tags = header.metadata.tags ?? []

  return (
    <Drawer
      open={open}
      onClose={onClose}
      width="xl"
      title="Preview"
      badge={<Badge tone={status === 'DRAFT' ? 'neutral' : 'info'} size="xs">{status}</Badge>}
      description="How this inward challan reads right now. Nothing here is saved."
      footer={
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="text-xs text-gray-500">
            {savedId ? 'The printable copy uses the company letterhead and the stored snapshot.' : 'Save the draft to print it.'}
          </span>
          <div className="flex items-center gap-2">
            <Button variant="secondary" onClick={onClose}>
              Close
            </Button>
            {savedId ? (
              <Link
                to={`/documents/${savedId}/print`}
                data-unsaved-allow
                className={cx(
                  'aic inline-flex h-8 items-center gap-1.5 rounded-lg bg-primary px-3 text-sm font-medium text-white no-underline transition-colors hover:bg-primary-hover',
                )}
              >
                <Printer className="h-4 w-4" aria-hidden />
                Open print view
              </Link>
            ) : null}
          </div>
        </div>
      }
    >
      <article className="space-y-4 text-sm">
        <header className="border-b border-gray-200 pb-3">
          <p className="text-base font-semibold text-gray-900">{companyName || 'This company'}</p>
          <p className="text-xs text-gray-500">{scopeLabel}</p>
          <h3 className="mt-2 text-sm font-semibold uppercase tracking-wide text-gray-700">{spec.label}</h3>
        </header>

        <dl className="grid grid-cols-2 gap-x-6 gap-y-2 md:grid-cols-3">
          <Field label="Document no." value={header.document_no || '(numbered on save)'} />
          <Field label="Date" value={formatDate(header.document_date)} />
          <Field label="Reference" value={header.reference || '—'} />
          <Field label="Supplier" value={header.party_name || '—'} />
          <Field label="Supplier ledger" value={header.party_ref || 'Not linked'} />
          <Field label="Default warehouse" value={warehouseName(header.default_warehouse_id) || '—'} />
          <Field label="Stock effect" value={`${spec.stockEffects.find((s) => s.value === header.stock_effect)?.label ?? header.stock_effect} · ${impact.label}`} />
          {header.metadata.purchase_order_no ? <Field label="Purchase order" value={String(header.metadata.purchase_order_no)} /> : null}
          {tags.length > 0 ? <Field label="Tags" value={tags.join(', ')} /> : null}
        </dl>

        <div className="overflow-x-auto">
          <table className="w-full min-w-[38rem] border-collapse text-xs">
            <thead>
              <tr className="border-y border-gray-200 bg-gray-50">
                <th className="px-2 py-1.5 text-left font-semibold text-gray-600">#</th>
                <th className="px-2 py-1.5 text-left font-semibold text-gray-600">Item</th>
                <th className="px-2 py-1.5 text-left font-semibold text-gray-600">Warehouse</th>
                <th className="px-2 py-1.5 text-left font-semibold text-gray-600">Batch / Serials</th>
                <th className="px-2 py-1.5 text-right font-semibold text-gray-600">Qty</th>
                <th className="px-2 py-1.5 text-right font-semibold text-gray-600">Rate</th>
                <th className="px-2 py-1.5 text-right font-semibold text-gray-600">Amount</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-2 py-6 text-center text-gray-500">
                    No items on this challan yet.
                  </td>
                </tr>
              ) : null}
              {rows.map((line, index) => {
                const amount = toNumber(line.amount) ?? lineAmount(line.qty, line.rate)
                return (
                  <tr key={line.key} className="border-b border-gray-100">
                    <td className="px-2 py-1.5 text-gray-400">{index + 1}</td>
                    <td className="px-2 py-1.5">
                      <span className="block text-gray-900">{line.item_name || '(no item)'}</span>
                      {line.item_sku ? <span className="block text-[10px] text-gray-500">{line.item_sku}</span> : null}
                    </td>
                    <td className="px-2 py-1.5 text-gray-600">{warehouseName(line.warehouse_id) || '—'}</td>
                    <td className="px-2 py-1.5 text-gray-600">
                      {line.batch_no ?? '—'}
                      {line.expiry_date ? <span className="block text-[10px] text-gray-500">exp {formatDate(line.expiry_date)}</span> : null}
                      {line.serials.length > 0 ? (
                        <span className="block text-[10px] text-gray-500">{line.serials.length} serial(s)</span>
                      ) : null}
                    </td>
                    <td className="px-2 py-1.5 text-right tabular-nums text-gray-900">
                      {formatQty(line.qty)} {line.unit_id ? unitSymbol(line.unit_id) : ''}
                    </td>
                    <td className="px-2 py-1.5 text-right tabular-nums text-gray-600">{line.rate ? formatMoney(line.rate) : '—'}</td>
                    <td className="px-2 py-1.5 text-right tabular-nums text-gray-900">{amount === null ? '—' : formatMoney(amount)}</td>
                  </tr>
                )
              })}
            </tbody>
            <tfoot>
              <tr className="border-t border-gray-300 font-semibold">
                <td className="px-2 py-1.5" colSpan={4}>
                  {totals.items} item{totals.items === 1 ? '' : 's'}
                </td>
                <td className="px-2 py-1.5 text-right tabular-nums">{formatQty(totals.quantity)}</td>
                <td className="px-2 py-1.5" />
                <td className="px-2 py-1.5 text-right tabular-nums">
                  {currencySymbol} {formatMoney(totals.amount, '0.00')}
                </td>
              </tr>
            </tfoot>
          </table>
        </div>

        {header.narration.trim() ? (
          <section>
            <h4 className="text-[11px] font-semibold uppercase tracking-wide text-gray-500">Narration</h4>
            <p className="mt-1 whitespace-pre-wrap text-xs text-gray-700">{header.narration}</p>
          </section>
        ) : null}

        <p className="rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-[11px] leading-snug text-gray-600">{impact.detail}</p>
      </article>
    </Drawer>
  )
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-[10px] font-semibold uppercase tracking-wide text-gray-500">{label}</dt>
      <dd className="mt-0.5 break-words text-sm text-gray-900">{value}</dd>
    </div>
  )
}

export default GrnPreviewDrawer
