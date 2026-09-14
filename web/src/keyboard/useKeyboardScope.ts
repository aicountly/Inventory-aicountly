import { useEffect, useId, useLayoutEffect, useMemo, useRef } from 'react'
import { useKeyboardContextOptional } from './KeyboardContext'
import { matchShortcut } from './matchShortcut'
import { isTypingTarget } from './isTypingTarget'
import type { KeyBindings, ScopeOptions, ScopeType } from './types'

function normalize(bindings: KeyBindings | undefined): KeyBindings {
  if (!bindings) return {}
  return Object.fromEntries(Object.entries(bindings).map(([combo, fn]) => [combo.toLowerCase(), fn]))
}

/**
 * Register shortcut bindings for a scope. Falls back to a private window
 * listener when no KeyboardProvider is mounted (tests, the sign-in screen), so
 * a component is never coupled to the provider being there.
 */
export function useKeyboardScope(
  scopeType: ScopeType,
  bindings: KeyBindings,
  options: ScopeOptions = {},
): void {
  const ctx = useKeyboardContextOptional()
  const id = useId()
  const scopeId = useRef(`scope-${scopeType}-${id}`)
  const normalized = useMemo(() => normalize(bindings), [bindings])
  const bindingsRef = useRef<KeyBindings>(normalized)
  const optionsRef = useRef<ScopeOptions>(options)

  useLayoutEffect(() => {
    bindingsRef.current = normalized
    optionsRef.current = options
  })

  useEffect(() => {
    const myId = scopeId.current
    if (ctx) {
      ctx.registerScope(myId, scopeType, bindingsRef.current, optionsRef.current)
      return () => ctx.unregisterScope(myId)
    }
    const handler = (e: KeyboardEvent) => {
      if (optionsRef.current.enabled === false) return
      if (isTypingTarget(e.target) && !optionsRef.current.allowInInput) return
      for (const [combo, fn] of Object.entries(bindingsRef.current)) {
        if (!matchShortcut(e, combo)) continue
        fn(e)
        return
      }
    }
    window.addEventListener('keydown', handler, true)
    return () => window.removeEventListener('keydown', handler, true)
  }, [ctx, scopeType])

  useEffect(() => {
    if (!ctx) return
    ctx.updateScope(scopeId.current, normalized, options)
    // `options` is an inline object at every call site; depending on it would
    // update on every render. The layout effect above already keeps the ref
    // fresh, and enabled/allowInInput are read through it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ctx, normalized])
}
