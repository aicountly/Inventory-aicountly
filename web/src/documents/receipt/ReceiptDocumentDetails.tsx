import { CalendarDays, FileText, Hash, Search, Truck, X } from 'lucide-react'
import type { ReactNode } from 'react'
import { Input } from '../../ui/Input'
import { Textarea } from '../../ui/Textarea'
import { Tooltip } from '../../ui/Tooltip'
import { FormField, FormGrid, FormSectionCard } from '../../ui/shell/FormSectionCard'
import type { FormOptionWarehouse } from '../../services/items'
import type { HeaderDraft } from '../formModel'
import type { HeaderField, HeaderIssue } from './receiptModel'
import type { ReceiptExtras } from './receiptModel'
import { SupplierField } from './SupplierField'
import { WarehousePicker } from './WarehousePicker'

export interface LinkedPurchaseOrder {
  id: number | string
  no: string
}

export interface ReceiptDocumentDetailsProps {
  header: HeaderDraft
  extras: ReceiptExtras
  onHeaderChange: (patch: Partial<HeaderDraft>) => void
  onExtrasChange: (patch: Partial<ReceiptExtras>) => void
  warehouses: FormOptionWarehouse[]
  warehousesLoading: boolean
  disabled?: boolean
  issues: HeaderIssue[]
  /** The strip, when it has not been dismissed. */
  assistant?: ReactNode
  linkedPo: LinkedPurchaseOrder | null
  onOpenPoPicker: () => void
  onClearPo: () => void
  poReason: string | null
}

function issueFor(issues: HeaderIssue[], field: HeaderField): string | undefined {
  return issues.find((i) => i.field === field)?.message
}

/**
 * The receipt header: when it arrived, on whose paperwork, from whom, into
 * which store.
 *
 * Every field here is a column or a metadata key `inv_documents` already
 * carries — nothing on this card is collected and then dropped on save.
 */
export function ReceiptDocumentDetails({
  header,
  extras,
  onHeaderChange,
  onExtrasChange,
  warehouses,
  warehousesLoading,
  disabled,
  issues,
  assistant,
  linkedPo,
  onOpenPoPicker,
  onClearPo,
  poReason,
}: ReceiptDocumentDetailsProps) {
  const dateError = issueFor(issues, 'document_date')
  const warehouseError = issueFor(issues, 'default_warehouse_id')
  const refDateError = issueFor(issues, 'source_document_date')
  const partyError = issueFor(issues, 'party_ref')

  const poButton = (
    <button
      type="button"
      onClick={onOpenPoPicker}
      disabled={disabled || Boolean(poReason)}
      className="flex w-full items-center gap-2 h-9 rounded-lg border border-gray-200 bg-white px-3 text-sm text-left text-gray-400 hover:border-primary/40 hover:text-gray-600 transition-colors disabled:cursor-not-allowed disabled:bg-gray-50 focus:outline-none focus:border-primary focus:ring-2 focus:ring-primary/30"
    >
      <Search className="w-4 h-4 shrink-0" aria-hidden />
      <span className="truncate">Search PO number…</span>
    </button>
  )

  return (
    <FormSectionCard
      title="Document details"
      description="When the material arrived, on whose paperwork, and into which store."
      icon={FileText}
    >
      {assistant}
      <FormGrid cols={4} gap="md">
        <FormField label="Document date" htmlFor="mr_document_date" required error={dateError}>
          <Input
            id="mr_document_date"
            type="date"
            size="md"
            value={header.document_date}
            disabled={disabled}
            invalid={Boolean(dateError)}
            onChange={(e) => onHeaderChange({ document_date: e.target.value })}
          />
        </FormField>

        <FormField label="Document no." htmlFor="mr_document_no" hint="Leave empty to number automatically.">
          <Input
            id="mr_document_no"
            size="md"
            leadingIcon={Hash}
            value={header.document_no}
            disabled={disabled}
            maxLength={64}
            placeholder="Auto-generate"
            onChange={(e) => onHeaderChange({ document_no: e.target.value })}
          />
        </FormField>

        <FormField
          label="Purchase order"
          hint={
            linkedPo
              ? `Receiving against ${linkedPo.no}.`
              : poReason
                ? 'Not connected in this environment yet.'
                : 'Optional. Pulls the ordered lines straight in.'
          }
        >
          {linkedPo ? (
            <div className="flex items-center gap-2 h-9 rounded-lg border border-sky-200 bg-sky-50 px-3 text-sm">
              <span className="font-medium text-gray-900 truncate">{linkedPo.no}</span>
              <button
                type="button"
                onClick={onClearPo}
                disabled={disabled}
                aria-label="Unlink the purchase order"
                className="ml-auto shrink-0 text-gray-500 hover:text-red-600"
              >
                <X className="w-4 h-4" aria-hidden />
              </button>
            </div>
          ) : poReason ? (
            <Tooltip label={poReason}>{poButton}</Tooltip>
          ) : (
            poButton
          )}
        </FormField>

        <SupplierField
          name={header.party_name}
          ledgerId={header.party_ref}
          onChange={onHeaderChange}
          disabled={disabled}
          error={partyError}
        />

        <FormField
          label="Default warehouse"
          htmlFor="mr_default_wh"
          required
          error={warehouseError}
          hint={warehouseError ? undefined : 'Pre-fills the warehouse on new lines.'}
        >
          <WarehousePicker
            id="mr_default_wh"
            value={header.default_warehouse_id}
            onChange={(id) => onHeaderChange({ default_warehouse_id: id })}
            warehouses={warehouses}
            emptyLabel={warehousesLoading ? 'Loading warehouses…' : 'Select warehouse'}
            invalid={Boolean(warehouseError)}
            disabled={disabled || warehousesLoading}
          />
        </FormField>

        <FormField label="Reference no." htmlFor="mr_reference_no" hint="Supplier challan / invoice no.">
          <Input
            id="mr_reference_no"
            size="md"
            value={header.source_document_no}
            disabled={disabled}
            maxLength={64}
            placeholder="e.g. INV-4421"
            onChange={(e) => onHeaderChange({ source_document_no: e.target.value })}
          />
        </FormField>

        <FormField label="Reference date" htmlFor="mr_reference_date" error={refDateError}>
          <Input
            id="mr_reference_date"
            type="date"
            size="md"
            value={header.source_document_date}
            disabled={disabled}
            invalid={Boolean(refDateError)}
            trailingIcon={header.source_document_date ? undefined : CalendarDays}
            onChange={(e) => onHeaderChange({ source_document_date: e.target.value })}
          />
        </FormField>

        <FormField label="Transporter" htmlFor="mr_transporter" hint="Carrier as written on the challan.">
          <Input
            id="mr_transporter"
            size="md"
            leadingIcon={Truck}
            value={extras.transporter_name}
            disabled={disabled}
            maxLength={120}
            placeholder="Carrier name"
            onChange={(e) => onExtrasChange({ transporter_name: e.target.value })}
          />
        </FormField>

        <FormField label="Narration" htmlFor="mr_narration" className="md:col-span-2 lg:col-span-4">
          <Textarea
            id="mr_narration"
            rows={2}
            value={header.narration}
            disabled={disabled}
            placeholder="e.g. Received against PO, challan no…, quality remarks, unloading details."
            onChange={(e) => onHeaderChange({ narration: e.target.value })}
          />
        </FormField>
      </FormGrid>
    </FormSectionCard>
  )
}

export default ReceiptDocumentDetails
