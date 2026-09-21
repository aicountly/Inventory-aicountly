import { AlertTriangle, IndianRupee, TrendingUp } from 'lucide-react'
import type { ItemFormOptions } from '../../services/items'
import { FormGrid } from '../../ui/shell/FormSectionCard'
import { AIC, cx } from '../../ui/cx'
import { formatMoney, toNumber } from '../../utils/format'
import { ItemSectionCard } from './ItemSectionCard'
import type { ItemCardBaseProps } from './ItemSectionCard'
import { FieldNote, NumberField, SelectField } from './ItemWorkspaceKit'

/**
 * How this item is costed, and what that costs against its price.
 *
 * The boundary this card sits on: Inventory owns what a unit of stock is WORTH — the valuation
 * method, the standard cost, the layers, the COGS. Books owns what a unit of stock was SOLD for —
 * the invoice line, the discount, the tax, the debtor. So the margin strip below reads the two
 * figures the item master already holds and says whether they are consistent with each other; it
 * does not reach for a selling price, and no commercial total is computed here.
 */
export interface ItemPricingValuationCardProps extends ItemCardBaseProps {
  options: ItemFormOptions | null
  /** Null when the company's base currency is not readable here. */
  currencySymbol: string | null
  /** True on an item that already has movements, where a method change re-costs history. */
  hasHistory: boolean
}

export function ItemPricingValuationCard({
  form,
  set,
  err,
  readOnly,
  registerSection,
  options,
  currencySymbol,
  hasHistory,
}: ItemPricingValuationCardProps) {
  const mrp = toNumber(form.mrp)
  const cost = toNumber(form.standard_cost)
  const comparable = mrp !== null && cost !== null && cost > 0 && mrp > 0
  const margin = comparable ? mrp - cost : null
  const marginPct = comparable && margin !== null ? (margin / mrp) * 100 : null
  const belowCost = margin !== null && margin < 0
  const thin = margin !== null && marginPct !== null && margin >= 0 && marginPct < 5

  return (
    <ItemSectionCard
      id="pricing"
      title="Pricing & Valuation"
      description="Configure costing and inventory valuation"
      icon={IndianRupee}
      register={registerSection}
    >
      <FormGrid cols={3} gap="md">
        <SelectField
          name="valuation_method"
          label="Valuation method"
          value={form.valuation_method}
          disabled={readOnly}
          error={err('valuation_method')}
          emptyLabel={null}
          options={(options?.valuation_methods ?? ['FIFO', 'LIFO', 'WAC']).map((m) => ({ value: m, label: m }))}
          onChange={(v) => set('valuation_method', v)}
          hint={hasHistory ? 'Changing it re-costs this item’s history.' : 'How issues are costed against receipts.'}
        />
        <NumberField
          name="standard_cost"
          label="Standard cost"
          value={form.standard_cost}
          step="0.01"
          disabled={readOnly}
          error={err('standard_cost')}
          suffix={currencySymbol ?? undefined}
          onChange={(v) => set('standard_cost', v)}
          hint="Per base unit."
        />
        <div className={cx(AIC, 'flex flex-col justify-end')}>
          <span className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-gray-500">
            Margin against MRP
          </span>
          <div
            className={cx(
              'flex items-center gap-2 rounded-lg border px-3 py-2',
              belowCost
                ? 'border-red-200 bg-red-50'
                : thin
                  ? 'border-amber-200 bg-amber-50'
                  : comparable
                    ? 'border-emerald-200 bg-emerald-50'
                    : 'border-gray-200 bg-gray-50',
            )}
          >
            {comparable ? (
              belowCost ? (
                <AlertTriangle className="h-4 w-4 shrink-0 text-red-600" aria-hidden />
              ) : (
                <TrendingUp className={cx('h-4 w-4 shrink-0', thin ? 'text-amber-600' : 'text-emerald-600')} aria-hidden />
              )
            ) : null}
            <span
              className={cx(
                'text-sm font-semibold tabular-nums',
                belowCost ? 'text-red-700' : thin ? 'text-amber-700' : comparable ? 'text-emerald-700' : 'text-gray-500',
              )}
            >
              {comparable && margin !== null && marginPct !== null
                ? `${currencySymbol ? `${currencySymbol} ` : ''}${formatMoney(margin)} · ${marginPct.toFixed(1)}%`
                : 'Needs MRP and standard cost'}
            </span>
          </div>
        </div>
      </FormGrid>

      {belowCost ? (
        <FieldNote tone="danger" icon={AlertTriangle} className="mt-3">
          <strong>MRP is below standard cost.</strong> Every sale at this price books a loss. Check whichever of the
          two figures is wrong before this item reaches a document.
        </FieldNote>
      ) : thin ? (
        <FieldNote tone="warning" icon={AlertTriangle} className="mt-3">
          Under 5% between standard cost and MRP. Freight, landed cost and a discount will take an item this thin
          under water.
        </FieldNote>
      ) : null}

      <FieldNote tone="info" className="mt-3">
        Inventory values the stock — the method, the cost layers and the COGS it reports back. What the item is
        invoiced at, taxed at and discounted by stays in Aicountly Books.
      </FieldNote>
    </ItemSectionCard>
  )
}

export default ItemPricingValuationCard
