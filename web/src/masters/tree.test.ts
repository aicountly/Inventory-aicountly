import { describe, expect, it } from 'vitest'
import { allTreeIds, buildTree, descendantIds, flattenTree } from './tree'

interface Row {
  id: number
  parent: number | null
  name: string
}

const opts = { idKey: 'id' as const, parentKey: 'parent', labelOf: (r: Row) => r.name }

const rows: Row[] = [
  { id: 1, parent: null, name: 'Raw materials' },
  { id: 2, parent: 1, name: 'Steel' },
  { id: 3, parent: 1, name: 'Aluminium' },
  { id: 4, parent: 2, name: 'Sheets' },
  { id: 5, parent: null, name: 'Finished goods' },
]

describe('buildTree', () => {
  it('nests children under parents and sorts siblings by label', () => {
    const roots = buildTree(rows, opts)
    expect(roots.map((r) => r.row.name)).toEqual(['Finished goods', 'Raw materials'])
    const raw = roots[1]
    expect(raw.children.map((c) => c.row.name)).toEqual(['Aluminium', 'Steel'])
    expect(raw.children[1].children[0]).toMatchObject({ id: 4, depth: 2 })
  })

  it('promotes rows whose parent is missing to roots', () => {
    const roots = buildTree([{ id: 9, parent: 42, name: 'Orphan' }], opts)
    expect(roots).toHaveLength(1)
    expect(roots[0]).toMatchObject({ id: 9, depth: 0 })
  })

  it('breaks cycles instead of looping forever', () => {
    const roots = buildTree(
      [
        { id: 1, parent: 2, name: 'A' },
        { id: 2, parent: 1, name: 'B' },
      ],
      opts,
    )
    expect(allTreeIds(roots).sort()).toEqual([1, 2])
  })
})

describe('flattenTree', () => {
  it('shows only expanded branches', () => {
    const roots = buildTree(rows, opts)
    const collapsed = flattenTree(roots, new Set())
    expect(collapsed.map((n) => n.id)).toEqual([5, 1])
    expect(collapsed[1]).toMatchObject({ hasChildren: true, expanded: false })
    const open = flattenTree(roots, new Set([1, 2]))
    expect(open.map((n) => n.id)).toEqual([5, 1, 3, 2, 4])
  })
})

describe('descendantIds', () => {
  it('returns the node and everything below it', () => {
    const roots = buildTree(rows, opts)
    expect([...descendantIds(roots, 1)].sort()).toEqual([1, 2, 3, 4])
    expect([...descendantIds(roots, 4)]).toEqual([4])
    expect(descendantIds(roots, 99).size).toBe(0)
  })
})
