import { Copy, Eye, History, Pencil, Power, PowerOff, Trash2, Warehouse } from 'lucide-react'
import type { MenuAction } from '../../ui/MenuButton'
import type { WarehouseGroup } from '../../services/masters'
import { isActive, warehouseCount } from './model'

/**
 * One row menu, built once, used by the table, the tree and the cards.
 *
 * Three views of the same records that offered three different sets of actions
 * would be three screens, and the difference would be invisible until somebody
 * could not find Deactivate in Cards. What the user may not do is left OUT of
 * the menu rather than disabled: a greyed row that never becomes pressable is a
 * promise the profile will never keep. The API enforces every one of these
 * permissions again regardless.
 */

export type RowAction = MenuAction

export interface RowActionHandlers {
  onView: (row: WarehouseGroup) => void
  onEdit: (row: WarehouseGroup) => void
  onDuplicate: (row: WarehouseGroup) => void
  onToggleActive: (row: WarehouseGroup) => void
  onShowWarehouses: (row: WarehouseGroup) => void
  onAudit: (row: WarehouseGroup) => void
  onDelete: (row: WarehouseGroup) => void
}

export interface RowActionAbilities {
  canWrite: boolean
  canDelete: boolean
  canReadAudit: boolean
  canReadWarehouses: boolean
}

export function buildRowActions(
  row: WarehouseGroup,
  abilities: RowActionAbilities,
  handlers: RowActionHandlers,
): RowAction[] {
  const actions: RowAction[] = []

  if (abilities.canWrite) {
    actions.push({ key: 'edit', label: 'Edit', icon: Pencil, onSelect: () => handlers.onEdit(row) })
    actions.push({ key: 'duplicate', label: 'Duplicate', icon: Copy, onSelect: () => handlers.onDuplicate(row) })
  } else {
    actions.push({ key: 'view', label: 'View', icon: Eye, onSelect: () => handlers.onView(row) })
  }

  if (abilities.canReadWarehouses) {
    actions.push({
      key: 'warehouses',
      label: `View warehouses (${warehouseCount(row)})`,
      icon: Warehouse,
      onSelect: () => handlers.onShowWarehouses(row),
      separated: true,
    })
  }

  if (abilities.canWrite) {
    actions.push({
      key: 'toggle',
      label: isActive(row) ? 'Deactivate' : 'Activate',
      icon: isActive(row) ? PowerOff : Power,
      onSelect: () => handlers.onToggleActive(row),
      separated: !abilities.canReadWarehouses,
    })
  }

  if (abilities.canReadAudit) {
    actions.push({ key: 'audit', label: 'Audit history', icon: History, onSelect: () => handlers.onAudit(row) })
  }

  if (abilities.canDelete) {
    actions.push({ key: 'delete', label: 'Delete', icon: Trash2, danger: true, separated: true, onSelect: () => handlers.onDelete(row) })
  }

  return actions
}
