import { describe, expect, it } from 'vitest'
import { resolveBackTarget } from './resolveBackTarget'

describe('resolveBackTarget', () => {
  it('prefers an explicit backTo', () => {
    expect(
      resolveBackTarget({ backTo: '/items', breadcrumbs: [{ label: 'Home', to: '/dashboard' }] }),
    ).toBe('/items')
  })

  it('falls back to the last breadcrumb that has a target', () => {
    expect(
      resolveBackTarget({
        breadcrumbs: [
          { label: 'Home', to: '/dashboard' },
          { label: 'Masters', to: '/masters' },
          { label: 'Batches' },
        ],
      }),
    ).toBe('/masters')
  })

  it('returns null when there is nowhere to go', () => {
    expect(resolveBackTarget()).toBeNull()
    expect(resolveBackTarget({ breadcrumbs: [] })).toBeNull()
    expect(resolveBackTarget({ breadcrumbs: [{ label: 'Only' }] })).toBeNull()
  })
})
