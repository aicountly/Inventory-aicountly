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
}

/**
 * Page-scope Esc → the back target (explicit `backTo`, else the breadcrumb
 * parent). Lower priority than modal and form scopes, and skipped while the
 * user is typing.
 */
export function usePageBackKeyboard({
  backTo,
  breadcrumbs,
  onBack,
  enabled = true,
}: PageBackKeyboardOptions = {}): void {
  const navigate = useNavigate()
  const target = resolveBackTarget({ backTo, breadcrumbs })
  const canBack = enabled && (typeof onBack === 'function' || Boolean(target))

  const bindings = useMemo<KeyBindings>(() => {
    if (!canBack) return {} as KeyBindings
    return {
      escape: (e: KeyboardEvent) => {
        if (isTypingTarget(e.target)) return
        e.preventDefault()
        if (typeof onBack === 'function') {
          onBack()
          return
        }
        if (target) navigate(target)
      },
    }
  }, [canBack, onBack, target, navigate])

  useKeyboardScope('page', bindings, { allowInInput: false })
}
