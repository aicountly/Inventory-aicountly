import { useEffect, useState } from 'react'
import { FilterX } from 'lucide-react'
import { ItemFilter } from '../components/ItemFilter'
import { Button } from '../ui/Button'
import { Drawer } from '../ui/Drawer'
import { Input } from '../ui/Input'
import { Select } from '../ui/Select'
import { FormGrid } from '../ui/shell/FormSectionCard'
import { Field } from './Field'
import type { Batch, Location, SerialStatus } from '../services/masters'
import type { ItemFormOptions } from '../services/items'
import { humanize } from '../utils/format'
import { SERIAL_STATUSES } from '../services/masters'

/**
 * Everything the toolbar has no room for.
 *
 * A drawer rather than a popover because there are eighteen controls and a
 * reader sets three or four of them together — a popover that closes on an
 * outside click turns that into four round trips.
 *
 * The draft is local and only written to the URL on Apply. That is not a
 * preference: `useListParams` navigates on every write, so setting six filters
 * one at a time would be six history entries and six requests, and the Back
 * button would walk the reader through each of them.
 */
export interface SerialFilterPanelProps {
  open: boolean
  onClose: () => void
  /** Current URL filters. */
  filters: Record<string, string>
  /** Writes every changed key in ONE navigation. */
  onApply: (patch: Record<string, string>) => void
  onClear: () => void
  options: ItemFormOptions | null
  batches: readonly Batch[]
  locations: readonly Location[]
  costVisible: boolean
}

const ADVANCED_KEYS = [
  'item_id',
  'batch_id',
  'item_grp_id',
  'brand_id',
  'stock_cat_id',
  'warranty_status',
  'warranty_days',
  'warranty_from',
  'warranty_to',
  'created_from',
  'created_to',
  'updated_from',
  'updated_to',
  'cost_min',
  'cost_max',
  'has_batch',
  'placed',
  'location_id',
] as const

