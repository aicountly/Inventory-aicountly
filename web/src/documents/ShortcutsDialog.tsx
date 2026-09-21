import { Modal } from '../components/Modal'
import { comboLabel } from '../keyboard/platform'

const SHORTCUTS: { action: string; combo: string }[] = [
  { action: 'Add line', combo: 'alt+a' },
  { action: 'Save draft', combo: 'ctrl+s' },
  { action: 'Save & post', combo: 'ctrl+enter' },
  { action: 'Search items', combo: '/' },
  { action: 'Close dialog', combo: 'escape' },
]

export interface ShortcutsDialogProps {
  open: boolean
  onClose: () => void
  /**
   * False on a document form with no line grid, which has nothing to search.
   * Listing a shortcut that does nothing on the screen behind the dialog is
   * worse than omitting it: the reader tries it and learns the reference lies.
   */
  showSearchItems?: boolean
}

/** Read-only reference for the document form's keyboard bindings, opened from the "Shortcuts" button. */
export function ShortcutsDialog({ open, onClose, showSearchItems = true }: ShortcutsDialogProps) {
  const shortcuts = showSearchItems ? SHORTCUTS : SHORTCUTS.filter((s) => s.action !== 'Search items')
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
