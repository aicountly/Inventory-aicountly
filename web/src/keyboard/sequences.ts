/**
 * Sequential shortcuts: `G` then `1`, `N` then `R`.
 *
 * These are two key presses one after the other, not a chord — nothing is held
 * down — which is why they are a separate registry from GLOBAL_SHORTCUTS and
 * why the help text says "G then 1" rather than "G+1". Books uses the same
 * grammar for the same reason.
 *
 * ## Why this is not just a keydown handler
 *
 * A bare letter is the most dangerous kind of shortcut: every text field in the
 * app is one keystroke away from firing it. Everything below exists to keep a
 * single letter from stealing a keystroke someone meant as typing:
 *
 *  - the sequence never starts while focus is in a text control, a select, a
 *    contenteditable, a rich-text editor, an ARIA textbox/combobox or a grid
 *    cell editor (isTypingTarget), and never inside an open overlay;
 *  - it never starts on a key that carries Ctrl/Alt/Meta, so Alt+G and AltGr
 *    combinations pass straight through to the browser and to non-US layouts;
 *  - it ignores auto-repeat and IME composition, so holding a key or typing
 *    Japanese cannot walk a sequence forward;
 *  - the pending prefix expires after SEQUENCE_TIMEOUT_MS, and is dropped on
 *    navigation, on blur, and when an overlay opens;
 *  - `preventDefault` is called only when a registered, permitted command
 *    actually ran — never on the prefix key, which stays available to the page.
 *
 * ## Disabling them
 *
 * Single-letter shortcuts are an accessibility problem for anyone using speech
 * input or a switch device, where a stray letter is easy to emit and hard to
 * take back. `readSequencesEnabled` / `writeSequencesEnabled` persist an
 * explicit opt-out per browser; when it is off the whole mechanism is inert and
 * every badge that would show a sequence hides instead, so the help never
 * promises a key that does nothing.
 */

import type { LucideIcon } from 'lucide-react'
import { P } from '../services/access'
import { slugForCode } from '../documents/registry'

/** How long a half-finished sequence waits for its second key. */
export const SEQUENCE_TIMEOUT_MS = 1000

export type SequenceGroup = 'Dashboards' | 'Go to' | 'Create' | 'Help'

export interface SequenceShortcut {
  id: string
  /** The keys in order, lower-case, e.g. `['g', '1']`. */
  keys: readonly string[]
  label: string
  group: SequenceGroup
  /** Where it navigates. Commands open a screen; they never save or post. */
  path: string
  /** Any one of these permits it; absent means everyone. */
  permissions?: readonly string[]
  icon?: LucideIcon
}

/** `/documents/new/<slug>` for a document code — the route DocumentFormPage owns. */
export function newDocumentPath(code: string): string {
  return `/documents/new/${slugForCode(code)}`
}

/** The type's own create permission, or the blanket one (documents/actions.ts). */
export function createPermissions(code: string): readonly string[] {
  return [`documents.${slugForCode(code)}.create`, 'documents.create']
}

/**
 * The fallback mappings.
 *
 * These are Inventory's own. They were NOT copied from a verified Books
 * shortcut table — `books-react-app` has no sequence registry to copy (its
 * `web/src/keyboard` handles chords only), so claiming parity here would be a
 * claim nobody checked. Ctrl+K and the chord shortcuts in `shortcutRegistry.ts`
 * are the ones the two products genuinely share.
 *
 * Nothing here collides with a chord in GLOBAL_SHORTCUTS: those all carry Ctrl
 * or Alt, and a sequence never starts on a key with a modifier held.
 */
