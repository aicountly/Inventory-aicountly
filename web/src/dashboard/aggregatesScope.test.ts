import { describe, expect, it } from 'vitest'
import { assertScope } from './aggregatesApi'
import type { DashboardEnvelope } from './aggregatesApi'

function envelope(scope: { cmp_id: number; fy_id: number; bo_id: number }): DashboardEnvelope<{ ok: true }> {
  return {
    scope: { ...scope, timezone: 'Asia/Kolkata' },
    meta: { generated_at: '2026-09-15T10:42:00Z', status: 'ready' },
    data: { ok: true },
  }
}

/**
 * The belt to useQuery's braces.
 *
 * Aborting the previous request is a request to stop, not a promise that
 * nothing is already in flight and about to resolve. If a response computed for
 * the old company does land, it must be thrown away rather than rendered under
 * the new company's heading.
 */
describe('assertScope', () => {
  const expected = { cmp_id: 7, fy_id: 3, bo_id: 0 }

  it('passes a response computed for the scope on screen', () => {
    expect(() => assertScope(envelope(expected), expected)).not.toThrow()
  })

  it('rejects another company\'s answer', () => {
    expect(() => assertScope(envelope({ ...expected, cmp_id: 8 }), expected)).toThrow(/different company/i)
  })

  it('rejects another financial year', () => {
    expect(() => assertScope(envelope({ ...expected, fy_id: 4 }), expected)).toThrow()
  })

  it('rejects another branch', () => {
    // Branch 0 is "all branches" and is a different figure from branch 2 — a
    // consolidated total shown as one branch's is as wrong as another tenant's.
    expect(() => assertScope(envelope({ ...expected, bo_id: 2 }), expected)).toThrow()
  })

  it('returns the envelope so it can be used inline', () => {
    expect(assertScope(envelope(expected), expected).data.ok).toBe(true)
  })
})
