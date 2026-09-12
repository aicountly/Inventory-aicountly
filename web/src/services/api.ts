/**
 * Typed fetch wrapper for the Inventory API (server-php, `/api/...`).
 *
 * Conventions it encodes so pages do not have to:
 *
 *  - `Authorization: Bearer <ses_key>` from the portal session, minted on demand.
 *    A 401 is retried exactly once with a freshly minted key, because a key can
 *    be revoked server-side before its local expiry.
 *  - Company context (`cmp_id`, `fy_id`, `bo_id`) is injected into every call
 *    from the scope registered by CompanyProvider — as query parameters on all
 *    verbs and, for JSON bodies, into the body as well. `bo_id` 0 = consolidated.
 *  - List responses are `{data: T[], meta: {total, limit, offset}}`, single
 *    resources `{data: T}`, and errors `{error: {code, message, details}, message}`;
 *    the latter become an `ApiError`.
 *
 * The Manage relay (`/manage/...`) and other context-free calls pass `scope: false`.
 */

import { getApiBaseUrl } from '../config'
import { ensureSesKey } from '../auth/portal'
import { clearSession } from '../auth/tokens'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type QueryValue = string | number | boolean | null | undefined
export type QueryParams = Record<string, QueryValue>

/** Company / financial year / branch every scoped request carries. */
export interface CompanyScope {
  cmp_id: number
  fy_id: number
  /** 0 = consolidated (all branches). */
  bo_id: number
  /** Portal access type for the company when known: 1 owner, 0 delegated. */
  acs_type?: 0 | 1 | null
}

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

export type SortOrder = 'asc' | 'desc'

/** Parameters every list endpoint understands (BaseController::listParams). */
export interface ListQuery extends QueryParams {
  q?: string
  limit?: number
  offset?: number
  page?: number
  sort?: string
  order?: SortOrder
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

  /** Name of the form field the server blamed, when it said. */
  get field(): string | null {
    const f = this.details?.field
    return typeof f === 'string' && f !== '' ? f : null
  }
}

export function isApiError(err: unknown): err is ApiError {
  return err instanceof ApiError
}

/** Human-readable message for any thrown value. */
export function errorMessage(err: unknown, fallback = 'Something went wrong'): string {
  if (err instanceof Error && err.message) return err.message
  if (typeof err === 'string' && err) return err
  return fallback
}

// ---------------------------------------------------------------------------
// Pure helpers (unit-tested)
// ---------------------------------------------------------------------------

/**
 * Serialise query parameters. Empty strings, null and undefined are dropped so a
 * cleared filter disappears from the URL instead of sending `?brand_id=`.
 * Booleans become 1/0 because the API casts flags with `(int)`.
 */
export function buildQueryString(params: QueryParams | undefined): string {
  if (!params) return ''
  const search = new URLSearchParams()
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === '') continue
    if (typeof value === 'boolean') {
      search.set(key, value ? '1' : '0')
    } else {
      search.set(key, String(value))
    }
  }
  const s = search.toString()
  return s ? `?${s}` : ''
}

export function offsetForPage(page: number, limit: number): number {
  const p = Number.isFinite(page) && page > 1 ? Math.floor(page) : 1
  const l = Number.isFinite(limit) && limit > 0 ? Math.floor(limit) : 1
  return (p - 1) * l
}

export function pageForOffset(offset: number, limit: number): number {
  const o = Number.isFinite(offset) && offset > 0 ? Math.floor(offset) : 0
  const l = Number.isFinite(limit) && limit > 0 ? Math.floor(limit) : 1
  return Math.floor(o / l) + 1
}

export function pageCount(total: number, limit: number): number {
  const t = Number.isFinite(total) && total > 0 ? Math.floor(total) : 0
  const l = Number.isFinite(limit) && limit > 0 ? Math.floor(limit) : 1
  return Math.max(1, Math.ceil(t / l))
}

