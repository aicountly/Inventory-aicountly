/**
 * Token storage for the two-token AICOUNTLY model (see
 * docs/auth/AICOUNTLY_AUTH_WORKFLOW.md and web/src/auth/tokens.ts for the
 * web equivalent).
 *
 * | Token        | Lifetime    | Storage                    | Use                           |
 * |--------------|-------------|----------------------------|--------------------------------|
 * | `auth_token` | Long-lived  | SecureStore (Keychain/KeyStore) | Mint / refresh a `ses_key` |
 * | `ses_key`    | ~15 minutes | Memory only                | `Bearer` on product API calls |
 *
 * `web/` persists `auth_token` in `localStorage` plus a shared `.aicountly.com`
 * cookie so a browser session carries across every AICOUNTLY product. Neither
 * concept exists on mobile — there is no shared cookie jar between apps — so
 * this app keeps its own `auth_token` in SecureStore and signs in independently
 * per install. `ses_key` still never touches persistent storage.
 *
 * TODO(mobile-auth): this module only stores tokens once obtained. Getting the
 * `auth_token` in the first place — the portal login round trip — is not yet
 * implemented and needs portal-side coordination:
 *   - `web/` redirects the full page to
 *     `{portal}/login/authentication_jump/inventory?returnUrl=...`; a mobile
 *     app instead opens that URL with `expo-web-browser`'s
 *     `openAuthSessionAsync` (ASWebAuthenticationSession on iOS, Custom Tabs
 *     on Android).
 *   - The portal needs a `returnUrl` it will redirect back to that this app's
 *     custom scheme can catch, e.g. `inventory://auth/callback?auth_token=...`
 *     (see APP_SCHEME in src/config.ts and the "scheme" field in app.json).
 *     Confirm with whoever owns my.aicountly.com whether a non-https
 *     `returnUrl` is accepted before building the screen around it.
 */

import * as SecureStore from 'expo-secure-store'

const AUTH_TOKEN_KEY = 'auth_token'

// ---------- auth_token ----------

export async function setAuthToken(token: string | null): Promise<void> {
  if (token) {
    await SecureStore.setItemAsync(AUTH_TOKEN_KEY, token)
  } else {
    await SecureStore.deleteItemAsync(AUTH_TOKEN_KEY)
  }
}

export async function getAuthToken(): Promise<string | null> {
  return SecureStore.getItemAsync(AUTH_TOKEN_KEY)
}

// ---------- ses_key ----------

let sesKey: string | null = null
let sesKeyExpiresAt = 0

/** ~15 minutes, matching the portal-issued lifetime; refreshed a minute early. */
const SES_KEY_LIFETIME_MS = 14 * 60 * 1000

export function setSesKey(key: string | null): void {
  sesKey = key || null
  sesKeyExpiresAt = key ? Date.now() + SES_KEY_LIFETIME_MS : 0
}

export function getSesKey(): string | null {
  if (!sesKey) return null
  if (Date.now() >= sesKeyExpiresAt) return null
  return sesKey
}

export async function clearSession(): Promise<void> {
  setSesKey(null)
  await setAuthToken(null)
}
