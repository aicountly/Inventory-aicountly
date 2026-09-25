/**
 * Portal SSO for the mobile app: opening the login page and minting a
 * `ses_key` from the `auth_token` it hands back. See
 * docs/auth/AICOUNTLY_AUTH_WORKFLOW.md for the shape web/ follows; this is
 * the same contract with a native front door.
 *
 * The redirect target is this app's own `inventory://` scheme (see
 * "scheme" in app.json). That scheme has to be registered against the
 * `inventory` product key in the portal's own `ProductRegistry`
 * (aicountly/my-aicountly-com, web/app/Libraries/ProductRegistry.php) the
 * same way `aicountlybooks` is registered for Books — otherwise the portal
 * has no product to hand the auth_token to and this flow fails at the
 * portal, not here. That registry change is out of this repo and needs the
 * portal owner's sign-off before it ships.
 *
 * Unlike web/, there is no CORS to route around here — native requests are
 * not subject to it — but this still calls the same server-php relay
 * (`/global/seskey`) so both apps mint sessions the same way and show up the
 * same way in the API's logs.
 */

import * as WebBrowser from 'expo-web-browser'
import * as Linking from 'expo-linking'
import * as Crypto from 'expo-crypto'

import { getApiBaseUrl, getPortalLoginUrl, PRODUCT_KEY } from '../config'
import {
  getAuthToken,
  getSesKey,
  setSesKey,
  clearSesKey,
  currentSessionGeneration,
  setAuthToken,
  clearSession,
  forceSignOut,
} from './tokens'

export class AuthError extends Error {
  readonly status: number
  constructor(message: string, status: number) {
    super(message)
    this.name = 'AuthError'
    this.status = status
  }
}

interface SesKeyResponse {
  ses_key?: string
  sesKey?: string
  token?: string
  access_token?: string
}

