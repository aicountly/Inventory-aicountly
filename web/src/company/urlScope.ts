/**
 * The company / financial year / branch a link asked Inventory to open.
 *
 * Books links into Inventory from many places — the "Managed in Inventory"
 * master badges, the historical-register notices, the command palette, the
 * mobile hand-off — and the web ones carry the Books scope as `cmp_id` /
 * `fy_id` / `bo_id` (books-react-app `web/src/services/inventoryApi.js`,
 * `buildInventoryAppLink` → `buildInventoryQuery({cmpId, fyId, boId})`, whose
 * camelCase keys are emitted snake_case). Nothing here used to read them:
 * `CompanyContext` scoped the app from `companyStorage.readSelection()` or fell
 * back to `companies[0]`, so a user whose Inventory tab last sat in company B
 * could follow a link to BOM #42 in company A and land on company B's BOM #42 —
 * a different record under the number the screen promised.
 *
 * Everything here is pure string / list work so the decision can be asserted
 * without a renderer. The side that touches the address bar is
 * `clearScopeParamsFromUrl` at the bottom, and it is the only DOM in the file.
 *
 * A scope the user cannot open is REFUSED, never quietly swapped for the one
 * they are on: the swap is the bug. Each refusal says what was asked for.
 */

/** Query parameters that carry a scope, in the order Books writes them. */
export const SCOPE_PARAMS = ['cmp_id', 'fy_id', 'bo_id'] as const

/** One axis of the request: absent, an id, or present-but-not-an-id. */
export type AskedValue =
  | { state: 'absent' }
  | { state: 'id'; id: number }
  | { state: 'unreadable'; raw: string }

export interface RequestedScope {
  cmp: AskedValue
  fy: AskedValue
  /** `bo_id=0` is consolidated (all branches), so zero is an answer, not a gap. */
  bo: AskedValue
}

/** What the provider should do with one axis of the request. */
export type ScopeResolution =
  | { state: 'none' }
  | { state: 'accepted'; id: number }
  | { state: 'refused'; message: string }

const ABSENT: AskedValue = { state: 'absent' }
const NONE: ScopeResolution = { state: 'none' }

function askedFor(raw: string | null, allowZero: boolean): AskedValue {
  if (raw === null) return ABSENT
  const text = raw.trim()
  // `?cmp_id=` is not a request for a company; Books drops empty values before
  // it builds the query, and an empty one cannot name anything.
  if (text === '') return ABSENT
  const n = Number(text)
  if (!Number.isInteger(n) || n < 0 || (!allowZero && n < 1)) return { state: 'unreadable', raw: text }
  return { state: 'id', id: n }
}

/**
 * The scope named by a query string, or null when it names none.
 *
 * Null is the whole of requirement "a link with no scope parameters behaves
 * exactly as it did before": the provider skips every branch below it.
 */
export function parseUrlScope(search: string): RequestedScope | null {
  const params = new URLSearchParams(search)
  const scope: RequestedScope = {
    cmp: askedFor(params.get('cmp_id'), false),
    fy: askedFor(params.get('fy_id'), false),
    bo: askedFor(params.get('bo_id'), true),
  }
  if (scope.cmp.state === 'absent' && scope.fy.state === 'absent' && scope.bo.state === 'absent') return null
  return scope
}

/** The id an axis asked for, ignoring whether anything can honour it. */
export function askedId(asked: AskedValue): number | null {
  return asked.state === 'id' ? asked.id : null
}

/**
 * The request, but only while it is about the company now open.
 *
 * A link names one company's financial year and branch. Once the user has
 * picked a different company the rest of the request is about someone else's
 * scope and must not be applied to theirs; a link that named no company at all
 * is about whichever company the visit resolved to, so it still applies.
 */
export function scopeForCompany(scope: RequestedScope | null, cmpId: number | null): RequestedScope | null {
  if (!scope || cmpId === null) return null
  const cmp = askedId(scope.cmp)
  return cmp === null || cmp === cmpId ? scope : null
}

function companyLabel(name: string): string {
  return name.trim() || 'this company'
}

/**
 * The company the link named, checked against the companies the user can open.
 *
 * That list IS the access boundary — it is what Manage returns for this user —
 * so a company missing from it is one they may not open, and the answer is a
 * refusal rather than a fallback.
 */
