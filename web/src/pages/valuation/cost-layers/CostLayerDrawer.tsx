import { Link } from 'react-router-dom'
import { ArrowUpRight } from 'lucide-react'
import type { ReactNode } from 'react'
import { Badge } from '../../../ui/Badge'
import { Button } from '../../../ui/Button'
import { Drawer } from '../../../ui/Drawer'
import { cx } from '../../../ui/cx'
import type { CostLayerItem, CostLayerRow } from '../../../services/valuationApi'
import { layerStatusOf } from '../../../services/valuationApi'
import { formatDate, formatDateTime, formatMoney, formatQty, humanize } from '../../../utils/format'
import { CostLayerStatusBadge } from './CostLayerStatusBadge'

function Row({
  label,
  children,
  wide = false,
}: {
  label: string
  children: ReactNode
  wide?: boolean
}) {
  return (
    <div className={cx('min-w-0', wide && 'sm:col-span-2')}>
      <dt className="text-[10.5px] font-medium uppercase tracking-wide text-gray-500">{label}</dt>
      <dd className="mt-0.5 break-words text-[12.5px] text-gray-900">{children}</dd>
    </div>
  )
}

function Section({ title, description, children }: { title: string; description?: string; children: ReactNode }) {
  return (
    <section className="min-w-0">
      <h3 className="text-[13px] font-semibold text-gray-900">{title}</h3>
      {description ? <p className="mt-0.5 text-[11px] leading-relaxed text-gray-500">{description}</p> : null}
      <div className="mt-2">{children}</div>
    </section>
  )
}

export interface CostLayerDrawerProps {
  layer: CostLayerRow | null
  item: CostLayerItem | null
  unitSymbol: string | null
  onClose: () => void
  /** Offered only where the profile may queue a recalculation. */
  onRecalculateFrom?: (fromDate: string) => void
  /** Offered only where the profile may raise a revaluation document. */
  onRevalue?: (layer: CostLayerRow) => void
}

/**
 * One layer, read beside the list rather than on top of it.
 *
 * It states what the layer is, what has been drawn from it and when each of
 * those happened — all of it out of the row the table already holds, so opening
 * a layer costs no request and works offline of a slow API. Nothing in here
 * edits a value: the two actions at the foot both open a workflow that records
 * an actor, a reason and an audit trail, which is the only way a valuation is
 * allowed to change.
 */
