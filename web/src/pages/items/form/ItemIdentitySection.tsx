import { useState } from 'react'
import { AlertTriangle, ExternalLink, Package, RefreshCw, ScanLine, Sparkles } from 'lucide-react'
import { Link } from 'react-router-dom'
import { Badge } from '../../../ui/Badge'
import { Input } from '../../../ui/Input'
import { Select } from '../../../ui/Select'
import { Switch } from '../../../ui/Switch'
import { AIC, cx } from '../../../ui/cx'
import { ITEM_TYPES } from '../../../services/items'
import { humanize } from '../../../utils/format'
import type { ItemFormState } from '../itemForm'
import { BarcodeScanDialog, barcodeScanSupported } from './BarcodeScanDialog'
import { Field, FieldIconButton, InlineAction, SectionCard, fieldDescribedBy } from './FormControls'
import type { DuplicateMatch } from './itemIntelligence'

export interface ItemIdentitySectionProps {
  form: ItemFormState
  set: <K extends keyof ItemFormState>(key: K, value: ItemFormState[K]) => void
  err: (key: string) => string | undefined
  readOnly: boolean
  highlighted: ReadonlySet<string>
  onAssist: () => void
  onGenerateSku: () => void
  /** The HSN a similar item in this company already carries, if any. */
  hsnFromSimilar: string | null
  duplicates: DuplicateMatch[]
  duplicatesAcknowledged: boolean
  onAcknowledgeDuplicates: () => void
  currencyCode: string | null
}

const DUPLICATE_LABEL: Record<DuplicateMatch['reason'], string> = {
  name: 'Same name',
  sku: 'Same SKU',
  barcode: 'Same barcode',
  similar: 'Similar name',
}

