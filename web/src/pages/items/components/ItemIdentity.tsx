import { cx } from '../../../ui/cx'
import type { ItemListRow } from '../../../services/items'
import { itemInitials, itemSubtitle } from '../itemsModel'

export interface ItemAvatarProps {
  item: ItemListRow
  size?: 'sm' | 'md' | 'lg'
  className?: string
}

const SIZE: Record<NonNullable<ItemAvatarProps['size']>, string> = {
  sm: 'w-8 h-8 rounded-lg text-[10px]',
  md: 'w-9 h-9 rounded-lg text-[11px]',
  lg: 'w-12 h-12 rounded-xl text-sm',
}

/**
 * The item's tile: its picture, or its initials.
 *
 * Initials rather than a generic box because they are DETERMINISTIC — the same
 * item wears the same two letters everywhere, so the eye can use the tile as a
 * landmark running down a column of near-identical names. A broken-image icon
 * is never shown: the item master holds no image column today, so the initials
 * are the design, not a placeholder waiting for one.
 */
export function ItemAvatar({ item, size = 'md', className }: ItemAvatarProps) {
  return (
    <span
      aria-hidden
      className={cx(
        'inline-flex shrink-0 items-center justify-center bg-primary-light font-bold uppercase text-primary',
        SIZE[size],
        className,
      )}
    >
      {itemInitials(item.item_name)}
    </span>
  )
}

export interface ItemIdentityProps {
  item: ItemListRow
  /** Renders the name as a button that opens the inspector. */
  onOpen?: () => void
  size?: ItemAvatarProps['size']
}

/** Tile + name + "alias · category", the cell the Item column renders. */
export function ItemIdentity({ item, onOpen, size = 'md' }: ItemIdentityProps) {
  const subtitle = itemSubtitle(item)
  const body = (
    <>
      <ItemAvatar item={item} size={size} />
      <span className="min-w-0">
        <span className="block truncate text-[13px] font-semibold text-gray-900">{item.item_name}</span>
        {subtitle ? <span className="mt-0.5 block truncate text-[11px] text-gray-500">{subtitle}</span> : null}
      </span>
    </>
  )

  if (!onOpen) {
    return <span className="flex min-w-0 items-center gap-2.5">{body}</span>
  }

  return (
    <button
      type="button"
      onClick={(e) => {
        // The row itself opens the drawer too. Without this the click runs
        // twice and the second one re-opens what the first just toggled.
        e.stopPropagation()
        onOpen()
      }}
      className="flex min-w-0 items-center gap-2.5 rounded-lg text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
      aria-label={`Open ${item.item_name}`}
    >
      {body}
    </button>
  )
}
