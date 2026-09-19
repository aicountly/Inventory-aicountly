import { useMemo } from 'react'
import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { FilePenLine, ReceiptText, RefreshCw } from 'lucide-react'
import { Button } from '../../../ui/Button'
import { Drawer } from '../../../ui/Drawer'
import { cx } from '../../../ui/cx'
import { formatDate, formatDateTime, formatMoney, formatQty, humanize } from '../../../utils/format'
import type { CostLayerRow, CostLayersResponse, ValuationRevision } from '../../../services/valuationApi'
import { CostLayerStatusBadge } from './CostLayerStatusBadge'
import { consumedQty, layerReceiptValue } from '../costLayerModel'

export interface CostLayerDrawerProps {
  layer: CostLayerRow | null
  item: CostLayersResponse['item'] | null
  batchName: (batchId: number | null) => string | null
  revisions: ValuationRevision[]
  unitSymbol: string | null
  onClose: () => void
  onCreateRevision: (layer: CostLayerRow) => void
  /** Null when the reader may not queue a recalculation. */
  onRecalculate: ((layer: CostLayerRow) => void) | null
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-[10px] font-medium uppercase tracking-wide text-gray-400">{label}</dt>
      <dd className="mt-0.5 truncate text-[12.5px] text-gray-900">{children}</dd>
    </div>
  )
}

function Section({ title, hint, children }: { title: string; hint?: string; children: ReactNode }) {
  return (
    <section className="border-t border-gray-100 pt-3.5">
      <h3 className="text-[12px] font-semibold text-gray-900">{title}</h3>
      {hint ? <p className="mt-0.5 text-[10.5px] text-gray-500">{hint}</p> : null}
      <div className="mt-2">{children}</div>
    </section>
  )
}

/**
 * One layer, opened beside the grid.
 *
 * A drawer rather than a dialog because the answer is read *against* the rows
 * it came from: a controller checking why one receipt costs 28% more than the
 * last one needs both on screen at once.
 *
 * Everything shown is the layer's own record. Where a section has nothing to
 * report it says so in a sentence — an inspector that renders an empty heading
 * leaves the reader wondering whether the data is missing or the screen is.
 */
