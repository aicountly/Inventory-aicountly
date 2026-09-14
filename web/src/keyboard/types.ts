/** A scope's shortcut table: combo string → handler. */
export type KeyBindings = Record<string, (e: KeyboardEvent) => void>

/**
 * Scope kinds, most specific first. A modal's Escape must win over a page's
 * Esc-to-back, and a form's Ctrl+S must win over a global one.
 */
export type ScopeType = 'palette' | 'modal' | 'form' | 'page' | 'global'

export const SCOPE_PRIORITY: Record<ScopeType, number> = {
  palette: 40,
  modal: 30,
  form: 20,
  page: 10,
  global: 0,
}

export interface ScopeOptions {
  /** Fire even while the user is typing in an input (Ctrl+S, Escape…). */
  allowInInput?: boolean
  enabled?: boolean
}
