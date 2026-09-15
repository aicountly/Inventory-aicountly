import { describe, expect, it } from 'vitest'
import { GLOBAL_SHORTCUTS } from './shortcutRegistry'
import {
  SEQUENCE_SHORTCUTS,
  isSequenceKey,
  resolveSequence,
  sequenceKey,
  sequenceLabel,
  sequencePrefixes,
} from './sequences'

/**
 * A bare letter is the most dangerous kind of shortcut: every text field in the
 * app is one keystroke away from firing it. These tests pin the guards that
 * stop a keystroke someone meant as typing from navigating the app instead.
 */
describe('resolveSequence', () => {
  it('completes a registered sequence', () => {
    const r = resolveSequence(['g', '1'])
    expect(r.status).toBe('match')
    if (r.status === 'match') expect(r.shortcut.id).toBe('dash.overview')
  })

  it('keeps buffering a valid prefix', () => {
    expect(resolveSequence(['g']).status).toBe('prefix')
    expect(resolveSequence(['n']).status).toBe('prefix')
  })

  it('reports a dead end rather than swallowing the next key too', () => {
    // 'g' then 'z' is nothing. The buffer has to reset, or the NEXT key gets
    // eaten as the third element of a sequence that was never going to match.
    expect(resolveSequence(['g', 'z']).status).toBe('none')
    expect(resolveSequence(['z']).status).toBe('none')
  })

  it('matches nothing on an empty buffer', () => {
    expect(resolveSequence([]).status).toBe('none')
  })

  it('only offers shortcuts the caller passed, so permissions really gate it', () => {
    // The provider filters the registry by can() before calling this, so a
    // command nobody may run must not resolve just because it was typed.
    const permitted = SEQUENCE_SHORTCUTS.filter((s) => s.id === 'go.items')
    expect(resolveSequence(['g', '1'], permitted).status).toBe('none')
    expect(resolveSequence(['g', 'i'], permitted).status).toBe('match')
  })
})

describe('isSequenceKey', () => {
  const event = (init: Partial<KeyboardEvent>) => init as KeyboardEvent

  it('accepts a plain letter or digit', () => {
    expect(isSequenceKey(event({ key: 'g' }))).toBe(true)
    expect(isSequenceKey(event({ key: '1' }))).toBe(true)
  })

  it('ignores anything carrying a modifier, so Ctrl and Alt combos pass through', () => {
    expect(isSequenceKey(event({ key: 'g', ctrlKey: true }))).toBe(false)
    expect(isSequenceKey(event({ key: 'g', metaKey: true }))).toBe(false)
    // AltGr reports as ctrl+alt on Windows; a non-US layout must keep working.
    expect(isSequenceKey(event({ key: 'g', altKey: true }))).toBe(false)
    expect(isSequenceKey(event({ key: 'g', ctrlKey: true, altKey: true }))).toBe(false)
  })

  it('ignores auto-repeat, so holding a key cannot walk a sequence forward', () => {
    expect(isSequenceKey(event({ key: 'g', repeat: true }))).toBe(false)
  })

  it('ignores an input method mid-composition', () => {
    expect(isSequenceKey(event({ key: 'g', isComposing: true }))).toBe(false)
    // Some browsers report keyCode 229 rather than isComposing during IME.
    expect(isSequenceKey(event({ key: 'g', keyCode: 229 }))).toBe(false)
  })

  it('ignores an event something else has already handled', () => {
    expect(isSequenceKey(event({ key: 'g', defaultPrevented: true }))).toBe(false)
  })

  it('ignores named keys, so Escape, Enter and Tab are never sequence starts', () => {
    for (const key of ['Escape', 'Enter', 'Tab', 'ArrowDown', 'F2', ' ']) {
      expect(isSequenceKey(event({ key })), key).toBe(false)
    }
  })
})

describe('the sequence registry', () => {
  it('has no duplicate sequences', () => {
    const keys = SEQUENCE_SHORTCUTS.map((s) => sequenceKey(s.keys))
    expect(new Set(keys).size, `duplicate sequence: ${keys.join(', ')}`).toBe(keys.length)
  })

  it('never collides with a chord shortcut', () => {
    // Chords all carry a modifier and sequences never start on a key with one,
    // so a collision is structurally impossible — this pins that property
    // rather than trusting it.
    for (const chord of GLOBAL_SHORTCUTS) {
      expect(chord.combo, `${chord.id} is a bare key and would collide`).toMatch(/(ctrl|cmd|alt|shift)\+/)
    }
  })

  it('does not repurpose a browser-reserved chord', () => {
    const reserved = ['ctrl+l', 'ctrl+r', 'ctrl+w', 'ctrl+t', 'ctrl+n']
    for (const chord of GLOBAL_SHORTCUTS) {
      expect(reserved, `${chord.combo} is reserved by the browser`).not.toContain(chord.combo)
    }
  })

  it('routes every command at a real screen and never at a mutation', () => {
    for (const s of SEQUENCE_SHORTCUTS) {
      expect(s.path.startsWith('/'), `${s.id} has no route`).toBe(true)
      // Commands open forms. None of them may name an action that writes.
      expect(s.path).not.toMatch(/\/(post|approve|submit|delete|reverse|cancel|replay|run)(\/|$|\?)/)
    }
  })

  it('has exactly two keys in every sequence, so the help text is never a lie', () => {
    for (const s of SEQUENCE_SHORTCUTS) {
      expect(s.keys, s.id).toHaveLength(2)
      expect(sequenceLabel(s.keys)).toMatch(/^[A-Z0-9] then [A-Z0-9]$/)
    }
  })

  it('starts sequences on only a couple of prefixes, so little is shadowed', () => {
    expect([...sequencePrefixes()].sort()).toEqual(['g', 'n'])
  })
})
