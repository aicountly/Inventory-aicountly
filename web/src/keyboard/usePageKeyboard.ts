import { useMemo } from 'react'
import type { RefObject } from 'react'
import { useKeyboardScope } from './useKeyboardScope'
import { openCommandPalette } from './shortcutRegistry'

function focusPageSearch(
  searchInputRef: RefObject<HTMLInputElement | null> | undefined,
  e: KeyboardEvent,
): void {
  e.preventDefault()
  if (searchInputRef?.current) {
    searchInputRef.current.focus()
    searchInputRef.current.select?.()
  } else {
    openCommandPalette()
  }
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
        focusPageSearch(searchInputRef, e)
      },
      '/': (e: KeyboardEvent) => {
        if (!enabled) return
        focusPageSearch(searchInputRef, e)
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
