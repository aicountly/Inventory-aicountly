import { useState } from 'react'
import { ActivityIndicator, Image, Pressable, StyleSheet, Text, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'

import { useAuth } from '@/auth/AuthProvider'
import { APP_NAME } from '@/config'

export default function LoginScreen() {
  const { signIn, error } = useAuth()
  const [signingIn, setSigningIn] = useState(false)

  async function handlePress() {
    setSigningIn(true)
    try {
      await signIn()
    } finally {
      setSigningIn(false)
    }
  }

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.content}>
        <Image source={require('../../assets/icon.png')} style={styles.icon} resizeMode="contain" />

        <Text style={styles.title}>{APP_NAME}</Text>
        <Text style={styles.subtitle}>by Aicountly</Text>

        <Text style={styles.tagline}>
          Sign in with your Aicountly account to manage stock, warehouses and documents on the go.
        </Text>
      </View>

      <View style={styles.bottom}>
        {error ? <Text style={styles.error}>{error}</Text> : null}

        <Pressable
          onPress={handlePress}
          disabled={signingIn}
          style={({ pressed }) => [styles.button, (pressed || signingIn) && styles.buttonPressed]}
        >
          {signingIn ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text style={styles.buttonLabel}>Continue with Aicountly</Text>
          )}
        </Pressable>

        <Text style={styles.helper}>You&apos;ll be redirected to your organization&apos;s sign-in page, then back to the app.</Text>
      </View>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'space-between',
    padding: 24,
  },
  content: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  icon: {
    width: 120,
    height: 120,
    marginBottom: 16,
  },
  title: {
    fontSize: 32,
    fontWeight: '700',
    color: '#0f172a',
  },
  subtitle: {
    fontSize: 16,
    color: '#64748b',
    marginBottom: 12,
  },
  tagline: {
    fontSize: 15,
    color: '#64748b',
    textAlign: 'center',
    lineHeight: 22,
    paddingHorizontal: 16,
  },
  bottom: {
    gap: 12,
  },
  error: {
    color: '#dc2626',
    fontSize: 14,
    textAlign: 'center',
  },
  button: {
    backgroundColor: '#2563eb',
    borderRadius: 28,
    paddingVertical: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  buttonPressed: {
    opacity: 0.85,
  },
  buttonLabel: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '700',
  },
  helper: {
    fontSize: 12,
    color: '#94a3b8',
    textAlign: 'center',
  },
})
