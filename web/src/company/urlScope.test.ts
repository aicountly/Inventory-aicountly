import { describe, expect, it } from 'vitest'
import {
  askedId,
  parseUrlScope,
  resolveRequestedBranch,
  resolveRequestedCompany,
  resolveRequestedFy,
  resolveUnreadableScope,
  scopeForCompany,
  stripScopeParams,
} from './urlScope'

/**
 * The scope a Books link hands over.
 *
 * Two halves are being asserted. The first is conformance with the emitter:
 * Books builds these URLs in `web/src/services/inventoryApi.js`
 * (`buildInventoryAppLink` → `buildInventoryQuery({cmpId, fyId, boId})`, which
 * snake_cases the keys), and a link that type-checks in that repo and is
 * ignored in this one is exactly how a user ends up on someone else's record.
 * The second is the refusal: a scope this user cannot open must stop the visit
 * and say so, because answering with the company they were already on puts a
 * DIFFERENT record under the id the link named.
 */

/** A link as Books emits it, down to the key names and the order. */
const BOOKS_LINK = 'https://inventory.aicountly.com/masters/bill-of-materials/42?cmp_id=54&fy_id=31&bo_id=0'

const COMPANIES = [{ cmpId: 54 }, { cmpId: 7 }]
const FY_LIST = [{ fyId: 31 }, { fyId: 30 }]
const BRANCHES = [{ boId: 2 }, { boId: 3 }]

describe('parseUrlScope', () => {
  it('reads the three parameters off a link Books actually emits', () => {
    const scope = parseUrlScope(new URL(BOOKS_LINK).search)

    expect(scope).not.toBeNull()
    expect(askedId(scope!.cmp)).toBe(54)
    expect(askedId(scope!.fy)).toBe(31)
    // 0 is consolidated — an answer, not a gap, so it must survive the parse.
    expect(scope!.bo).toEqual({ state: 'id', id: 0 })
  })

  it('reads a scope that sits beside another screen’s parameters', () => {
    const scope = parseUrlScope('?cmp_id=54&fy_id=31&bo_id=2&document_type=STOCK_TRANSFER')

    expect(askedId(scope!.cmp)).toBe(54)
    expect(askedId(scope!.bo)).toBe(2)
  })

  it('is null when the URL names no scope at all', () => {
    // The whole of "a link with no scope parameters behaves exactly as before".
    expect(parseUrlScope('')).toBeNull()
    expect(parseUrlScope('?document_type=STOCK_TRANSFER&page=2')).toBeNull()
    // Present but empty is not a request: Books drops empty values before it
    // builds the query, and an empty parameter cannot name a company.
    expect(parseUrlScope('?cmp_id=&fy_id=')).toBeNull()
  })

  it('keeps a value that is not an id rather than dropping it', () => {
    const scope = parseUrlScope('?cmp_id=abc&fy_id=-3&bo_id=1.5')

    expect(scope!.cmp).toEqual({ state: 'unreadable', raw: 'abc' })
    expect(scope!.fy).toEqual({ state: 'unreadable', raw: '-3' })
    expect(scope!.bo).toEqual({ state: 'unreadable', raw: '1.5' })
    expect(askedId(scope!.cmp)).toBeNull()
  })

  it('treats company 0 as unreadable and branch 0 as consolidated', () => {
    const scope = parseUrlScope('?cmp_id=0&bo_id=0')

    expect(scope!.cmp.state).toBe('unreadable')
    expect(askedId(scope!.bo)).toBe(0)
  })
})

describe('resolveRequestedCompany', () => {
  it('accepts a company the user can open', () => {
    expect(resolveRequestedCompany(parseUrlScope('?cmp_id=54'), COMPANIES)).toEqual({ state: 'accepted', id: 54 })
  })

  it('refuses one the user cannot, and names it', () => {
    const decision = resolveRequestedCompany(parseUrlScope('?cmp_id=99'), COMPANIES)

    expect(decision.state).toBe('refused')
    if (decision.state !== 'refused') throw new Error('expected a refusal')
    // What was asked for...
    expect(decision.message).toContain('company #99')
    // ...and why nothing opened instead of opening it somewhere else.
    expect(decision.message).toContain('Nothing was opened')
    expect(decision.message).toContain('different record')
  })

  it('refuses a company that is not a number', () => {
    const decision = resolveRequestedCompany(parseUrlScope('?cmp_id=abc'), COMPANIES)

    expect(decision.state).toBe('refused')
    if (decision.state !== 'refused') throw new Error('expected a refusal')
    expect(decision.message).toContain('“abc”')
  })

  it('has no opinion when the link named no company', () => {
    expect(resolveRequestedCompany(parseUrlScope('?fy_id=31'), COMPANIES)).toEqual({ state: 'none' })
    expect(resolveRequestedCompany(null, COMPANIES)).toEqual({ state: 'none' })
  })
})

