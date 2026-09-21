import { afterEach, describe, expect, it, vi } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { MD_UP, useMediaQuery } from './useMediaQuery'

type Listener = (e: MediaQueryListEvent) => void

function stubMatchMedia(matches: boolean) {
  const listeners = new Set<Listener>()
  const mql = {
    matches,
    addEventListener: (_: string, fn: Listener) => listeners.add(fn),
    removeEventListener: (_: string, fn: Listener) => listeners.delete(fn),
  }
  vi.stubGlobal('matchMedia', vi.fn(() => mql))
  return {
    emit(next: boolean) {
      mql.matches = next
      listeners.forEach((fn) => fn({ matches: next } as MediaQueryListEvent))
    },
    get listenerCount() {
      return listeners.size
    },
  }
}

afterEach(() => vi.unstubAllGlobals())

describe('useMediaQuery', () => {
  it('reports whether the query matches', () => {
    stubMatchMedia(true)
    expect(renderHook(() => useMediaQuery(MD_UP)).result.current).toBe(true)
  })

  it('follows the viewport as it changes', () => {
    const media = stubMatchMedia(false)
    const { result } = renderHook(() => useMediaQuery(MD_UP))
    expect(result.current).toBe(false)
    act(() => media.emit(true))
    expect(result.current).toBe(true)
  })

  it('falls back rather than throwing where matchMedia is missing', () => {
    // jsdom, and any browser old enough not to have it.
    vi.stubGlobal('matchMedia', undefined)
    expect(renderHook(() => useMediaQuery(MD_UP)).result.current).toBe(false)
    expect(renderHook(() => useMediaQuery(MD_UP, true)).result.current).toBe(true)
  })

  it('removes its listener on unmount', () => {
    const media = stubMatchMedia(true)
    const { unmount } = renderHook(() => useMediaQuery(MD_UP))
    expect(media.listenerCount).toBe(1)
    unmount()
    expect(media.listenerCount).toBe(0)
  })
})
