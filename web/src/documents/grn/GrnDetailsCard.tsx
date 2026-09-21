import { useId } from 'react'
import { CalendarDays, FileText, Hash, Link2, MessageSquare, Plus, Settings2, Sparkles, X } from 'lucide-react'
import { Badge } from '../../ui/Badge'
import { Button } from '../../ui/Button'
import { Input } from '../../ui/Input'
import { Select } from '../../ui/Select'
import { Textarea } from '../../ui/Textarea'
import { Tooltip } from '../../ui/Tooltip'
import { AIC, cx } from '../../ui/cx'
import { FormField } from '../../ui/shell/FormSectionCard'
import { GRN_TAGS, NARRATION_MAX, toggleTag } from './grnModel'
import { SupplierSelector } from './SupplierSelector'
import { GrnWarehouseSelect } from './GrnWarehouseSelect'
import type { HeaderDraft } from '../formModel'
import type { DocumentTypeSpec } from '../registry'
import type { FormOptionWarehouse } from '../../services/items'
import { GrnCard, GrnCardHeader } from './GrnCard'

export interface GrnDetailsCardProps {
  spec: DocumentTypeSpec
  header: HeaderDraft
  onPatch: (patch: Partial<HeaderDraft>) => void
  warehouses: FormOptionWarehouse[]
  warehousesLoading: boolean
  /** Manage's range for the selected financial year, used to bound the date picker. */
  fyRange: { from: string; to: string }
  autoNumber: boolean
  onAutoNumberChange: (auto: boolean) => void
  linkedOrderLabel: string | null
  onUnlinkOrder: () => void
  onOpenPurchaseOrders: () => void
  canCreateSupplier: boolean
  booksOrigin: string | null
  disabled?: boolean
  /** Field names the last validation attempt complained about. */
  invalid?: { supplier?: boolean; warehouse?: boolean; date?: boolean }
}

/**
 * The header of an inward challan: when it arrived, who from, against what, and what receiving
 * it does to stock.
 *
 * Seven fields, in the order a receiving clerk fills them, and the one that changes the meaning
 * of the document — Stock effect — carries its consequence in words underneath rather than in a
 * tooltip. Everything else the type supports (returnable dates, reason codes) belongs to other
 * document types and is deliberately not here.
 */