async function mintSesKey(): Promise<string> {
  const authToken = await getAuthToken()
  if (!authToken) {
    throw new AuthError('No auth token — sign in again.', 401)
  }

  // Captured before the request goes out: if a sign-out runs while this is in
  // flight, the generation moves on and the result below is stale — it still
  // resolves for whichever caller awaited it, but it must not repopulate the
  // shared ses_key cache after the world has already moved past it.
  const generation = currentSessionGeneration()

  const res = await fetch(`${getApiBaseUrl()}/global/seskey`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${authToken}` },
  })

  if (!res.ok) {
    const body = await res.text().catch(() => '')
    // The auth_token itself was rejected — not a transient/server error, a
    // dead credential. forceSignOut() (not clearSession()) so AuthProvider's
    // `status` actually reflects it instead of leaving a signed-in screen up
    // with nothing behind it.
    if (res.status === 401) await forceSignOut()
    throw new AuthError(body || `HTTP ${res.status}`, res.status)
  }

  const data = (await res.json()) as SesKeyResponse
  const key = data.ses_key ?? data.sesKey ?? data.token ?? data.access_token
  if (!key) {
    throw new AuthError('The auth service returned no session key.', 200)
  }

  if (currentSessionGeneration() === generation) {
    setSesKey(key)
  }
  return key
}

let mintInFlight: Promise<string> | null = null

/** A valid ses_key, minting one from the stored auth_token when needed. */
export async function ensureSesKey(): Promise<string> {
  const existing = getSesKey()
  if (existing) return existing

  if (!mintInFlight) {
    mintInFlight = mintSesKey().finally(() => {
      mintInFlight = null
    })
  }
  return mintInFlight
}

/**
 * Forces a real re-mint instead of the cached (possibly already-rejected)
 * ses_key — for a caller that just got a 401 from a product API and needs to
 * know whether that means "key expired, mint a new one" or "auth_token itself
 * is dead" (see src/services/api.ts's retry-once-on-401).
 */
export async function ensureFreshSesKey(): Promise<string> {
  clearSesKey()
  return ensureSesKey()
}

// ---------------------------------------------------------------------------
// Interactive sign-in
// ---------------------------------------------------------------------------

export interface SignInResult {
  success: boolean
  /** Human-readable reason, set only when `success` is false. */
  error?: string
}

/**
 * Single-use nonce for the in-flight sign-in attempt, if any. Verified in
 * completeSignInWithToken() before an auth_token is trusted — otherwise
 * `/auth/callback` (src/app/auth/callback.tsx) is reachable by construction
 * regardless of app state (see its own comment) and would otherwise accept an
 * auth_token from *any* caller of `inventory://auth/callback?auth_token=...`,
 * not just this app's own sign-in attempt — a login-CSRF / token-injection
 * hole. Embedding it in the returnUrl itself (rather than relying on the
 * portal's separate `state` echo) means no portal-side change beyond the
 * scheme registration is needed for this to work.
 */
let pendingNonce: string | null = null

/**
 * Finishes sign-in once the portal has handed back an `auth_token` (or an
 * error) on this app's callback route — called from both the direct
 * `signInWithPortal()` result and the `/auth/callback` screen, so a cold
 * launch via the redirect (the app was backgrounded during sign-in, or the
 * OS delivered the link instead of resolving the auth session in place)
 * completes sign-in the same way a same-session redirect does.
 */
export async function completeSignInWithToken(
  authToken: string | null | undefined,
  portalError?: string | null,
  nonce?: string | null,
): Promise<SignInResult> {
  const expectedNonce = pendingNonce
  // Single-use either way, so a replayed or duplicate callback can't reuse it.
  pendingNonce = null

  if (portalError) {
    return { success: false, error: `The portal reported: ${portalError}` }
  }
  if (!authToken) {
    return { success: false, error: 'No auth token was returned by the portal.' }
  }
  if (!expectedNonce || nonce !== expectedNonce) {
    // No sign-in this app instance started, or it doesn't match one still
    // pending — most likely the app was killed and relaunched by the
    // redirect (the in-memory nonce doesn't survive that) rather than an
    // actual attack, but there's no way to tell those apart from here, and
    // asking a real user to retry sign-in is far cheaper than trusting an
    // unverified auth_token from an arbitrary external deep link.
    return { success: false, error: 'This sign-in link is no longer valid. Please try signing in again.' }
  }

  try {
    await setAuthToken(authToken)
  } catch {
    return { success: false, error: 'Could not save the sign-in — try again.' }
  }

  try {
    await ensureSesKey()
  } catch (err) {
    // Only a confirmed-dead credential warrants wiping what we just saved —
    // a transient network/server error right after login shouldn't force the
    // user through the whole portal flow again.
    if (err instanceof AuthError && err.status === 401) {
      await clearSession()
    }
    return { success: false, error: err instanceof AuthError ? err.message : 'Could not start a session.' }
  }
  return { success: true }
}

/**
 * Opens the portal's login page in a system auth session
 * (ASWebAuthenticationSession on iOS, Custom Tabs on Android) and waits for
 * it to redirect back to this app. The app never sees a password — only the
 * `auth_token` the portal puts on the redirect.
 *
 * KNOWN LIMITATION (not fixed here — needs infra, not code): `inventory://`
 * is a bare custom URL scheme. On iOS, ASWebAuthenticationSession binds the
 * redirect to this specific call, so another app registering the same scheme
 * can't intercept it. Android has no equivalent — the redirect goes through
 * the OS's ordinary intent-filter dispatch, and a malicious app declaring the
 * same scheme would at minimum trigger a disambiguation prompt, or worse on
 * some OEM configurations. The nonce check above stops such an app from
 * feeding a token *into* this app, but not from capturing a genuine
 * `auth_token` in transit and using it directly against `/global/seskey`
 * itself. Closing that needs a verified Android App Link (a real
 * https-based, domain-verified intent filter) in place of the bare scheme —
 * a follow-up, not part of this change.
 */
export async function signInWithPortal(): Promise<SignInResult> {
  const nonce = Crypto.randomUUID()
  pendingNonce = nonce
  // Linking.createURL('/auth/callback') resolves to `inventory:///auth/callback`
  // in a real build (empty authority, so expo-router reads it as path
  // `/auth/callback` — see the comment on ProductRegistry::appSchemeOf() in
  // the portal repo, which documents the same shape for Books). Baking the
  // nonce into that same URL means it round-trips back with the portal's
  // response params attached, with nothing extra required on the portal side.
  const redirectUrl = Linking.createURL('/auth/callback', { queryParams: { nonce } })
  const loginUrl =
    `${getPortalLoginUrl()}/login/authentication_jump/${PRODUCT_KEY}` +
    `?${new URLSearchParams({ returnUrl: redirectUrl }).toString()}`

  let result: WebBrowser.WebBrowserAuthSessionResult
  try {
    result = await WebBrowser.openAuthSessionAsync(loginUrl, redirectUrl)
  } catch {
    pendingNonce = null
    return { success: false, error: 'Could not open the sign-in page.' }
  }

  if (result.type === 'cancel' || result.type === 'dismiss') {
    pendingNonce = null
    return { success: false, error: 'Sign-in was cancelled.' }
  }
  if (result.type !== 'success' || !result.url) {
    pendingNonce = null
    return { success: false, error: 'Sign-in did not complete.' }
  }

  const { queryParams } = Linking.parse(result.url)
  const authToken = typeof queryParams?.auth_token === 'string' ? queryParams.auth_token : null
  const portalError = typeof queryParams?.error === 'string' ? queryParams.error : null
  const returnedNonce = typeof queryParams?.nonce === 'string' ? queryParams.nonce : null
  return completeSignInWithToken(authToken, portalError, returnedNonce)
}