export const SEQUENCE_SHORTCUTS: readonly SequenceShortcut[] = [
  // Dashboards — G then 1..5, in the order of the tabs.
  { id: 'dash.overview', keys: ['g', '1'], label: 'Overview dashboard', group: 'Dashboards', path: '/dashboard?view=overview', permissions: [P.dashboard] },
  { id: 'dash.operations', keys: ['g', '2'], label: 'Operations dashboard', group: 'Dashboards', path: '/dashboard?view=operations', permissions: [P.dashboard] },
  { id: 'dash.replenishment', keys: ['g', '3'], label: 'Replenishment dashboard', group: 'Dashboards', path: '/dashboard?view=replenishment', permissions: [P.report('replenishment')] },
  { id: 'dash.valuation', keys: ['g', '4'], label: 'Valuation dashboard', group: 'Dashboards', path: '/dashboard?view=valuation', permissions: [P.report('stock_summary')] },
  { id: 'dash.controls', keys: ['g', '5'], label: 'Controls dashboard', group: 'Dashboards', path: '/dashboard?view=controls', permissions: [P.dashboard] },

  // Go to — the two registers people live in.
  { id: 'go.items', keys: ['g', 'i'], label: 'Items', group: 'Go to', path: '/items', permissions: [P.masters('items', 'read')] },
  { id: 'go.ledger', keys: ['g', 'l'], label: 'Stock ledger', group: 'Go to', path: '/registers/stock-ledger', permissions: [P.report('stock_ledger')] },

  // Create — every one of these opens a blank FORM. None of them saves,
  // submits, approves or posts anything; a keystroke may never write.
  //
  // Permission keys follow documents/actions.ts: the type's own
  // `documents.<slug>.create`, or the blanket `documents.create`. `can()` treats
  // an array as "any one of these", which is exactly the fallback the document
  // screens already apply.
  { id: 'new.receipt', keys: ['n', 'r'], label: 'New stock receipt', group: 'Create', path: newDocumentPath('MATERIAL_RECEIPT'), permissions: createPermissions('MATERIAL_RECEIPT') },
  { id: 'new.issue', keys: ['n', 'i'], label: 'New stock issue', group: 'Create', path: newDocumentPath('MATERIAL_ISSUE'), permissions: createPermissions('MATERIAL_ISSUE') },
  { id: 'new.transfer', keys: ['n', 't'], label: 'New transfer', group: 'Create', path: newDocumentPath('STOCK_TRANSFER'), permissions: createPermissions('STOCK_TRANSFER') },
  { id: 'new.count', keys: ['n', 'c'], label: 'New stock count', group: 'Create', path: newDocumentPath('PHYSICAL_ADJUSTMENT'), permissions: createPermissions('PHYSICAL_ADJUSTMENT') },
]

/** `['g','1']` → `g 1`, the key a lookup table is built on. */
export function sequenceKey(keys: readonly string[]): string {
  return keys.join(' ')
}

/** `['g','1']` → `G then 1`, for help text and tooltips. */
export function sequenceLabel(keys: readonly string[]): string {
  return keys.map((k) => k.toUpperCase()).join(' then ')
}

/** The first keys any sequence can start with — used to decide what to buffer. */
export function sequencePrefixes(shortcuts: readonly SequenceShortcut[] = SEQUENCE_SHORTCUTS): Set<string> {
  return new Set(shortcuts.map((s) => s.keys[0]))
}

/**
 * Resolve a buffered key list against the registry.
 *
 * Three outcomes, and the caller needs all three kept apart: a completed
 * sequence to run, a still-valid prefix to keep buffering, and a dead end that
 * must reset the buffer rather than silently swallow the next key too.
 */
export function resolveSequence(
  pressed: readonly string[],
  shortcuts: readonly SequenceShortcut[] = SEQUENCE_SHORTCUTS,
): { status: 'match'; shortcut: SequenceShortcut } | { status: 'prefix' } | { status: 'none' } {
  if (pressed.length === 0) return { status: 'none' }
  const typed = sequenceKey(pressed)
  const exact = shortcuts.find((s) => sequenceKey(s.keys) === typed)
  if (exact) return { status: 'match', shortcut: exact }
  const partial = shortcuts.some((s) => sequenceKey(s.keys).startsWith(typed + ' '))
  return partial ? { status: 'prefix' } : { status: 'none' }
}

/**
 * Is this event allowed to advance a sequence at all?
 *
 * Deliberately conservative: anything the browser or an input method might
 * already be doing with the key wins, and the sequence is abandoned.
 */
export function isSequenceKey(e: KeyboardEvent): boolean {
  if (e.ctrlKey || e.metaKey || e.altKey) return false
  // `repeat` is a held key; `isComposing` (and keyCode 229) is an IME mid-word.
  if (e.repeat || e.isComposing || e.keyCode === 229) return false
  if (e.defaultPrevented) return false
  const key = e.key
  return typeof key === 'string' && key.length === 1 && /^[a-z0-9]$/i.test(key)
}

// ---------------------------------------------------------------------------
// The accessibility opt-out
// ---------------------------------------------------------------------------

const STORAGE_KEY = 'inventory.shortcuts.sequences'

/**
 * On unless the user turned them off.
 *
 * A throwing localStorage (private mode, blocked site data) must not take the
 * app down, and the safe fallback for a *convenience* is "available" — the user
 * can always turn it off again once storage works.
 */
export function readSequencesEnabled(): boolean {
  try {
    return window.localStorage.getItem(STORAGE_KEY) !== 'off'
  } catch {
    return true
  }
}

export function writeSequencesEnabled(enabled: boolean): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, enabled ? 'on' : 'off')
    window.dispatchEvent(new CustomEvent(SEQUENCES_CHANGED_EVENT, { detail: { enabled } }))
  } catch {
    /* A browser that cannot remember the choice still honours it this session. */
  }
}

/** Fired when the opt-out changes, so badges and help update without a reload. */
export const SEQUENCES_CHANGED_EVENT = 'inventory:sequences-changed'

/** Opened by `?` and by the shortcut-footer button. */
export const SHORTCUT_HELP_EVENT = 'inventory:shortcut-help'

export function openShortcutHelp(): void {
  window.dispatchEvent(new CustomEvent(SHORTCUT_HELP_EVENT))
}
