import { createContext, useContext } from 'react'
import { SCOPE_PRIORITY } from './types'
import type { KeyBindings, ScopeOptions, ScopeType } from './types'

interface Scope {
  id: string
  scopeType: ScopeType
  bindings: KeyBindings
  options: ScopeOptions
  enabled: boolean
}

export interface KeyboardStore {
  getActiveScopes: () => Scope[]
  hasFormScope: () => boolean
  registerScope: (id: string, scopeType: ScopeType, bindings: KeyBindings, options?: ScopeOptions) => void
  updateScope: (id: string, bindings?: KeyBindings, options?: ScopeOptions) => void
  unregisterScope: (id: string) => void
  attachListener: (onKeyDown: (e: KeyboardEvent) => void) => void
  detachListener: () => void
}

/**
 * A plain Map of live scopes plus one window listener. Deliberately not React
 * state: registering a scope must not re-render the tree, and the keydown
 * handler must see the newest bindings without a re-subscription.
 */
export function createKeyboardStore(): KeyboardStore {
  const scopes = new Map<string, Scope>()
  let handler: ((e: KeyboardEvent) => void) | null = null

  return {
    getActiveScopes() {
      return [...scopes.values()].sort(
        (a, b) => SCOPE_PRIORITY[b.scopeType] - SCOPE_PRIORITY[a.scopeType],
      )
    },
    hasFormScope() {
      for (const scope of scopes.values()) {
        if (scope.scopeType === 'form' && scope.enabled) return true
      }
      return false
    },
    registerScope(id, scopeType, bindings, options = {}) {
      scopes.set(id, { id, scopeType, bindings, options, enabled: options.enabled !== false })
    },
    updateScope(id, bindings, options) {
      const existing = scopes.get(id)
      if (!existing) return
      scopes.set(id, {
        ...existing,
        bindings: bindings ?? existing.bindings,
        options: options ? { ...existing.options, ...options } : existing.options,
        enabled: (options?.enabled ?? existing.options.enabled) !== false,
      })
    },
    unregisterScope(id) {
      scopes.delete(id)
    },
    attachListener(onKeyDown) {
      if (handler) window.removeEventListener('keydown', handler, true)
      handler = onKeyDown
      window.addEventListener('keydown', handler, true)
    },
    detachListener() {
      if (!handler) return
      window.removeEventListener('keydown', handler, true)
      handler = null
    },
  }
}

export type KeyboardContextValue = Pick<
  KeyboardStore,
  'registerScope' | 'updateScope' | 'unregisterScope' | 'hasFormScope'
>

export const KeyboardContext = createContext<KeyboardContextValue | null>(null)

/** Null when the provider is absent — hooks then fall back to a window listener. */
export function useKeyboardContextOptional(): KeyboardContextValue | null {
  return useContext(KeyboardContext)
}
