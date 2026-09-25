import { useEffect, useRef } from 'react'
import { ActivityIndicator, StyleSheet } from 'react-native'
import { router, useLocalSearchParams } from 'expo-router'
import { SafeAreaView } from 'react-native-safe-area-context'

import { useAuth } from '@/auth/AuthProvider'

/**
 * Where the portal redirects back to (see src/auth/portal.ts). Reachable
 * regardless of sign-in status — see the Stack.Screen for it in
 * src/app/_layout.tsx, outside both Stack.Protected blocks.
 *
 * `signInWithPortal()` already completes sign-in from the auth session's own
 * result in the common case; this screen exists for the redirect landing
 * here as a real navigation instead (the app was backgrounded during
 * sign-in, or the OS delivered the link rather than resolving the auth
 * session in place) — same outcome, different path to it.
 */
export default function AuthCallbackScreen() {
  const { auth_token: authToken, error, nonce } = useLocalSearchParams<{
    auth_token?: string
    error?: string
    nonce?: string
  }>()
  const { completeSignInWithToken } = useAuth()
  const handled = useRef(false)

  useEffect(() => {
    if (handled.current) return
    handled.current = true

    completeSignInWithToken(authToken ?? null, error ?? null, nonce ?? null).finally(() => {
      // Stack.Protected redirects to whichever screen the resulting status
      // actually allows — login again on failure, the dashboard on success.
      router.replace('/')
    })
  }, [authToken, error, nonce, completeSignInWithToken])

  return (
    <SafeAreaView style={styles.container}>
      <ActivityIndicator size="large" />
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
})
