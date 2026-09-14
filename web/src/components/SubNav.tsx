import { useAccess } from '../access/AccessContext'
import type { PermissionKey } from '../access/AccessContext'
import { RouteTabBar } from '../ui/shell/PageTabBar'

export interface SubNavItem {
  to: string
  label: string
  /** Match only the exact path (index entries). */
  end?: boolean
  /** Hidden once permissions are known and the user lacks the key(s). */
  permission?: PermissionKey
}

/** Horizontal sub-navigation inside a module, filtered by permission. */
export function SubNav({ items, label }: { items: readonly SubNavItem[]; label: string }) {
  const { can, loading } = useAccess()
  const visible = loading ? items : items.filter((i) => !i.permission || can(i.permission))
  return (
    <RouteTabBar
      tabs={visible.map((i) => ({ label: i.label, to: i.to, end: i.end }))}
      aria-label={label}
    />
  )
}