export function SerialFilterPanel({
  open,
  onClose,
  filters,
  onApply,
  onClear,
  options,
  batches,
  locations,
  costVisible,
}: SerialFilterPanelProps) {
  const [draft, setDraft] = useState<Record<string, string>>(filters)

  // Reopening shows what is actually applied, not the abandoned draft from
  // last time — otherwise Apply would silently restore filters the reader
  // thought they had walked away from.
  useEffect(() => {
    if (open) setDraft(filters)
  }, [open, filters])

  const set = (key: string, value: string) => setDraft((d) => ({ ...d, [key]: value }))

  const apply = () => {
    const patch: Record<string, string> = {}
    for (const key of ADVANCED_KEYS) patch[key] = draft[key] ?? ''
    onApply(patch)
    onClose()
  }

  return (
    <Drawer
      open={open}
      title="More filters"
      description="Narrow the serial list. Filters are kept in the address bar, so a filtered view can be shared."
      onClose={onClose}
      width="md"
      footer={
        <div className="flex items-center justify-between gap-2">
          <Button variant="ghost" size="sm" icon={FilterX} onClick={onClear}>
            Clear all
          </Button>
          <div className="flex items-center gap-2">
            <Button variant="secondary" size="sm" onClick={onClose}>
              Cancel
            </Button>
            <Button size="sm" onClick={apply}>
              Apply filters
            </Button>
          </div>
        </div>
      }
    >
      <FormGrid>
        <Field label="Item" className="sm:col-span-2" hint="Batches can only be filtered once an item is chosen.">
          <ItemFilter value={draft.item_id ?? ''} onChange={(v) => set('item_id', v)} />
        </Field>

        <Field label="Batch">
          <Select
            value={draft.batch_id ?? ''}
            onChange={(e) => set('batch_id', e.target.value)}
            disabled={!draft.item_id || batches.length === 0}
          >
            <option value="">
              {!draft.item_id ? 'Pick an item first' : batches.length === 0 ? 'No batches for this item' : 'Any batch'}
            </option>
            {batches.map((b) => (
              <option key={b.batch_id} value={b.batch_id}>
                {b.batch_no}
              </option>
            ))}
          </Select>
        </Field>

        <Field label="Location">
          <Select
            value={draft.location_id ?? ''}
            onChange={(e) => set('location_id', e.target.value)}
            disabled={locations.length === 0}
          >
            <option value="">{locations.length === 0 ? 'Pick a warehouse first' : 'Any location'}</option>
            {locations.map((l) => (
              <option key={l.location_id} value={l.location_id}>
                {l.location_code}
                {l.location_name ? ` – ${l.location_name}` : ''}
              </option>
            ))}
          </Select>
        </Field>

        <Field label="Item group">
          <Select value={draft.item_grp_id ?? ''} onChange={(e) => set('item_grp_id', e.target.value)}>
            <option value="">Any group</option>
            {(options?.item_groups ?? []).map((g) => (
              <option key={g.item_grp_id} value={g.item_grp_id}>
                {g.grp_name}
              </option>
            ))}
          </Select>
        </Field>

        <Field label="Brand">
          <Select value={draft.brand_id ?? ''} onChange={(e) => set('brand_id', e.target.value)}>
            <option value="">Any brand</option>
            {(options?.brands ?? []).map((b) => (
              <option key={b.brand_id} value={b.brand_id}>
                {b.brand_name}
              </option>
            ))}
          </Select>
        </Field>

        <Field label="Stock category">
          <Select value={draft.stock_cat_id ?? ''} onChange={(e) => set('stock_cat_id', e.target.value)}>
            <option value="">Any category</option>
            {(options?.stock_categories ?? []).map((c) => (
              <option key={c.stock_cat_id} value={c.stock_cat_id}>
                {c.cat_name}
              </option>
            ))}
          </Select>
        </Field>

        <Field label="Status">
          <Select value={draft.status ?? ''} onChange={(e) => set('status', e.target.value)}>
            <option value="">Any status</option>
            {SERIAL_STATUSES.map((s: SerialStatus) => (
              <option key={s} value={s}>
                {humanize(s)}
              </option>
            ))}
          </Select>
        </Field>

        <Field label="Warranty">
          <Select value={draft.warranty_status ?? ''} onChange={(e) => set('warranty_status', e.target.value)}>
            <option value="">Any warranty</option>
            <option value="active">Still covered</option>
            <option value="expiring">Expiring soon</option>
            <option value="expired">Expired</option>
            <option value="none">No warranty recorded</option>
          </Select>
        </Field>

        {draft.warranty_status === 'expiring' ? (
          <Field label="Expiring within (days)" hint="The server counts from its own date, so the figure matches the card.">
            <Input
              type="number"
              min={1}
              max={3650}
              value={draft.warranty_days ?? ''}
              placeholder="30"
              onChange={(e) => set('warranty_days', e.target.value)}
            />
          </Field>
        ) : null}

        <Field label="Warranty from">
          <Input type="date" value={draft.warranty_from ?? ''} onChange={(e) => set('warranty_from', e.target.value)} />
        </Field>
        <Field label="Warranty until">
          <Input type="date" value={draft.warranty_to ?? ''} onChange={(e) => set('warranty_to', e.target.value)} />
        </Field>

        <Field label="Registered from">
          <Input type="date" value={draft.created_from ?? ''} onChange={(e) => set('created_from', e.target.value)} />
        </Field>
        <Field label="Registered to">
          <Input type="date" value={draft.created_to ?? ''} onChange={(e) => set('created_to', e.target.value)} />
        </Field>

        <Field label="Updated from">
          <Input type="date" value={draft.updated_from ?? ''} onChange={(e) => set('updated_from', e.target.value)} />
        </Field>
        <Field label="Updated to">
          <Input type="date" value={draft.updated_to ?? ''} onChange={(e) => set('updated_to', e.target.value)} />
        </Field>

        {/*
          The cost range is only offered to a reader the server lets see cost.
          Offering a filter over a column that is withheld would let the range
          be used as an oracle for the very figure it is hiding.
        */}
        {costVisible ? (
          <>
            <Field label="Unit cost from">
              <Input type="number" min={0} step="any" value={draft.cost_min ?? ''} onChange={(e) => set('cost_min', e.target.value)} />
            </Field>
            <Field label="Unit cost to">
              <Input type="number" min={0} step="any" value={draft.cost_max ?? ''} onChange={(e) => set('cost_max', e.target.value)} />
            </Field>
          </>
        ) : null}

        <Field label="Batch tracking">
          <Select value={draft.has_batch ?? ''} onChange={(e) => set('has_batch', e.target.value)}>
            <option value="">Any</option>
            <option value="1">Has a batch</option>
            <option value="0">No batch</option>
          </Select>
        </Field>

        <Field label="Placement">
          <Select value={draft.placed ?? ''} onChange={(e) => set('placed', e.target.value)}>
            <option value="">Any</option>
            <option value="1">In a warehouse</option>
            <option value="0">Not placed</option>
          </Select>
        </Field>
      </FormGrid>
    </Drawer>
  )
}

export default SerialFilterPanel
