import { Modal } from '../components/Modal'
import { comboLabel } from '../keyboard/platform'

/** `lineOnly` bindings are registered only by a form that has item lines — see DocumentForm. */
const SHORTCUTS: { action: string; combo: string; lineOnly?: boolean }[] = [
  { action: 'Add line', combo: 'alt+a', lineOnly: true },
  { action: 'Save draft', combo: 'ctrl+s' },
  { action: 'Save & post', combo: 'ctrl+enter' },
  { action: 'Search items', combo: '/', lineOnly: true },
  { action: 'Close dialog', combo: 'escape' },
]

export interface ShortcutsDialogProps {
  open: boolean
  onClose: () => void
  /**
   * Whether this form has item lines.
   *
   * `/` and Alt+A are registered by DocumentForm only when it does, so listing them on a
   * line-less document (a landed cost allocation, a revaluation) advertises two keys that do
   * nothing. Defaults to true, which is what every form that has lines wants.
   */
  showSearchItems?: boolean
}

/** Read-only reference for the document form's keyboard bindings, opened from the "Shortcuts" button. */
export function ShortcutsDialog({ open, onClose, showSearchItems = true }: ShortcutsDialogProps) {
  const shortcuts = showSearchItems ? SHORTCUTS : SHORTCUTS.filter((s) => !s.lineOnly)
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