export function CostLayerDrawer({
  layer,
  item,
  batchName,
  revisions,
  unitSymbol,
  onClose,
  onCreateRevision,
  onRecalculate,
}: CostLayerDrawerProps) {
  /*
   * `inv_valuation_revisions` records the DOCUMENT whose cost changed, not the
   * layer the cost came from, so a revision cannot be joined to a layer
   * directly. What can be said truthfully is which revisions touched this
   * layer's own documents — its receipt and the issues that drew on it — so
   * that is what is shown, and the heading says it.
   */
  const related = useMemo(() => {
    if (!layer) return []
    const docs = new Set<number>()
    if (layer.source_document_id) docs.add(layer.source_document_id)
    for (const c of layer.consumptions ?? []) if (c.document_id) docs.add(c.document_id)
    return revisions.filter((r) => r.document_id !== null && docs.has(r.document_id))
  }, [layer, revisions])

  const consumptions = layer?.consumptions ?? []
  const lastConsumption = consumptions.length ? consumptions[consumptions.length - 1] : null
  const unit = unitSymbol ? ` ${unitSymbol}` : ''

  return (
    <Drawer
      open={layer !== null}
      onClose={onClose}
      width="lg"
      title={
        layer ? (
          <span className="tabular-nums">
            {layer.source_document_no ?? `${humanize(layer.layer_kind)} layer #${layer.layer_id}`}
          </span>
        ) : (
          ''
        )
      }
      badge={layer ? <CostLayerStatusBadge row={layer} /> : null}
      description={
        layer
          ? `${item?.item_name ?? 'Item'} · received ${formatDate(layer.received_at)} into ${layer.warehouse_name ?? 'stock'}`
          : undefined
      }
      footer={
        layer ? (
          <div className="flex flex-wrap items-center justify-end gap-2">
            {/* A real anchor, wearing the secondary button's clothes: middle-click,
                copy-link and open-in-new-tab all have to keep working on the
                one control that leaves this screen for a document. */}
            {layer.source_document_id ? (
              <Link
                to={`/documents/${layer.source_document_id}`}
                onClick={onClose}
                className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-gray-200 bg-white px-3 text-sm font-medium text-gray-700 no-underline transition-colors hover:border-primary/40 hover:bg-primary-light hover:text-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/30"
              >
                <ReceiptText className="h-4 w-4 shrink-0" aria-hidden />
                Open receipt
              </Link>
            ) : null}
            {onRecalculate ? (
              <Button variant="secondary" icon={RefreshCw} onClick={() => onRecalculate(layer)}>
                Recalculate from this date
              </Button>
            ) : null}
            <Button icon={FilePenLine} onClick={() => onCreateRevision(layer)}>
              Create revision
            </Button>
          </div>
        ) : null
      }
    >
      {layer ? (
        <div className="space-y-3.5">
          <section>
            <h3 className="text-[12px] font-semibold text-gray-900">Layer overview</h3>
            <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-2.5 sm:grid-cols-3">
              <Row label="Receipt reference">
                {layer.source_document_id ? (
                  <Link
                    to={`/documents/${layer.source_document_id}`}
                    className="font-semibold text-primary no-underline hover:underline"
                  >
                    {layer.source_document_no ?? `#${layer.source_document_id}`}
                  </Link>
                ) : (
                  <span className="text-gray-400">Not linked</span>
                )}
              </Row>
              <Row label="Received">{formatDate(layer.received_at)}</Row>
              <Row label="Layer type">{humanize(layer.layer_kind)}</Row>
              <Row label="Item">{item?.item_name ?? `#${layer.item_id}`}</Row>
              <Row label="SKU">{item?.item_sku ?? <span className="text-gray-400">—</span>}</Row>
              <Row label="Warehouse">
                {layer.warehouse_name ?? <span className="text-gray-400">Unassigned</span>}
              </Row>
              <Row label="Batch / lot">
                {batchName(layer.batch_id) ?? <span className="text-gray-400">Not batch tracked</span>}
              </Row>
              <Row label="Qty received">
                <span className="tabular-nums">
                  {formatQty(layer.qty_received)}
                  {unit}
                </span>
              </Row>
              <Row label="Qty consumed">
                <span className="tabular-nums">
                  {formatQty(consumedQty(layer))}
                  {unit}
                </span>
              </Row>
              <Row label="Qty available">
                <span
                  className={cx(
                    'font-semibold tabular-nums',
                    (layer.qty_remaining ?? 0) < 0 && 'text-red-600',
                  )}
                >
                  {formatQty(layer.qty_remaining)}
                  {unit}
                </span>
              </Row>
              <Row label="Unit cost">
                <span className="tabular-nums">{formatMoney(layer.unit_cost)}</span>
              </Row>
              <Row label="Value at receipt">
                <span className="tabular-nums">{formatMoney(layerReceiptValue(layer))}</span>
              </Row>
              <Row label="Value remaining">
                <span className="font-semibold tabular-nums">{formatMoney(layer.remaining_value)}</span>
              </Row>
              <Row label="Valuation method">
                {item?.valuation_method ?? <span className="text-gray-400">Company default</span>}
              </Row>
            </dl>
          </section>

          <Section
            title="Consumed by"
            hint="The issues that have drawn on this layer, in the order the costing applied them."
          >
            {consumptions.length === 0 ? (
              <p className="text-[11.5px] text-gray-500">
                Nothing has been issued from this layer yet.
              </p>
            ) : (
              <table className="w-full text-[11.5px]">
                <thead>
                  <tr className="border-b border-gray-200 text-left">
                    <th scope="col" className="py-1.5 pr-2 font-semibold uppercase tracking-wide text-[10px] text-gray-500">Document</th>
                    <th scope="col" className="py-1.5 pr-2 font-semibold uppercase tracking-wide text-[10px] text-gray-500">Date</th>
                    <th scope="col" className="py-1.5 pr-2 text-right font-semibold uppercase tracking-wide text-[10px] text-gray-500">Qty</th>
                    <th scope="col" className="py-1.5 pr-2 text-right font-semibold uppercase tracking-wide text-[10px] text-gray-500">Unit cost</th>
                    <th scope="col" className="py-1.5 text-right font-semibold uppercase tracking-wide text-[10px] text-gray-500">Amount</th>
                  </tr>
                </thead>
                <tbody>
                  {consumptions.map((c) => (
                    <tr key={c.consumption_id} className="border-b border-gray-100 last:border-b-0">
                      <td className="py-1.5 pr-2">
                        {c.document_id ? (
                          <Link
                            to={`/documents/${c.document_id}`}
                            className="font-semibold text-gray-700 no-underline hover:text-primary hover:underline"
                          >
                            {c.document_no ?? `#${c.document_id}`}
                          </Link>
                        ) : (
                          <span className="text-gray-400">Stock movement</span>
                        )}
                        {c.document_type ? (
                          <span className="block text-[10px] text-gray-400">{humanize(c.document_type)}</span>
                        ) : null}
                      </td>
                      <td className="py-1.5 pr-2 whitespace-nowrap text-gray-600">{formatDate(c.document_date)}</td>
                      <td className="py-1.5 pr-2 text-right tabular-nums">{formatQty(c.qty)}</td>
                      <td className="py-1.5 pr-2 text-right tabular-nums text-gray-600">{formatMoney(c.unit_cost)}</td>
                      <td className="py-1.5 text-right font-semibold tabular-nums">{formatMoney(c.amount)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Section>

          <Section
            title="Valuation changes"
            hint="Revisions published against this layer's own receipt and issues. Revisions are recorded per document, so this is the closest true link to a layer."
          >
            {related.length === 0 ? (
              <p className="text-[11.5px] text-gray-500">
                No cost revision has touched this layer&rsquo;s documents.
              </p>
            ) : (
              <ul className="space-y-2">
                {related.map((r) => (
                  <li key={r.revision_id} className="rounded-lg bg-gray-50 px-2.5 py-2 text-[11.5px]">
                    <p className="font-semibold text-gray-900">
                      {formatMoney(r.old_valuation_rate)} → {formatMoney(r.new_valuation_rate)}
                      <span
                        className={cx(
                          'ml-2 tabular-nums',
                          (r.delta_amount ?? 0) < 0 ? 'text-red-600' : 'text-emerald-600',
                        )}
                      >
                        {(r.delta_amount ?? 0) >= 0 ? '+' : ''}
                        {formatMoney(r.delta_amount)}
                      </span>
                    </p>
                    <p className="mt-0.5 text-[10.5px] text-gray-500">
                      {r.document_no ?? (r.document_id ? `#${r.document_id}` : 'Document')} ·{' '}
                      {formatDateTime(r.created_at)} · job{' '}
                      {r.job_id ? `#${r.job_id}` : 'unknown'} ·{' '}
                      {r.acknowledged ? 'applied in Books' : 'awaiting Books'}
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </Section>

          <Section title="Audit history" hint="What the layer record itself carries.">
            <ul className="space-y-1.5 text-[11.5px] text-gray-600">
              <li>
                <strong className="font-semibold text-gray-900">Created</strong> ·{' '}
                {formatDateTime(layer.created_at)}
                {layer.source_document_type ? ` from a ${humanize(layer.source_document_type).toLowerCase()}` : ''}
              </li>
              <li>
                <strong className="font-semibold text-gray-900">Opened</strong> ·{' '}
                {formatDate(layer.received_at)} at {formatMoney(layer.unit_cost)} per unit
              </li>
              {lastConsumption ? (
                <li>
                  <strong className="font-semibold text-gray-900">Last consumed</strong> ·{' '}
                  {formatDate(lastConsumption.document_date ?? lastConsumption.created_at)} by{' '}
                  {lastConsumption.document_no ?? 'a stock movement'}
                </li>
              ) : null}
              {(layer.qty_remaining ?? 0) === 0 ? (
                <li>
                  <strong className="font-semibold text-gray-900">Closed</strong> · the layer is
                  fully consumed and holds no further value
                </li>
              ) : null}
              {layer.layer_kind === 'revaluation' ? (
                <li className="text-violet-700">
                  This layer was written by a re-costing, not by a receipt.
                </li>
              ) : null}
            </ul>
            <p className="mt-2 text-[10px] leading-relaxed text-gray-400">
              Cost layers are never edited in place. A change of cost is published as a revision
              against the affected documents, which Books acknowledges — see Valuation › Revisions.
            </p>
          </Section>
        </div>
      ) : null}
    </Drawer>
  )
}

export default CostLayerDrawer
