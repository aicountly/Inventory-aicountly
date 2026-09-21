import { Modal } from '../../components/Modal'
import { Button, Kbd } from '../../ui'
import { AIC, cx } from '../../ui/cx'

/** Every binding the screen owns, and what it does. */
export const MATERIAL_ISSUE_SHORTCUTS: readonly { keys: string[]; label: string }[] = [
  { keys: ['Ctrl', 'S'], label: 'Save as draft' },
  { keys: ['Ctrl', 'Enter'], label: 'Save and post' },
  { keys: ['Alt', 'A'], label: 'Add a line' },
  { keys: ['Enter'], label: 'From a quantity box: jump to the next line' },
  { keys: ['↑', '↓'], label: 'Move through item search results' },
  { keys: ['F2'], label: 'Open this list' },
  { keys: ['Esc'], label: 'Close a dialog or dropdown' },
  { keys: ['Ctrl', 'K'], label: 'Search anything (app-wide)' },
]

export interface ShortcutsDialogProps {
  open: boolean
  onClose: () => void
}

export function ShortcutsDialog({ open, onClose }: ShortcutsDialogProps) {
  return (
    <Modal
      open={open}
      title="Keyboard shortcuts"
      description="Material issue moves faster from the keyboard than the mouse."
      onClose={onClose}
      size="md"
      footer={
        <Button variant="primary" onClick={onClose}>
          Close
        </Button>
      }
    >
      <ul className={cx(AIC, 'divide-y divide-gray-100')}>
        {MATERIAL_ISSUE_SHORTCUTS.map((s) => (
          <li key={s.label} className="flex items-center justify-between gap-4 py-2.5">
            <span className="text-sm text-gray-700">{s.label}</span>
            <span className="flex shrink-0 items-center gap-1">
              {s.keys.map((k, i) => (
                <span key={k} className="flex items-center gap-1">
                  {i > 0 ? <span className="text-xs text-gray-300">+</span> : null}
                  <Kbd>{k}</Kbd>
                </span>
              ))}
            </span>
          </li>
        ))}
      </ul>
    </Modal>
  )
}

export default ShortcutsDialog