/** 1-based "from – to" of the rows on the current page; `{from: 0, to: 0}` when empty. */
export function pageRange(meta: Pick<ListMeta, 'total' | 'limit' | 'offset'>): { from: number; to: number } {
  if (meta.total <= 0) return { from: 0, to: 0 }
  const from = Math.min(meta.total, meta.offset + 1)
  const to = Math.min(meta.total, meta.offset + meta.limit)
  return { from, to }
}

interface ErrorEnvelope {
  error?: { code?: unknown; message?: unknown; details?: unknown }
  message?: unknown
  messages?: unknown
}

/** Turn a non-2xx response body into an ApiError, tolerating the legacy shapes. */
export function parseErrorBody(status: number, body: unknown, fallbackMessage = `HTTP ${status}`): ApiError {
  if (body && typeof body === 'object') {
    const env = body as ErrorEnvelope
    const nested = env.error && typeof env.error === 'object' ? env.error : null
    const code = typeof nested?.code === 'string' && nested.code ? nested.code : defaultCode(status)
    let message = typeof nested?.message === 'string' && nested.message ? nested.message : ''
    if (!message && typeof env.message === 'string') message = env.message
    if (!message && env.messages && typeof env.messages === 'object') {
      // CI4 validation shape: {messages: {field: 'error'}}
      message = Object.values(env.messages as Record<string, unknown>)
        .map((v) => (typeof v === 'string' ? v : ''))
        .filter(Boolean)
        .join(' ')
    }
    const details = nested?.details && typeof nested.details === 'object' ? (nested.details as ApiErrorDetails) : null
    return new ApiError(status, code, message || fallbackMessage, details)
  }
  if (typeof body === 'string' && body.trim()) {
    return new ApiError(status, defaultCode(status), body.trim().slice(0, 500))
  }
  return new ApiError(status, defaultCode(status), fallbackMessage)
}

function defaultCode(status: number): string {
  switch (status) {
    case 400:
      return 'bad_request'
    case 401:
      return 'unauthorized'
    case 403:
      return 'forbidden'
    case 404:
      return 'not_found'
    case 409:
      return 'conflict'
    case 422:
      return 'validation_failed'
    default:
      return status >= 500 ? 'server_error' : 'error'
  }
}

/** Merge the company scope into a JSON body when the body is a plain object. */
export function withScopeInBody(body: unknown, scope: CompanyScope | null): unknown {
  if (!scope || !body || typeof body !== 'object' || Array.isArray(body)) return body
  return { cmp_id: scope.cmp_id, fy_id: scope.fy_id, bo_id: scope.bo_id, ...(body as Record<string, unknown>) }
}

export function scopeToQuery(scope: CompanyScope | null): QueryParams {
  if (!scope) return {}
  const q: QueryParams = { cmp_id: scope.cmp_id, fy_id: scope.fy_id, bo_id: scope.bo_id }
  if (scope.acs_type === 0 || scope.acs_type === 1) q.acs_type = scope.acs_type
  return q
}

// ---------------------------------------------------------------------------
// Scope registration
// ---------------------------------------------------------------------------

let activeScope: CompanyScope | null = null

/** CompanyProvider calls this whenever the selected company / FY / branch changes. */
export function setActiveScope(scope: CompanyScope | null): void {
  activeScope = scope
}

export function getActiveScope(): CompanyScope | null {
  return activeScope
}

// ---------------------------------------------------------------------------
// Request
// ---------------------------------------------------------------------------

export interface RequestOptions {
  query?: QueryParams
  body?: unknown
  signal?: AbortSignal
  /**
   * `undefined` — inject the active company scope (the default).
   * `false` — send no scope (Manage relay, session probe).
   * A `CompanyScope` — use that scope instead of the active one.
   */
  scope?: CompanyScope | false
  headers?: Record<string, string>
  /** Milliseconds before the request is abandoned. Default 30s. */
  timeoutMs?: number
}

type Method = 'GET' | 'POST' | 'PUT' | 'DELETE'

const DEFAULT_TIMEOUT_MS = 30_000

