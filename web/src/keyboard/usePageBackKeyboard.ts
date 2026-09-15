import { useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { useKeyboardScope } from './useKeyboardScope'
import { isTypingTarget } from './isTypingTarget'
import { resolveBackTarget } from './resolveBackTarget'
import type { BackCrumb } from './resolveBackTarget'
import type { KeyBindings } from './types'

export interface PageBackKeyboardOptions {
  backTo?: string | null
  breadcrumbs?: readonly BackCrumb[] | null
  onBack?: () => void
  enabled?: boolean
  /** The page holds unsaved edits — Esc must ask before it throws them away. */
  dirty?: boolean
  /** How that is asked; returning false stays put. Defaults to window.confirm. */
  confirmDiscard?: () => boolean
}

const DISCARD_PROMPT = 'Leave this page? Unsaved changes will be lost.'

function mayDiscard(confirmDiscard?: () => boolean): boolean {
  if (typeof confirmDiscard === 'function') return confirmDiscard()
  // Having no way to ask is not an answer of yes.
  if (typeof window === 'undefined' || typeof window.confirm !== 'function') return false
  return window.confirm(DISCARD_PROMPT)
}

/**
 * Page-scope Esc → the back target (explicit `backTo`, else the breadcrumb
 * parent). Lower priority than modal and form scopes, and skipped while the
 * user is typing.
 *
 * `isTypingTarget` deliberately returns false for checkboxes, radios, buttons
 * and for the body, so on a form screen "the user is typing" is not a guard at
 * all — such a screen passes `dirty` while it has unsaved edits.
 */
export function usePageBackKeyboard({
  backTo,
  breadcrumbs,
  onBack,
  enabled = true,
  dirty = false,
  confirmDiscard,
}: PageBackKeyboardOptions = {}): void {
  const navigate = useNavigate()
  const target = resolveBackTarget({ backTo, breadcrumbs })
  const canBack = enabled && (typeof onBack === 'function' || Boolean(target))

  const bindings = useMemo<KeyBindings>(() => {
    if (!canBack) return {} as KeyBindings
    return {
      escape: (e: KeyboardEvent) => {
        if (isTypingTarget(e.target)) return
        if (dirty && !mayDiscard(confirmDiscard)) return
        e.preventDefault()
        if (typeof onBack === 'function') {
          onBack()
          return
        }
        if (target) navigate(target)
      },
    }
  }, [canBack, onBack, target, navigate, dirty, confirmDiscard])

  useKeyboardScope('page', bindings, { allowInInput: false })
}
