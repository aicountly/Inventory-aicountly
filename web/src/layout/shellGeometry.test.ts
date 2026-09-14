import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

/**
 * Stacking order is a whole-app property: nothing a component test mounts can
 * show that the topbar sits above the page and below the mobile scrim, so the
 * one number that decides it is asserted here.
 *
 * It is also shared geometry — Books' topbar is `sticky top-0 z-20`
 * (web/src/components/AppTopbar.jsx:32) above a z-30 scrim and a z-40 rail, and
 * a different number here means the two products behave differently on the same
 * screen.
 */

const src = (path: string) => readFileSync(new URL(path, import.meta.url).pathname, 'utf8')

describe('shell stacking order', () => {
  it('keeps the topbar at z-20, under the mobile scrim and the rail', () => {
    const header = /<header className="([^"]*app-topbar[^"]*)"/.exec(src('./AppTopbar.tsx'))
    expect(header?.[1]).toContain('sticky top-0')
    expect(header?.[1]).toContain('z-20')
    expect(header?.[1]).not.toContain('z-30')
  })

  it('still keeps the scrim above it and the rail above that', () => {
    expect(src('./AppShell.tsx')).toContain('app-sidebar-scrim fixed inset-0 z-30')
    expect(src('./AppSidebar.tsx')).toContain('fixed inset-y-0 left-0 z-40')
  })
})
