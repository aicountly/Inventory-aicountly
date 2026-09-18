import { Card } from '../../ui/Card'
import { EmptyState } from '../../ui/EmptyState'
import { Badge } from '../../ui/Badge'
import { AIC, cx } from '../../ui/cx'
import { formatQty } from '../../utils/format'
import { isBlankLine, lineAmount } from '../formModel'
import type { HeaderDraft, LineDraft } from '../formModel'
import type { FormOptionWarehouse } from '../../services/items'
import { journalTotals, reasonLabel } from './model'

interface StockJournalPreviewProps {
  header: HeaderDraft
  lines: readonly LineDraft[]
  warehouses: readonly FormOptionWarehouse[]
  currency: string
}

/**
 * The document as it will read once posted — no inputs, nothing editable.
 *
 * Deliberately built from the draft in the browser rather than from a server
 * render: it is a proof-read of what is about to be sent, not a claim about what
 * the server stored. The real posted document has its own detail screen.
 */
export function StockJournalPreview({ header, lines, warehouses, currency }: StockJournalPreviewProps) {
  const active = lines.filter((l) => !isBlankLine(l))
  const totals = journalTotals(lines)
  const warehouseName = (id: number | null) =>
    id === null ? '—' : (warehouses.find((w) => w.warehouse_id === id)?.warehouse_name ?? `Warehouse #${id}`)

  if (active.length === 0) {
    return (
      <Card padding="lg">
        <EmptyState
          title="Nothing to preview yet"
          description="Add at least one line on the Create tab and it will read here exactly as it will post."
        />
      </Card>
    )
  }

  return (
    <Card padding="lg">
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-gray-100 pb-3">
        <div>
          <h3 className="text-sm font-semibold text-gray-900">Stock Journal</h3>
          <p className="mt-0.5 text-xs text-gray-500">
            {header.document_no.trim() || 'Number assigned on save'} · {header.document_date}
          </p>
        </div>
        <Badge tone="neutral">Draft preview</Badge>
      </div>

      <dl className={cx(AIC, 'grid grid-cols-2 gap-3 border-b border-gray-100 py-3 sm:grid-cols-4')}>
        <div>
          <dt className="text-[11px] uppercase tracking-wide text-gray-500">Default warehouse</dt>
          <dd className="text-xs font-medium text-gray-900">{warehouseName(header.default_warehouse_id)}</dd>
        </div>
        <div>
          <dt className="text-[11px] uppercase tracking-wide text-gray-500">Reason</dt>
          <dd className="text-xs font-medium text-gray-900">{reasonLabel(header.reason_code) || '—'}</dd>
        </div>
        <div>
          <dt className="text-[11px] uppercase tracking-wide text-gray-500">Movement reason</dt>
          <dd className="text-xs font-medium text-gray-900">{header.movement_reason || '—'}</dd>
        </div>
        <div>
          <dt className="text-[11px] uppercase tracking-wide text-gray-500">Narration</dt>
          <dd className="text-xs font-medium text-gray-900">{header.narration || '—'}</dd>
        </div>
      </dl>

      <div className="mt-3 overflow-x-auto rounded-lg border border-gray-200">
        <table className="w-full min-w-[46rem] border-collapse text-xs">
          <thead>
            <tr className="border-b border-gray-200 bg-gray-50 text-left">
              <th className="px-2 py-2 text-[10px] font-bold uppercase tracking-wide text-gray-500">#</th>
              <th className="px-2 py-2 text-[10px] font-bold uppercase tracking-wide text-gray-500">Item</th>
              <th className="px-2 py-2 text-[10px] font-bold uppercase tracking-wide text-gray-500">Warehouse</th>
              <th className="px-2 py-2 text-[10px] font-bold uppercase tracking-wide text-gray-500">Batch / Serial</th>
              <th className="px-2 py-2 text-[10px] font-bold uppercase tracking-wide text-gray-500">Dir.</th>
              <th className="px-2 py-2 text-right text-[10px] font-bold uppercase tracking-wide text-gray-500">Qty</th>
              <th className="px-2 py-2 text-right text-[10px] font-bold uppercase tracking-wide text-gray-500">Rate</th>
              <th className="px-2 py-2 text-right text-[10px] font-bold uppercase tracking-wide text-gray-500">Amount</th>
              <th className="px-2 py-2 text-[10px] font-bold uppercase tracking-wide text-gray-500">Remarks</th>
            </tr>
          </thead>
          <tbody>
            {active.map((line, i) => (
              <tr key={line.key} className="border-b border-gray-100 last:border-b-0">
                <td className="px-2 py-1.5 text-gray-400">{i + 1}</td>
                <td className="px-2 py-1.5">
                  <span className="font-medium text-gray-900">{line.item_name || '—'}</span>
                  {line.item_sku ? <span className="ml-1 text-[10px] text-gray-500">{line.item_sku}</span> : null}
                </td>
                <td className="px-2 py-1.5 text-gray-700">{warehouseName(line.warehouse_id)}</td>
                <td className="px-2 py-1.5 text-gray-700">
                  {line.batch_no ?? (line.serials.length > 0 ? `${line.serials.length} serials` : '—')}
                </td>
                <td className="px-2 py-1.5">
                  <span className={line.direction === 'in' ? 'font-semibold text-emerald-700' : 'font-semibold text-red-600'}>
                    {line.direction === 'in' ? 'In' : line.direction === 'out' ? 'Out' : '—'}
                  </span>
                </td>
                <td className="px-2 py-1.5 text-right tabular-nums">{formatQty(line.qty)}</td>
                <td className="px-2 py-1.5 text-right tabular-nums">{formatQty(line.rate)}</td>
                <td className="px-2 py-1.5 text-right tabular-nums">{formatQty(lineAmount(line.qty, line.rate))}</td>
                <td className="px-2 py-1.5 text-gray-600">{line.description || '—'}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="border-t border-gray-200 bg-gray-50 font-semibold">
              <td className="px-2 py-2 text-[11px] uppercase tracking-wide text-gray-500" colSpan={5}>
                Total
              </td>
              <td className="px-2 py-2 text-right tabular-nums">
                <span className="text-emerald-700">+{formatQty(totals.qtyIn, '0')}</span>{' '}
                <span className="text-red-600">−{formatQty(totals.qtyOut, '0')}</span>
              </td>
              <td />
              <td className="px-2 py-2 text-right tabular-nums text-gray-900">
                {currency} {formatQty(totals.netValue, '0')}
              </td>
              <td />
            </tr>
          </tfoot>
        </table>
      </div>

      <p className="mt-3 text-[11px] leading-relaxed text-gray-500">
        Values shown are what this screen calculates from the rates you entered. The posted valuation is
        computed by the server against the company&rsquo;s costing method.
      </p>
    </Card>
  )
}
