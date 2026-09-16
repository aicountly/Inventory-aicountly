import { useMemo } from 'react'
import { MoreVertical } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import type { LucideIcon } from 'lucide-react'
import type { PermissionKey } from '../access/AccessContext'
import { MenuButton } from '../ui/MenuButton'

export interface RegisterRowAction {
  key: string
  label: string
  /** Where it goes. Omit and `onSelect` runs instead. */
  to?: string
  onSelect?: () => void
  icon?: LucideIcon
  /** Hidden unless the signed-in member holds this. */
  permission?: PermissionKey
  /** Why it cannot be used on this row, or null when it can. */
  disabledReason?: string | null
}

/**
 * The row's own actions, behind a kebab at the right edge.
 *
 * Every register already opens a row on click and on Enter, but nothing on
 * screen said so — a reader with a mouse had no way to discover that a stock
 * balance leads to that item's ledger. This is that affordance, and only that:
 * the register declares actions it already supports, the engine hides any the
 * member has no permission for, and nothing here invents a new one.
 *
 * The menu itself is `ui/MenuButton`, which already portals out of the table's
 * scroll box and owns the arrow / Home / End / Escape behaviour `role="menu"`
 * promises. This is the adapter: it turns a register's declarative action —
 * which may be a route rather than a callback — into what that component takes.
 */
export function RegisterRowMenu({
  actions,
  label = 'Row actions',
}: {
  actions: readonly RegisterRowAction[]
  label?: string
}) {
  const navigate = useNavigate()

  const items = useMemo(
    () =>
      actions.map((action) => ({
        key: action.key,
        label: action.label,
        icon: action.icon,
        disabled: Boolean(action.disabledReason),
        onSelect: () => {
          if (action.to) navigate(action.to)
          else action.onSelect?.()
        },
      })),
    [actions, navigate],
  )

  if (!items.length) return null

  return (
    // The row reacts to clicks, and the kebab must not take the reader with it.
    // Stopped on a wrapper rather than through `buttonProps`: MenuButton
    // spreads that bag AFTER its own onClick, so an onClick passed there
    // replaces the toggle and the menu never opens.
    <span
      className="inline-flex"
      onClick={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
    >
      <MenuButton
        actions={items}
        label={label}
        icon={MoreVertical}
        variant="ghost"
        size="xs"
        buttonProps={{ title: label }}
      />
    </span>
  )
}

export default RegisterRowMenu