export function GrnDetailsCard({
  spec,
  header,
  onPatch,
  warehouses,
  warehousesLoading,
  fyRange,
  autoNumber,
  onAutoNumberChange,
  linkedOrderLabel,
  onUnlinkOrder,
  onOpenPurchaseOrders,
  canCreateSupplier,
  booksOrigin,
  disabled,
  invalid,
}: GrnDetailsCardProps) {
  const dateId = useId()
  const supplierId = useId()
  const referenceId = useId()
  const documentNoId = useId()
  const ledgerId = useId()
  const stockEffectId = useId()
  const warehouseId = useId()
  const narrationId = useId()

  const tags = header.metadata.tags ?? []
  const effectHint = spec.stockEffects.find((s) => s.value === header.stock_effect)?.hint
  const narration = header.narration ?? ''

  return (
    <GrnCard>
      <GrnCardHeader
        icon={FileText}
        tone="success"
        title="Document Details"
        description="Enter challan details and supplier information"
        action={
          <button
            type="button"
            onClick={onOpenPurchaseOrders}
            disabled={disabled}
            className={cx(
              AIC,
              'inline-flex items-center gap-1.5 rounded-full bg-violet-50 px-3 py-1.5 text-xs font-semibold text-violet-700 transition-colors hover:bg-violet-100 disabled:opacity-60',
            )}
          >
            <Sparkles className="h-3.5 w-3.5" aria-hidden />
            Auto-fill from Purchase Order
          </button>
        }
      />

      <div className="grid grid-cols-1 gap-x-4 gap-y-3 px-4 py-3.5 md:grid-cols-2 xl:grid-cols-3">
        <FormField label="Document date" htmlFor={dateId} required>
          <Input
            id={dateId}
            type="date"
            size="md"
            value={header.document_date}
            min={fyRange.from || undefined}
            max={fyRange.to || undefined}
            disabled={disabled}
            invalid={invalid?.date}
            leadingIcon={CalendarDays}
            onChange={(e) => onPatch({ document_date: e.target.value })}
          />
        </FormField>

        <FormField
          label="Supplier"
          htmlFor={supplierId}
          required
          hint={header.party_ref.trim() ? undefined : 'Link the Books ledger so pending quantities match.'}
        >
          <div className="flex items-start gap-2">
            <div className="min-w-0 flex-1">
              <SupplierSelector
                id={supplierId}
                partyRef={header.party_ref}
                partyName={header.party_name}
                onChange={onPatch}
                disabled={disabled}
                invalid={invalid?.supplier}
              />
            </div>
            {canCreateSupplier && booksOrigin ? (
              <Tooltip label="Suppliers are ledgers in Aicountly Books — opens Books in a new tab">
                <a
                  href={`${booksOrigin}/masters/ledgers/new`}
                  target="_blank"
                  rel="noreferrer noopener"
                  data-unsaved-allow
                  className={cx(
                    AIC,
                    'inline-flex h-9 shrink-0 items-center gap-1 rounded-lg border border-gray-200 bg-white px-2.5 text-sm font-medium text-gray-700 no-underline transition-colors hover:border-primary/40 hover:text-primary',
                  )}
                >
                  <Plus className="h-3.5 w-3.5" aria-hidden />
                  New
                </a>
              </Tooltip>
            ) : null}
          </div>
        </FormField>

        <FormField label="Reference" htmlFor={referenceId} hint="Searchable on the documents register.">
          <Input
            id={referenceId}
            size="md"
            maxLength={64}
            value={header.reference}
            disabled={disabled}
            placeholder="PO No. / Supplier Challan No. / Invoice No."
            onChange={(e) => onPatch({ reference: e.target.value })}
          />
        </FormField>

        <FormField
          label="Document no."
          htmlFor={documentNoId}
          required
          hint={autoNumber ? 'Numbered automatically when the draft is saved.' : 'Must be unique in this company and financial year.'}
        >
          <div className="flex items-center gap-2">
            <Input
              id={documentNoId}
              size="md"
              className="flex-1"
              maxLength={64}
              value={header.document_no}
              disabled={disabled || autoNumber}
              placeholder={autoNumber ? 'GRN-0000 (auto)' : 'Enter the number'}
              onChange={(e) => onPatch({ document_no: e.target.value })}
            />
            <Tooltip label={autoNumber ? 'Switch to a number you type' : 'Switch back to automatic numbering'}>
              <Button
                variant="secondary"
                size="md"
                icon={Settings2}
                aria-label={autoNumber ? 'Number this document manually' : 'Number this document automatically'}
                aria-pressed={!autoNumber}
                disabled={disabled}
                onClick={() => {
                  onAutoNumberChange(!autoNumber)
                  if (!autoNumber) onPatch({ document_no: '' })
                }}
              />
            </Tooltip>
          </div>
        </FormField>

        <FormField
          label="Supplier ledger id"
          htmlFor={ledgerId}
          hint="Books account id (acc_id). Pending quantities are matched on it."
        >
          <Input
            id={ledgerId}
            size="md"
            inputMode="numeric"
            value={header.party_ref}
            disabled={disabled}
            leadingIcon={Hash}
            placeholder="Not linked"
            onChange={(e) => onPatch({ party_ref: e.target.value.replace(/[^\d]/g, '') })}
          />
        </FormField>

        <FormField label="Stock effect" htmlFor={stockEffectId} required hint={effectHint}>
          <Select
            id={stockEffectId}
            size="md"
            value={header.stock_effect}
            disabled={disabled}
            onChange={(e) =>
              onPatch({
                stock_effect: e.target.value,
                metadata: { ...header.metadata, linked_source_document_id: undefined },
              })
            }
          >
            {spec.stockEffects.map((effect) => (
              <option key={effect.value} value={effect.value}>
                {effect.label}
              </option>
            ))}
          </Select>
        </FormField>

        <FormField
          label="Default warehouse"
          htmlFor={warehouseId}
          required
          hint={warehousesLoading ? 'Loading warehouses…' : 'Pre-fills the warehouse on new lines.'}
        >
          <GrnWarehouseSelect
            id={warehouseId}
            size="md"
            value={header.default_warehouse_id}
            onChange={(id) => onPatch({ default_warehouse_id: id })}
            warehouses={warehouses}
            disabled={disabled}
            invalid={invalid?.warehouse}
          />
        </FormField>

        {linkedOrderLabel ? (
          <div className="md:col-span-2 xl:col-span-3">
            <div className="flex flex-wrap items-center gap-2 rounded-lg border border-sky-200 bg-sky-50/70 px-3 py-2">
              <Link2 className="h-4 w-4 shrink-0 text-sky-600" aria-hidden />
              <span className="min-w-0 flex-1 truncate text-xs text-sky-900">
                Linked to <strong className="font-semibold">{linkedOrderLabel}</strong>. Received quantities settle against it.
              </span>
              {!disabled ? (
                <Button variant="ghost" size="xs" icon={X} onClick={onUnlinkOrder}>
                  Unlink
                </Button>
              ) : null}
            </div>
          </div>
        ) : null}
      </div>

      <div className="px-4 pb-3">
        <div className="mb-1 flex items-center justify-between">
          <label htmlFor={narrationId} className="text-[11px] font-semibold uppercase tracking-wide text-gray-500">
            Narration
          </label>
          <span className={cx('text-[11px] tabular-nums', narration.length > NARRATION_MAX ? 'text-red-600' : 'text-gray-400')}>
            {narration.length}/{NARRATION_MAX}
          </span>
        </div>
        <div className="relative">
          <MessageSquare className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-gray-400" aria-hidden />
          <Textarea
            id={narrationId}
            rows={2}
            maxLength={NARRATION_MAX}
            className="pl-8"
            value={narration}
            disabled={disabled}
            placeholder="Enter any additional notes, terms or remarks…"
            onChange={(e) => onPatch({ narration: e.target.value })}
          />
        </div>
      </div>

      <fieldset className="flex flex-wrap items-center gap-1.5 px-4 pb-4">
        <legend className="sr-only">Workflow tags</legend>
        {GRN_TAGS.map((tag) => {
          const on = tags.includes(tag)
          return (
            <button
              key={tag}
              type="button"
              aria-pressed={on}
              disabled={disabled}
              onClick={() => onPatch({ metadata: { ...header.metadata, tags: toggleTag(tags, tag) } })}
              className={cx(
                AIC,
                'rounded-full border px-2.5 py-1 text-[11px] font-medium transition-colors disabled:opacity-60',
                on
                  ? 'border-primary/30 bg-primary-light text-primary'
                  : 'border-gray-200 bg-gray-50 text-gray-600 hover:border-gray-300 hover:bg-gray-100',
              )}
            >
              {tag}
            </button>
          )
        })}
        {tags.filter((t) => !GRN_TAGS.includes(t as (typeof GRN_TAGS)[number])).map((tag) => (
          <Badge key={tag} tone="neutral" size="xs">
            {tag}
          </Badge>
        ))}
      </fieldset>
    </GrnCard>
  )
}

export default GrnDetailsCard
