import { Modal } from '../components/Modal'
import { comboLabel } from '../keyboard/platform'

const SHORTCUTS: { action: string; combo: string; linesOnly?: boolean }[] = [
  { action: 'Add line', combo: 'alt+a' },
  { action: 'Save draft', combo: 'ctrl+s' },
  { action: 'Save & post', combo: 'ctrl+enter' },
  // DocumentForm binds `/` only on a lines form (`if (!isLinesForm …) return`),
  // so on any other type this row would name a key that does nothing.
  { action: 'Search items', combo: '/', linesOnly: true },
  { action: 'Close dialog', combo: 'escape' },
]

export interface ShortcutsDialogProps {
  open: boolean
  onClose: () => void
  /** Lists the item-search key. False on a form that does not bind it. */
  showSearchItems?: boolean
}

/** Read-only reference for the document form's keyboard bindings, opened from the "Shortcuts" button. */
export function ShortcutsDialog({ open, onClose, showSearchItems = true }: ShortcutsDialogProps) {
  const shortcuts = SHORTCUTS.filter((s) => showSearchItems || !s.linesOnly)
  return (
    <Modal open={open} title="Keyboard shortcuts" onClose={onClose} size="sm">
      <ul className="divide-y divide-gray-100">
        {shortcuts.map((s) => (
          <li key={s.action} className="flex items-center justify-between py-2 text-sm">
            <span className="text-gray-700">{s.action}</span>
            <span className="kbd">{comboLabel(s.combo)}</span>
          </li>
        ))}
      </ul>
    </Modal>
  )
}

export default ShortcutsDialog
