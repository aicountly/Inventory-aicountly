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

import { getApiBaseUrl, getPortalLoginUrl, PRODUCT_KEY } from '../config'
import { getAuthToken, getSesKey, setSesKey, setAuthToken, clearSession } from './tokens'

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

  const res = await fetch(`${getApiBaseUrl()}/global/seskey`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${authToken}` },
  })

  if (!res.ok) {
    const body = await res.text().catch(() => '')
    if (res.status === 401) await clearSession()
    throw new AuthError(body || `HTTP ${res.status}`, res.status)
  }

  const data = (await res.json()) as SesKeyResponse
  const key = data.ses_key ?? data.sesKey ?? data.token ?? data.access_token
  if (!key) {
    throw new AuthError('The auth service returned no session key.', 200)
  }

  setSesKey(key)
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

// ---------------------------------------------------------------------------
// Interactive sign-in
// ---------------------------------------------------------------------------

export interface SignInResult {
  success: boolean
  /** Human-readable reason, set only when `success` is false. */
  error?: string
}

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
): Promise<SignInResult> {
  if (portalError) {
    return { success: false, error: `The portal reported: ${portalError}` }
  }
  if (!authToken) {
    return { success: false, error: 'No auth token was returned by the portal.' }
  }

  await setAuthToken(authToken)
  try {
    await ensureSesKey()
  } catch (err) {
    await clearSession()
    return { success: false, error: err instanceof AuthError ? err.message : 'Could not start a session.' }
  }
  return { success: true }
}

/**
 * Opens the portal's login page in a system auth session
 * (ASWebAuthenticationSession on iOS, Custom Tabs on Android) and waits for
 * it to redirect back to this app. The app never sees a password — only the
 * `auth_token` the portal puts on the redirect.
 */
export async function signInWithPortal(): Promise<SignInResult> {
  const redirectUrl = Linking.createURL('/auth/callback')
  const loginUrl =
    `${getPortalLoginUrl()}/login/authentication_jump/${PRODUCT_KEY}` +
    `?${new URLSearchParams({ returnUrl: redirectUrl }).toString()}`

  let result: WebBrowser.WebBrowserAuthSessionResult
  try {
    result = await WebBrowser.openAuthSessionAsync(loginUrl, redirectUrl)
  } catch {
    return { success: false, error: 'Could not open the sign-in page.' }
  }

  if (result.type === 'cancel' || result.type === 'dismiss') {
    return { success: false, error: 'Sign-in was cancelled.' }
  }
  if (result.type !== 'success' || !result.url) {
    return { success: false, error: 'Sign-in did not complete.' }
  }

  const { queryParams } = Linking.parse(result.url)
  const authToken = typeof queryParams?.auth_token === 'string' ? queryParams.auth_token : null
  const portalError = typeof queryParams?.error === 'string' ? queryParams.error : null
  return completeSignInWithToken(authToken, portalError)
}
