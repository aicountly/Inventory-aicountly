import { useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { Boxes, ChevronRight, MoreHorizontal, Network, Warehouse as WarehouseIcon } from 'lucide-react'
import { Badge } from '../../ui/Badge'
import { Button } from '../../ui/Button'
import { Card } from '../../ui/Card'
import { MenuButton } from '../../ui/MenuButton'
import { cx } from '../../ui/cx'
import type { Warehouse, WarehouseGroup } from '../../services/masters'
import { buildTree } from '../tree'
import type { TreeNode } from '../tree'
import { isActive, warehouseCount } from './model'
import type { RowAction } from './rowActions'

/**
 * The hierarchy, as the data model actually has it.
 *
 * `inv_warehouse_groups.parent_grp_id` is real — a group can be the child of
 * another — so this draws that parent / child structure rather than inventing
 * one. Warehouses hang under the group that names them, which is the other half
 * of the question a reader brings to this view ("what is actually IN Retail
 * Stores?"), and they are only drawn when the profile may read warehouses.
 *
 * A group whose parent the filters removed still appears, as a root: silently
 * dropping a matching row because its parent did not match would be a search
 * that hides its own results.
 */

interface TreeRowProps {
  node: TreeNode<WarehouseGroup>
  depth: number
  expanded: ReadonlySet<number>
  onToggle: (id: number) => void
  warehousesByGroup: Map<number, Warehouse[]> | null
  showEmpty: boolean
  onOpen: (row: WarehouseGroup) => void
  actionsFor: (row: WarehouseGroup) => RowAction[]
}

function TreeRow({ node, depth, expanded, onToggle, warehousesByGroup, showEmpty, onOpen, actionsFor }: TreeRowProps) {
  const row = node.row
  const id = node.id
  const warehouses = warehousesByGroup?.get(id) ?? []
  const hasChildren = node.children.length > 0 || warehouses.length > 0
  const open = expanded.has(id)
  const count = warehouseCount(row)
  const actions = actionsFor(row)

  if (!showEmpty && count === 0 && node.children.length === 0) return null

  return (
    <li role="none">
      <div
        role="treeitem"
        aria-expanded={hasChildren ? open : undefined}
        aria-level={depth + 1}
        aria-label={`${row.grp_name}, ${count} ${count === 1 ? 'warehouse' : 'warehouses'}`}
        className="group flex items-center gap-1.5 rounded-lg px-1.5 py-1 transition-colors hover:bg-gray-50"
        style={{ paddingLeft: `${depth * 1.25 + 0.375}rem` }}
      >
        {hasChildren ? (
          <button
            type="button"
            onClick={() => onToggle(id)}
            aria-label={open ? `Collapse ${row.grp_name}` : `Expand ${row.grp_name}`}
            className="grid h-5 w-5 shrink-0 place-items-center rounded text-gray-400 transition-colors hover:bg-gray-200 hover:text-gray-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/30"
          >
            <ChevronRight className={cx('h-3.5 w-3.5 transition-transform duration-150', open && 'rotate-90')} aria-hidden />
          </button>
        ) : (
          <span className="h-5 w-5 shrink-0" aria-hidden />
        )}

        <span
          className={cx(
            'grid h-6 w-6 shrink-0 place-items-center rounded-md',
            isActive(row) ? 'bg-primary-light text-primary' : 'bg-gray-100 text-gray-400',
          )}
          aria-hidden
        >
          <Boxes className="h-3.5 w-3.5" />
        </span>

        <button
          type="button"
          onClick={() => onOpen(row)}
          className="min-w-0 flex-1 truncate text-left text-sm font-medium text-gray-800 transition-colors hover:text-primary focus:outline-none focus-visible:text-primary focus-visible:underline"
        >
          {row.grp_name}
        </button>

        {row.grp_code ? (
          <span className="shrink-0 font-mono text-[10px] font-semibold uppercase tracking-wide text-gray-400">
            {row.grp_code}
          </span>
        ) : null}
        {!isActive(row) ? (
          <Badge tone="neutral" size="xs" dot>
            Inactive
          </Badge>
        ) : null}
        <span className="shrink-0 rounded-full bg-gray-100 px-1.5 text-[10px] font-semibold tabular-nums text-gray-500">
          {count}
        </span>
        {actions.length > 0 ? (
          <span className="shrink-0 opacity-0 transition-opacity focus-within:opacity-100 group-hover:opacity-100">
            <MenuButton
              label={`Actions for ${row.grp_name}`}
              actions={actions}
              icon={MoreHorizontal}
              variant="ghost"
              size="xs"
              buttonProps={{ className: 'px-1' }}
            />
          </span>
        ) : null}
      </div>

      {open && hasChildren ? (
        <ul role="group" className="list-none p-0">
          {node.children.map((child) => (
            <TreeRow
              key={child.id}
              node={child}
              depth={depth + 1}
              expanded={expanded}
              onToggle={onToggle}
              warehousesByGroup={warehousesByGroup}
              showEmpty={showEmpty}
              onOpen={onOpen}
              actionsFor={actionsFor}
            />
          ))}
          {warehouses.map((w) => (
            <li role="none" key={`w-${w.warehouse_id}`}>
              <div
                role="treeitem"
                aria-level={depth + 2}
                className="flex items-center gap-1.5 rounded-lg px-1.5 py-1 text-sm text-gray-600"
                style={{ paddingLeft: `${(depth + 1) * 1.25 + 0.375}rem` }}
              >
                <span className="h-5 w-5 shrink-0" aria-hidden />
                <span className="grid h-6 w-6 shrink-0 place-items-center rounded-md bg-sky-50 text-sky-600" aria-hidden>
                  <WarehouseIcon className="h-3.5 w-3.5" />
                </span>
                <span className="min-w-0 flex-1 truncate">{w.warehouse_name}</span>
                {w.warehouse_code ? (
                  <span className="shrink-0 font-mono text-[10px] font-semibold uppercase tracking-wide text-gray-400">
                    {w.warehouse_code}
                  </span>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      ) : null}
    </li>
  )
}

export interface WarehouseGroupsTreeProps {
  rows: readonly WarehouseGroup[]
  warehouses: readonly Warehouse[] | null
  loading: boolean
  empty: ReactNode
  onOpen: (row: WarehouseGroup) => void
  actionsFor: (row: WarehouseGroup) => RowAction[]
  totalLabel: string
}

export function WarehouseGroupsTree({
  rows,
  warehouses,
  loading,
  empty,
  onOpen,
  actionsFor,
  totalLabel,
}: WarehouseGroupsTreeProps) {
  const forest = useMemo(
    () => buildTree(rows, { idKey: 'warehouse_group_id', parentKey: 'parent_grp_id', labelOf: (r) => r.grp_name }),
    [rows],
  )
  const warehousesByGroup = useMemo(() => {
    if (!warehouses) return null
    const map = new Map<number, Warehouse[]>()
    for (const w of warehouses) {
      const gid = Number(w.warehouse_group_id ?? 0)
      if (!gid) continue
      map.set(gid, [...(map.get(gid) ?? []), w])
    }
    for (const list of map.values()) {
      list.sort((a, b) => a.warehouse_name.localeCompare(b.warehouse_name, undefined, { sensitivity: 'base' }))
    }
    return map
  }, [warehouses])

  const allIds = useMemo(() => rows.map((r) => r.warehouse_group_id), [rows])
  const [expanded, setExpanded] = useState<Set<number>>(() => new Set())
  const [showEmpty, setShowEmpty] = useState(true)

  // Arriving on the tree with everything shut would hide the structure the view
  // exists to show, so it opens itself once the rows are in — and stays wherever
  // the reader leaves it afterwards.
  const [seeded, setSeeded] = useState(false)
  useEffect(() => {
    if (!seeded && allIds.length > 0) {
      setExpanded(new Set(allIds))
      setSeeded(true)
    }
  }, [allIds, seeded])

  const toggle = (id: number) =>
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

  if (loading && rows.length === 0) {
    return (
      <Card padding="md">
        <div className="space-y-2" aria-hidden>
          {[0, 1, 2, 3, 4].map((i) => (
            <div key={i} className="skeleton h-7 rounded-lg" style={{ marginLeft: `${(i % 3) * 1.25}rem` }} />
          ))}
        </div>
      </Card>
    )
  }

  if (rows.length === 0) return <Card padding="md">{empty}</Card>

  return (
    <Card padding="sm">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2 border-b border-gray-100 px-1 pb-2">
        <span className="inline-flex items-center gap-2 text-xs font-semibold text-gray-700">
          <Network className="h-4 w-4 text-gray-400" aria-hidden />
          {totalLabel}
        </span>
        <span className="flex flex-wrap items-center gap-1">
          <Button variant="ghost" size="xs" onClick={() => setExpanded(new Set(allIds))}>
            Expand all
          </Button>
          <Button variant="ghost" size="xs" onClick={() => setExpanded(new Set())}>
            Collapse all
          </Button>
          <Button
            variant="ghost"
            size="xs"
            onClick={() => setShowEmpty((v) => !v)}
            aria-pressed={!showEmpty}
          >
            {showEmpty ? 'Hide empty groups' : 'Show empty groups'}
          </Button>
        </span>
      </div>

      <ul role="tree" aria-label="Warehouse group hierarchy" className="list-none p-0">
        {forest.map((node) => (
          <TreeRow
            key={node.id}
            node={node}
            depth={0}
            expanded={expanded}
            onToggle={toggle}
            warehousesByGroup={warehousesByGroup}
            showEmpty={showEmpty}
            onOpen={onOpen}
            actionsFor={actionsFor}
          />
        ))}
      </ul>
    </Card>
  )
}

export default WarehouseGroupsTree
