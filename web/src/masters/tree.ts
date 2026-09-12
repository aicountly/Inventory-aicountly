/** Pure helpers for self-referencing masters (item groups, warehouse groups…). */

export interface TreeNode<T> {
  row: T
  id: number
  parentId: number | null
  depth: number
  children: TreeNode<T>[]
}

export interface TreeOptions<T> {
  idKey: keyof T & string
  parentKey: string
  /** Sort siblings by this label. */
  labelOf: (row: T) => string
}

function toId(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null
  const n = Number(v)
  return Number.isFinite(n) && n > 0 ? n : null
}

/**
 * Build a forest from flat rows. Rows whose parent is missing from the input
 * (filtered out, deleted) become roots so nothing silently disappears; cycles
 * are broken at the first repeated id.
 */
export function buildTree<T>(rows: T[], opts: TreeOptions<T>): TreeNode<T>[] {
  const byId = new Map<number, TreeNode<T>>()
  for (const row of rows) {
    const id = toId((row as Record<string, unknown>)[opts.idKey])
    if (id === null || byId.has(id)) continue
    byId.set(id, { row, id, parentId: toId((row as Record<string, unknown>)[opts.parentKey]), depth: 0, children: [] })
  }
  const roots: TreeNode<T>[] = []
  for (const node of byId.values()) {
    const parent = node.parentId !== null && node.parentId !== node.id ? byId.get(node.parentId) : undefined
    if (parent) parent.children.push(node)
    else roots.push(node)
  }
  const sortSiblings = (list: TreeNode<T>[]) => list.sort((a, b) => opts.labelOf(a.row).localeCompare(opts.labelOf(b.row), undefined, { sensitivity: 'base' }))
  const visit = (list: TreeNode<T>[], depth: number, seen: Set<number>) => {
    sortSiblings(list)
    for (const node of list) {
      if (seen.has(node.id)) {
        node.children = []
        continue
      }
      seen.add(node.id)
      node.depth = depth
      visit(node.children, depth + 1, seen)
    }
  }
  visit(roots, 0, new Set())
  // A cycle with no root (a→b→a) never reaches `roots`; surface its members as roots too.
  const reached = new Set<number>()
  const collect = (list: TreeNode<T>[]) => {
    for (const n of list) {
      reached.add(n.id)
      collect(n.children)
    }
  }
  collect(roots)
  for (const node of byId.values()) {
    if (!reached.has(node.id)) {
      node.depth = 0
      node.children = []
      roots.push(node)
      reached.add(node.id)
    }
  }
  sortSiblings(roots)
  return roots
}

export interface VisibleNode<T> extends TreeNode<T> {
  hasChildren: boolean
  expanded: boolean
}

/** Depth-first rows to render, honouring which ids are expanded. */
export function flattenTree<T>(roots: TreeNode<T>[], expanded: ReadonlySet<number>): VisibleNode<T>[] {
  const out: VisibleNode<T>[] = []
  const walk = (list: TreeNode<T>[]) => {
    for (const node of list) {
      const isOpen = expanded.has(node.id)
      out.push({ ...node, hasChildren: node.children.length > 0, expanded: isOpen })
      if (isOpen) walk(node.children)
    }
  }
  walk(roots)
  return out
}

/** Every id in the forest — used for "expand all". */
export function allTreeIds<T>(roots: TreeNode<T>[]): number[] {
  const out: number[] = []
  const walk = (list: TreeNode<T>[]) => {
    for (const n of list) {
      out.push(n.id)
      walk(n.children)
    }
  }
  walk(roots)
  return out
}

/** Ids of `id` and everything below it — the rows that cannot become its parent. */
export function descendantIds<T>(roots: TreeNode<T>[], id: number): Set<number> {
  const out = new Set<number>()
  const find = (list: TreeNode<T>[]): TreeNode<T> | null => {
    for (const n of list) {
      if (n.id === id) return n
      const hit = find(n.children)
      if (hit) return hit
    }
    return null
  }
  const node = find(roots)
  if (!node) return out
  const walk = (n: TreeNode<T>) => {
    out.add(n.id)
    n.children.forEach(walk)
  }
  walk(node)
  return out
}
