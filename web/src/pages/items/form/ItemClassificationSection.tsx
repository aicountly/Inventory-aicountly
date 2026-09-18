import { Percent, Tags } from 'lucide-react'
import { Link } from 'react-router-dom'
import { ITC_ELIGIBILITY } from '../../../services/items'
import type { ItcEligibility, ItemFormOptions } from '../../../services/items'
import { Select } from '../../../ui/Select'
import type { ItemFormState } from '../itemForm'
import { Field, MasterSelect, SectionCard, fieldDescribedBy } from './FormControls'
import type { MasterOption } from './FormControls'

/**
 * What the item-level ITC attribute means, in the words of the goods rather
 * than of the tax. Carried over verbatim from the previous form: Inventory
 * stores a FACT ABOUT THE ITEM and makes no tax determination from it; Books
 * resolves it against the tax category, the purchase ledger and the voucher
 * line, and decides the credit there.
 */
const ITC_HELP: Record<ItcEligibility, string> = {
  inherit: 'This item says nothing. Books decides from the tax category and the purchase ledger, exactly as it does today.',
  block: 'Mark the item as one whose input tax is ordinarily NOT recoverable — a motor vehicle, a food and beverage. Books reads this and decides; Inventory computes no tax.',
  claim: 'Mark the item as one whose input tax is ordinarily recoverable, whatever its category suggests. Books reads this and decides; Inventory computes no tax.',
}

const ITC_LABEL: Record<ItcEligibility, string> = {
  inherit: 'Inherit — let Books decide',
  claim: 'Claim — ordinarily recoverable',
  block: 'Block — ordinarily not recoverable',
}

export interface ItemClassificationSectionProps {
  form: ItemFormState
  set: <K extends keyof ItemFormState>(key: K, value: ItemFormState[K]) => void
  err: (key: string) => string | undefined
  readOnly: boolean
  highlighted: ReadonlySet<string>
  options: ItemFormOptions | null
  optionsLoading: boolean
  optionsError: string | null
  onRetryOptions: () => void
  /** True while the user may create the masters these selects read. */
  canManageMasters: boolean
}

export function ItemClassificationSection({
  form,
  set,
  err,
  readOnly,
  highlighted,
  options,
  optionsLoading,
  optionsError,
  onRetryOptions,
  canManageMasters,
}: ItemClassificationSectionProps) {
  const groups: MasterOption[] = (options?.item_groups ?? []).map((g) => ({ value: String(g.item_grp_id), label: g.grp_name }))
  const categories: MasterOption[] = (options?.stock_categories ?? []).map((c) => ({ value: String(c.stock_cat_id), label: c.cat_name }))
  const brands: MasterOption[] = (options?.brands ?? []).map((b) => ({ value: String(b.brand_id), label: b.brand_name }))

  const shared = { disabled: readOnly, loading: optionsLoading, error: optionsError, onRetry: onRetryOptions }

  return (
    <>
      <SectionCard
        id="item-classification"
        icon={Tags}
        title="Classification"
        description="How this item is grouped for reporting, analysis and stock controls."
        action={
          canManageMasters ? (
            <Link to="/masters" className="text-[11px] font-semibold text-primary no-underline hover:underline">
              Manage masters
            </Link>
          ) : null
        }
      >
        <div className="grid grid-cols-12 gap-3">
          <Field
            id="item_grp_id"
            label="Item group"
            error={err('item_grp_id')}
            hint="Drives the group columns in stock reports."
            highlighted={highlighted.has('item_grp_id')}
            className="col-span-12 md:col-span-4"
          >
            <MasterSelect
              id="item_grp_id"
              value={form.item_grp_id}
              onChange={(v) => set('item_grp_id', v)}
              options={groups}
              placeholder="— None —"
              emptyLabel="No item groups yet."
              invalid={!!err('item_grp_id')}
              describedBy={fieldDescribedBy('item_grp_id', true)}
              {...shared}
            />
          </Field>

          <Field
            id="stock_cat_id"
            label="Stock category"
            error={err('stock_cat_id')}
            hint="A second axis, independent of the group tree."
            highlighted={highlighted.has('stock_cat_id')}
            className="col-span-12 md:col-span-4"
          >
            <MasterSelect
              id="stock_cat_id"
              value={form.stock_cat_id}
              onChange={(v) => set('stock_cat_id', v)}
              options={categories}
              placeholder="— None —"
              emptyLabel="No stock categories yet."
              invalid={!!err('stock_cat_id')}
              describedBy={fieldDescribedBy('stock_cat_id', true)}
              {...shared}
            />
          </Field>

          <Field
            id="brand_id"
            label="Brand"
            error={err('brand_id')}
            hint="Who makes or markets it."
            highlighted={highlighted.has('brand_id')}
            className="col-span-12 md:col-span-4"
          >
            <MasterSelect
              id="brand_id"
              value={form.brand_id}
              onChange={(v) => set('brand_id', v)}
              options={brands}
              placeholder="— None —"
              emptyLabel="No brands yet."
              invalid={!!err('brand_id')}
              describedBy={fieldDescribedBy('brand_id', true)}
              {...shared}
            />
          </Field>
        </div>
      </SectionCard>

      <SectionCard
        id="item-tax"
        icon={Percent}
        title="Tax attribute"
        description="A fact about the goods that travels with the item. Inventory records it and reports it to Smart Books; it makes no tax determination here and has no rule about which setting wins."
      >
        <div className="grid grid-cols-12 gap-3">
          <Field
            id="itc_eligibility"
            label="Input tax credit"
            error={err('itc_eligibility')}
            hint={ITC_HELP[form.itc_eligibility]}
            highlighted={highlighted.has('itc_eligibility')}
            className="col-span-12 md:col-span-6"
          >
            <Select
              id="itc_eligibility"
              size="md"
              value={form.itc_eligibility}
              disabled={readOnly}
              aria-describedby={fieldDescribedBy('itc_eligibility', true)}
              onChange={(e) => set('itc_eligibility', e.target.value as ItcEligibility)}
            >
              {(options?.itc_eligibility_options ?? ITC_ELIGIBILITY).map((v) => (
                <option key={v} value={v}>
                  {ITC_LABEL[v as ItcEligibility] ?? v}
                </option>
              ))}
            </Select>
          </Field>
        </div>
      </SectionCard>
    </>
  )
}

export default ItemClassificationSection