function resolveScope(opt: RequestOptions['scope']): CompanyScope | null {
  if (opt === false) return null
  if (opt) return opt
  return activeScope
}

function combineSignals(external: AbortSignal | undefined, timeoutMs: number): AbortSignal {
  const timeout = AbortSignal.timeout(timeoutMs)
  if (!external) return timeout
  if (typeof AbortSignal.any === 'function') return AbortSignal.any([external, timeout])
  return external
}

async function readBody(res: Response): Promise<unknown> {
  const text = await res.text().catch(() => '')
  if (!text) return null
  try {
    return JSON.parse(text) as unknown
  } catch {
    return text
  }
}

async function send(method: Method, url: string, opts: RequestOptions, bodyJson: string | undefined, sesKey: string): Promise<Response> {
  const headers: Record<string, string> = {
    Accept: 'application/json',
    Authorization: `Bearer ${sesKey}`,
    // Lets the API's Manage relay pick the sandbox vs production Manage origin
    // from the browser host even when the API is on another domain (local dev).
    'X-Origin-Host': window.location.host,
    ...(opts.headers ?? {}),
  }
  if (bodyJson !== undefined) headers['Content-Type'] = 'application/json'
  return fetch(url, {
    method,
    headers,
    body: bodyJson,
    signal: combineSignals(opts.signal, opts.timeoutMs ?? DEFAULT_TIMEOUT_MS),
  })
}

async function request<T>(method: Method, path: string, opts: RequestOptions = {}): Promise<T> {
  const scope = resolveScope(opts.scope)
  const query = { ...scopeToQuery(scope), ...(opts.query ?? {}) }
  const url = `${getApiBaseUrl()}/${path.replace(/^\//, '')}${buildQueryString(query)}`
  const bodyJson = opts.body === undefined ? undefined : JSON.stringify(withScopeInBody(opts.body, scope))

  let res: Response
  try {
    res = await send(method, url, opts, bodyJson, await ensureSesKey())
    if (res.status === 401) {
      // The key may have been revoked before its local expiry: mint once more.
      clearSession()
      res = await send(method, url, opts, bodyJson, await ensureSesKey())
    }
  } catch (err) {
    if (err instanceof ApiError) throw err
    if ((err as Error)?.name === 'AbortError' || (err as Error)?.name === 'TimeoutError') throw err
    throw new ApiError(0, 'network_error', errorMessage(err, 'Could not reach the Inventory API.'))
  }

  if (res.status === 204) return undefined as T
  const body = await readBody(res)
  if (!res.ok) throw parseErrorBody(res.status, body)
  return body as T
}

export const api = {
  get<T>(path: string, opts?: RequestOptions): Promise<T> {
    return request<T>('GET', path, opts)
  },
  post<T>(path: string, body?: unknown, opts?: RequestOptions): Promise<T> {
    return request<T>('POST', path, { ...opts, body: body ?? {} })
  },
  put<T>(path: string, body?: unknown, opts?: RequestOptions): Promise<T> {
    return request<T>('PUT', path, { ...opts, body: body ?? {} })
  },
  delete<T>(path: string, opts?: RequestOptions): Promise<T> {
    return request<T>('DELETE', path, opts)
  },
  /** GET a paginated list. `page` is translated to `offset` client-side. */
  list<T>(path: string, query: ListQuery = {}, opts?: RequestOptions): Promise<ListResponse<T>> {
    const { page, ...rest } = query
    const q: QueryParams = { ...rest }
    if (page !== undefined && rest.offset === undefined) {
      q.offset = offsetForPage(Number(page), Number(rest.limit ?? 50))
    }
    return request<ListResponse<T>>('GET', path, { ...opts, query: { ...(opts?.query ?? {}), ...q } })
  },
}

/** True when the failure was the caller's own abort (deps changed, unmounted). */
export function isAbortError(err: unknown): boolean {
  return err instanceof Error && (err.name === 'AbortError' || err.name === 'TimeoutError')
}
