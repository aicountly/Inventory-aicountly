import { StyleSheet, Text, View } from 'react-native'
import { Stack } from 'expo-router'

import { APP_ENV, APP_NAME } from '@/config'

export default function DashboardScreen() {
  return (
    <View style={styles.container}>
      <Stack.Screen options={{ title: APP_NAME }} />
      <Text style={styles.title}>{APP_NAME} — mobile scaffold</Text>
      <Text style={styles.subtitle}>Environment: {APP_ENV}</Text>
      <Text style={styles.hint}>
        Sign-in is not wired up yet — see the TODO in src/auth/tokens.ts.{'\n'}
        This screen is the placeholder for the dashboard once it is.
      </Text>
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
})
