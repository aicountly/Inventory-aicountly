/**
 * Match a keyboard event against a combo string like "ctrl+shift+s" or "f2".
 * Ported from books-react-app/web/src/keyboard/matchShortcut.js — the two
 * products must agree on what Ctrl+P means.
 */
export function matchShortcut(e: KeyboardEvent, combo: string): boolean {
  if (!combo || !e) return false
  const parts = combo.toLowerCase().split('+').map((p) => p.trim())
  const needCtrl = parts.includes('ctrl') || parts.includes('cmd')
  const needAlt = parts.includes('alt')
  const needShift = parts.includes('shift')
  const keyPart = parts.filter((p) => !['ctrl', 'cmd', 'alt', 'shift'].includes(p))[0]
  if (!keyPart) return false

  const ctrlOrMeta = e.ctrlKey || e.metaKey
  if (needCtrl !== ctrlOrMeta) return false
  if (needAlt !== e.altKey) return false
  if (needShift !== e.shiftKey) return false

  // A held Alt (macOS Option, and some non-US layouts) composes e.key into a
  // different character entirely — Alt+B often reports "∫", not "b". e.code
  // reflects the physical key regardless of modifiers or layout.
  if (/^[a-z0-9]$/.test(keyPart)) {
    const code = e.code || ''
    const physicalKey = /^Key[A-Z]$/.test(code)
      ? code.slice(3).toLowerCase()
      : /^Digit[0-9]$/.test(code)
        ? code.slice(5)
        : null
    if (physicalKey) return physicalKey === keyPart
  }

  const eventKey = (e.key || '').toLowerCase()
  if (/^f\d+$/.test(keyPart)) return eventKey === keyPart
  return eventKey === keyPart
}

/** Normalise a combo for lookup (ctrl and cmd are equivalent). */
export function normalizeCombo(combo: string): string {
  const order: Record<string, number> = { ctrl: 0, alt: 1, shift: 2 }
  return combo
    .toLowerCase()
    .split('+')
    .map((p) => p.trim())
    .map((p) => (p === 'cmd' ? 'ctrl' : p))
    .sort((a, b) => {
      const oa = order[a] ?? 3
      const ob = order[b] ?? 3
      if (oa !== ob) return oa - ob
      return a.localeCompare(b)
    })
    .join('+')
}
