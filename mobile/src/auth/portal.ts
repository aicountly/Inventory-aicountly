/**
 * Minting a `ses_key` from an `auth_token`, mirroring web/src/auth/portal.ts's
 * `ensureSesKey`. See docs/auth/AICOUNTLY_AUTH_WORKFLOW.md.
 *
 * This is the second half of sign-in only. Getting the `auth_token` in the
 * first place — the interactive portal login — is not implemented yet; see
 * the TODO in src/auth/tokens.ts. Call `ensureSesKey()` only after an
 * `auth_token` already exists in SecureStore.
 *
 * Unlike web/, there is no CORS to route around here — native requests are
 * not subject to it — but this still calls the same server-php relay
 * (`/global/seskey`) so both apps mint sessions the same way and show up the
 * same way in the API's logs.
 */

import { getApiBaseUrl } from '../config'
import { getAuthToken, getSesKey, setSesKey, clearSession } from './tokens'

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
