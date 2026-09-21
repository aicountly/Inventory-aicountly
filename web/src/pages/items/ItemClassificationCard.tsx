import { Tags } from 'lucide-react'
import { Link } from 'react-router-dom'
import { Plus } from 'lucide-react'
import type { ItemFormOptions } from '../../services/items'
import { FormGrid } from '../../ui/shell/FormSectionCard'
import { ItemSectionCard } from './ItemSectionCard'
import type { ItemCardBaseProps } from './ItemSectionCard'
import { SelectField } from './ItemWorkspaceKit'

/**
 * Where this item files in the reports.
 *
 * Every list comes from `GET /v1/items/form-options` — the same call the old form made, cached per
 * company by `useFormOptions`. Nothing is hardcoded, so a group created in Masters this morning is
 * in this dropdown this afternoon.
 *
 * The "create a new one" affordances are links to the master screens rather than inline dialogs:
 * those screens already enforce their own permission and their own validation, and a second
 * creation path for the same master is a second set of rules to keep in step.
 */
export interface ItemClassificationCardProps extends ItemCardBaseProps {
  options: ItemFormOptions | null
  /** Master screens this user may open — `null` entries are simply not offered. */
  masterLinks: { groups: string | null; categories: string | null; brands: string | null }
}

function CreateLink({ to, label }: { to: string | null; label: string }) {
  if (!to) return null
  return (
    <Link
      to={to}
      className="inline-flex items-center gap-0.5 text-[11px] font-semibold text-primary no-underline hover:underline"
    >
      <Plus className="h-3 w-3" aria-hidden />
      {label}
    </Link>
  )
}

export function ItemClassificationCard({
  form,
  set,
  err,
  readOnly,
  registerSection,
  options,
  masterLinks,
}: ItemClassificationCardProps) {
  return (
    <ItemSectionCard
      id="classification"
      title="Classification"
      description="Organize your item for better reporting and search"
      icon={Tags}
      register={registerSection}
    >
      <FormGrid cols={3} gap="md">
        <SelectField
          name="item_grp_id"
          label="Item group"
          value={form.item_grp_id}
          disabled={readOnly}
          error={err('item_grp_id')}
          options={(options?.item_groups ?? []).map((g) => ({ value: g.item_grp_id, label: g.grp_name }))}
          onChange={(v) => set('item_grp_id', v)}
          hint={<CreateLink to={masterLinks.groups} label="New item group" />}
        />
        <SelectField
          name="stock_cat_id"
          label="Stock category"
          value={form.stock_cat_id}
          disabled={readOnly}
          error={err('stock_cat_id')}
          options={(options?.stock_categories ?? []).map((c) => ({ value: c.stock_cat_id, label: c.cat_name }))}
          onChange={(v) => set('stock_cat_id', v)}
          hint={<CreateLink to={masterLinks.categories} label="New stock category" />}
        />
        <SelectField
          name="brand_id"
          label="Brand"
          value={form.brand_id}
          disabled={readOnly}
          error={err('brand_id')}
          options={(options?.brands ?? []).map((b) => ({ value: b.brand_id, label: b.brand_name }))}
          onChange={(v) => set('brand_id', v)}
          hint={<CreateLink to={masterLinks.brands} label="New brand" />}
        />
      </FormGrid>
    </ItemSectionCard>
  )
}

export default ItemClassificationCard
