import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { ArrowUpRight, Info } from 'lucide-react'
import { Button } from '../../../ui/Button'
import { Drawer } from '../../../ui/Drawer'
import { Input } from '../../../ui/Input'
import { cx } from '../../../ui/cx'
import type { CostLayerItem, CostLayerRow } from '../../../services/valuationApi'
import { formatDate, formatMoney, formatQty, toNumber, todayIso } from '../../../utils/format'

export interface ValuationRevisionDrawerProps {
  open: boolean
  onClose: () => void
  item: CostLayerItem | null
  /** The layer the reader opened this from, if any. */
  layer: CostLayerRow | null
  /** Open quantity and value across the layers the filters match. */
  openQty: number
  openValue: number
  /** May the profile raise a stock revaluation document? */
  canRevalue: boolean
  /** May the profile queue a recalculation? */
  canRecalculate: boolean
  onRecalculate: () => void
}

function Figure({ label, value, tone = 'default' }: { label: string; value: string; tone?: 'default' | 'good' | 'bad' }) {
  return (
    <div className="rounded-lg border border-gray-200 p-2.5">
      <p className="text-[10.5px] font-medium uppercase tracking-wide text-gray-500">{label}</p>
      <p
        className={cx(
          'mt-0.5 truncate text-[15px] font-semibold tabular-nums',
          tone === 'good' ? 'text-emerald-600' : tone === 'bad' ? 'text-red-600' : 'text-gray-900',
        )}
      >
        {value}
      </p>
    </div>
  )
}

/**
 * What it would take to change this item's cost, and what it would do.
 *
 * Deliberately not a form that writes a revision. A valuation revision is an
 * OUTPUT in this system — the record of a cost that changed, produced by a
 * stock revaluation document or a back-dated recalculation and published to
 * Books from there. A panel that wrote one directly would leave a cost in the
 * ledger with no document behind it and no reason recorded against it, which
 * is precisely the thing an audit trail exists to prevent.
 *
 * So this does the part a form cannot: it prices the change before anyone
 * commits to it — quantity on hand times the difference in cost — and then
 * hands over to whichever of the two real workflows fits. Nothing here writes
 * anything.
 */
