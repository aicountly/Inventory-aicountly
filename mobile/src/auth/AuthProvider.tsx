/**
 * Auth state for the whole app: whether there's a signed-in session, and the
 * actions that change it. `src/app/_layout.tsx` reads `status` to decide
 * between the login screen and the rest of the app (see Stack.Protected
 * there); `src/app/login.tsx` and `src/app/auth/callback.tsx` are the two
 * places sign-in can complete from.
 */

import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react'

import { getAuthToken, clearSession } from './tokens'
import { ensureSesKey, signInWithPortal, completeSignInWithToken } from './portal'

export type AuthStatus = 'loading' | 'signedIn' | 'signedOut'

interface AuthContextValue {
  status: AuthStatus
  /** Reason the last sign-in attempt failed, if any. Cleared on the next attempt. */
  error: string | null
  signIn: () => Promise<void>
  completeSignInWithToken: (authToken: string | null | undefined, portalError?: string | null) => Promise<void>
  signOut: () => Promise<void>
}

const AuthContext = createContext<AuthContextValue | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<AuthStatus>('loading')
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false

    async function restore() {
      const token = await getAuthToken()
      if (!token) {
        if (!cancelled) setStatus('signedOut')
        return
      }
      try {
        await ensureSesKey()
        if (!cancelled) setStatus('signedIn')
      } catch {
        await clearSession()
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
    const result = await signInWithPortal()
    if (result.success) {
      setStatus('signedIn')
    } else {
      setError(result.error ?? 'Sign-in failed.')
    }
  }, [])

  const completeSignInFromCallback = useCallback(
    async (authToken: string | null | undefined, portalError?: string | null) => {
      setError(null)
      const result = await completeSignInWithToken(authToken, portalError)
      if (result.success) {
        setStatus('signedIn')
      } else {
        setError(result.error ?? 'Sign-in failed.')
        setStatus('signedOut')
      }
    },
    [],
  )

  const signOut = useCallback(async () => {
    await clearSession()
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
