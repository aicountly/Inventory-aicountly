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
   * Whether `/` does anything on the form that opened this.
   *
   * Only a lines form has an item search to focus (DocumentForm passes
   * `spec.formKind === 'lines'`). On a header-only document the binding is
   * inert, and a reference card that lists a shortcut which does nothing is
   * worse than one that omits it — somebody presses it, nothing happens, and
   * they stop trusting the rest of the list. Defaults to true so a caller that
   * says nothing gets the full card, as before.
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
