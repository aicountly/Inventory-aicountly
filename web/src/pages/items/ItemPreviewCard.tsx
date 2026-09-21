import { Image as ImageIcon, Package } from 'lucide-react'
import { Badge } from '../../ui/Badge'
import { Button } from '../../ui/Button'
import { AIC, cx } from '../../ui/cx'
import { formatQty, humanize } from '../../utils/format'
import { AsideCard } from './ItemWorkspaceKit'
import type { ItemFormState } from './itemForm'

/**
 * The item as it will be seen elsewhere — built from the draft, so it changes as the form is typed.
 *
 * The image is a placeholder, and honestly so: there is no attachment endpoint in the Inventory
 * API yet, so there is no image to show and none is faked. What stands in its place is the item's
 * own initials over the surface tint, which at least identifies the record rather than pretending
 * a photograph is on its way.
 */
export interface ItemPreviewCardProps {
  form: ItemFormState
  baseUnitSymbol: string | null
  onHand: number | null
  /** Opens the Media & Documents section, where the state of file support is explained. */
  onChangeImage: () => void
}

/** Two characters at most: `Ballpoint Pens` → `BP`, `Pen` → `PE`. */
function initialsOf(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean)
  if (words.length === 0) return '—'
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase()
  return (words[0][0] + words[1][0]).toUpperCase()
}

export function ItemPreviewCard({ form, baseUnitSymbol, onHand, onChangeImage }: ItemPreviewCardProps) {
  const name = form.item_name.trim()
  const { description, tags } = form.attributes

  return (
    <AsideCard>
      <div
        className={cx(
          AIC,
          'mb-3 flex h-36 items-center justify-center rounded-xl border border-gray-200 bg-gray-50',
        )}
      >
        <span className="flex h-20 w-20 items-center justify-center rounded-2xl bg-white text-2xl font-bold tracking-tight text-gray-400 shadow-card">
          {name ? initialsOf(name) : <Package className="h-8 w-8" aria-hidden />}
        </span>
      </div>

      <h3 className="text-base font-bold leading-snug tracking-tight text-gray-900">{name || 'Untitled item'}</h3>

      <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
        <Badge tone={form.item_type === 'stock' ? 'primary' : 'info'}>{humanize(form.item_type)} item</Badge>
        {!form.is_active ? <Badge tone="neutral">Inactive</Badge> : null}
      </div>

      <dl className="mt-3 grid grid-cols-2 gap-x-3 gap-y-2 text-[11px]">
        <div className="min-w-0">
          <dt className="text-gray-400">SKU</dt>
          <dd className="truncate font-semibold text-gray-700">{form.item_sku || '—'}</dd>
        </div>
        <div className="min-w-0">
          <dt className="text-gray-400">HSN</dt>
          <dd className="truncate font-semibold text-gray-700">{form.hsn_sac || '—'}</dd>
        </div>
        {onHand !== null ? (
          <div className="col-span-2 min-w-0">
            <dt className="text-gray-400">On hand</dt>
            <dd className="truncate font-semibold tabular-nums text-gray-700">
              {formatQty(onHand)} {baseUnitSymbol ?? ''}
            </dd>
          </div>
        ) : null}
      </dl>

      {description ? (
        <p className="mt-3 text-xs leading-relaxed text-gray-600">{description}</p>
      ) : (
        <p className="mt-3 text-xs italic leading-relaxed text-gray-400">
          No description yet — add one under Additional.
        </p>
      )}

      {tags.length > 0 ? (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {tags.map((tag) => (
            <span key={tag} className="rounded-md bg-sky-50 px-1.5 py-0.5 text-[10px] font-medium text-sky-700">
              {tag}
            </span>
          ))}
        </div>
      ) : null}

      <Button variant="secondary" size="sm" icon={ImageIcon} block className="mt-4" onClick={onChangeImage}>
        Change image
      </Button>
    </AsideCard>
  )
}

export default ItemPreviewCard
