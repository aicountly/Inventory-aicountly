import { Modal } from '../components/Modal'
import { comboLabel } from '../keyboard/platform'

const BASE_SHORTCUTS: { action: string; combo: string }[] = [
  { action: 'Add line', combo: 'ctrl+enter' },
  { action: 'Save draft', combo: 'ctrl+s' },
  { action: 'Save & post', combo: 'alt+p' },
  { action: 'Close dialog', combo: 'escape' },
]

const SEARCH_ITEMS_SHORTCUT = { action: 'Search items', combo: '/' }

export interface ShortcutsDialogProps {
  open: boolean
  onClose: () => void
  /** Only the "lines"-form types wire up the "/" jump-to-search binding. */
  showSearchItems?: boolean
}

/** Read-only reference for the document form's keyboard bindings, opened from the "Shortcuts" button. */
export function ShortcutsDialog({ open, onClose, showSearchItems = false }: ShortcutsDialogProps) {
  const shortcuts = showSearchItems ? [...BASE_SHORTCUTS.slice(0, 3), SEARCH_ITEMS_SHORTCUT, BASE_SHORTCUTS[3]] : BASE_SHORTCUTS
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
