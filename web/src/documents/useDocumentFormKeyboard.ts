import { useMemo } from 'react'
import { useKeyboardScope } from '../keyboard/useKeyboardScope'
import type { KeyBindings } from '../keyboard/types'

export interface DocumentFormKeyboardOptions {
  onSaveDraft?: () => void
  onSavePost?: () => void
  onAddLine?: () => void
  /** Focuses the next line still waiting for an item. */
  onSearchItems?: () => void
  enabled?: boolean
}

/**
 * Save draft (Ctrl/Cmd+S), save & post (Ctrl/Cmd+Enter) and add line (Alt+A) for a document
 * entry form. `allowInInput` because every one of these combos needs a modifier, so none of them
 * fire from ordinary typing in the narration box or a line's qty/rate fields.
 *
 * `/` is registered on its own, plain-key scope: unlike the three above it carries no modifier,
 * so it must stay off while the user is actually typing somewhere (a narration that mentions a
 * date like "12/04" should not steal focus).
 */
export function useDocumentFormKeyboard({ onSaveDraft, onSavePost, onAddLine, onSearchItems, enabled = true }: DocumentFormKeyboardOptions): void {
  const bindings = useMemo<KeyBindings>(
    () => ({
      'ctrl+s': (e) => {
        if (!enabled || !onSaveDraft) return
        e.preventDefault()
        onSaveDraft()
      },
      'ctrl+enter': (e) => {
        if (!enabled || !onSavePost) return
        e.preventDefault()
        onSavePost()
      },
      'alt+a': (e) => {
        if (!enabled || !onAddLine) return
        e.preventDefault()
        onAddLine()
      },
    }),
    [enabled, onSaveDraft, onSavePost, onAddLine],
  )
  useKeyboardScope('form', bindings, { allowInInput: true })

  const searchBindings = useMemo<KeyBindings>(
    () => ({
      '/': (e) => {
        if (!enabled || !onSearchItems) return
        e.preventDefault()
        onSearchItems()
      },
    }),
    [enabled, onSearchItems],
  )
  useKeyboardScope('page', searchBindings, { allowInInput: false })
}
