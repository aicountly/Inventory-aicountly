import { useEffect, useMemo, useState } from 'react'
import { useAccess } from '../../access/AccessContext'
import { Modal } from '../../components/Modal'
import { Kbd } from '../../ui/Kbd'
import { GLOBAL_SHORTCUTS } from '../../keyboard/shortcutRegistry'
import {
  SEQUENCES_CHANGED_EVENT,
  SEQUENCE_SHORTCUTS,
  SEQUENCE_TIMEOUT_MS,
  SHORTCUT_HELP_EVENT,
  readSequencesEnabled,
  sequenceLabel,
  writeSequencesEnabled,
} from '../../keyboard/sequences'
import type { SequenceGroup } from '../../keyboard/sequences'

/**
 * `?` — every shortcut that is actually live, and the switch that turns the
 * single-letter ones off.
 *
 * Three things this dialog is careful about:
 *
 *  - **It lists only what works.** Entries are filtered by the same `can()` the
 *    handler uses, so it never advertises a command the user cannot run, and
 *    the whole sequence section disappears when sequences are off.
 *  - **It writes the grammar out.** "G then 1", not "G+1" — they are two
 *    presses, and a user who holds them together will conclude the feature is
 *    broken.
 *  - **The off switch is here, not buried.** Single-letter shortcuts are an
 *    accessibility problem for speech and switch input, where a stray letter is
 *    easy to emit and hard to take back; the person affected has to be able to
 *    find the switch from the thing that is affecting them.
 */
const GROUP_ORDER: SequenceGroup[] = ['Dashboards', 'Go to', 'Create', 'Help']

export function ShortcutHelpDialog() {
  const { can, loading } = useAccess()
  const [open, setOpen] = useState(false)
  const [sequencesOn, setSequencesOn] = useState(readSequencesEnabled)

  useEffect(() => {
    const onOpen = () => setOpen(true)
    const onChange = () => setSequencesOn(readSequencesEnabled())
    window.addEventListener(SHORTCUT_HELP_EVENT, onOpen)
    window.addEventListener(SEQUENCES_CHANGED_EVENT, onChange)
    return () => {
      window.removeEventListener(SHORTCUT_HELP_EVENT, onOpen)
      window.removeEventListener(SEQUENCES_CHANGED_EVENT, onChange)
    }
  }, [])

  const grouped = useMemo(() => {
    const permitted = SEQUENCE_SHORTCUTS.filter((s) => loading || !s.permissions || can(s.permissions))
    return GROUP_ORDER.map((group) => ({
      group,
      items: permitted.filter((s) => s.group === group),
    })).filter((g) => g.items.length > 0)
  }, [can, loading])

  return (
    <Modal open={open} onClose={() => setOpen(false)} title="Keyboard shortcuts" size="lg">
      <div className="space-y-5">
        <section>
          <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-500">Always available</h3>
          <ul className="mt-2 space-y-1.5">
            {GLOBAL_SHORTCUTS.map((s) => (
              <li key={s.id} className="flex items-center justify-between gap-3 text-sm">
                <span className="text-gray-700">{s.label}</span>
                <Kbd>{s.combo.replace('ctrl', 'Ctrl').replace('alt', 'Alt').replace('+', ' + ')}</Kbd>
              </li>
            ))}
            <li className="flex items-center justify-between gap-3 text-sm">
              <span className="text-gray-700">Close a dialog, drawer or the palette</span>
              <Kbd>Esc</Kbd>
            </li>
            <li className="flex items-center justify-between gap-3 text-sm">
              <span className="text-gray-700">This help</span>
              <Kbd>?</Kbd>
            </li>
          </ul>
          <p className="mt-2 text-[11px] text-gray-500">
            On a Mac, Cmd works wherever Ctrl is shown.
          </p>
        </section>

        {sequencesOn ? (
          grouped.map((g) => (
            <section key={g.group}>
              <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-500">{g.group}</h3>
              <ul className="mt-2 space-y-1.5">
                {g.items.map((s) => (
                  <li key={s.id} className="flex items-center justify-between gap-3 text-sm">
                    <span className="text-gray-700">{s.label}</span>
                    {/* "G then 1", never "G+1": two presses, not a chord. */}
                    <span className="shrink-0 text-[11px] text-gray-500">
                      <Kbd>{s.keys[0].toUpperCase()}</Kbd> then <Kbd>{s.keys[1].toUpperCase()}</Kbd>
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          ))
        ) : (
          <p className="rounded-lg border border-gray-200 bg-gray-50 p-3 text-xs text-gray-600">
            Single-letter shortcuts are turned off, so none are listed here. Turn them back on below.
          </p>
        )}

        <section className="rounded-lg border border-gray-200 p-3">
          <label className="flex items-start gap-2.5">
            <input
              type="checkbox"
              checked={sequencesOn}
              onChange={(e) => {
                writeSequencesEnabled(e.target.checked)
                setSequencesOn(e.target.checked)
              }}
              className="mt-0.5 h-4 w-4 accent-primary"
            />
            <span className="min-w-0">
              <span className="block text-sm font-medium text-gray-800">Single-letter shortcuts</span>
              <span className="block text-[11px] leading-relaxed text-gray-500">
                Sequences like {sequenceLabel(['g', '1'])} are two presses within{' '}
                {(SEQUENCE_TIMEOUT_MS / 1000).toFixed(0)} second. They never fire while you are typing in a field, in a
                dialog, or while an input method is composing. Turn them off if speech or switch input makes a stray
                letter easy to emit — Ctrl and Alt shortcuts keep working either way.
              </span>
            </span>
          </label>
        </section>

        <p className="text-[11px] text-gray-500">
          Shortcuts open screens and forms. None of them saves, approves, posts, deletes or orders anything.
        </p>
      </div>
    </Modal>
  )
}

export default ShortcutHelpDialog
