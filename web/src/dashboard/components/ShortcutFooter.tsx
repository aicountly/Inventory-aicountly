import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Keyboard } from 'lucide-react'
import { useAccess } from '../../access/AccessContext'
import { Kbd } from '../../ui/Kbd'
import {
  SEQUENCES_CHANGED_EVENT,
  SEQUENCE_SHORTCUTS,
  openShortcutHelp,
  readSequencesEnabled,
  sequenceLabel,
} from '../../keyboard/sequences'

/**
 * The shortcut strip at the foot of the dashboards.
 *
 * Every entry is a real button as well as a shortcut, so the same commands are
 * reachable with a pointer — a footer of key hints and nothing else is a
 * feature only keyboard users can use, and it is the keyboard users who least
 * need reminding.
 *
 * Two things it will not do:
 *
 *  - show a key for a command the user may not run (the registry is filtered by
 *    the same `can()` the handler uses, so the badge and the behaviour agree);
 *  - show any key at all while single-letter shortcuts are turned off, because
 *    a badge for a disabled shortcut is a promise the app will not keep.
 */
const FOOTER_IDS = ['go.items', 'go.ledger', 'new.receipt', 'new.transfer'] as const

export function ShortcutFooter() {
  const navigate = useNavigate()
  const { can, loading } = useAccess()
  const [sequencesOn, setSequencesOn] = useState(readSequencesEnabled)

  useEffect(() => {
    const onChange = () => setSequencesOn(readSequencesEnabled())
    window.addEventListener(SEQUENCES_CHANGED_EVENT, onChange)
    return () => window.removeEventListener(SEQUENCES_CHANGED_EVENT, onChange)
  }, [])

  const entries = SEQUENCE_SHORTCUTS.filter(
    (s) =>
      (FOOTER_IDS as readonly string[]).includes(s.id) &&
      (loading || !s.permissions || can(s.permissions)),
  )

  return (
    <footer
      aria-label="Keyboard shortcuts"
      className="flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-gray-200 pt-2 text-[11px] text-gray-500 print:hidden"
    >
      <span className="inline-flex items-center gap-1.5 font-medium">
        <Keyboard className="h-3.5 w-3.5" aria-hidden />
        Shortcuts
      </span>

      {entries.map((s) => (
        <button
          key={s.id}
          type="button"
          onClick={() => navigate(s.path)}
          title={sequencesOn ? `${s.label} — ${sequenceLabel(s.keys)}` : s.label}
          className="inline-flex items-center gap-1.5 text-gray-600 transition-colors hover:text-primary"
        >
          {sequencesOn ? <Kbd>{s.keys.map((k) => k.toUpperCase()).join(' ')}</Kbd> : null}
          {s.label.replace(/^New /, '')}
        </button>
      ))}

      <button
        type="button"
        onClick={openShortcutHelp}
        className="inline-flex items-center gap-1.5 text-gray-600 transition-colors hover:text-primary"
      >
        {sequencesOn ? <Kbd>?</Kbd> : null}
        All shortcuts
      </button>

      <span className="ml-auto text-gray-400">Suggestions only — nothing here posts or approves.</span>
    </footer>
  )
}

export default ShortcutFooter
