import type { NavLeaf, SidebarNavItem } from '../config/navRegistry'

/**
 * Which ONE sidebar section owns the current URL.
 *
 * NavLink decides this per link, and on a nested route more than one link can
 * answer yes: on `/registers/stock-balances`, "Registers" matches by prefix and
 * "Stock" matches exactly, so the rail lit both and the reader could not tell
 * which section they were actually in. Two highlighted sections is not a
 * stronger signal than one, it is no signal.
 *
 * So the rail asks this once, for the whole list, and styles exactly the winner.
 *
 * The rule: the section whose OWN destination matches the URL most specifically
 * wins. Mega-menu contents only break a tie — several sections may list the same
 * register in their flyout (Registers lists all of them), but only one section
 * has it as the place its own label goes.
 */

/** Length of the matched prefix, or -1 when this path does not match at all. */
function matchScore(pathname: string, path: string | undefined, end: boolean | undefined): number {
  if (!path) return -1
  const [clean] = path.split('?')
  if (pathname === clean) return clean.length
  if (!end && pathname.startsWith(`${clean}/`)) return clean.length
  return -1
}

function bestLeafScore(pathname: string, item: SidebarNavItem): number {
  let best = -1
  for (const column of item.megaMenu ?? []) {
    for (const leaf of column.items as readonly NavLeaf[]) {
      const score = matchScore(pathname, leaf.path, leaf.end)
      if (score > best) best = score
    }
  }
  return best
}

export function activeNavKey(
  pathname: string,
  items: readonly SidebarNavItem[],
): string | null {
  let key: string | null = null
  let bestOwn = -1
  let bestLeaf = -1

  for (const item of items) {
    const own = matchScore(pathname, item.path, item.end)
    const leaf = bestLeafScore(pathname, item)
    if (own < 0 && leaf < 0) continue
    if (own > bestOwn || (own === bestOwn && leaf > bestLeaf)) {
      key = item.key
      bestOwn = own
      bestLeaf = leaf
    }
  }

  return key
}

export default activeNavKey
