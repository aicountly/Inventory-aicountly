/**
 * Cross-app link builder into Aicountly Books.
 *
 * Books already links INTO Inventory this way — see `buildInventoryAppLink()` /
 * `INVENTORY_APP_PATHS` in books-react-app's `web/src/services/inventoryApi.js` — for
 * retired master screens: a plain URL carrying `cmp_id` / `fy_id` / `bo_id` as query
 * params, no token, opened with `window.open(url, '_blank', 'noopener,noreferrer')`.
 * Identity travels via the shared `.aicountly.com` `auth_token` cookie (see
 * `web/src/auth/sharedAuthCookie.ts`), not via the URL, so a Books screen reached this
 * way is gated by Books' own permission checks like any other page a signed-in user opens.
 *
 * This is the reverse direction: Inventory linking OUT to a Books screen (e.g. the
 * COGS-revision-audit report). Same shape — origin + path + plain query params — with
 * the origin resolved from the shared app catalog (`config/aicountlyApps.ts`) rather
 * than a new one invented for this file.
 */

import { getAppById, resolveAppOrigin } from './appLauncher'
import { isSandboxHost } from '../auth/hostnames'

const BOOKS_APP_ID = 'books'

/** Fallback hosts, used only if the catalog is ever missing the `books` entry. */
export const BOOKS_APP_SANDBOX = 'https://books.gh.aicountly.com'
export const BOOKS_APP_PRODUCTION = 'https://books.aicountly.com'

function trimEnvUrl(value: string | undefined): string {
  if (typeof value !== 'string') return ''
  return value.trim().replace(/\/+$/, '')
}

/**
 * Books SPA origin (no trailing slash). `VITE_BOOKS_APP_URL` wins; otherwise the
 * sandbox / production host comes from the shared app catalog's `books` entry
 * (config/aicountlyApps.ts), the same catalog the launcher and CompanySwitcher use.
 */
export function getBooksAppUrl(sandbox: boolean = isSandboxHost()): string {
  const explicit = trimEnvUrl(import.meta.env.VITE_BOOKS_APP_URL)
  if (explicit) return explicit
  const app = getAppById(BOOKS_APP_ID)
  if (app) return resolveAppOrigin(app, sandbox)
  return sandbox ? BOOKS_APP_SANDBOX : BOOKS_APP_PRODUCTION
}

/**
 * Deep link into Books. Query params are written exactly as given (`cmpId` stays
 * `cmpId`, not snake_cased) — the caller passes whatever the target Books screen reads.
 *
 * @param path e.g. '/reports/cogs-revision-audit'
 * @param params e.g. { cmpId: run.cmp_id, fyId: run.fy_id }
 */
export function buildBooksAppLink(path: string, params: Record<string, string | number> = {}): string {
  let p = String(path || '/')
  if (!p.startsWith('/')) p = `/${p}`

  const search = new URLSearchParams()
  for (const [key, value] of Object.entries(params || {})) {
    if (value === undefined || value === null || value === '') continue
    search.set(key, String(value))
  }
  const qs = search.toString()

  return `${getBooksAppUrl()}${p}${qs ? `?${qs}` : ''}`
}