export function ValuationRevisionDrawer({
  open,
  onClose,
  item,
  layer,
  openQty,
  openValue,
  canRevalue,
  canRecalculate,
  onRecalculate,
}: ValuationRevisionDrawerProps) {
  const currentCost = layer ? layer.unit_cost : openQty > 0 ? openValue / openQty : 0
  const qty = layer ? layer.qty_remaining : openQty
  const [newCost, setNewCost] = useState('')
  const [effective, setEffective] = useState(todayIso())

  useEffect(() => {
    if (!open) return
    setNewCost('')
    setEffective(layer?.received_at?.slice(0, 10) ?? todayIso())
  }, [open, layer])

  const revised = toNumber(newCost)
  const delta = revised === null ? null : (revised - currentCost) * qty

  return (
    <Drawer
      open={open}
      onClose={onClose}
      width="lg"
      title="Create revision"
      description="Price a cost change before you commit to it, then raise the document that records it."
      footer={
        <div className="flex flex-wrap items-center justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>
            Close
          </Button>
          {canRecalculate ? (
            <Button
              variant="secondary"
              onClick={() => {
                onClose()
                onRecalculate()
              }}
            >
              Recalculate instead
            </Button>
          ) : null}
          {canRevalue ? (
            <Link
              to="/documents/new/revaluation"
              onClick={onClose}
              className="aic inline-flex h-8 items-center gap-1.5 rounded-lg bg-primary px-3.5 text-sm font-medium text-white no-underline shadow-card transition-colors hover:bg-primary-hover focus:outline-none focus:ring-2 focus:ring-primary/30"
            >
              Open stock revaluation
              <ArrowUpRight className="h-4 w-4" aria-hidden />
            </Link>
          ) : null}
        </div>
      }
    >
      <div className="space-y-5">
        <div className="rounded-lg border border-sky-200 bg-sky-50 p-3">
          <p className="flex items-start gap-2 text-[11.5px] leading-relaxed text-sky-700">
            <Info className="mt-px h-4 w-4 shrink-0" aria-hidden />
            <span>
              Costs are never edited in place in Aicountly. A <strong>stock revaluation</strong> re-prices the stock
              still on hand from a date forward; a <strong>recalculation</strong> re-costs issues that have already
              been posted. Both record who did it, when, and against which document — this panel writes nothing.
            </span>
          </p>
        </div>

        <section>
          <h3 className="text-[13px] font-semibold text-gray-900">
            {layer ? `Layer #${layer.layer_id}` : item ? item.item_name : 'Selected item'}
          </h3>
          <p className="mt-0.5 text-[11px] leading-relaxed text-gray-500">
            {layer
              ? `Opened ${formatDate(layer.received_at)}${layer.warehouse_name ? ` at ${layer.warehouse_name}` : ''}${
                  layer.batch_no ? `, batch ${layer.batch_no}` : ''
                }.`
              : 'Across every open layer matching the filters on screen.'}
          </p>

          <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-3">
            <Figure label="Quantity affected" value={formatQty(qty)} />
            <Figure label="Current unit cost" value={formatMoney(currentCost)} />
            <Figure label="Value held" value={formatMoney(layer ? layer.remaining_value : openValue)} />
          </div>
        </section>

        <section className="space-y-3">
          <h3 className="text-[13px] font-semibold text-gray-900">Price the change</h3>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <label className="flex flex-col gap-1">
              <span className="text-xs font-semibold text-gray-700">Revised unit cost</span>
              <Input
                type="number"
                step="0.0001"
                min="0"
                inputMode="decimal"
                value={newCost}
                placeholder={currentCost.toFixed(4)}
                onChange={(e) => setNewCost(e.target.value)}
              />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-xs font-semibold text-gray-700">Effective from</span>
              <Input type="date" value={effective} onChange={(e) => setEffective(e.target.value)} />
            </label>
          </div>

          <div
            className={cx(
              'rounded-lg border p-3',
              delta === null
                ? 'border-gray-200 bg-gray-50'
                : delta > 0
                  ? 'border-emerald-200 bg-emerald-50'
                  : delta < 0
                    ? 'border-amber-200 bg-amber-50'
                    : 'border-gray-200 bg-gray-50',
            )}
          >
            {delta === null ? (
              <p className="text-[11.5px] text-gray-600">
                Enter a revised cost and the change in stock value appears here, before anything is raised.
              </p>
            ) : (
              <>
                <p className="text-[11.5px] text-gray-700">
                  {formatQty(qty)} units move from {formatMoney(currentCost)} to {formatMoney(revised ?? 0)} each.
                </p>
                <p className="mt-1 text-[15px] font-semibold tabular-nums text-gray-900">
                  Stock value {delta >= 0 ? 'increases' : 'decreases'} by {formatMoney(Math.abs(delta))}
                </p>
                <p className="mt-1 text-[11px] leading-relaxed text-gray-600">
                  Books will see the matching adjustment once the revaluation is posted and the revision is published.
                </p>
              </>
            )}
          </div>
        </section>

        <section>
          <h3 className="text-[13px] font-semibold text-gray-900">What to do next</h3>
          <ul className="mt-2 space-y-2 text-[11.5px] leading-relaxed text-gray-600">
            <li className="rounded-lg border border-gray-200 p-2.5">
              <strong className="text-gray-900">Re-price stock still on hand.</strong> Raise a stock revaluation for
              this item and warehouse with the revised cost, a reason and a supporting reference. It opens a
              revaluation layer, so the old cost stays on the record beside the new one.
              {canRevalue ? null : (
                <span className="mt-1 block text-amber-700">
                  Your profile cannot raise revaluation documents — ask someone who can.
                </span>
              )}
            </li>
            <li className="rounded-lg border border-gray-200 p-2.5">
              <strong className="text-gray-900">Re-cost issues already posted.</strong> Run a back-dated
              recalculation from {formatDate(effective)}. Every issue after that date is re-costed and each change is
              recorded as a revision Books acknowledges.
              {canRecalculate ? null : (
                <span className="mt-1 block text-amber-700">
                  Your profile cannot queue recalculations — ask someone who can.
                </span>
              )}
            </li>
          </ul>
          <p className="mt-2 text-[11px] leading-relaxed text-gray-500">
            Every revision this produces is listed on the{' '}
            <Link to="/valuation/revisions" className="font-semibold text-primary no-underline hover:underline">
              revisions tab
            </Link>
            , with the old rate, the new rate and whether Books has acknowledged it.
          </p>
        </section>
      </div>
    </Drawer>
  )
}

export default ValuationRevisionDrawer
