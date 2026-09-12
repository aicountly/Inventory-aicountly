import { describe, expect, it } from 'vitest'
import { ApiError, buildQueryString, offsetForPage, pageCount, pageForOffset, pageRange, parseErrorBody, scopeToQuery, withScopeInBody } from './api'

describe('buildQueryString', () => {
  it('drops empty, null and undefined values', () => {
    expect(buildQueryString({ q: '', a: null, b: undefined, c: 'x' })).toBe('?c=x')
  })

  it('encodes booleans as 1/0 for the API\'s (int) casts', () => {
    expect(buildQueryString({ with_stock: true, active_only: false })).toBe('?with_stock=1&active_only=0')
  })

  it('keeps zero (bo_id 0 = consolidated)', () => {
    expect(buildQueryString({ bo_id: 0 })).toBe('?bo_id=0')
  })

  it('returns an empty string when nothing survives', () => {
    expect(buildQueryString({})).toBe('')
    expect(buildQueryString(undefined)).toBe('')
  })

  it('url-encodes values', () => {
    expect(buildQueryString({ q: 'a b&c' })).toBe('?q=a+b%26c')
  })
})

describe('pagination helpers', () => {
  it('converts pages to offsets and back', () => {
    expect(offsetForPage(1, 50)).toBe(0)
    expect(offsetForPage(3, 50)).toBe(100)
    expect(offsetForPage(0, 50)).toBe(0)
    expect(pageForOffset(0, 50)).toBe(1)
    expect(pageForOffset(100, 50)).toBe(3)
    expect(pageForOffset(120, 50)).toBe(3)
  })

  it('counts pages with at least one page', () => {
    expect(pageCount(0, 50)).toBe(1)
    expect(pageCount(50, 50)).toBe(1)
    expect(pageCount(51, 50)).toBe(2)
    expect(pageCount(10, 0)).toBe(10)
  })

  it('describes the visible range', () => {
    expect(pageRange({ total: 0, limit: 50, offset: 0 })).toEqual({ from: 0, to: 0 })
    expect(pageRange({ total: 120, limit: 50, offset: 100 })).toEqual({ from: 101, to: 120 })
    expect(pageRange({ total: 120, limit: 50, offset: 0 })).toEqual({ from: 1, to: 50 })
  })
})

describe('parseErrorBody', () => {
  it('reads the structured envelope', () => {
    const err = parseErrorBody(409, { error: { code: 'delete_blocked', message: 'In use', details: { guard: 'item(s)', count: 3 } }, message: 'In use' })
    expect(err).toBeInstanceOf(ApiError)
    expect(err.status).toBe(409)
    expect(err.code).toBe('delete_blocked')
    expect(err.message).toBe('In use')
    expect(err.details).toEqual({ guard: 'item(s)', count: 3 })
    expect(err.field).toBeNull()
  })

  it('exposes the blamed field', () => {
    const err = parseErrorBody(422, { error: { code: 'validation_failed', message: 'item_name is required', details: { field: 'item_name' } } })
    expect(err.field).toBe('item_name')
  })

  it('falls back to the legacy message and a default code', () => {
    const err = parseErrorBody(404, { message: 'Not found here' })
    expect(err.code).toBe('not_found')
    expect(err.message).toBe('Not found here')
  })

  it('handles CI4 validation maps, plain text and empty bodies', () => {
    expect(parseErrorBody(422, { messages: { a: 'A bad', b: 'B bad' } }).message).toBe('A bad B bad')
    expect(parseErrorBody(500, 'Boom').message).toBe('Boom')
    expect(parseErrorBody(502, null).message).toBe('HTTP 502')
    expect(parseErrorBody(502, null).code).toBe('server_error')
  })
})

describe('scope injection', () => {
  const scope = { cmp_id: 7, fy_id: 3, bo_id: 0, acs_type: 1 as const }

  it('adds the scope to the query, including acs_type when known', () => {
    expect(scopeToQuery(scope)).toEqual({ cmp_id: 7, fy_id: 3, bo_id: 0, acs_type: 1 })
    expect(scopeToQuery({ cmp_id: 7, fy_id: 3, bo_id: 2 })).toEqual({ cmp_id: 7, fy_id: 3, bo_id: 2 })
    expect(scopeToQuery(null)).toEqual({})
  })

  it('merges the scope under the body without overriding explicit keys', () => {
    expect(withScopeInBody({ name: 'x' }, scope)).toEqual({ cmp_id: 7, fy_id: 3, bo_id: 0, name: 'x' })
    expect(withScopeInBody({ fy_id: 0, rows: [] }, scope)).toEqual({ cmp_id: 7, fy_id: 0, bo_id: 0, rows: [] })
  })

  it('leaves arrays and non-objects alone', () => {
    expect(withScopeInBody([1, 2], scope)).toEqual([1, 2])
    expect(withScopeInBody('raw', scope)).toBe('raw')
    expect(withScopeInBody({ a: 1 }, null)).toEqual({ a: 1 })
  })
})
