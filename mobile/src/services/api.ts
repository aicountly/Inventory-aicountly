/**
 * Typed fetch wrapper for the Inventory API (server-php, `/api/...`), mirroring
 * web/src/services/api.ts so the two clients stay easy to cross-reference:
 *
 *  - `Authorization: Bearer <ses_key>`, minted on demand. A 401 is retried
 *    exactly once with a freshly minted key, since a key can be revoked
 *    server-side before its local expiry.
 *  - List responses are `{data: T[], meta: {total, limit, offset}}`, single
 *    resources `{data: T}`, and errors `{error: {code, message, details}, message}`;
 *    the latter become an `ApiError`.
 *
 * Company scope (`cmp_id`/`fy_id`/`bo_id`) is NOT wired in yet — there is no
 * mobile equivalent of web's CompanyProvider until a company/branch/financial
 * year switcher is built. Add it here, in one place, when that lands.
 */

import { getApiBaseUrl } from '../config'
import { ensureSesKey, ensureFreshSesKey } from '../auth/portal'

export type QueryValue = string | number | boolean | null | undefined
export type QueryParams = Record<string, QueryValue>

export interface ListMeta {
  total: number
  limit: number
  offset: number
  [key: string]: unknown
}

export interface ListResponse<T> {
  data: T[]
  meta: ListMeta
}

export interface ItemResponse<T> {
  data: T
}

export interface ApiErrorDetails {
  field?: string
  [key: string]: unknown
}

export class ApiError extends Error {
  readonly status: number
  readonly code: string
  readonly details: ApiErrorDetails | null

  constructor(status: number, code: string, message: string, details: ApiErrorDetails | null = null) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.code = code
    this.details = details
  }
}

export function isApiError(err: unknown): err is ApiError {
  return err instanceof ApiError
}

export function errorMessage(err: unknown, fallback = 'Something went wrong'): string {
  if (err instanceof Error && err.message) return err.message
  if (typeof err === 'string' && err) return err
  return fallback
}

/** Empty strings, null and undefined are dropped; booleans become 1/0. */
export function buildQueryString(params: QueryParams | undefined): string {
  if (!params) return ''
  const search = new URLSearchParams()
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === '') continue
    search.set(key, typeof value === 'boolean' ? (value ? '1' : '0') : String(value))
  }
  const qs = search.toString()
  return qs ? `?${qs}` : ''
}

interface RequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'
  query?: QueryParams
  body?: unknown
}

async function parseErrorBody(res: Response): Promise<ApiError> {
  let payload: { error?: { code?: string; message?: string; details?: ApiErrorDetails }; message?: string } = {}
  try {
    payload = await res.json()
  } catch {
    /* non-JSON error body */
  }
  const code = payload.error?.code ?? String(res.status)
  const message = payload.error?.message ?? payload.message ?? `HTTP ${res.status}`
  return new ApiError(res.status, code, message, payload.error?.details ?? null)
}

async function rawRequest(path: string, sesKey: string, options: RequestOptions): Promise<Response> {
  const url = `${getApiBaseUrl()}${path}${buildQueryString(options.query)}`
  return fetch(url, {
    method: options.method ?? 'GET',
    headers: {
      Authorization: `Bearer ${sesKey}`,
      ...(options.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
    },
    body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
  })
}

/** Core request function. `path` starts with `/`, e.g. `/v1/items`. */
export async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  let sesKey = await ensureSesKey()
  let res = await rawRequest(path, sesKey, options)

  if (res.status === 401) {
    // ensureSesKey() alone would hand back the exact same (already-rejected)
    // key: getSesKey() only checks the local expiry clock, which a
    // server-side revocation doesn't touch. Force a real re-mint instead.
    sesKey = await ensureFreshSesKey()
    res = await rawRequest(path, sesKey, options)
  }

  if (!res.ok) throw await parseErrorBody(res)
  return (await res.json()) as T
}

export function get<T>(path: string, query?: QueryParams): Promise<T> {
  return request<T>(path, { method: 'GET', query })
}

export function post<T>(path: string, body?: unknown): Promise<T> {
  return request<T>(path, { method: 'POST', body })
}

export function put<T>(path: string, body?: unknown): Promise<T> {
  return request<T>(path, { method: 'PUT', body })
}

export function del<T>(path: string): Promise<T> {
  return request<T>(path, { method: 'DELETE' })
}
