import { useMemo } from 'react'
import type { RefObject } from 'react'
import { useKeyboardScope } from './useKeyboardScope'
import { openCommandPalette } from './shortcutRegistry'

/**
 * What "search this page" means: the page's own search box when it has one,
 * the command palette when it does not.
 *
 * Exported because the register toolbar has a visible Search button beside the
 * `/` hint, and two implementations of the same promise drift — the button was
 * a no-op on every register whose search box is the item typeahead.
 */
export function focusPageSearch(
  searchInputRef?: RefObject<HTMLInputElement | null>,
): void {
  const el = searchInputRef?.current
  if (el) {
    el.focus()
    el.select?.()
    return
  }
  openCommandPalette()
}

export interface PageKeyboardOptions {
  searchInputRef?: RefObject<HTMLInputElement | null>
  onRefresh?: () => void
  onPrint?: () => void
  onNew?: () => void
  enabled?: boolean
}

/**
 * Report / register / list page shortcuts: `/` and Ctrl+F focus the search
 * box, Ctrl+R refreshes, Ctrl+P prints, Ctrl+N creates. Handlers are optional —
 * a combo with no handler is simply left to the browser.
 */
export function usePageKeyboard({
  searchInputRef,
  onRefresh,
  onPrint,
  onNew,
  enabled = true,
}: PageKeyboardOptions): void {
  const bindings = useMemo(
    () => ({
      'ctrl+f': (e: KeyboardEvent) => {
        if (!enabled) return
        e.preventDefault()
        focusPageSearch(searchInputRef)
      },
      '/': (e: KeyboardEvent) => {
        if (!enabled) return
        e.preventDefault()
        focusPageSearch(searchInputRef)
      },
      'ctrl+r': (e: KeyboardEvent) => {
        if (!enabled || !onRefresh) return
        e.preventDefault()
        onRefresh()
      },
      'ctrl+p': (e: KeyboardEvent) => {
        if (!enabled || !onPrint) return
        e.preventDefault()
        onPrint()
      },
      'ctrl+n': (e: KeyboardEvent) => {
        if (!enabled || !onNew) return
        e.preventDefault()
        onNew()
      },
    }),
    [enabled, searchInputRef, onRefresh, onPrint, onNew],
  )

  useKeyboardScope('page', bindings)
}

export interface FormKeyboardOptions {
  onSave?: () => void
  onCancel?: () => void
  onDelete?: () => void
  saving?: boolean
  enabled?: boolean
}

/** Entry-form shortcuts: Ctrl+S saves, Esc cancels, Ctrl+Delete deletes. */
export function useFormKeyboard({
  onSave,
  onCancel,
  onDelete,
  saving = false,
  enabled = true,
}: FormKeyboardOptions): void {
  const bindings = useMemo(
    () => ({
      'ctrl+s': (e: KeyboardEvent) => {
        if (!enabled || saving || !onSave) return
        e.preventDefault()
        onSave()
      },
      escape: (e: KeyboardEvent) => {
        if (!enabled || !onCancel) return
        e.preventDefault()
        onCancel()
      },
      'ctrl+delete': (e: KeyboardEvent) => {
        if (!enabled || !onDelete) return
        e.preventDefault()
        onDelete()
      },
    }),
    [enabled, saving, onSave, onCancel, onDelete],
  )

  useKeyboardScope('form', bindings, { allowInInput: true })
}
