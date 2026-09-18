import { Calculator, ExternalLink, Lock } from 'lucide-react'
import type { Item, ItcEligibility, ItemFormOptions } from '../../services/items'
import { ITC_ELIGIBILITY } from '../../services/items'
import { booksMastersService } from '../../services/booksMastersService'
import { FormGrid } from '../../ui/shell/FormSectionCard'
import { AIC, cx } from '../../ui/cx'
import { ItemSectionCard } from './ItemSectionCard'
import type { ItemCardBaseProps } from './ItemSectionCard'
import { FieldNote, SelectField } from './ItemWorkspaceKit'

/**
 * The accounting an item carries, and the line it does not cross.
 *
 * Two different kinds of thing live here and they are shown differently on purpose:
 *
 *  - The **input-tax attribute** is Inventory's to hold. It is a fact about the goods — this is a
 *    motor vehicle, this is a food and beverage — and it is fully editable, exactly as before.
 *    Inventory records it and reports it; it makes no tax determination from it and computes
 *    nothing with it.
 *
 *  - The **ledger and tax-category references** are Books' rows. Inventory stores the id so a
 *    document knows where to post, and nothing more. There is no Books relay in this API, so there
 *    is no honest way to offer a picker — and the dishonest way (copying Books' chart of accounts
 *    into an Inventory table and syncing it on a cron) is the exact duplication the domain
 *    contract forbids. They are shown read-only with their origin named, and the save deliberately
 *    does not carry them: a column the request never sends is a column it cannot damage.
 */
export interface ItemAccountingCardProps extends ItemCardBaseProps {
  options: ItemFormOptions | null
  /** The saved record, for the Books references. Null on a new item. */
  item: Item | null
}

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

function BooksReference({ label, value }: { label: string; value: number | null }) {
  return (
    <div className={cx(AIC, 'flex flex-col gap-1')}>
      <span className="text-[11px] font-semibold uppercase tracking-wide text-gray-500">{label}</span>
      <div className="flex h-9 items-center gap-2 rounded-lg border border-gray-200 bg-gray-50 px-3">
        <Lock className="h-3 w-3 shrink-0 text-gray-400" aria-hidden />
        <span className="truncate text-sm tabular-nums text-gray-600">
          {value ? `Books reference #${value}` : 'Not mapped'}
        </span>
      </div>
    </div>
  )
}

export function ItemAccountingCard({ form, set, err, readOnly, registerSection, options, item }: ItemAccountingCardProps) {
  const books = booksMastersService.capability()
  return (
    <ItemSectionCard
      id="accounting"
      title="Accounting"
      description="What this item tells Books, and what Books tells it"
      icon={Calculator}
      register={registerSection}
    >
      <FormGrid cols={3} gap="md">
        <SelectField
          name="itc_eligibility"
          label="Input tax credit"
          value={form.itc_eligibility}
          disabled={readOnly}
          error={err('itc_eligibility')}
          emptyLabel={null}
          options={(options?.itc_eligibility_options ?? ITC_ELIGIBILITY).map((v) => ({ value: v, label: ITC_LABEL[v] }))}
          onChange={(v) => set('itc_eligibility', v as ItcEligibility)}
          hint={ITC_HELP[form.itc_eligibility]}
          className="lg:col-span-3"
        />
      </FormGrid>

      <FieldNote tone="info" className="mt-1">
        A fact about the goods that travels with the item. Inventory records it and reports it to Books; it makes no
        tax determination here, computes nothing from it, and has no rule about which setting wins. Books reads it
        alongside the tax category, the purchase ledger and the voucher line, and decides the credit there.
      </FieldNote>

      <div className="mt-4 rounded-xl border border-gray-200 p-3">
        <header className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h4 className="text-xs font-semibold text-gray-900">Books mappings</h4>
          <span className="inline-flex items-center gap-1 rounded-md bg-sky-50 px-1.5 py-0.5 text-[10px] font-semibold text-sky-700">
            <ExternalLink className="h-3 w-3" aria-hidden />
            Maintained in Aicountly Books
          </span>
        </header>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
          <BooksReference label="Sales ledger" value={item?.books_sales_acc_id ?? null} />
          <BooksReference label="Purchase ledger" value={item?.books_purchase_acc_id ?? null} />
          <BooksReference label="Tax category" value={item?.books_tax_cat_id ?? null} />
        </div>
        {!books.available ? (
          <p className="mt-3 text-[11px] leading-relaxed text-gray-500">{books.reason}</p>
        ) : null}
      </div>
    </ItemSectionCard>
  )
}

export default ItemAccountingCard
