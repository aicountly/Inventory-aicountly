import { describe, expect, it } from 'vitest'
import { matchShortcut, normalizeCombo } from './matchShortcut'

function ev(init: Partial<KeyboardEvent>): KeyboardEvent {
  return {
    key: '',
    code: '',
    ctrlKey: false,
    metaKey: false,
    altKey: false,
    shiftKey: false,
    ...init,
  } as KeyboardEvent
}

describe('matchShortcut', () => {
  it('matches a plain key', () => {
    expect(matchShortcut(ev({ key: '/' }), '/')).toBe(true)
    expect(matchShortcut(ev({ key: 'a', code: 'KeyA' }), 'a')).toBe(true)
  })

  it('requires the modifiers to match exactly', () => {
    expect(matchShortcut(ev({ key: 'p', code: 'KeyP', ctrlKey: true }), 'ctrl+p')).toBe(true)
    expect(matchShortcut(ev({ key: 'p', code: 'KeyP' }), 'ctrl+p')).toBe(false)
    expect(matchShortcut(ev({ key: 'p', code: 'KeyP', ctrlKey: true, shiftKey: true }), 'ctrl+p')).toBe(false)
  })

  it('treats cmd as ctrl so macOS works without a second table', () => {
    expect(matchShortcut(ev({ key: 'k', code: 'KeyK', metaKey: true }), 'ctrl+k')).toBe(true)
    expect(matchShortcut(ev({ key: 'k', code: 'KeyK', ctrlKey: true }), 'cmd+k')).toBe(true)
  })

  it('uses the physical key when Alt rewrites e.key', () => {
    // macOS Option+B reports "∫"; e.code still says KeyB.
    expect(matchShortcut(ev({ key: '∫', code: 'KeyB', altKey: true }), 'alt+b')).toBe(true)
  })

  it('matches function keys and named keys', () => {
    expect(matchShortcut(ev({ key: 'F12' }), 'f12')).toBe(true)
    expect(matchShortcut(ev({ key: 'F1' }), 'f12')).toBe(false)
    expect(matchShortcut(ev({ key: 'Escape' }), 'escape')).toBe(true)
    expect(matchShortcut(ev({ key: 'Enter' }), 'enter')).toBe(true)
  })

  it('is false for an empty or modifier-only combo', () => {
    expect(matchShortcut(ev({ key: 'a' }), '')).toBe(false)
    expect(matchShortcut(ev({ key: 'Control', ctrlKey: true }), 'ctrl')).toBe(false)
  })
})

describe('normalizeCombo', () => {
  it('sorts modifiers and folds cmd into ctrl', () => {
    expect(normalizeCombo('Shift+Ctrl+S')).toBe('ctrl+shift+s')
    expect(normalizeCombo('cmd+k')).toBe('ctrl+k')
  })
})
