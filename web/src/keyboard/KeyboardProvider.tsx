import { useCallback, useEffect, useMemo, useRef } from 'react'
import type { ReactNode } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { useAccessOptional } from '../access/AccessContext'
import { KeyboardContext, createKeyboardStore } from './KeyboardContext'
import type { KeyboardContextValue } from './KeyboardContext'
import { isInOverlay, isTypingTarget } from './isTypingTarget'
import { matchShortcut } from './matchShortcut'
import { GLOBAL_SHORTCUTS, openCommandPalette } from './shortcutRegistry'
import {
  SEQUENCES_CHANGED_EVENT,
  SEQUENCE_SHORTCUTS,
  SEQUENCE_TIMEOUT_MS,
  isSequenceKey,
  openShortcutHelp,
  readSequencesEnabled,
  resolveSequence,
} from './sequences'

/**
 * One window keydown listener for the whole app.
 *
 * Scopes registered by `useKeyboardScope` are consulted in priority order
 * (palette → modal → form → page → global); the first matching binding wins
 * and nothing else runs. Only then are the app-wide shortcuts considered, so a
 * page can always shadow a global combo.
 *
 * Sequences (`G` then `1`) are considered LAST, after every scope and every
 * chord. That ordering is the point: a modal's own bindings, a form's Ctrl+S
 * and a page's `/` all get the key first, so a bare letter can never reach past
 * something the user is actually looking at. See sequences.ts for the rest of
 * the guards — typing targets, overlays, modifiers, auto-repeat and IME.
 */
export function KeyboardProvider({ children }: { children: ReactNode }) {
  const store = useMemo(() => createKeyboardStore(), [])
  const navigate = useNavigate()
  const location = useLocation()
  // KeyboardProvider mounts above AccessProvider, so permissions may genuinely
  // not exist yet. When they do not, no sequence runs — a shortcut that fires
  // before anyone knows whether the user may use it is the wrong default.
  const access = useAccessOptional()

  /** Keys typed so far in a half-finished sequence, and when the last one landed. */
  const pending = useRef<{ keys: string[]; at: number }>({ keys: [], at: 0 })
  const sequencesEnabled = useRef<boolean>(readSequencesEnabled())
  const accessRef = useRef(access)
  accessRef.current = access

  const resetSequence = useCallback(() => {
    pending.current = { keys: [], at: 0 }
  }, [])

  // The pending prefix must not survive anything that changes what the user is
  // looking at. A `G` typed before a click on another screen is not the first
  // half of anything.
  useEffect(() => {
    resetSequence()
  }, [location.pathname, location.search, resetSequence])

  useEffect(() => {
    const onBlur = () => resetSequence()
    const onVisibility = () => resetSequence()
    const onSequencesChanged = () => {
      sequencesEnabled.current = readSequencesEnabled()
      resetSequence()
    }
    window.addEventListener('blur', onBlur)
    document.addEventListener('visibilitychange', onVisibility)
    window.addEventListener(SEQUENCES_CHANGED_EVENT, onSequencesChanged)
    return () => {
      window.removeEventListener('blur', onBlur)
      document.removeEventListener('visibilitychange', onVisibility)
      window.removeEventListener(SEQUENCES_CHANGED_EVENT, onSequencesChanged)
    }
  }, [resetSequence])

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
          resetSequence()
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
        resetSequence()
        if (entry.path) {
          navigate(entry.path)
          return
        }
        if (entry.id === 'commandPalette') {
          openCommandPalette()
          return
        }
      }

      // ---- sequences ----------------------------------------------------
      // Everything below is inert while the user is typing, inside an overlay,
      // or has turned single-letter shortcuts off.
      if (!sequencesEnabled.current || typing || inOverlay) {
        resetSequence()
        return
      }

      // `?` opens the shortcut help. It is a single key rather than a sequence,
      // it needs Shift on most layouts, and it is checked before the a-z0-9
      // gate that `isSequenceKey` applies.
      if (e.key === '?' && !e.ctrlKey && !e.metaKey && !e.altKey && !e.repeat) {
        e.preventDefault()
        resetSequence()
        openShortcutHelp()
        return
      }

      if (!isSequenceKey(e)) {
        resetSequence()
        return
      }

      const now = Date.now()
      const expired = pending.current.keys.length > 0 && now - pending.current.at > SEQUENCE_TIMEOUT_MS
      const keys = expired ? [] : pending.current.keys
      const next = [...keys, e.key.toLowerCase()]

      // Permission is checked here, not only at render: a command nobody may run
      // must not run because it was typed rather than clicked.
      const acc = accessRef.current
      if (acc === null) {
        resetSequence()
        return
      }
      const permitted = SEQUENCE_SHORTCUTS.filter(
        (s) => acc.loading || !s.permissions || acc.can(s.permissions),
      )
      const outcome = resolveSequence(next, permitted)

      if (outcome.status === 'match') {
        // The only place a sequence takes the key from the browser: a real,
        // permitted command that is about to run.
        e.preventDefault()
        resetSequence()
        navigate(outcome.shortcut.path)
        return
      }
      if (outcome.status === 'prefix') {
        // Buffer it, but do NOT preventDefault — `G` on its own still belongs
        // to the page until the second key proves otherwise.
        pending.current = { keys: next, at: now }
        return
      }
      resetSequence()
    },
    [store, navigate, resetSequence],
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
