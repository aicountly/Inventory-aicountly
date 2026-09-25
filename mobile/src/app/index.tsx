import { Pressable, StyleSheet, Text, View } from 'react-native'
import { Stack } from 'expo-router'

import { APP_ENV, APP_NAME } from '@/config'
import { useAuth } from '@/auth/AuthProvider'

export default function DashboardScreen() {
  const { signOut } = useAuth()

  return (
    <View style={styles.container}>
      <Stack.Screen options={{ title: APP_NAME }} />
      <Text style={styles.title}>{APP_NAME} — mobile scaffold</Text>
      <Text style={styles.subtitle}>Environment: {APP_ENV}</Text>
      <Text style={styles.hint}>
        Signed in. Items, warehouses, documents and reports are not built yet — this is still the
        placeholder for the real dashboard.
      </Text>

      <Pressable onPress={signOut} style={({ pressed }) => [styles.signOut, pressed && styles.signOutPressed]}>
        <Text style={styles.signOutLabel}>Sign out</Text>
      </Pressable>
    </View>
  )
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
    gap: 8,
  },
  title: {
    fontSize: 20,
    fontWeight: '600',
  },
  subtitle: {
    fontSize: 14,
    color: '#666',
  },
  hint: {
    marginTop: 16,
    fontSize: 13,
    color: '#888',
    textAlign: 'center',
  },
  signOut: {
    marginTop: 32,
    paddingVertical: 12,
    paddingHorizontal: 24,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: '#dc2626',
  },
  signOutPressed: {
    backgroundColor: '#fef2f2',
  },
  signOutLabel: {
    color: '#dc2626',
    fontWeight: '600',
  },
})
