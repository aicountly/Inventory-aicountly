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
 * The portal login round trip itself — opening the portal, getting the
 * `auth_token` back — lives in src/auth/portal.ts (`signInWithPortal`), not
 * here. This module only ever stores what that flow hands it.
 *
 * NOTE: this app's `inventory://` redirect only works once the portal's own
 * ProductRegistry (aicountly/my-aicountly-com,
 * web/app/Libraries/ProductRegistry.php) has an `inventory` entry with
 * `'schemes' => ['inventory']`, the same way `books` has `aicountlybooks`
 * registered. Until that ships, the portal doesn't recognize our scheme as
 * belonging to `inventory`, so `productCallbackUrl()` there silently falls
 * back to the default web callback (a normal https URL, e.g.
 * https://inventory.gh.aicountly.com/auth/callback) instead of rejecting
 * the request — the auth session
 * follows that redirect inside the in-app browser instead of returning to
 * this app, and `openAuthSessionAsync()` ends up resolving as a cancel or
 * dismiss once the user closes it. It looks like "sign-in was cancelled";
 * it's actually this registration gap.
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
