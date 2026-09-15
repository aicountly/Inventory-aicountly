/**
 * App-wide shortcuts, handled after every registered scope has passed.
 *
 * Keep this list short and mnemonic. Anything page-specific belongs in that
 * page's own scope (usePageKeyboard / useFormKeyboard), not here.
 */
export interface GlobalShortcut {
  id: string
  combo: string
  label: string
  /** Navigate here when fired. */
  path?: string
  /** Fires even while typing (only for combos with a modifier). */
  allowInInput?: boolean
}

/** Dispatched by Ctrl+K and by the topbar search button. */
export const COMMAND_PALETTE_EVENT = 'inventory:command-palette'

export const GLOBAL_SHORTCUTS: readonly GlobalShortcut[] = [
  { id: 'commandPalette', combo: 'ctrl+k', label: 'Command palette', allowInInput: true },
  { id: 'dashboard', combo: 'alt+d', label: 'Dashboard', path: '/dashboard' },
  { id: 'items', combo: 'alt+i', label: 'Items', path: '/items' },
  { id: 'documents', combo: 'alt+o', label: 'Documents', path: '/documents' },
  { id: 'stock', combo: 'alt+s', label: 'Stock', path: '/registers/stock-balances' },
  { id: 'reports', combo: 'alt+r', label: 'Reports', path: '/reports' },
]

export function openCommandPalette(filter?: string): void {
  window.dispatchEvent(new CustomEvent(COMMAND_PALETTE_EVENT, { detail: { filter } }))
}
