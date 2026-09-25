/**
 * Auth state for the whole app: whether there's a signed-in session, and the
 * actions that change it. `src/app/_layout.tsx` reads `status` to decide
 * between the login screen and the rest of the app (see Stack.Protected
 * there); `src/app/login.tsx` and `src/app/auth/callback.tsx` are the two
 * places sign-in can complete from.
 */

import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react'

import { clearSession, getAuthToken, onForcedSignOut } from './tokens'
import { AuthError, completeSignInWithToken, ensureSesKey, signInWithPortal } from './portal'

export type AuthStatus = 'loading' | 'signedIn' | 'signedOut'

interface AuthContextValue {
  status: AuthStatus
  /** Reason the last sign-in attempt failed, if any. Cleared on the next attempt. */
  error: string | null
  signIn: () => Promise<void>
  completeSignInWithToken: (
    authToken: string | null | undefined,
    portalError?: string | null,
    nonce?: string | null,
  ) => Promise<void>
  signOut: () => Promise<void>
}

const AuthContext = createContext<AuthContextValue | null>(null)

/** Only a confirmed-dead credential (401) should wipe a still-possibly-valid auth_token. */
function isConfirmedInvalid(err: unknown): boolean {
  return err instanceof AuthError && err.status === 401
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<AuthStatus>('loading')
  const [error, setError] = useState<string | null>(null)

  // mintSesKey() (portal.ts) can discover the session is dead from deep
  // inside a plain API call with no React context of its own — it calls
  // forceSignOut() there, and this is the other half: however state ends up
  // signed out, `status` follows it instead of the UI staying on a
  // now-credential-less screen.
  useEffect(() => {
    onForcedSignOut(() => setStatus('signedOut'))
    return () => onForcedSignOut(null)
  }, [])

  useEffect(() => {
    let cancelled = false

    async function restore() {
      try {
        const token = await getAuthToken()
        if (!token) {
          if (!cancelled) setStatus('signedOut')
          return
        }
        try {
          await ensureSesKey()
          if (!cancelled) setStatus('signedIn')
        } catch (err) {
          // A transient network/server error here shouldn't cost the user
          // their session — only clear storage once the auth_token itself is
          // confirmed dead. Either way `status` must resolve to something:
          // this app launch just doesn't get to start out signed in.
          if (isConfirmedInvalid(err)) await clearSession()
          if (!cancelled) setStatus('signedOut')
        }
      } catch {
        // getAuthToken() itself failed (SecureStore unavailable) — fail
        // closed to signedOut rather than leaving `status` stuck at
        // 'loading' forever with no way to ever reach the login screen.
        if (!cancelled) setStatus('signedOut')
      }
    }

    restore()
    return () => {
      cancelled = true
    }
  }, [])

  const signIn = useCallback(async () => {
    setError(null)
    try {
      const result = await signInWithPortal()
      if (result.success) {
        setStatus('signedIn')
      } else {
        setError(result.error ?? 'Sign-in failed.')
      }
    } catch {
      setError('Something went wrong while signing in.')
    }
  }, [])

  const completeSignInFromCallback = useCallback(
    async (authToken: string | null | undefined, portalError?: string | null, nonce?: string | null) => {
      setError(null)
      try {
        const result = await completeSignInWithToken(authToken, portalError, nonce)
        if (result.success) {
          setStatus('signedIn')
        } else {
          setError(result.error ?? 'Sign-in failed.')
          setStatus('signedOut')
        }
      } catch {
        setError('Something went wrong while signing in.')
        setStatus('signedOut')
      }
    },
    [],
  )

  const signOut = useCallback(async () => {
    try {
      await clearSession()
    } catch {
      // Best-effort: even if the SecureStore delete failed, don't leave the
      // user stuck on an authenticated screen with no way to sign out.
    }
    setError(null)
    setStatus('signedOut')
  }, [])

  return (
    <AuthContext.Provider
      value={{ status, error, signIn, completeSignInWithToken: completeSignInFromCallback, signOut }}
    >
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth() must be used within <AuthProvider>')
  return ctx
}