export function resolveRequestedCompany(
  scope: RequestedScope | null,
  companies: readonly { cmpId: number }[],
): ScopeResolution {
  if (!scope) return NONE
  const asked = scope.cmp
  if (asked.state === 'absent') return NONE
  const wanted = asked.state === 'id' ? `company #${asked.id}` : `company “${asked.raw}”`
  const because =
    asked.state === 'id'
      ? 'which you cannot open in Inventory'
      : 'which is not a company number'
  if (asked.state === 'id' && companies.some((c) => c.cmpId === asked.id)) {
    return { state: 'accepted', id: asked.id }
  }
  return {
    state: 'refused',
    message:
      `This link asked for ${wanted}, ${because}. Nothing was opened — the same page in another ` +
      'company is a different record. Ask for access in Manage and reload, or pick one of your ' +
      'companies from the switcher above.',
  }
}

/** The financial year the link named, checked against the company's years. */
export function resolveRequestedFy(
  scope: RequestedScope | null,
  companyName: string,
  fyList: readonly { fyId: number }[],
): ScopeResolution {
  if (!scope) return NONE
  const asked = scope.fy
  if (asked.state === 'absent') return NONE
  if (asked.state === 'id' && fyList.some((f) => f.fyId === asked.id)) {
    return { state: 'accepted', id: asked.id }
  }
  const wanted = asked.state === 'id' ? `financial year #${asked.id}` : `financial year “${asked.raw}”`
  const because =
    asked.state === 'id'
      ? `which ${companyLabel(companyName)} does not have`
      : 'which is not a financial year number'
  return {
    state: 'refused',
    message:
      `This link asked for ${wanted}, ${because}. Nothing was opened — another year shows ` +
      'different figures under the same link. Pick a financial year from the switcher above.',
  }
}

/**
 * The branch the link named, checked against the company's branches.
 *
 * `bo_id=0` is consolidated and always answerable, which is why it is accepted
 * without consulting the list.
 */
export function resolveRequestedBranch(
  scope: RequestedScope | null,
  companyName: string,
  branches: readonly { boId: number }[],
): ScopeResolution {
  if (!scope) return NONE
  const asked = scope.bo
  if (asked.state === 'absent') return NONE
  if (asked.state === 'id' && (asked.id === 0 || branches.some((b) => b.boId === asked.id))) {
    return { state: 'accepted', id: asked.id }
  }
  const wanted = asked.state === 'id' ? `branch #${asked.id}` : `branch “${asked.raw}”`
  const because =
    asked.state === 'id'
      ? `which is not a branch of ${companyLabel(companyName)}`
      : 'which is not a branch number'
  return {
    state: 'refused',
    message:
      `This link asked for ${wanted}, ${because}. Nothing was opened — another branch shows ` +
      'different stock under the same link. Pick a branch from the switcher above.',
  }
}

/**
 * The refusal owed to a parameter that is not an id at all.
 *
 * Decidable without any list, so the provider settles it before it picks a
 * company. That is what keeps the checks downstream honest: by the time the
 * year and the branch are resolved, every parameter still in play is a number,
 * and "cannot be checked right now" can never be confused with "is nonsense".
 */
export function resolveUnreadableScope(scope: RequestedScope | null): ScopeResolution {
  if (!scope) return NONE
  if (scope.cmp.state === 'unreadable') return resolveRequestedCompany(scope, [])
  if (scope.fy.state === 'unreadable') return resolveRequestedFy(scope, '', [])
  if (scope.bo.state === 'unreadable') return resolveRequestedBranch(scope, '', [])
  return NONE
}

/** The same query string without the three scope parameters; everything else keeps its order. */
export function stripScopeParams(search: string): string {
  const params = new URLSearchParams(search)
  let touched = false
  for (const key of SCOPE_PARAMS) {
    if (params.has(key)) {
      params.delete(key)
      touched = true
    }
  }
  if (!touched) return search
  const rest = params.toString()
  return rest ? `?${rest}` : ''
}

/**
 * The scope named by the address bar right now, or null.
 *
 * Read once, at the provider's first render: a deep link is a document load,
 * and Inventory never builds an internal link that carries a scope.
 */
export function currentUrlScope(): RequestedScope | null {
  try {
    return parseUrlScope(window.location.search)
  } catch {
    return null
  }
}

/**
 * Take the three parameters out of the address bar once they have been honoured.
 *
 * replaceState, not a navigation: the app must not restart, and the visit is
 * already scoped. The selection has been written to localStorage by then, so a
 * reload of the shortened URL lands on the same company — and a later switch
 * from the switcher is not undone by an address bar still naming the old one.
 *
 * react-router keeps its own copy of the location, so a screen that rewrites
 * the query afterwards (useListParams) can put them back; harmless, because by
 * then the stored selection and the parameters agree.
 */
export function clearScopeParamsFromUrl(): void {
  try {
    const { pathname, search, hash } = window.location
    const next = stripScopeParams(search)
    if (next === search) return
    window.history.replaceState(null, '', `${pathname}${next}${hash}`)
  } catch {
    /* no history to rewrite — the parameters simply stay in the address bar */
  }
}
