import { useEffect } from 'react'
import { Stack } from 'expo-router'
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context'
import { StatusBar } from 'expo-status-bar'
import { ActivityIndicator, StyleSheet } from 'react-native'
import * as SplashScreen from 'expo-splash-screen'

import { AuthProvider, useAuth } from '@/auth/AuthProvider'

SplashScreen.preventAutoHideAsync().catch(() => {
  /* already hidden, or the module isn't ready yet — either way, ignore */
})

export default function RootLayout() {
  return (
    <SafeAreaProvider>
      <StatusBar style="auto" />
      <AuthProvider>
        <RootNavigator />
      </AuthProvider>
    </SafeAreaProvider>
  )
}

function RootNavigator() {
  const { status } = useAuth()

  useEffect(() => {
    if (status !== 'loading') {
      SplashScreen.hideAsync().catch(() => {})
    }
  }, [status])

  if (status === 'loading') {
    return (
      <SafeAreaView style={styles.loading}>
        <ActivityIndicator size="large" />
      </SafeAreaView>
    )
  }

  return (
    <Stack screenOptions={{ headerTitleAlign: 'center' }}>
      <Stack.Protected guard={status === 'signedOut'}>
        <Stack.Screen name="login" options={{ headerShown: false }} />
      </Stack.Protected>
      <Stack.Protected guard={status === 'signedIn'}>
        <Stack.Screen name="index" />
      </Stack.Protected>
      {/* Reachable regardless of status — it's the transition screen sign-in lands on. */}
      <Stack.Screen name="auth/callback" options={{ headerShown: false }} />
    </Stack>
  )
}

const styles = StyleSheet.create({
  loading: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
})
