import { FileText, ScanLine, Sparkles } from 'lucide-react'
import { ITEM_TYPES } from '../../services/items'
import { Button } from '../../ui/Button'
import { Tooltip } from '../../ui/Tooltip'
import { FormGrid } from '../../ui/shell/FormSectionCard'
import { humanize } from '../../utils/format'
import { ItemSectionCard } from './ItemSectionCard'
import type { ItemCardBaseProps } from './ItemSectionCard'
import { NumberField, SelectField, TextField, ToggleField } from './ItemWorkspaceKit'

/**
 * Identity: what this thing is called, how it is coded and whether it is in use.
 *
 * `item_type` keeps the API's vocabulary (`stock`, `service`, `non_stock`) and shows the humanised
 * label; mapping the label back would be one more place for the two to drift.
 */
export interface ItemBasicDetailsCardProps extends ItemCardBaseProps {
  onSuggest: () => void
  suggestBusy: boolean
  /** Null when the company's base currency is not readable here — the label then carries no symbol. */
  currencySymbol: string | null
  /** Reports the state of scanning support on this device; the field stays typeable either way. */
  onScanBarcode: () => void
}

export function ItemBasicDetailsCard({
  form,
  set,
  err,
  readOnly,
  registerSection,
  onSuggest,
  suggestBusy,
  currencySymbol,
  onScanBarcode,
}: ItemBasicDetailsCardProps) {
  return (
    <ItemSectionCard
      id="basic"
      title="Basic Details"
      description="Core information about this item"
      icon={FileText}
      register={registerSection}
      action={
        readOnly ? null : (
          <Button
            variant="secondary"
            size="sm"
            icon={Sparkles}
            loading={suggestBusy}
            onClick={onSuggest}
            className="border-violet-200 bg-violet-50 text-violet-700 hover:border-violet-300 hover:bg-violet-100 hover:text-violet-700"
          >
            Suggest with AI
          </Button>
        )
      }
    >
      <FormGrid cols={3} gap="md">
        <TextField
          name="item_name"
          label="Item name"
          required
          value={form.item_name}
          maxLength={255}
          disabled={readOnly}
          error={err('item_name')}
          onChange={(v) => set('item_name', v)}
        />

        <SelectField
          name="item_type"
          label="Item type"
          required
          value={form.item_type}
          disabled={readOnly}
          error={err('item_type')}
          emptyLabel={null}
          options={ITEM_TYPES.map((t) => ({ value: t, label: humanize(t) }))}
          onChange={(v) => set('item_type', v)}
          hint={
            form.item_type === 'stock'
              ? 'Holds quantity and is valued.'
              : form.item_type === 'service'
                ? 'No quantity, no valuation.'
                : 'Bought and sold without stock being kept.'
          }
        />

        <TextField
          name="item_sku"
          label="SKU / item code"
          value={form.item_sku}
          maxLength={64}
          disabled={readOnly}
          error={err('item_sku')}
          hint="Unique within the company."
          onChange={(v) => set('item_sku', v)}
        />

        <TextField
          name="item_alias"
          label="Alias / short name"
          value={form.item_alias}
          maxLength={255}
          disabled={readOnly}
          error={err('item_alias')}
          onChange={(v) => set('item_alias', v)}
        />

        <TextField
          name="item_upc"
          label="Barcode / EAN / UPC"
          value={form.item_upc}
          maxLength={64}
          disabled={readOnly}
          error={err('item_upc')}
          onChange={(v) => set('item_upc', v)}
          addon={
            <Tooltip label="Scan a barcode">
              <button
                type="button"
                aria-label="Scan barcode"
                disabled={readOnly}
                onClick={onScanBarcode}
                className="-ml-px flex h-9 w-10 shrink-0 items-center justify-center rounded-r-lg border border-gray-200 bg-gray-50 text-gray-500 transition-colors hover:bg-gray-100 hover:text-gray-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 disabled:cursor-not-allowed disabled:opacity-60"
              >
                <ScanLine className="h-4 w-4" aria-hidden />
              </button>
            </Tooltip>
          }
        />

        <TextField
          name="print_name"
          label="Print name"
          value={form.print_name}
          maxLength={255}
          disabled={readOnly}
          error={err('print_name')}
          hint="Defaults to the item name."
          onChange={(v) => set('print_name', v)}
        />

        <TextField
          name="hsn_sac"
          label="HSN / SAC"
          value={form.hsn_sac}
          maxLength={8}
          disabled={readOnly}
          error={err('hsn_sac')}
          hint="4 to 8 characters."
          onChange={(v) => set('hsn_sac', v)}
        />

        <NumberField
          name="mrp"
          label={currencySymbol ? `MRP (${currencySymbol})` : 'MRP'}
          value={form.mrp}
          step="0.01"
          disabled={readOnly}
          error={err('mrp')}
          onChange={(v) => set('mrp', v)}
        />

        <ToggleField
          name="is_active"
          label="Active"
          description={form.is_active ? 'Shows in every list and document.' : 'Hidden from new documents; history is kept.'}
          checked={form.is_active}
          disabled={readOnly}
          onChange={(v) => set('is_active', v)}
          className="self-end"
        />
      </FormGrid>
    </ItemSectionCard>
  )
}

export default ItemBasicDetailsCard
