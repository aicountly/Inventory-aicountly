import { Modal } from '../../components/Modal'
import { Button } from '../../ui/Button'
import { Kbd } from '../../ui/Kbd'
import { AIC, cx } from '../../ui/cx'

interface ShortcutsDialogProps {
  open: boolean
  onClose: () => void
}

const SHORTCUTS: readonly { keys: string[]; what: string }[] = [
  { keys: ['Ctrl', 'K'], what: 'Open the global search / command palette' },
  { keys: ['Alt', 'N'], what: 'Add a stock journal line' },
  { keys: ['Ctrl', 'S'], what: 'Save as draft' },
  { keys: ['Ctrl', 'Enter'], what: 'Open the post confirmation' },
  { keys: ['Esc'], what: 'Close a dialog, or leave the page' },
  { keys: ['Enter'], what: 'Choose the highlighted search result' },
  { keys: ['↑', '↓'], what: 'Move through search results' },
  { keys: ['Tab'], what: 'Move to the next field' },
]

/** What this screen answers to. */
export function ShortcutsDialog({ open, onClose }: ShortcutsDialogProps) {
  return (
    <Modal
      open={open}
      title="Keyboard shortcuts"
      description="Stock journal entry is built for the keyboard."
      onClose={onClose}
      size="md"
      footer={<Button onClick={onClose}>Close</Button>}
    >
      <ul className={cx(AIC, 'divide-y divide-gray-100')}>
        {SHORTCUTS.map((s) => (
          <li key={s.what} className="flex items-center justify-between gap-4 py-2">
            <span className="text-xs text-gray-700">{s.what}</span>
            <span className="flex shrink-0 items-center gap-1">
              {s.keys.map((k, i) => (
                <span key={k} className="flex items-center gap-1">
                  {i > 0 ? <span className="text-[10px] text-gray-400">+</span> : null}
                  <Kbd>{k}</Kbd>
                </span>
              ))}
            </span>
          </li>
        ))}
      </ul>
      <p className="mt-3 text-[11px] leading-relaxed text-gray-500">
        Ctrl+Enter opens the confirmation; it never posts on its own.
      </p>
    </Modal>
  )
}
