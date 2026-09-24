/**
 * Build-time configuration.
 *
 * Metro inlines every EXPO_PUBLIC_* value into the JS bundle when the app is
 * built, the same way Vite inlines VITE_* for `web/` (see web/src/config.ts
 * and docs/DEPLOYMENT.md) — these are public values, never secrets.
 */

export const APP_NAME = (process.env.EXPO_PUBLIC_APP_NAME ?? 'Inventory').trim() || 'Inventory'

/** `local` | `sandbox` | `production` — set per EAS build profile (see eas.json). */
export const APP_ENV = (process.env.EXPO_PUBLIC_APP_ENV ?? 'local').trim() || 'local'

/**
 * Base URL of this product's own PHP API (server-php), e.g.
 * `https://inventory.gh.aicountly.com/api`.
 *
 * Unlike `web/`, the app has no same-origin host to fall back to, so this
 * must be set explicitly per build profile — there is no sane default.
 */
export function getApiBaseUrl(): string {
  const configured = (process.env.EXPO_PUBLIC_API_BASE_URL ?? '').trim()
  if (!configured) {
    throw new Error('EXPO_PUBLIC_API_BASE_URL is not set — see mobile/.env.example')
  }
  return configured.replace(/\/$/, '')
}

/**
 * Login portal origin (`my.aicountly.com` in production, `sandbox.aicountly.com`
 * otherwise). Login redirect only — see docs/auth/AICOUNTLY_AUTH_WORKFLOW.md.
 */
export function getPortalLoginUrl(): string {
  const configured = (process.env.EXPO_PUBLIC_PORTAL_LOGIN_URL ?? '').trim()
  return configured || 'https://sandbox.aicountly.com'
}

/** Portal `authentication_jump` product key — always "inventory" for this app. */
export const PRODUCT_KEY = 'inventory'

/** Custom URL scheme registered in app.json, used for the auth callback deep link. */
export const APP_SCHEME = 'inventory'
