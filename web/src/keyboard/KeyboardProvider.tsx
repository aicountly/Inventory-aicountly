import { useCallback, useEffect, useMemo } from 'react'
import type { ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import { KeyboardContext, createKeyboardStore } from './KeyboardContext'
import type { KeyboardContextValue } from './KeyboardContext'
import { isInOverlay, isTypingTarget } from './isTypingTarget'
import { matchShortcut } from './matchShortcut'
import { GLOBAL_SHORTCUTS, openCommandPalette } from './shortcutRegistry'

/**
 * One window keydown listener for the whole app.
 *
 * Scopes registered by `useKeyboardScope` are consulted in priority order
 * (palette → modal → form → page → global); the first matching binding wins
 * and nothing else runs. Only then are the app-wide shortcuts considered, so a
 * page can always shadow a global combo.
 */
export function KeyboardProvider({ children }: { children: ReactNode }) {
  const store = useMemo(() => createKeyboardStore(), [])
  const navigate = useNavigate()

  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      const typing = isTypingTarget(e.target)
      const inOverlay = isInOverlay(e.target)

      for (const scope of store.getActiveScopes()) {
        if (!scope.enabled) continue
        // A page's Esc-to-back must not fire while a modal is open on top of it.
        if (inOverlay && (scope.scopeType === 'page' || scope.scopeType === 'form')) continue
        for (const [combo, fn] of Object.entries(scope.bindings)) {
          if (!matchShortcut(e, combo)) continue
          if (typing && !scope.options.allowInInput) continue
          fn(e)
          return
        }
      }

      for (const entry of GLOBAL_SHORTCUTS) {
        if (!matchShortcut(e, entry.combo)) continue
        if (inOverlay && !entry.allowInInput) continue
        if (typing && !entry.allowInInput) continue
        // Ctrl+K is the browser address bar and Alt+letter is a menu mnemonic;
        // both must be taken over or the shortcut is unusable.
        e.preventDefault()
        if (entry.path) {
          navigate(entry.path)
          return
        }
        if (entry.id === 'commandPalette') {
          openCommandPalette()
          return
        }
      }
    },
    [store, navigate],
  )

  useEffect(() => {
    store.attachListener(handleKeyDown)
    return () => store.detachListener()
  }, [store, handleKeyDown])

  const value = useMemo<KeyboardContextValue>(
    () => ({
      registerScope: store.registerScope,
      updateScope: store.updateScope,
      unregisterScope: store.unregisterScope,
      hasFormScope: store.hasFormScope,
    }),
    [store],
  )

  return <KeyboardContext.Provider value={value}>{children}</KeyboardContext.Provider>
}

export default KeyboardProvider