describe('resolveRequestedFy', () => {
  it('accepts a year the company has', () => {
    expect(resolveRequestedFy(parseUrlScope('?fy_id=31'), 'Acme Ltd', FY_LIST)).toEqual({ state: 'accepted', id: 31 })
  })

  it('refuses a year the company does not have, and names both', () => {
    const decision = resolveRequestedFy(parseUrlScope('?fy_id=99'), 'Acme Ltd', FY_LIST)

    expect(decision.state).toBe('refused')
    if (decision.state !== 'refused') throw new Error('expected a refusal')
    expect(decision.message).toContain('financial year #99')
    expect(decision.message).toContain('Acme Ltd')
  })

  it('falls back to a neutral noun when the company has no name yet', () => {
    const decision = resolveRequestedFy(parseUrlScope('?fy_id=99'), '', FY_LIST)

    if (decision.state !== 'refused') throw new Error('expected a refusal')
    expect(decision.message).toContain('this company')
  })

  it('has no opinion when the link named no year', () => {
    expect(resolveRequestedFy(parseUrlScope('?cmp_id=54'), 'Acme Ltd', FY_LIST)).toEqual({ state: 'none' })
  })
})

describe('resolveRequestedBranch', () => {
  it('accepts a branch of the company', () => {
    expect(resolveRequestedBranch(parseUrlScope('?bo_id=2'), 'Acme Ltd', BRANCHES)).toEqual({ state: 'accepted', id: 2 })
  })

  it('accepts consolidated without consulting the branch list', () => {
    expect(resolveRequestedBranch(parseUrlScope('?bo_id=0'), 'Acme Ltd', [])).toEqual({ state: 'accepted', id: 0 })
  })

  it('refuses a branch of some other company, and names it', () => {
    const decision = resolveRequestedBranch(parseUrlScope('?bo_id=9'), 'Acme Ltd', BRANCHES)

    expect(decision.state).toBe('refused')
    if (decision.state !== 'refused') throw new Error('expected a refusal')
    expect(decision.message).toContain('branch #9')
    expect(decision.message).toContain('Acme Ltd')
  })
})

describe('resolveUnreadableScope', () => {
  it('refuses a year or branch that is not a number, before any list is loaded', () => {
    const fy = resolveUnreadableScope(parseUrlScope('?cmp_id=54&fy_id=abc'))
    expect(fy.state).toBe('refused')
    if (fy.state !== 'refused') throw new Error('expected a refusal')
    expect(fy.message).toContain('“abc”')

    expect(resolveUnreadableScope(parseUrlScope('?bo_id=x')).state).toBe('refused')
  })

  it('passes anything that IS a number, however wrong it may turn out to be', () => {
    // Settled later against the real lists — "cannot be checked yet" must never
    // read as "is nonsense".
    expect(resolveUnreadableScope(parseUrlScope('?cmp_id=99&fy_id=99&bo_id=99'))).toEqual({ state: 'none' })
    expect(resolveUnreadableScope(null)).toEqual({ state: 'none' })
  })
})

describe('scopeForCompany', () => {
  it('keeps the request while it is about the company now open', () => {
    const scope = parseUrlScope('?cmp_id=54&fy_id=31')

    expect(scopeForCompany(scope, 54)).toBe(scope)
    // A link that named no company is about whichever one the visit resolved to.
    expect(scopeForCompany(parseUrlScope('?fy_id=31'), 54)).not.toBeNull()
  })

  it('drops it once another company is open', () => {
    // Company 7's year 31 is not company 54's year 31; carrying it over is the
    // silent swap this module exists to prevent.
    expect(scopeForCompany(parseUrlScope('?cmp_id=7&fy_id=31'), 54)).toBeNull()
    expect(scopeForCompany(parseUrlScope('?cmp_id=7'), null)).toBeNull()
  })
})

describe('stripScopeParams', () => {
  it('takes out the three and leaves the rest of the query alone', () => {
    expect(stripScopeParams('?cmp_id=54&document_type=STOCK_TRANSFER&fy_id=31&bo_id=0&page=2')).toBe(
      '?document_type=STOCK_TRANSFER&page=2',
    )
  })

  it('leaves nothing behind when the scope was the whole query', () => {
    expect(stripScopeParams('?cmp_id=54&fy_id=31&bo_id=0')).toBe('')
  })

  it('returns the query untouched when there is no scope in it', () => {
    expect(stripScopeParams('?page=2')).toBe('?page=2')
    expect(stripScopeParams('')).toBe('')
    // Untouched to the character, not merely equivalent: a URL with nothing to
    // strip must not be rewritten at all, and a round trip through
    // URLSearchParams would quietly turn `%20` into `+`.
    expect(stripScopeParams('?q=a%20b')).toBe('?q=a%20b')
  })
})