export function CostLayerDrawer({
  layer,
  item,
  unitSymbol,
  onClose,
  onRecalculateFrom,
  onRevalue,
}: CostLayerDrawerProps) {
  const open = layer !== null
  const status = layer ? layerStatusOf(layer) : null
  const consumptions = layer?.consumptions ?? []
  const consumedValue = consumptions.reduce((sum, c) => sum + c.amount, 0)
  const receivedDate = layer?.received_at?.slice(0, 10) ?? null

  return (
    <Drawer
      open={open}
      onClose={onClose}
      width="lg"
      title={layer ? `Layer #${layer.layer_id}` : 'Layer'}
      badge={status ? <CostLayerStatusBadge status={status} /> : null}
      description={
        layer
          ? `${item?.item_name ?? 'Item'} · opened ${formatDate(layer.received_at)}${
              layer.warehouse_name ? ` at ${layer.warehouse_name}` : ''
            }`
          : undefined
      }
      footer={
        layer ? (
          <div className="flex flex-wrap items-center justify-end gap-2">
            {onRecalculateFrom && receivedDate ? (
              <Button variant="secondary" onClick={() => onRecalculateFrom(receivedDate)}>
                Recalculate from this date
              </Button>
            ) : null}
            {onRevalue ? (
              <Button variant="secondary" onClick={() => onRevalue(layer)}>
                Revalue this stock
              </Button>
            ) : null}
            <Button variant="ghost" onClick={onClose}>
              Close
            </Button>
          </div>
        ) : null
      }
    >
      {layer ? (
        <div className="space-y-5">
          <Section title="Layer overview">
            <dl className="grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-3">
              <Row label="Receipt">
                {layer.source_document_id ? (
                  <Link
                    to={`/documents/${layer.source_document_id}`}
                    className="inline-flex items-center gap-0.5 font-semibold text-primary no-underline hover:underline"
                  >
                    {layer.source_document_no ?? `#${layer.source_document_id}`}
                    <ArrowUpRight className="h-3 w-3" aria-hidden />
                  </Link>
                ) : (
                  <span className="text-gray-400">Not linked to a document</span>
                )}
              </Row>
              <Row label="Receipt date">{formatDate(layer.source_document_date ?? layer.received_at)}</Row>
              <Row label="Layer kind">
                <Badge tone={layer.layer_kind === 'backorder' ? 'danger' : 'neutral'} size="xs">
                  {humanize(layer.layer_kind)}
                </Badge>
              </Row>

              <Row label="Item">{item?.item_name ?? '—'}</Row>
              <Row label="SKU">{item?.item_sku ?? <span className="text-gray-400">—</span>}</Row>
              <Row label="Warehouse">
                {layer.warehouse_name ?? <span className="text-gray-400">Company scope</span>}
              </Row>

              <Row label="Batch / lot">
                {layer.batch_no ? (
                  <>
                    {layer.batch_no}
                    {layer.lot_no ? <span className="text-gray-500"> · lot {layer.lot_no}</span> : null}
                  </>
                ) : layer.batch_id ? (
                  `#${layer.batch_id}`
                ) : (
                  <span className="text-gray-400">Not batch tracked</span>
                )}
              </Row>
              <Row label="Expiry">
                {layer.expiry_date ? (
                  formatDate(layer.expiry_date)
                ) : (
                  <span className="text-gray-400">—</span>
                )}
              </Row>
              <Row label="Batch status">
                {layer.batch_status ? humanize(layer.batch_status) : <span className="text-gray-400">—</span>}
              </Row>

              <Row label={`Qty received${unitSymbol ? ` (${unitSymbol})` : ''}`}>
                <span className="tabular-nums">{formatQty(layer.qty_received)}</span>
              </Row>
              <Row label="Qty consumed">
                <span className="tabular-nums">{formatQty(layer.qty_consumed)}</span>
              </Row>
              <Row label="Qty available">
                <strong className={cx('tabular-nums', layer.qty_remaining < 0 && 'text-red-600')}>
                  {formatQty(layer.qty_remaining)}
                </strong>
              </Row>

              <Row label="Unit cost">
                <span className="tabular-nums">{formatMoney(layer.unit_cost)}</span>
              </Row>
              <Row label="Opening value">
                <span className="tabular-nums">
                  {formatMoney(layer.layer_value ?? (layer.qty_received ?? layer.qty_remaining) * layer.unit_cost)}
                </span>
              </Row>
              <Row label="Remaining value">
                <strong className={cx('tabular-nums', layer.remaining_value < 0 && 'text-red-600')}>
                  {formatMoney(layer.remaining_value)}
                </strong>
              </Row>

              <Row label="Valuation method" wide>
                {item?.valuation_method ?? <span className="text-gray-400">Company default</span>}
              </Row>
            </dl>
          </Section>

          <Section
            title="Consumption history"
            description={
              consumptions.length === 0
                ? undefined
                : `${consumptions.length} issue${consumptions.length === 1 ? ' has' : 's have'} drawn ${formatQty(
                    layer.qty_consumed,
                  )} from this layer, at a cost of ${formatMoney(consumedValue)}.`
            }
          >
            {consumptions.length === 0 ? (
              <p className="rounded-lg border border-dashed border-gray-200 px-3 py-4 text-center text-[11.5px] text-gray-500">
                Nothing has been issued from this layer yet.
              </p>
            ) : (
              <div className="overflow-x-auto rounded-lg border border-gray-200">
                <table className="aic w-full text-[11.5px]">
                  <thead>
                    <tr className="bg-gray-50 text-left text-[10.5px] uppercase tracking-wide text-gray-500">
                      <th className="px-2.5 py-1.5 font-semibold">Issue</th>
                      <th className="px-2.5 py-1.5 font-semibold">Date</th>
                      <th className="px-2.5 py-1.5 text-right font-semibold">Qty</th>
                      <th className="px-2.5 py-1.5 text-right font-semibold">Unit cost</th>
                      <th className="px-2.5 py-1.5 text-right font-semibold">Amount</th>
                    </tr>
                  </thead>
                  <tbody>
                    {consumptions.map((c) => (
                      <tr key={c.consumption_id} className="border-t border-gray-100">
                        <td className="px-2.5 py-1.5">
                          {c.document_id ? (
                            <Link
                              to={`/documents/${c.document_id}`}
                              className="font-semibold text-gray-700 no-underline hover:text-primary hover:underline"
                            >
                              {c.document_no ?? `#${c.document_id}`}
                            </Link>
                          ) : (
                            <span className="text-gray-500">Movement {c.movement_id ?? ''}</span>
                          )}
                        </td>
                        <td className="whitespace-nowrap px-2.5 py-1.5 text-gray-600">
                          {formatDate(c.document_date ?? c.created_at)}
                        </td>
                        <td className="px-2.5 py-1.5 text-right tabular-nums">{formatQty(c.qty)}</td>
                        <td className="px-2.5 py-1.5 text-right tabular-nums">{formatMoney(c.unit_cost)}</td>
                        <td className="px-2.5 py-1.5 text-right font-semibold tabular-nums">{formatMoney(c.amount)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Section>

          <Section
            title="Audit trail"
            description="When the layer entered the books, and when it was entered — the two are not always the same day."
          >
            <dl className="grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-3">
              <Row label="Effective from">{formatDateTime(layer.received_at)}</Row>
              <Row label="Recorded at">{formatDateTime(layer.created_at)}</Row>
              <Row label="Financial year">
                {layer.fy_id ? `#${layer.fy_id}` : <span className="text-gray-400">—</span>}
              </Row>
            </dl>
            <p className="mt-2 text-[11px] leading-relaxed text-gray-500">
              A layer's cost is never edited in place. It changes only through a stock revaluation document or a
              back-dated recalculation, each of which records who ran it, when, and what it moved — see the
              <Link to="/audit" className="mx-1 font-semibold text-primary no-underline hover:underline">
                audit log
              </Link>
              for the full history.
            </p>
          </Section>
        </div>
      ) : null}
    </Drawer>
  )
}

export default CostLayerDrawer