export function ItemIdentitySection({
  form,
  set,
  err,
  readOnly,
  highlighted,
  onAssist,
  onGenerateSku,
  hsnFromSimilar,
  duplicates,
  duplicatesAcknowledged,
  onAcknowledgeDuplicates,
  currencyCode,
}: ItemIdentitySectionProps) {
  const [scanOpen, setScanOpen] = useState(false)
  const canScan = barcodeScanSupported()

  return (
    <SectionCard
      id="item-identity"
      icon={Package}
      title="Identity"
      description="What uniquely identifies this item wherever it is used."
      action={
        !readOnly ? (
          <InlineAction onClick={onAssist} icon={Sparkles} disabled={form.item_name.trim() === ''} title="Review suggestions for this item">
            Suggest
          </InlineAction>
        ) : null
      }
    >
      <div className="grid grid-cols-12 gap-3">
        <Field
          id="item_name"
          label="Item name"
          required
          error={err('item_name')}
          hint="Used everywhere this item is picked, searched or printed."
          highlighted={highlighted.has('item_name')}
          className="col-span-12 lg:col-span-6"
        >
          <Input
            id="item_name"
            size="md"
            value={form.item_name}
            maxLength={255}
            disabled={readOnly}
            invalid={!!err('item_name')}
            placeholder="e.g. Paracetamol 500 mg tablet"
            aria-describedby={fieldDescribedBy('item_name', true)}
            onChange={(e) => set('item_name', e.target.value)}
          />
        </Field>

        <Field
          id="item_alias"
          label="Alias"
          error={err('item_alias')}
          hint="A short name people search by."
          highlighted={highlighted.has('item_alias')}
          className="col-span-12 sm:col-span-6 lg:col-span-3"
        >
          <Input
            id="item_alias"
            size="md"
            value={form.item_alias}
            maxLength={255}
            disabled={readOnly}
            aria-describedby={fieldDescribedBy('item_alias', true)}
            onChange={(e) => set('item_alias', e.target.value)}
          />
        </Field>

        <Field
          id="print_name"
          label="Print name"
          error={err('print_name')}
          hint="Defaults to the item name."
          highlighted={highlighted.has('print_name')}
          className="col-span-12 sm:col-span-6 lg:col-span-3"
        >
          <Input
            id="print_name"
            size="md"
            value={form.print_name}
            maxLength={255}
            disabled={readOnly}
            placeholder={form.item_name || undefined}
            aria-describedby={fieldDescribedBy('print_name', true)}
            onChange={(e) => set('print_name', e.target.value)}
          />
        </Field>

        <Field id="item_type" label="Type" required error={err('item_type')} hint="Only stock items hold quantities." className="col-span-12 sm:col-span-6 lg:col-span-3">
          <Select
            id="item_type"
            size="md"
            value={form.item_type}
            disabled={readOnly}
            invalid={!!err('item_type')}
            aria-describedby={fieldDescribedBy('item_type', true)}
            onChange={(e) => set('item_type', e.target.value)}
          >
            {ITEM_TYPES.map((t) => (
              <option key={t} value={t}>
                {humanize(t)}
              </option>
            ))}
          </Select>
        </Field>

        <Field
          id="item_sku"
          label="SKU"
          error={err('item_sku')}
          hint="Unique within the company."
          highlighted={highlighted.has('item_sku')}
          className="col-span-12 sm:col-span-6 lg:col-span-3"
        >
          <div className="flex items-stretch gap-1.5">
            <Input
              id="item_sku"
              size="md"
              className="min-w-0 flex-1"
              value={form.item_sku}
              maxLength={64}
              disabled={readOnly}
              invalid={!!err('item_sku')}
              aria-describedby={fieldDescribedBy('item_sku', true)}
              onChange={(e) => set('item_sku', e.target.value)}
            />
            {!readOnly ? <FieldIconButton icon={RefreshCw} label="Generate a SKU" onClick={onGenerateSku} /> : null}
          </div>
        </Field>

        <Field
          id="item_upc"
          label="Barcode / EAN / UPC"
          error={err('item_upc')}
          hint={canScan ? 'Type, scan with a USB scanner, or use the camera.' : 'Type it or scan it with a USB scanner.'}
          highlighted={highlighted.has('item_upc')}
          className="col-span-12 sm:col-span-6 lg:col-span-3"
        >
          <div className="flex items-stretch gap-1.5">
            <Input
              id="item_upc"
              size="md"
              className="min-w-0 flex-1"
              value={form.item_upc}
              maxLength={64}
              disabled={readOnly}
              aria-describedby={fieldDescribedBy('item_upc', true)}
              onChange={(e) => set('item_upc', e.target.value)}
            />
            {!readOnly && canScan ? <FieldIconButton icon={ScanLine} label="Scan a barcode with the camera" onClick={() => setScanOpen(true)} /> : null}
          </div>
        </Field>

        <Field
          id="hsn_sac"
          label="HSN / SAC"
          error={err('hsn_sac')}
          hint="4 to 8 letters or digits."
          highlighted={highlighted.has('hsn_sac')}
          className="col-span-12 sm:col-span-6 lg:col-span-3"
          action={
            !readOnly && hsnFromSimilar && form.hsn_sac.trim() === '' ? (
              <InlineAction onClick={() => set('hsn_sac', hsnFromSimilar)} icon={Sparkles} title={`Use ${hsnFromSimilar}, from a similar item in this company`}>
                {hsnFromSimilar}
              </InlineAction>
            ) : null
          }
        >
          <Input
            id="hsn_sac"
            size="md"
            value={form.hsn_sac}
            maxLength={8}
            disabled={readOnly}
            invalid={!!err('hsn_sac')}
            aria-describedby={fieldDescribedBy('hsn_sac', true)}
            onChange={(e) => set('hsn_sac', e.target.value)}
          />
        </Field>

        <Field
          id="mrp"
          label={currencyCode ? `MRP (${currencyCode})` : 'MRP'}
          error={err('mrp')}
          hint="Per base unit."
          highlighted={highlighted.has('mrp')}
          className="col-span-12 sm:col-span-6 lg:col-span-3"
        >
          <Input
            id="mrp"
            size="md"
            type="number"
            min={0}
            step="any"
            inputMode="decimal"
            className="text-right tabular-nums"
            value={form.mrp}
            disabled={readOnly}
            invalid={!!err('mrp')}
            aria-describedby={fieldDescribedBy('mrp', true)}
            onChange={(e) => set('mrp', e.target.value)}
          />
        </Field>

        <div className="col-span-12 sm:col-span-6 lg:col-span-3">
          <div className={cx(AIC, 'flex h-full items-center gap-3 rounded-xl border border-gray-200 bg-gray-50 px-3 py-2.5')}>
            <Switch
              checked={form.is_active}
              onChange={(v) => set('is_active', v)}
              disabled={readOnly}
              id="is_active"
              aria-describedby="is_active-desc"
            />
            <div className="min-w-0">
              <label htmlFor="is_active" className={cx('block text-[0.8125rem] font-semibold text-gray-900', readOnly ? 'cursor-not-allowed' : 'cursor-pointer')}>
                Active item
              </label>
              <p id="is_active-desc" className="mt-0.5 text-[11px] leading-relaxed text-gray-500">
                Available for transactions.
              </p>
            </div>
          </div>
        </div>
      </div>

      {duplicates.length > 0 && !duplicatesAcknowledged ? (
        <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50/60 p-3">
          <div className="flex items-start gap-2.5">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" aria-hidden />
            <div className="min-w-0 flex-1">
              <strong className="text-[0.8125rem] font-semibold text-amber-800">
                {duplicates.length === 1 ? 'A possible duplicate' : `${duplicates.length} possible duplicates`}
              </strong>
              <p className="mt-0.5 text-[11px] leading-relaxed text-amber-700">
                Nothing is blocked here — the API refuses a repeated name or SKU when you save, and reports which one.
              </p>
              <ul className={cx(AIC, 'mt-2 flex list-none flex-col gap-1.5 p-0')}>
                {duplicates.map((match) => (
                  <li key={`${match.reason}-${match.item.item_id}`} className="flex flex-wrap items-center gap-2 rounded-lg border border-amber-200 bg-white px-2.5 py-1.5">
                    <Badge tone={match.severity === 'conflict' ? 'danger' : 'warning'}>{DUPLICATE_LABEL[match.reason]}</Badge>
                    <span className="min-w-0 flex-1 truncate text-xs font-semibold text-gray-900">{match.item.item_name}</span>
                    {match.item.item_sku ? <span className="truncate text-[11px] text-gray-500">{match.item.item_sku}</span> : null}
                    <Link
                      to={`/items/${match.item.item_id}`}
                      className="inline-flex items-center gap-1 text-[11px] font-semibold text-primary no-underline hover:underline"
                    >
                      Open
                      <ExternalLink className="h-3 w-3" aria-hidden />
                    </Link>
                  </li>
                ))}
              </ul>
              <button
                type="button"
                onClick={onAcknowledgeDuplicates}
                className="mt-2 rounded-md text-[11px] font-semibold text-amber-800 underline underline-offset-2 focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-300"
              >
                Continue anyway
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {canScan ? <BarcodeScanDialog open={scanOpen} onClose={() => setScanOpen(false)} onDetected={(value) => set('item_upc', value)} /> : null}
    </SectionCard>
  )
}

export default ItemIdentitySection
