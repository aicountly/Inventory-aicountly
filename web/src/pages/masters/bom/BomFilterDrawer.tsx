import { useEffect, useState } from 'react'
import type { ItemFormOptions } from '../../../services/items'
import { ItemPicker } from '../../../components/ItemPicker'
import type { PickedItem } from '../../../components/ItemPicker'
import { Button } from '../../../ui/Button'
import { Drawer } from '../../../ui/Drawer'
import { Input } from '../../../ui/Input'
import { Select } from '../../../ui/Select'
import { activeFilterCount, clearedFilters } from './bomFilters'
import type { BomFilters } from './bomFilters'

/**
 * Everything the toolbar does not have room for.
 *
 * The drawer edits a LOCAL copy and writes it back in one navigation on Apply.
 * Two reasons: `useListParams` reads the query string from the render closure,
 * so setting six filters one at a time would have each call start from the
 * pre-update URL and silently drop the previous five; and a reader building a
 * compound filter should not watch the table re-query after every field.
 *
 * Cancel and Escape discard. The applied state always comes back from the URL,
 * never from what is typed here.
 */

export interface BomFilterDrawerProps {
  open: boolean
  onClose: () => void
  filters: BomFilters
  onApply: (patch: Record<string, string>) => void
  options: ItemFormOptions | null
}

function Field({ label, htmlFor, hint, children }: { label: string; htmlFor?: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={htmlFor} className="text-[11px] font-semibold text-gray-700">
        {label}
      </label>
      {children}
      {hint ? <p className="text-[10.5px] leading-relaxed text-gray-400">{hint}</p> : null}
    </div>
  )
}

export function BomFilterDrawer({ open, onClose, filters, onApply, options }: BomFilterDrawerProps) {
  const [draft, setDraft] = useState<BomFilters>(filters)
  const [component, setComponent] = useState<PickedItem | null>(null)
  const [finished, setFinished] = useState<PickedItem | null>(null)

  // Re-seeded on open, so a drawer closed with Cancel does not remember the
  // edits it discarded the next time it is opened.
  useEffect(() => {
    if (open) setDraft(filters)
  }, [open, filters])

  const set = (key: keyof BomFilters, value: string) => setDraft((d) => ({ ...d, [key]: value }))

  const apply = () => {
    onApply({
      ...clearedFilters(),
      ...Object.fromEntries(Object.entries(draft).map(([k, v]) => [k, v ?? ''])),
      finished_item_id: finished ? String(finished.item_id) : (draft.finished_item_id ?? ''),
      component_item_id: component ? String(component.item_id) : (draft.component_item_id ?? ''),
    })
    onClose()
  }

  const reset = () => {
    setDraft({})
    setComponent(null)
    setFinished(null)
  }

  const count = activeFilterCount(draft)

  return (
    <Drawer
      open={open}
      onClose={onClose}
      title="Filter bills of materials"
      description="Narrow the list. Everything you set here travels in the page address, so the view can be shared."
      width="md"
      footer={
        <div className="flex items-center justify-between gap-2">
          <Button variant="ghost" onClick={reset} disabled={count === 0}>
            Reset
          </Button>
          <div className="flex items-center gap-2">
            <Button variant="secondary" onClick={onClose}>
              Cancel
            </Button>
            <Button onClick={apply}>Apply filters</Button>
          </div>
        </div>
      }
    >
      <div className="space-y-5">
        <section className="space-y-3">
          <h3 className="text-[11px] font-bold uppercase tracking-wide text-gray-400">Bill</h3>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Status" htmlFor="bom-filter-status">
              <Select
                id="bom-filter-status"
                size="md"
                value={draft.status ?? ''}
                onChange={(e) => set('status', e.target.value)}
              >
                <option value="">All status</option>
                <option value="active">Active</option>
                <option value="inactive">Inactive</option>
              </Select>
            </Field>
            <Field label="Item group" htmlFor="bom-filter-group">
              <Select
                id="bom-filter-group"
                size="md"
                value={draft.item_grp_id ?? ''}
                onChange={(e) => set('item_grp_id', e.target.value)}
              >
                <option value="">All item groups</option>
                {(options?.item_groups ?? []).map((g) => (
                  <option key={g.item_grp_id} value={g.item_grp_id}>
                    {g.grp_name}
                  </option>
                ))}
              </Select>
            </Field>
          </div>
          <Field label="Finished item" hint="Only bills that produce this item.">
            <ItemPicker value={finished} onChange={setFinished} placeholder="Search the finished item…" />
          </Field>
          <Field label="Contains component" hint="Only bills that consume this item — the 'where used' question.">
            <ItemPicker value={component} onChange={setComponent} placeholder="Search a component item…" />
          </Field>
        </section>

        <section className="space-y-3 border-t border-gray-100 pt-4">
          <h3 className="text-[11px] font-bold uppercase tracking-wide text-gray-400">Structure</h3>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Minimum components" htmlFor="bom-filter-min">
              <Input
                id="bom-filter-min"
                size="md"
                type="number"
                min={0}
                step={1}
                value={draft.min_components ?? ''}
                onChange={(e) => set('min_components', e.target.value)}
              />
            </Field>
            <Field label="Maximum components" htmlFor="bom-filter-max">
              <Input
                id="bom-filter-max"
                size="md"
                type="number"
                min={0}
                step={1}
                value={draft.max_components ?? ''}
                onChange={(e) => set('max_components', e.target.value)}
              />
            </Field>
          </div>
          <div className="space-y-2">
            <label className="flex items-center gap-2 text-[12px] text-gray-700">
              <input
                type="checkbox"
                className="h-3.5 w-3.5 accent-[rgb(var(--color-primary))]"
                checked={draft.has_scrap === '1'}
                onChange={(e) => set('has_scrap', e.target.checked ? '1' : '')}
              />
              Only bills with wastage on a component
            </label>
            <label className="flex items-center gap-2 text-[12px] text-gray-700">
              <input
                type="checkbox"
                className="h-3.5 w-3.5 accent-[rgb(var(--color-primary))]"
                checked={draft.has_by_products === '1'}
                onChange={(e) => set('has_by_products', e.target.checked ? '1' : '')}
              />
              Only bills that produce a by-product
            </label>
          </div>
        </section>

        <section className="space-y-3 border-t border-gray-100 pt-4">
          <h3 className="text-[11px] font-bold uppercase tracking-wide text-gray-400">History</h3>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Created from" htmlFor="bom-filter-cfrom">
              <Input id="bom-filter-cfrom" size="md" type="date" value={draft.created_from ?? ''} onChange={(e) => set('created_from', e.target.value)} />
            </Field>
            <Field label="Created to" htmlFor="bom-filter-cto">
              <Input id="bom-filter-cto" size="md" type="date" value={draft.created_to ?? ''} onChange={(e) => set('created_to', e.target.value)} />
            </Field>
            <Field label="Updated from" htmlFor="bom-filter-ufrom">
              <Input id="bom-filter-ufrom" size="md" type="date" value={draft.updated_from ?? ''} onChange={(e) => set('updated_from', e.target.value)} />
            </Field>
            <Field label="Updated to" htmlFor="bom-filter-uto">
              <Input id="bom-filter-uto" size="md" type="date" value={draft.updated_to ?? ''} onChange={(e) => set('updated_to', e.target.value)} />
            </Field>
          </div>
        </section>
      </div>
    </Drawer>
  )
}

export default BomFilterDrawer
