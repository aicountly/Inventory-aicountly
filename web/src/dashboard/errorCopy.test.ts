import { describe, expect, it } from 'vitest'
import { cardErrorCopy, isContextError } from './errorCopy'
import { ApiError } from '../services/api'

/** Anything a user must never read on a card. */
const INTERNALS = [
  'cmp_id',
  'fy_id',
  'bo_id',
  'SQLSTATE',
  'inv_stock_balances',
  'HTTP 500',
  'Stack trace',
  '/v1/dashboard',
]

describe('card error copy', () => {
  it('turns the context error into a sentence about choosing a company', () => {
    // The exact failure this module exists for: the live screen printed
    // "Company context required (cmp_id, fy_id, bo_id)" onto a card.
    const copy = cardErrorCopy(
      new ApiError(400, 'context_required', 'Company context required (cmp_id, fy_id, bo_id)'),
      'inventory value',
    )
    expect(copy.title).toBe('Select a company and financial year')
    expect(copy.message).toContain('company, financial year and branch')
    // Nothing to retry until a company is picked.
    expect(copy.retryable).toBe(false)
    expect(copy.tone).toBe('notice')
  })

  it('never leaks an internal identifier, whatever the server said', () => {
    const errors: unknown[] = [
      new ApiError(400, 'context_required', 'Company context required (cmp_id, fy_id, bo_id)'),
      new ApiError(403, 'forbidden', 'reports.stock_ageing.read denied for bo_id 4'),
      new ApiError(500, 'server_error', 'SQLSTATE[42P01] relation "inv_stock_balances" does not exist'),
      new ApiError(0, 'network_error', 'fetch failed GET /v1/dashboard/valuation-bridge'),
      new ApiError(422, 'validation_failed', 'as_of must be <= fy_end'),
      new Error('Stack trace at renderWithHooks'),
      'a bare string',
      null,
    ]
    for (const error of errors) {
      const copy = cardErrorCopy(error, 'stock ageing')
      const text = `${copy.title} ${copy.message}`
      for (const secret of INTERNALS) {
        expect(text, `"${secret}" reached the card`).not.toContain(secret)
      }
      expect(copy.title.length).toBeGreaterThan(0)
      expect(copy.message.length).toBeGreaterThan(0)
    }
  })

  it('names what failed, so six cards do not read as six copies of one sentence', () => {
    expect(cardErrorCopy(new ApiError(500, 'server_error', 'boom'), 'stock ageing').title).toContain('stock ageing')
    expect(cardErrorCopy(new ApiError(500, 'server_error', 'boom'), 'the warehouse split').title).toContain(
      'the warehouse split',
    )
  })

  it('does not offer to retry what retrying cannot fix', () => {
    expect(cardErrorCopy(new ApiError(403, 'forbidden', 'nope')).retryable).toBe(false)
    expect(cardErrorCopy(new ApiError(404, 'not_found', 'nope')).retryable).toBe(false)
    expect(cardErrorCopy(new ApiError(500, 'server_error', 'nope')).retryable).toBe(true)
    expect(cardErrorCopy(new ApiError(0, 'network_error', 'nope')).retryable).toBe(true)
  })

  it('tells a slow answer apart from a broken one', () => {
    const timeout = new Error('timed out')
    timeout.name = 'TimeoutError'
    expect(cardErrorCopy(timeout, 'the value bridge').message).toContain('longer than expected')
  })

  it('recognises the context error for the page-level message', () => {
    expect(isContextError(new ApiError(400, 'context_required', 'x'))).toBe(true)
    expect(isContextError(new ApiError(403, 'forbidden', 'x'))).toBe(false)
    expect(isContextError(new Error('x'))).toBe(false)
  })
})
