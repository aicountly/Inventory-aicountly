import { describe, expect, it } from 'vitest'
import { pageWindow } from './TablePagination'

/**
 * The numbered strip an audit log needs.
 *
 * Two failures to rule out. A run of 250 buttons is not a control, and a strip
 * that drops the last page leaves the end of a long log unreachable except by
 * pressing Next until it arrives.
 */
describe('pageWindow', () => {
  it('always offers both ends', () => {
    const pages = pageWindow(120, 250)
    expect(pages[0]).toBe(1)
    expect(pages[pages.length - 1]).toBe(250)
  })

  it('marks the runs it skipped rather than implying the numbers are adjacent', () => {
    expect(pageWindow(120, 250)).toEqual([1, 'gap', 119, 120, 121, 'gap', 250])
  })

  it('stays a bounded width however long the log is', () => {
    expect(pageWindow(5000, 100000).length).toBeLessThanOrEqual(7)
  })

  it('draws every page when they all fit, with no gaps', () => {
    expect(pageWindow(1, 5)).toEqual([1, 2, 3, 4, 5])
    expect(pageWindow(3, 5)).toEqual([1, 2, 3, 4, 5])
  })

  /** Near an end the window is clipped, so it is made up from the other side. */
  it('keeps a stable width at the ends', () => {
    expect(pageWindow(1, 50)).toEqual([1, 2, 3, 4, 'gap', 50])
    expect(pageWindow(50, 50)).toEqual([1, 'gap', 47, 48, 49, 50])
  })

  it('has nothing to draw for an empty or single-page result', () => {
    expect(pageWindow(1, 0)).toEqual([])
    expect(pageWindow(1, 1)).toEqual([1])
  })
})
